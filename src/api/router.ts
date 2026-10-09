import { chainHead, ledgerRoot, verifyChain } from "@/services/ledger/auditLedger";
import { closureProbability, CLOSURE_CALIBRATION } from "@/services/ml/closureModel";
import { MODEL_CARD } from "@/services/ml/riskEngine";
import { verifyDelayReport, type DelayReport } from "@/services/reports/delayReport";
import { CASPIAN_PORTS, telemetryConfigFromEnv, type CaspianPort } from "@/services/telemetry";
import { authConfigFromEnv, authenticate, type ApiClient, type AuthConfig } from "./auth";
import { CorridorService } from "./corridorService";
import { OPENAPI_SPEC } from "./openapi";

// REST API v1 — framework-free (Request → Response), mounted by src/server.ts under /api/.
// Same services as the dashboard; see src/api/openapi.ts and docs/API.md.

export const API_PREFIX = "/api/v1";
export const API_VERSION = "1.0.0";

export type ApiEnv = Record<string, string | undefined>;

export type AccessLogEntry = {
  ts: string;
  client: string | null;
  method: string;
  path: string;
  status: number;
  ms: number;
};

export type ApiOptions = {
  env: ApiEnv;
  service?: CorridorService;
  clock?: () => number;
  log?: (entry: AccessLogEntry) => void;
};

type Ctx = { request: Request; url: URL; client: ApiClient | null; params: string[] };
type Handler = (ctx: Ctx) => Promise<Response> | Response;
type Route = { method: string; pattern: RegExp; handler: Handler; public?: boolean };

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });

const error = (status: number, code: string, message: string) =>
  json(status, { error: { code, message } });

const isPort = (p: string): p is CaspianPort => (CASPIAN_PORTS as readonly string[]).includes(p);

async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.length > 2_000_000) throw new RangeError("Body too large");
  return JSON.parse(text);
}

export function createApi(options: ApiOptions) {
  const clock = options.clock ?? Date.now;
  const auth: AuthConfig = authConfigFromEnv(options.env);
  const service =
    options.service ??
    new CorridorService(
      telemetryConfigFromEnv({
        VITE_WEATHER_MODE: options.env["SILKSOL_WEATHER_MODE"] ?? options.env["VITE_WEATHER_MODE"],
        VITE_AIS_MODE: options.env["SILKSOL_AIS_MODE"] ?? options.env["VITE_AIS_MODE"],
        VITE_AIS_API_URL: options.env["SILKSOL_AIS_API_URL"] ?? options.env["VITE_AIS_API_URL"],
      }),
      clock,
    );
  const log = options.log ?? ((entry: AccessLogEntry) => console.log(JSON.stringify(entry)));
  const startedAt = clock();

  const routes: Route[] = [
    {
      method: "GET",
      pattern: /^\/health$/,
      public: true,
      handler: () =>
        json(200, {
          status: "ok",
          version: API_VERSION,
          model: MODEL_CARD.version,
          feeds: service.isLive ? "live" : "simulated",
          uptimeS: Math.round((clock() - startedAt) / 1000),
          auth: auth.disabled ? "off" : auth.keys.size > 0 ? "api-key" : "no-keys-configured",
        }),
    },
    {
      method: "GET",
      pattern: /^\/openapi\.json$/,
      public: true,
      handler: () => json(200, OPENAPI_SPEC),
    },
    {
      method: "GET",
      pattern: /^\/model$/,
      handler: () =>
        json(200, {
          ...MODEL_CARD,
          closureModel: {
            event: CLOSURE_CALIBRATION.event,
            coefficients: CLOSURE_CALIBRATION.coefficients,
            warningThreshold: CLOSURE_CALIBRATION.warningThreshold,
            train: CLOSURE_CALIBRATION.train,
            test: CLOSURE_CALIBRATION.test,
            backtest: CLOSURE_CALIBRATION.backtest,
            sources: CLOSURE_CALIBRATION.sources,
          },
        }),
    },
    {
      method: "GET",
      pattern: /^\/corridor$/,
      handler: async () => {
        const s = await service.current();
        return json(200, {
          now: s.snapshot.now,
          corridorRisk: s.forecast.corridorRisk,
          bottlenecks: s.forecast.bottlenecks,
          closureOutlook: s.forecast.closureOutlook,
          queues: s.snapshot.ais.queues,
          provenance: {
            weather: Object.fromEntries(
              CASPIAN_PORTS.map((p) => [p, s.snapshot.weather[p].provenance]),
            ),
            ais: s.snapshot.ais.provenance,
          },
          model: { name: MODEL_CARD.name, version: MODEL_CARD.version, status: MODEL_CARD.status },
        });
      },
    },
    {
      method: "GET",
      pattern: /^\/ports\/([a-z]+)\/weather$/,
      handler: async ({ params: [port] }) => {
        if (!port || !isPort(port)) return error(404, "port_not_found", `Unknown port ${port}`);
        const s = await service.current();
        return json(200, {
          ...s.snapshot.weather[port],
          closureOutlook: s.forecast.closureOutlook[port],
        });
      },
    },
    {
      method: "GET",
      pattern: /^\/shipments$/,
      handler: async () => {
        const s = await service.current();
        return json(200, {
          now: s.snapshot.now,
          shipments: s.snapshot.shipments.map((sh) => {
            const f = s.forecast.shipments[sh.id]!;
            return {
              id: sh.id,
              route: sh.route,
              currentNode: sh.route[sh.currentIndex],
              phase: sh.phase,
              containers: sh.containers,
              status: s.statuses[sh.id],
              risk: f.risk,
              etaDriftH: f.etaDriftH,
              predictedEta: f.predictedEta,
              slaStatus: s.sla[sh.id]?.status,
            };
          }),
        });
      },
    },
    {
      method: "GET",
      pattern: /^\/shipments\/([A-Za-z0-9-]+)$/,
      handler: async ({ params: [id] }) => {
        const s = await service.current();
        const shipment = s.snapshot.shipments.find((sh) => sh.id === id);
        if (!shipment) return error(404, "shipment_not_found", `Unknown shipment ${id}`);
        return json(200, {
          shipment,
          status: s.statuses[shipment.id],
          forecast: s.forecast.shipments[shipment.id],
          sla: s.sla[shipment.id],
          dwell: s.snapshot.timelines[shipment.id],
          reportIssued: Boolean(s.reports[shipment.id]),
        });
      },
    },
    {
      method: "GET",
      pattern: /^\/shipments\/([A-Za-z0-9-]+)\/ledger$/,
      handler: async ({ params: [id] }) => {
        const s = await service.current();
        const chain = id ? s.ledgers[id] : undefined;
        if (!chain) return error(404, "shipment_not_found", `Unknown shipment ${id}`);
        return json(200, {
          cargoId: id,
          head: chainHead(chain),
          ledgerRoot: ledgerRoot(s.ledgers),
          verification: verifyChain(chain),
          entries: chain,
        });
      },
    },
    {
      method: "POST",
      pattern: /^\/shipments\/([A-Za-z0-9-]+)\/delay-report$/,
      handler: async ({ params: [id] }) => {
        const report = id ? await service.issueReport(id) : undefined;
        if (!report) return error(404, "shipment_not_found", `Unknown shipment ${id}`);
        return json(201, report);
      },
    },
    {
      method: "GET",
      pattern: /^\/shipments\/([A-Za-z0-9-]+)\/delay-report$/,
      handler: async ({ params: [id] }) => {
        const s = await service.current();
        const report = id ? s.reports[id] : undefined;
        if (!report) return error(404, "report_not_found", `No report issued for ${id}`);
        return json(200, report);
      },
    },
    {
      method: "POST",
      pattern: /^\/reports\/verify$/,
      handler: async ({ request }) => {
        const body = (await readJson(request)) as DelayReport;
        if (!body || typeof body !== "object" || typeof body.reportHash !== "string")
          return error(400, "invalid_report", "Body must be a delay report JSON");
        return json(200, verifyDelayReport(body));
      },
    },
    {
      method: "POST",
      pattern: /^\/risk\/closure$/,
      handler: async ({ request }) => {
        const body = (await readJson(request)) as { maxWindMs?: unknown; maxGustMs?: unknown };
        const wind = Number(body?.maxWindMs);
        const gust = Number(body?.maxGustMs);
        if (!Number.isFinite(wind) || !Number.isFinite(gust) || wind < 0 || gust < 0 || wind > 80)
          return error(400, "invalid_input", "maxWindMs and maxGustMs must be numbers in m/s");
        const p = closureProbability(wind, gust);
        return json(200, {
          probability: Math.round(1000 * p) / 10,
          warning: p >= CLOSURE_CALIBRATION.warningThreshold,
          model: `closure ${CLOSURE_CALIBRATION.generatedAt}`,
        });
      },
    },
  ];

  return async function handle(request: Request): Promise<Response> {
    const t0 = clock();
    const url = new URL(request.url);
    const path = url.pathname.slice(API_PREFIX.length) || "/";
    let client: ApiClient | null = null;
    let response: Response;
    try {
      if (!url.pathname.startsWith(API_PREFIX)) {
        response = error(404, "not_found", "Unknown API version; use /api/v1");
      } else {
        const matches = routes.filter((r) => r.pattern.test(path));
        const route = matches.find((r) => r.method === request.method);
        if (!matches.length) response = error(404, "not_found", `No route ${path}`);
        else if (!route)
          response = new Response(null, {
            status: 405,
            headers: { allow: matches.map((r) => r.method).join(", ") },
          });
        else {
          client = route.public ? null : authenticate(request, auth);
          if (!route.public && !client)
            response = json(
              401,
              { error: { code: "unauthorized", message: "Missing or invalid API key" } },
              { "www-authenticate": 'Bearer realm="silksol"' },
            );
          else {
            const params = path.match(route.pattern)!.slice(1);
            response = await route.handler({ request, url, client, params });
          }
        }
      }
    } catch (err) {
      response =
        err instanceof SyntaxError || err instanceof RangeError
          ? error(400, "invalid_body", err.message)
          : error(500, "internal_error", "Internal error");
      if (response.status === 500) console.error(err);
    }
    log({
      ts: new Date(t0).toISOString(),
      client: client?.name ?? null,
      method: request.method,
      path: url.pathname,
      status: response.status,
      ms: clock() - t0,
    });
    return response;
  };
}
