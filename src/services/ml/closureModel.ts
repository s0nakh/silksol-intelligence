import type { PortWeather } from "@/services/telemetry/weather";
import { HOUR_MS, round } from "@/services/telemetry/prng";
import calibration from "./caspianCalibration.json";

// Calibrated Caspian port-closure model. Unlike the expert-set dwell model in riskEngine.ts, its
// coefficients are fitted on real data: archived forecasts vs. weather-station observations at
// Aktau and Baku, with an out-of-time backtest on forecasts issued 1–3 days ahead
// (scripts/data/calibrate-closure.mjs, docs/BACKTEST.md).

export const CLOSURE_CALIBRATION = calibration;

const { intercept, maxWind, maxGust } = calibration.coefficients;

/** P(closure day) from the day's forecast max sustained wind and max gust (m/s), 0–1. */
export function closureProbability(maxWindMs: number, maxGustMs: number): number {
  return 1 / (1 + Math.exp(-(intercept + maxWind * maxWindMs + maxGust * maxGustMs)));
}

export type ClosureOutlookDay = {
  /** UTC day, YYYY-MM-DD. */
  day: string;
  leadDays: number;
  maxWindMs: number;
  maxGustMs: number;
  /** Calibrated closure probability, 0–100. */
  probability: number;
  /** Probability at or above the warning threshold chosen on training data. */
  warning: boolean;
};

const MIN_HOURS_PER_DAY = 12;

/** Closure outlook for the next `days` UTC days from the port's hourly forecast series. */
export function closureOutlook(pw: PortWeather, now: Date, days = 3): ClosureOutlookDay[] {
  const today = Math.floor(now.getTime() / (24 * HOUR_MS));
  const byDay = new Map<number, { wind: number; gust: number; n: number }>();
  for (const p of pw.series) {
    const d = Math.floor(new Date(p.at).getTime() / (24 * HOUR_MS)) - today;
    if (d < 1 || d > days) continue;
    const acc = byDay.get(d) ?? { wind: 0, gust: 0, n: 0 };
    byDay.set(d, {
      wind: Math.max(acc.wind, p.windMs),
      gust: Math.max(acc.gust, p.gustMs),
      n: acc.n + 1,
    });
  }
  return [...byDay]
    .filter(([, v]) => v.n >= MIN_HOURS_PER_DAY)
    .sort(([a], [b]) => a - b)
    .map(([lead, v]) => {
      const p = closureProbability(v.wind, v.gust);
      return {
        day: new Date((today + lead) * 24 * HOUR_MS).toISOString().slice(0, 10),
        leadDays: lead,
        maxWindMs: round(v.wind),
        maxGustMs: round(v.gust),
        probability: Math.round(100 * p),
        warning: p >= calibration.warningThreshold,
      };
    });
}
