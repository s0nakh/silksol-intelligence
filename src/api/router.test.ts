import { describe, expect, it } from "vitest";
import { verifyDelayReport, type DelayReport } from "@/services/reports/delayReport";
import { createApi, type AccessLogEntry } from "./router";

const KEY = "test-key-0123456789abcdef";
const base = "http://localhost/api/v1";

function setup(env: Record<string, string> = { SILKSOL_API_KEYS: `erp-test:${KEY}` }) {
  const logs: AccessLogEntry[] = [];
  const api = createApi({ env, log: (e) => logs.push(e) });
  const call = (path: string, init: RequestInit & { key?: string | null } = {}) => {
    const { key = KEY, ...rest } = init;
    const headers = new Headers(rest.headers);
    if (key) headers.set("authorization", `Bearer ${key}`);
    return api(new Request(`${base}${path}`, { ...rest, headers }));
  };
  return { call, logs };
}

describe("REST API v1", () => {
  it("serves health and OpenAPI without a key", async () => {
    const { call } = setup();
    const health = await call("/health", { key: null });
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ status: "ok", auth: "api-key" });
    const spec = await call("/openapi.json", { key: null });
    expect((await spec.json()).openapi).toBe("3.1.0");
  });

  it("rejects missing and wrong keys, and logs the client name only", async () => {
    const { call, logs } = setup();
    expect((await call("/shipments", { key: null })).status).toBe(401);
    expect((await call("/shipments", { key: "wrong-key-0123456789" })).status).toBe(401);
    const ok = await call("/shipments", {
      key: null,
      headers: { "x-api-key": KEY },
    });
    expect(ok.status).toBe(200);
    expect(logs.at(-1)).toMatchObject({
      client: "erp-test",
      status: 200,
      path: "/api/v1/shipments",
    });
    expect(JSON.stringify(logs)).not.toContain(KEY);
  });

  it("returns corridor risk, closure outlook and shipment forecasts", async () => {
    const { call } = setup();
    const corridor = await (await call("/corridor")).json();
    expect(corridor.corridorRisk).toBeGreaterThan(0);
    expect(Object.keys(corridor.closureOutlook)).toEqual(["aktau", "kuryk", "baku"]);
    const { shipments } = await (await call("/shipments")).json();
    expect(shipments.length).toBeGreaterThan(0);
    const detail = await (await call(`/shipments/${shipments[0].id}`)).json();
    expect(detail.forecast.etaP10 <= detail.forecast.etaP90).toBe(true);
    expect((await call("/shipments/NOPE-1")).status).toBe(404);
    expect((await call("/ports/atlantis/weather")).status).toBe(404);
  });

  it("issues a verifiable delay report and anchors it in the ledger", async () => {
    const { call } = setup();
    const { shipments } = await (await call("/shipments")).json();
    const id = shipments[0].id as string;
    const issued = await call(`/shipments/${id}/delay-report`, { method: "POST" });
    expect(issued.status).toBe(201);
    const report = (await issued.json()) as DelayReport;
    expect(verifyDelayReport(report).valid).toBe(true);

    const ledger = await (await call(`/shipments/${id}/ledger`)).json();
    expect(ledger.verification.valid).toBe(true);
    expect(ledger.entries.at(-1).payload.reportHash).toBe(report.reportHash);

    const verified = await call("/reports/verify", {
      method: "POST",
      body: JSON.stringify(report),
    });
    expect((await verified.json()).valid).toBe(true);
    const tampered = await call("/reports/verify", {
      method: "POST",
      body: JSON.stringify({ ...report, delay: { ...report.delay, observedExcessH: 0 } }),
    });
    expect((await tampered.json()).valid).toBe(false);
  });

  it("scores closure risk and validates input", async () => {
    const { call } = setup();
    const storm = await call("/risk/closure", {
      method: "POST",
      body: JSON.stringify({ maxWindMs: 17, maxGustMs: 24 }),
    });
    expect(await storm.json()).toMatchObject({ warning: true });
    const bad = await call("/risk/closure", { method: "POST", body: "{not json" });
    expect(bad.status).toBe(400);
    expect((await call("/risk/closure")).status).toBe(405);
  });

  it("denies everything but public routes when no keys are configured", async () => {
    const { call } = setup({});
    expect((await call("/corridor")).status).toBe(401);
    expect((await call("/health", { key: null })).status).toBe(200);
  });
});
