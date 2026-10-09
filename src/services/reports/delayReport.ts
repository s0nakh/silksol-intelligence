import {
  chainHead,
  verifyChain,
  type LedgerEntry,
  type NewLedgerEvent,
  type Provenance,
} from "@/services/ledger/auditLedger";
import { canonicalJson, sha256Hex } from "@/services/ledger/sha256";
import { MODEL_CARD, type ShipmentForecast } from "@/services/ml/riskEngine";
import type { ShipmentSla } from "@/services/sla/slaMonitor";
import {
  CARGO_VESSEL,
  NODES,
  isCaspianPort,
  type CorridorSnapshot,
  type NodeId,
  type Shipment,
  type Vessel,
  type WeatherPoint,
} from "@/services/telemetry";
import { HOUR_MS, round } from "@/services/telemetry/prng";

// Verifiable Delay Report ("Passport of Delay"): a self-contained, hash-sealed evidence bundle
// for forwarders and insurance partners — weather observations, AIS positions, timestamped dwell
// events and the cargo's full audit chain. Anyone can recompute every hash with `verifyDelayReport`.

export const REPORT_SCHEMA = "silksol.delay-report/v1";

export type DelayCause = "weather_closure" | "port_queue" | "rail_border" | "terminal_handling";

export type DelayAttribution = { node: NodeId; cause: DelayCause; hours: number };

export type DelayReportBody = {
  schema: typeof REPORT_SCHEMA;
  reportId: string;
  issuedAt: string;
  cargo: {
    id: string;
    route: NodeId[];
    currentNode: NodeId;
    containers: number;
    commodity: Shipment["commodity"];
  };
  delay: {
    /** Observed dwell above plan so far, hours. */
    observedExcessH: number;
    attribution: DelayAttribution[];
    primaryCause: DelayCause | null;
  };
  sla: ShipmentSla;
  forecast: Pick<
    ShipmentForecast,
    "risk" | "etaDriftH" | "contractualEta" | "predictedEta" | "etaP10" | "etaP90"
  > & { model: string; modelStatus: string };
  evidence: {
    weather: { port: NodeId; points: WeatherPoint[] }[];
    ais: Vessel[];
    dwell: {
      node: NodeId;
      arrivedAt: string | null;
      departedAt: string | null;
      dwellH: number | null;
      plannedDwellH: number;
      slaDwellH: number;
    }[];
  };
  ledger: { entries: LedgerEntry[]; head: string };
  sources: Provenance[];
  disclaimer: string;
};

export type DelayReport = DelayReportBody & { reportHash: string };

const hoursClosed = (points: WeatherPoint[], from: number, to: number) =>
  points.filter((p) => {
    const t = new Date(p.at).getTime();
    return p.portClosed && t >= from && t < to;
  }).length;

/** Splits excess dwell at each node into causes using the evidence observed during the stay. */
export function attributeDelay(snap: CorridorSnapshot, s: Shipment): DelayAttribution[] {
  const timeline = snap.timelines[s.id];
  if (!timeline) return [];
  const out: DelayAttribution[] = [];
  const epoch = new Date(snap.epoch).getTime();
  timeline.records.forEach((r, i) => {
    if (i === 0 || !r.arrivedAt || r.dwellH === null) return;
    const excess = r.dwellH - r.plannedDwellH;
    if (excess <= 0) return;
    const node = r.node;
    if (isCaspianPort(node)) {
      const from = new Date(r.arrivedAt).getTime();
      const to = r.departedAt ? new Date(r.departedAt).getTime() : epoch;
      const closed = Math.min(excess, hoursClosed(snap.weather[node].series, from, to));
      if (closed > 0) out.push({ node, cause: "weather_closure", hours: round(closed) });
      if (excess - closed > 0)
        out.push({ node, cause: "port_queue", hours: round(excess - closed) });
    } else {
      out.push({
        node,
        cause: NODES[node].kind === "rail_border" ? "rail_border" : "terminal_handling",
        hours: round(excess),
      });
    }
  });
  return out;
}

export function primaryCause(attribution: DelayAttribution[]): DelayCause | null {
  const totals = new Map<DelayCause, number>();
  for (const a of attribution) totals.set(a.cause, (totals.get(a.cause) ?? 0) + a.hours);
  let best: DelayCause | null = null;
  for (const [cause, h] of totals) if (best === null || h > (totals.get(best) ?? 0)) best = cause;
  return best;
}

export const hashReportBody = (body: DelayReportBody) => sha256Hex(canonicalJson(body));

/** Ledger event that anchors an issued report's hash in the cargo's audit chain. */
export const reportIssuedEvent = (report: DelayReport): NewLedgerEvent => ({
  type: "REPORT_ISSUED",
  occurredAt: report.issuedAt,
  node: report.cargo.currentNode,
  payload: {
    reportId: report.reportId,
    reportHash: report.reportHash,
    ledgerHead: report.ledger.head,
  },
  provenance: {
    source: "SilkSol Intelligence report service",
    mode: "simulated",
    retrievedAt: report.issuedAt,
  },
});

export function buildDelayReport(args: {
  snap: CorridorSnapshot;
  shipment: Shipment;
  forecast: ShipmentForecast;
  sla: ShipmentSla;
  chain: LedgerEntry[];
  issuedAt?: Date;
}): DelayReport {
  const { snap, shipment: s, forecast, sla, chain } = args;
  const issuedAt = (args.issuedAt ?? new Date(snap.now)).toISOString();
  const timeline = snap.timelines[s.id];
  const node = s.route[s.currentIndex]!;
  const attribution = attributeDelay(snap, s);

  // Weather evidence for every Caspian port the cargo has waited at, from arrival until now (3-hourly).
  const weather = (timeline?.records ?? [])
    .filter((r) => r.arrivedAt && isCaspianPort(r.node))
    .map((r) => {
      const port = r.node as keyof CorridorSnapshot["weather"];
      const from = new Date(r.arrivedAt!).getTime();
      const to = r.departedAt ? new Date(r.departedAt).getTime() : new Date(snap.now).getTime();
      const points = snap.weather[port].series.filter((p) => {
        const t = new Date(p.at).getTime();
        return t >= from && t <= to && Math.round((t - from) / HOUR_MS) % 3 === 0;
      });
      return { port: r.node, points };
    })
    // Stays older than the feed's history window have no observations to cite.
    .filter((w) => w.points.length > 0);

  const vesselMmsi = CARGO_VESSEL[s.id];
  const ais = snap.ais.vessels.filter(
    (v) =>
      v.mmsi === vesselMmsi || (isCaspianPort(node) && v.port === node && v.status === "at_anchor"),
  );

  const body: DelayReportBody = {
    schema: REPORT_SCHEMA,
    reportId: `POD-${s.id}-${issuedAt.slice(0, 16).replace(/[-:T]/g, "")}`,
    issuedAt,
    cargo: {
      id: s.id,
      route: s.route,
      currentNode: node,
      containers: s.containers,
      commodity: s.commodity,
    },
    delay: {
      observedExcessH: round(attribution.reduce((n, a) => n + a.hours, 0)),
      attribution,
      primaryCause: primaryCause(attribution),
    },
    sla,
    forecast: {
      risk: forecast.risk,
      etaDriftH: forecast.etaDriftH,
      contractualEta: forecast.contractualEta,
      predictedEta: forecast.predictedEta,
      etaP10: forecast.etaP10,
      etaP90: forecast.etaP90,
      model: `${MODEL_CARD.name} ${MODEL_CARD.version}`,
      modelStatus: MODEL_CARD.status,
    },
    evidence: {
      weather,
      ais,
      dwell: (timeline?.records ?? []).map(
        ({ node: n, arrivedAt, departedAt, dwellH, plannedDwellH, slaDwellH }) => ({
          node: n,
          arrivedAt,
          departedAt,
          dwellH,
          plannedDwellH,
          slaDwellH,
        }),
      ),
    },
    ledger: { entries: chain, head: chainHead(chain) },
    sources: dedupeSources([
      timeline?.provenance,
      snap.ais.provenance,
      ...weather.map((w) => snap.weather[w.port as keyof CorridorSnapshot["weather"]].provenance),
    ]),
    disclaimer:
      "Decision-support analytics, not an insurance or legal determination. Simulated feeds are labelled in `sources`; port-closure probabilities are calibrated on weather-station data, dwell and ETA coefficients are an expert-set baseline.",
  };
  return { ...body, reportHash: hashReportBody(body) };
}

function dedupeSources(list: (Provenance | undefined)[]): Provenance[] {
  const seen = new Set<string>();
  return list.filter((p): p is Provenance => {
    if (!p || seen.has(p.source)) return false;
    seen.add(p.source);
    return true;
  });
}

export type ReportVerification = {
  valid: boolean;
  reportHash: boolean;
  chain: boolean;
  head: boolean;
};

/** Recomputes the report seal and the embedded audit chain. Works on a parsed JSON export. */
export function verifyDelayReport(report: DelayReport): ReportVerification {
  const { reportHash, ...body } = report;
  const sealOk = hashReportBody(body) === reportHash;
  const chain = verifyChain(report.ledger.entries);
  const headOk = chain.valid && chain.head === report.ledger.head;
  return {
    valid: sealOk && chain.valid && headOk,
    reportHash: sealOk,
    chain: chain.valid,
    head: headOk,
  };
}
