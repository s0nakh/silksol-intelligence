import type { ShipmentForecast } from "@/services/ml/riskEngine";
import type { CorridorSnapshot, NodeId, Shipment } from "@/services/telemetry";
import { hoursBetween, round } from "@/services/telemetry/prng";

// SLA Violation Monitor: compares actual (and predicted) port/rail dwell at every checkpoint with
// the contractual threshold agreed between forwarder and client.

export type SlaStatus = "ok" | "warning" | "breach";

/** Dwell above this share of the threshold raises a warning. */
export const SLA_WARNING_RATIO = 0.8;

export type SlaCheck = {
  node: NodeId;
  state: "complete" | "active";
  dwellH: number;
  thresholdH: number;
  /** dwell / threshold */
  utilization: number;
  status: SlaStatus;
  /** Active node only: median predicted total dwell and its status. */
  predictedDwellH?: number;
  predictedStatus?: SlaStatus;
};

export type ShipmentSla = {
  shipmentId: string;
  checks: SlaCheck[];
  violations: SlaCheck[];
  status: SlaStatus;
};

export const statusFor = (dwellH: number, thresholdH: number): SlaStatus =>
  dwellH > thresholdH ? "breach" : dwellH >= thresholdH * SLA_WARNING_RATIO ? "warning" : "ok";

const RANK: Record<SlaStatus, number> = { ok: 0, warning: 1, breach: 2 };
export const worst = (a: SlaStatus, b: SlaStatus) => (RANK[b] > RANK[a] ? b : a);

export function evaluateSla(
  snap: CorridorSnapshot,
  s: Shipment,
  forecast?: ShipmentForecast,
): ShipmentSla {
  const timeline = snap.timelines[s.id];
  if (!timeline) throw new Error(`No dwell timeline for ${s.id}`);
  const sinceEpoch = Math.max(0, hoursBetween(new Date(snap.epoch), new Date(snap.now)));
  const checks: SlaCheck[] = [];
  for (const r of timeline.records) {
    if (r.state === "pending" || r.dwellH === null) continue;
    // Origin dwell happens before the contractual clock starts.
    if (r.node === s.route[0]) continue;
    const dwellH = round(r.state === "active" ? r.dwellH + sinceEpoch : r.dwellH);
    const check: SlaCheck = {
      node: r.node,
      state: r.state,
      dwellH,
      thresholdH: r.slaDwellH,
      utilization: round(dwellH / r.slaDwellH, 2),
      status: statusFor(dwellH, r.slaDwellH),
    };
    if (r.state === "active" && forecast) {
      const predicted = round(dwellH + forecast.currentNodeRemainingH);
      check.predictedDwellH = predicted;
      check.predictedStatus = statusFor(predicted, r.slaDwellH);
    }
    checks.push(check);
  }
  const violations = checks.filter((c) => c.status === "breach");
  return {
    shipmentId: s.id,
    checks,
    violations,
    status: checks.reduce<SlaStatus>((w, c) => worst(w, c.status), "ok"),
  };
}

export type ShipmentStatus = "in_transit" | "at_risk" | "sla_breach";

/** Table status: confirmed SLA breach beats predicted risk. */
export const shipmentStatus = (sla: ShipmentSla, risk: number): ShipmentStatus =>
  sla.status === "breach" ? "sla_breach" : risk >= 50 ? "at_risk" : "in_transit";
