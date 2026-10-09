import {
  CASPIAN_PORTS,
  NODES,
  PORT_CLOSURE_WIND_MS,
  isCaspianPort,
  isSeaLeg,
  railLoadFactor,
  seasonalIndex,
  transitHours,
  weatherAt,
  type CaspianPort,
  type CorridorSnapshot,
  type NodeId,
  type Shipment,
} from "@/services/telemetry";
import {
  HOUR_MS,
  addHours,
  clamp,
  gaussian,
  hoursBetween,
  rng,
  round,
} from "@/services/telemetry/prng";
import { CLOSURE_CALIBRATION, closureOutlook, type ClosureOutlookDay } from "./closureModel";

// Isolated inference service for corridor delay risk. Two models share one feature pipeline:
//  1. Node disruption classifier (logistic) → "delay probability" of a node at a given hour.
//  2. Dwell survival model (Weibull proportional hazards, time-varying covariates) sampled by
//     Monte Carlo → probabilistic ETA, ETA drift and the shipment's Predictive Risk Index.
// Coefficients are an expert-set BASELINE until the CatBoost / survival models are trained on
// historical dwell data — see MODEL_CARD.
//  3. Port-closure model (closureModel.ts) — CALIBRATED on real forecasts vs. station observations
//     at Aktau and Baku and backtested out of time (docs/BACKTEST.md). Every output can be traced to its features.

export const MODEL_CARD = {
  name: "SilkSol Corridor Risk Engine",
  version: "0.2.0",
  status: "partially_calibrated" as const,
  trainedOn: {
    closureModel: `Archived forecasts ${CLOSURE_CALIBRATION.train.start} … ${CLOSURE_CALIBRATION.train.end} vs. Meteostat station observations (Aktau UATE0, Baku 37864)`,
    seasonality: `Observed closure-day frequency by month, ${CLOSURE_CALIBRATION.climatology.years.start}–${CLOSURE_CALIBRATION.climatology.years.end}`,
    dwellModel: null,
  },
  backtest: CLOSURE_CALIBRATION.backtest.map((b) => ({
    leadDays: b.leadDays,
    days: b.days,
    events: b.events,
    auc: b.auc,
    brierSkill: b.brierSkill,
  })),
  notes:
    "Port-closure probabilities and sea-port seasonality are fitted on real data and backtested out of time (docs/BACKTEST.md). Dwell (Weibull PH) and disruption coefficients are still expert-set; they are calibrated on a pilot partner's dwell logs before commercial use.",
  features: [
    "weatherSeverity",
    "queueDensity",
    "seasonalIndex",
    "railLoad",
    "customsHold",
    "portClosed",
  ] as const,
  horizonH: 72,
  delayToleranceH: 48,
  samples: 400,
};

export type FeatureName = (typeof MODEL_CARD.features)[number];

export type NodeFeatures = {
  /** 0–1 from wind, waves and storm alerts (Caspian ports only). */
  weatherSeverity: number;
  /** Anchored vessels per berth-day of capacity (Caspian ports only). */
  queueDensity: number;
  /** Monthly dwell index relative to the annual mean (1 = average month). */
  seasonalIndex: number;
  /** Rail network utilisation 0–1. */
  railLoad: number;
  customsHold: boolean;
  portClosed: boolean;
};

// --- Feature pipeline ---------------------------------------------------------------------------

const ARRIVALS_PER_H = 0.25;
const SERVICE_PER_BERTH_H = 0.09;

/** Projects each port's anchored-vessel queue hour by hour: grows while closed, drains while open. */
function projectQueues(snap: CorridorSnapshot): Record<CaspianPort, number[]> {
  const now = new Date(snap.now);
  const out = {} as Record<CaspianPort, number[]>;
  for (const port of CASPIAN_PORTS) {
    const berths = NODES[port].berths ?? 1;
    let q = snap.ais.queues[port].anchored;
    const series = [q];
    for (let h = 1; h <= 240; h++) {
      const closed = weatherAt(snap.weather[port], addHours(now, h)).portClosed;
      q = Math.max(0, q + ARRIVALS_PER_H - (closed ? 0 : berths * SERVICE_PER_BERTH_H));
      series.push(q);
    }
    out[port] = series;
  }
  return out;
}

export type EngineContext = {
  snap: CorridorSnapshot;
  now: Date;
  queues: Record<CaspianPort, number[]>;
};

export const createContext = (snap: CorridorSnapshot): EngineContext => ({
  snap,
  now: new Date(snap.now),
  queues: projectQueues(snap),
});

/**
 * Features for a node at a time. `exposed` = the cargo's dwell depends on Caspian sea operations
 * (waiting for a vessel, or on a vessel at the roadstead).
 */
export function nodeFeatures(
  ctx: EngineContext,
  node: NodeId,
  at: Date,
  exposed: boolean,
  customsHold = false,
  priorityBerth = false,
): NodeFeatures {
  const kind = NODES[node].kind;
  const base = {
    seasonalIndex: seasonalIndex(kind, at),
    railLoad: railLoadFactor(at),
    customsHold,
  };
  if (!exposed || !isCaspianPort(node))
    return { ...base, weatherSeverity: 0, queueDensity: 0, portClosed: false };
  const w = weatherAt(ctx.snap.weather[node], at);
  const h = clamp(Math.round(hoursBetween(ctx.now, at)), 0, 240);
  const anchored = ctx.queues[node][h] ?? ctx.snap.ais.queues[node].anchored;
  // A priority berth slot skips the roadstead queue (what-if scenario).
  const density = priorityBerth ? 0 : anchored / ((NODES[node].berths ?? 1) * 2);
  return {
    ...base,
    weatherSeverity: w.severity,
    queueDensity: round(density, 3),
    portClosed: w.windMs > PORT_CLOSURE_WIND_MS,
  };
}

// --- Model 1: node disruption classifier --------------------------------------------------------

const LOGIT = {
  intercept: -3.4,
  weatherSeverity: 4.6,
  queueDensity: 1.9,
  seasonalIndex: 3.0,
  railLoad: 2.0,
  customsHold: 1.3,
  portClosed: 1.2,
};

export type Contribution = { feature: FeatureName; value: number; weight: number };

/** Log-odds contributions per feature (centred so 0 = neutral conditions). */
export function contributions(f: NodeFeatures): Contribution[] {
  return [
    {
      feature: "weatherSeverity",
      value: f.weatherSeverity,
      weight: LOGIT.weatherSeverity * f.weatherSeverity,
    },
    { feature: "queueDensity", value: f.queueDensity, weight: LOGIT.queueDensity * f.queueDensity },
    {
      feature: "seasonalIndex",
      value: f.seasonalIndex,
      weight: LOGIT.seasonalIndex * (f.seasonalIndex - 1),
    },
    { feature: "railLoad", value: f.railLoad, weight: LOGIT.railLoad * (f.railLoad - 0.8) },
    {
      feature: "customsHold",
      value: f.customsHold ? 1 : 0,
      weight: f.customsHold ? LOGIT.customsHold : 0,
    },
    {
      feature: "portClosed",
      value: f.portClosed ? 1 : 0,
      weight: f.portClosed ? LOGIT.portClosed : 0,
    },
  ];
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

/** Probability (0–1) that operations at the node are disrupted enough to delay cargo. */
export function disruptionProbability(f: NodeFeatures): number {
  return sigmoid(LOGIT.intercept + contributions(f).reduce((s, c) => s + c.weight, 0));
}

export type RiskPoint = { at: string; risk: number };

/** Delay probability (%) for a node over the forecast horizon. */
export function nodeRiskSeries(
  ctx: EngineContext,
  node: NodeId,
  exposed: boolean,
  stepH = 6,
  horizonH = MODEL_CARD.horizonH,
  customsHold = false,
): RiskPoint[] {
  const points: RiskPoint[] = [];
  const start = new Date(Math.floor(ctx.now.getTime() / HOUR_MS) * HOUR_MS);
  for (let h = 0; h <= horizonH; h += stepH) {
    const at = addHours(start, h);
    points.push({
      at: at.toISOString(),
      risk: Math.round(
        100 * disruptionProbability(nodeFeatures(ctx, node, at, exposed, customsHold)),
      ),
    });
  }
  return points;
}

// --- Model 2: dwell survival (Weibull PH) + Monte Carlo ETA ------------------------------------

const WEIBULL_SHAPE = 1.6;
const PH_BETA = {
  weatherSeverity: 1.7,
  queueDensity: 1.0,
  seasonalIndex: 1.4,
  railLoad: 1.2,
  customsHold: 0.8,
};
const CLOSED_HAZARD = 0.05;
const MAX_DWELL_H = 240;

/** Hazard multiplier: adverse conditions slow the exit from the queue (lower hazard = longer dwell). */
export function hazardMultiplier(f: NodeFeatures) {
  const lp =
    PH_BETA.weatherSeverity * f.weatherSeverity +
    PH_BETA.queueDensity * f.queueDensity +
    PH_BETA.seasonalIndex * (f.seasonalIndex - 1) +
    PH_BETA.railLoad * (f.railLoad - 0.8) +
    (f.customsHold ? PH_BETA.customsHold : 0);
  return Math.exp(-lp) * (f.portClosed ? CLOSED_HAZARD : 1);
}

/** Samples the remaining dwell (hours) at a node given time already spent, by inverting the cumulative hazard. */
function sampleRemainingDwell(
  ctx: EngineContext,
  node: NodeId,
  start: Date,
  elapsedH: number,
  exposed: boolean,
  u: number,
  customsHold: boolean,
  priorityBerth = false,
) {
  const lambda = NODES[node].baseDwellH;
  const target = -Math.log(Math.max(u, 1e-12));
  const H0 = (t: number) => (t / lambda) ** WEIBULL_SHAPE;
  let acc = 0;
  for (let h = 0; h < MAX_DWELL_H; h++) {
    const mult = hazardMultiplier(
      nodeFeatures(ctx, node, addHours(start, h), exposed, customsHold, priorityBerth),
    );
    const step = (H0(elapsedH + h + 1) - H0(elapsedH + h)) * mult;
    if (acc + step >= target) return h + (target - acc) / step;
    acc += step;
  }
  return MAX_DWELL_H;
}

const quantile = (sorted: number[], q: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;

export type ShipmentForecast = {
  shipmentId: string;
  /** Predictive Risk Index: P(arrival later than contractual ETA + tolerance), 0–100. */
  risk: number;
  /** Median predicted lateness vs contractual ETA (hours; negative = early). */
  etaDriftH: number;
  contractualEta: string;
  predictedEta: string;
  etaP10: string;
  etaP90: string;
  /** Median remaining dwell at the current node. */
  currentNodeRemainingH: number;
  /** P(current node dwell ends above its SLA threshold), 0–100. */
  currentNodeSlaRisk: number;
  /** Mean lateness beyond the contractual ETA, hours (0 when on time). */
  expectedLateH: number;
  /** Mean dwell above the planned dwell at the current node, hours. */
  expectedExcessDwellH: number;
  features: NodeFeatures;
  contributions: Contribution[];
};

export const isExposed = (s: Shipment) =>
  s.phase === "awaiting_vessel" || s.phase === "at_roadstead";

/** What-if levers evaluated with the same random draws as the baseline forecast. */
export type ForecastScenario = {
  /** Priority ferry / berth slot at the current node: no roadstead queue. */
  priorityBerth?: boolean;
};

const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);

export function forecastShipment(
  ctx: EngineContext,
  s: Shipment,
  samples = MODEL_CARD.samples,
  scenario: ForecastScenario = {},
): ShipmentForecast {
  const timeline = ctx.snap.timelines[s.id];
  if (!timeline) throw new Error(`No dwell timeline for ${s.id}`);
  const node = s.route[s.currentIndex]!;
  const sla = NODES[node].slaDwellH;
  const elapsed = s.currentDwellH + Math.max(0, hoursBetween(new Date(ctx.snap.epoch), ctx.now));
  const exposed = isExposed(s);
  const contractual = new Date(timeline.contractualEta).getTime();
  const next = rng(`forecast:${s.id}`);

  const lateness: number[] = [];
  const remaining: number[] = [];
  let slaBreaches = 0;
  for (let i = 0; i < samples; i++) {
    const rem = sampleRemainingDwell(
      ctx,
      node,
      ctx.now,
      elapsed,
      exposed,
      next(),
      !!s.customsHold,
      !!scenario.priorityBerth,
    );
    remaining.push(rem);
    if (elapsed + rem > sla) slaBreaches++;
    let t = addHours(ctx.now, rem);
    for (let j = s.currentIndex + 1; j < s.route.length; j++) {
      const from = s.route[j - 1]!;
      const to = s.route[j]!;
      let transit = transitHours(from, to) * (1 + 0.06 * gaussian(next));
      if (isSeaLeg(from, to) && isCaspianPort(from))
        transit *= 1 + 0.35 * weatherAt(ctx.snap.weather[from], t).severity;
      t = addHours(t, Math.max(transitHours(from, to) * 0.85, transit));
      if (j < s.route.length - 1)
        t = addHours(t, sampleRemainingDwell(ctx, to, t, 0, isCaspianPort(to), next(), false));
    }
    lateness.push((t.getTime() - contractual) / HOUR_MS);
  }

  lateness.sort((a, b) => a - b);
  remaining.sort((a, b) => a - b);
  const late = lateness.filter((l) => l > MODEL_CARD.delayToleranceH).length;
  const features = nodeFeatures(ctx, node, ctx.now, exposed, !!s.customsHold);
  const etaAt = (h: number) => new Date(contractual + h * HOUR_MS).toISOString();
  return {
    shipmentId: s.id,
    risk: Math.round((100 * late) / samples),
    etaDriftH: round(quantile(lateness, 0.5)),
    contractualEta: timeline.contractualEta,
    predictedEta: etaAt(quantile(lateness, 0.5)),
    etaP10: etaAt(quantile(lateness, 0.1)),
    etaP90: etaAt(quantile(lateness, 0.9)),
    currentNodeRemainingH: round(quantile(remaining, 0.5)),
    currentNodeSlaRisk: Math.round((100 * slaBreaches) / samples),
    expectedLateH: round(mean(lateness.map((l) => Math.max(0, l)))),
    expectedExcessDwellH: round(
      mean(remaining.map((r) => Math.max(0, elapsed + r - NODES[node].plannedDwellH))),
    ),
    features,
    contributions: contributions(features),
  };
}

// --- Bottleneck warnings -------------------------------------------------------------------------

export type BottleneckReason =
  | { code: "storm_closure"; windMs: number; thresholdMs: number }
  | { code: "storm_forecast"; inH: number; windMs: number }
  | { code: "closure_outlook"; day: string; probability: number }
  | { code: "queue_backlog"; anchored: number; avgQueueH: number }
  | { code: "seasonal_peak"; index: number }
  | { code: "rail_load"; loadPct: number };

export type Bottleneck = {
  node: NodeId;
  /** Delay probability now and its peak within the horizon, 0–100. */
  riskNow: number;
  riskPeak: number;
  peakAt: string;
  level: "high" | "medium" | "low";
  reasons: BottleneckReason[];
};

const WATCHED_NODES: NodeId[] = ["khorgos", "aktau", "kuryk", "baku"];

export function detectBottlenecks(ctx: EngineContext): Bottleneck[] {
  return WATCHED_NODES.map((node) => {
    const series = nodeRiskSeries(ctx, node, true, 3);
    const peak = series.reduce((a, b) => (b.risk > a.risk ? b : a), series[0]!);
    const riskNow = series[0]!.risk;
    const reasons: BottleneckReason[] = [];
    const f = nodeFeatures(ctx, node, ctx.now, true);
    if (isCaspianPort(node)) {
      const pw = ctx.snap.weather[node];
      if (pw.current.windMs > PORT_CLOSURE_WIND_MS)
        reasons.push({
          code: "storm_closure",
          windMs: pw.current.windMs,
          thresholdMs: PORT_CLOSURE_WIND_MS,
        });
      else {
        const storm = pw.series.find((p) => p.portClosed && new Date(p.at) > ctx.now);
        if (storm)
          reasons.push({
            code: "storm_forecast",
            inH: Math.round(hoursBetween(ctx.now, new Date(storm.at))),
            windMs: storm.windMs,
          });
      }
      const outlook = closureOutlook(pw, ctx.now).find((d) => d.warning);
      if (outlook)
        reasons.push({
          code: "closure_outlook",
          day: outlook.day,
          probability: outlook.probability,
        });
      const q = ctx.snap.ais.queues[node];
      if (f.queueDensity >= 0.4)
        reasons.push({ code: "queue_backlog", anchored: q.anchored, avgQueueH: q.avgQueueH });
    } else if (f.railLoad >= 0.9) {
      reasons.push({ code: "rail_load", loadPct: Math.round(f.railLoad * 100) });
    }
    if (f.seasonalIndex >= 1.05) reasons.push({ code: "seasonal_peak", index: f.seasonalIndex });
    const top = Math.max(riskNow, peak.risk);
    return {
      node,
      riskNow,
      riskPeak: peak.risk,
      peakAt: peak.at,
      level: top >= 60 ? "high" : top >= 35 ? "medium" : "low",
      reasons,
    } satisfies Bottleneck;
  }).sort((a, b) => b.riskNow - a.riskNow || b.riskPeak - a.riskPeak);
}

// --- Corridor-level summary ---------------------------------------------------------------------

export type CorridorForecast = {
  shipments: Record<string, ShipmentForecast>;
  bottlenecks: Bottleneck[];
  /** Container-weighted mean Predictive Risk Index, 0–100. */
  corridorRisk: number;
  /** Calibrated closure probability for each Caspian port, next 3 UTC days. */
  closureOutlook: Record<CaspianPort, ClosureOutlookDay[]>;
  model: typeof MODEL_CARD;
};

export function forecastCorridor(
  snap: CorridorSnapshot,
  samples = MODEL_CARD.samples,
): CorridorForecast {
  const ctx = createContext(snap);
  const shipments = Object.fromEntries(
    snap.shipments.map((s) => [s.id, forecastShipment(ctx, s, samples)]),
  );
  const total = snap.shipments.reduce((n, s) => n + s.containers, 0);
  const weighted = snap.shipments.reduce((n, s) => n + s.containers * shipments[s.id]!.risk, 0);
  return {
    shipments,
    bottlenecks: detectBottlenecks(ctx),
    corridorRisk: total ? round(weighted / total) : 0,
    closureOutlook: Object.fromEntries(
      CASPIAN_PORTS.map((p) => [p, closureOutlook(snap.weather[p], ctx.now)]),
    ) as Record<CaspianPort, ClosureOutlookDay[]>,
    model: MODEL_CARD,
  };
}
