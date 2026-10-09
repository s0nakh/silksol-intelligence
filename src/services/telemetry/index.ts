import { mockAis, fetchLiveAis, type AisSnapshot } from "./ais";
import { buildDwellTimeline, SHIPMENTS, type DwellTimeline, type Shipment } from "./railPortDwell";
import { fetchLiveCaspianWeather, mockCaspianWeather, type CaspianWeather } from "./weather";

export * from "./corridor";
export * from "./ais";
export * from "./weather";
export * from "./railPortDwell";

/** Everything the risk engine and dashboard need, captured at one instant. */
export type CorridorSnapshot = {
  /** Scenario anchor — scripted events are placed relative to it. Stable for a session. */
  epoch: string;
  /** Live clock of this snapshot. */
  now: string;
  weather: CaspianWeather;
  ais: AisSnapshot;
  shipments: Shipment[];
  timelines: Record<string, DwellTimeline>;
};

/** Fixed epoch for server rendering and first paint, so SSR and hydration agree. */
export const DEMO_EPOCH = new Date("2026-10-02T06:00:00Z");

export function mockSnapshot(epoch: Date = DEMO_EPOCH, now: Date = epoch): CorridorSnapshot {
  const weather = mockCaspianWeather(epoch, now);
  return {
    epoch: epoch.toISOString(),
    now: now.toISOString(),
    weather,
    ais: mockAis(epoch, now, weather),
    shipments: SHIPMENTS,
    timelines: Object.fromEntries(SHIPMENTS.map((s) => [s.id, buildDwellTimeline(s, epoch)])),
  };
}

export type TelemetryConfig = {
  /** "live" tries real feeds first and falls back to simulation per feed. */
  weatherMode: "mock" | "live";
  aisMode: "mock" | "live";
  /** Proxy returning `RawAisPosition[]` (keeps provider API keys server-side). */
  aisUrl?: string | undefined;
};

export function telemetryConfigFromEnv(env: Record<string, string | undefined>): TelemetryConfig {
  return {
    weatherMode: env["VITE_WEATHER_MODE"] === "live" ? "live" : "mock",
    aisMode: env["VITE_AIS_MODE"] === "live" && env["VITE_AIS_API_URL"] ? "live" : "mock",
    aisUrl: env["VITE_AIS_API_URL"],
  };
}

/** Snapshot with live feeds where configured; each failing feed silently falls back to its mock. */
export async function loadSnapshot(
  config: TelemetryConfig,
  epoch: Date,
  now = new Date(),
): Promise<CorridorSnapshot> {
  const base = mockSnapshot(epoch, now);
  const [weather, ais] = await Promise.all([
    config.weatherMode === "live"
      ? fetchLiveCaspianWeather(now).catch(() => base.weather)
      : base.weather,
    config.aisMode === "live" && config.aisUrl
      ? fetchLiveAis(config.aisUrl).catch(() => base.ais)
      : base.ais,
  ]);
  return { ...base, weather, ais };
}
