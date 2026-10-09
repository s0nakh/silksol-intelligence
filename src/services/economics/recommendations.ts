import {
  createContext,
  forecastShipment,
  isExposed,
  type CorridorForecast,
  type ShipmentForecast,
} from "@/services/ml/riskEngine";
import {
  NODES,
  buildDwellTimeline,
  hasLeg,
  isCaspianPort,
  transitHours,
  type CorridorSnapshot,
  type NodeId,
  type Shipment,
} from "@/services/telemetry";
import { HOUR_MS, addHours } from "@/services/telemetry/prng";
import {
  DELAY_TARIFFS,
  HOURS_PER_DAY,
  expectedDelayCost,
  roundKzt,
  type DelayCost,
} from "./delayCost";

// Prescriptive layer: for each shipment, evaluates operational levers and keeps those that save
// money. "simulation" levers re-run the risk engine on a modified scenario with the same random
// draws (common random numbers), so before/after differ only by the lever; "estimate" levers use
// the weather forecast directly.

export type RecommendationCode = "switch_port" | "priority_berth" | "hold_upstream";

export type Recommendation = {
  code: RecommendationCode;
  method: "simulation" | "estimate";
  /** Port to switch from/to, or the node to hold at and the port to wait out. */
  from?: NodeId;
  to?: NodeId;
  holdH?: number;
  baselineCostKzt: number;
  scenarioCostKzt: number;
  actionCostKzt: number;
  netSavingKzt: number;
  riskBefore: number;
  riskAfter: number;
  /** Median ETA change, hours (negative = earlier). */
  etaShiftH: number;
};

export type ShipmentEconomics = {
  shipmentId: string;
  cost: DelayCost;
  /** Every lever that applies to the shipment, best net saving first (may be negative). */
  options: Recommendation[];
  /** Options worth doing: net saving ≥ MIN_NET_SAVING_KZT. */
  recommendations: Recommendation[];
};

type Evaluated = { cost: DelayCost; forecast: ShipmentForecast };

/** Recommendations below this net saving are noise for a dispatcher. */
export const MIN_NET_SAVING_KZT = 10_000;
/** Port-closure window considered when deciding to hold cargo upstream. */
const HOLD_LOOKAHEAD_H = 48;

const SWITCHABLE_PORTS: Partial<Record<NodeId, NodeId>> = { aktau: "kuryk", kuryk: "aktau" };

const etaShift = (base: ShipmentForecast, alt: ShipmentForecast) =>
  Math.round(
    (new Date(alt.predictedEta).getTime() - new Date(base.predictedEta).getTime()) / HOUR_MS,
  );

function simulated(
  code: RecommendationCode,
  base: Evaluated,
  alt: Evaluated,
  actionCostKzt: number,
  extra: Pick<Recommendation, "from" | "to">,
): Recommendation {
  return {
    code,
    method: "simulation",
    ...extra,
    baselineCostKzt: base.cost.totalKzt,
    scenarioCostKzt: alt.cost.totalKzt,
    actionCostKzt,
    netSavingKzt: base.cost.totalKzt - alt.cost.totalKzt - actionCostKzt,
    riskBefore: base.forecast.risk,
    riskAfter: alt.forecast.risk,
    etaShiftH: etaShift(base.forecast, alt.forecast),
  };
}

/** Re-route the next Caspian departure port (Aktau ↔ Kuryk) while the cargo has not reached it. */
function switchPort(snap: CorridorSnapshot, s: Shipment, base: Evaluated): Recommendation | null {
  const j = s.route.findIndex((n, i) => i > s.currentIndex && SWITCHABLE_PORTS[n]);
  if (j < 0) return null;
  const from = s.route[j]!;
  const to = SWITCHABLE_PORTS[from]!;
  const next = s.route[j + 1];
  if (!hasLeg(s.route[j - 1]!, to) || (next && !hasLeg(to, next))) return null;

  const alt: Shipment = { ...s, route: s.route.map((n, i) => (i === j ? to : n)) };
  const altSnap: CorridorSnapshot = {
    ...snap,
    shipments: snap.shipments.map((x) => (x.id === s.id ? alt : x)),
    timelines: {
      ...snap.timelines,
      // The contract does not change with the route: lateness is still measured against it.
      [s.id]: {
        ...buildDwellTimeline(alt, new Date(snap.epoch)),
        contractualEta: snap.timelines[s.id]!.contractualEta,
      },
    },
  };
  const forecast = forecastShipment(createContext(altSnap), alt);
  return simulated(
    "switch_port",
    base,
    { forecast, cost: expectedDelayCost(alt, forecast) },
    s.containers * DELAY_TARIFFS.portSwitchPerContainer,
    { from, to },
  );
}

/** Book a priority ferry / berth slot so the cargo skips the roadstead queue. */
function priorityBerth(
  snap: CorridorSnapshot,
  s: Shipment,
  base: Evaluated,
): Recommendation | null {
  const node = s.route[s.currentIndex]!;
  if (!isExposed(s) || !isCaspianPort(node)) return null;
  const forecast = forecastShipment(createContext(snap), s, undefined, { priorityBerth: true });
  return simulated(
    "priority_berth",
    base,
    { forecast, cost: expectedDelayCost(s, forecast) },
    s.containers * DELAY_TARIFFS.priorityBerthPerContainer,
    { to: node },
  );
}

/**
 * Hold wagons at the current rail node while the next port is forecast closed: the cargo waits
 * anyway, but at rail-terminal storage rates instead of port demurrage.
 */
function holdUpstream(snap: CorridorSnapshot, s: Shipment, base: Evaluated): Recommendation | null {
  const here = s.route[s.currentIndex]!;
  const port = s.route[s.currentIndex + 1];
  if (!port || !isCaspianPort(port) || isCaspianPort(here)) return null;

  const arrival = addHours(
    new Date(snap.now),
    base.forecast.currentNodeRemainingH + transitHours(here, port),
  ).getTime();
  const closedH = snap.weather[port].series.filter((p) => {
    const t = new Date(p.at).getTime();
    return p.portClosed && t >= arrival && t < arrival + HOLD_LOOKAHEAD_H * HOUR_MS;
  }).length;
  if (closedH === 0) return null;

  const rateGap =
    DELAY_TARIFFS.storagePerContainerDay.sea_port -
    DELAY_TARIFFS.storagePerContainerDay[NODES[here].kind];
  const saving = roundKzt(s.containers * (closedH / HOURS_PER_DAY) * rateGap);
  return {
    code: "hold_upstream",
    method: "estimate",
    from: here,
    to: port,
    holdH: closedH,
    baselineCostKzt: base.cost.totalKzt,
    scenarioCostKzt: base.cost.totalKzt - saving,
    actionCostKzt: 0,
    netSavingKzt: saving,
    riskBefore: base.forecast.risk,
    riskAfter: base.forecast.risk,
    etaShiftH: 0,
  };
}

const LEVERS = [switchPort, priorityBerth, holdUpstream];

/** Expected delay cost and money-saving actions for every shipment in the snapshot. */
export function assessEconomics(
  snap: CorridorSnapshot,
  forecast: CorridorForecast,
): Record<string, ShipmentEconomics> {
  return Object.fromEntries(
    snap.shipments.map((s) => {
      const f = forecast.shipments[s.id]!;
      const base: Evaluated = { forecast: f, cost: expectedDelayCost(s, f) };
      const options = LEVERS.map((lever) => lever(snap, s, base))
        .filter((r): r is Recommendation => r !== null)
        .sort((a, b) => b.netSavingKzt - a.netSavingKzt);
      const recommendations = options.filter((r) => r.netSavingKzt >= MIN_NET_SAVING_KZT);
      return [s.id, { shipmentId: s.id, cost: base.cost, options, recommendations }];
    }),
  );
}

/** Corridor totals: expected loss and what the best action per shipment would save. */
export function economicsSummary(economics: Record<string, ShipmentEconomics>) {
  const all = Object.values(economics);
  return {
    expectedLossKzt: all.reduce((n, e) => n + e.cost.totalKzt, 0),
    savingsAvailableKzt: all.reduce((n, e) => n + (e.recommendations[0]?.netSavingKzt ?? 0), 0),
    actions: all.reduce((n, e) => n + e.recommendations.length, 0),
  };
}
