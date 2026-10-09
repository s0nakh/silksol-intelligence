import type { Provenance } from "@/services/ledger/auditLedger";
import { CASPIAN_PORTS, NODES, PORT_CLOSURE_WIND_MS, type CaspianPort } from "./corridor";
import { HOUR_MS, addHours, clamp, round, smoothNoise } from "./prng";

// Caspian hydrometeorology: wind, gusts, significant wave height and storm alerts per port.
// Mock mode replays scripted storm fronts; live mode reads the free Open-Meteo forecast and
// marine APIs (no key). Kazhydromet / ECMWF adapters can implement the same `PortWeather` shape.

export type WeatherPoint = {
  at: string;
  windMs: number;
  gustMs: number;
  waveM: number;
  /** 0–1 severity index used as an ML feature. */
  severity: number;
  stormAlert: boolean;
  portClosed: boolean;
};

export type PortWeather = {
  port: CaspianPort;
  current: WeatherPoint;
  /** Hourly points from 48 h ago to 72 h ahead. */
  series: WeatherPoint[];
  provenance: Provenance;
};

export type CaspianWeather = Record<CaspianPort, PortWeather>;

export const HISTORY_H = 48;
export const FORECAST_H = 72;

export function weatherSeverity(windMs: number, waveM: number) {
  return round(0.7 * clamp((windMs - 5) / 12) + 0.3 * clamp((waveM - 0.4) / 2.2), 3);
}

function point(at: Date, windMs: number, gustMs: number, waveM: number): WeatherPoint {
  return {
    at: at.toISOString(),
    windMs: round(windMs),
    gustMs: round(gustMs),
    waveM: round(waveM, 2),
    severity: weatherSeverity(windMs, waveM),
    stormAlert: windMs >= PORT_CLOSURE_WIND_MS - 2 || gustMs >= 20,
    portClosed: windMs > PORT_CLOSURE_WIND_MS,
  };
}

/** Fetch-limited wave estimate for the shallow northern/middle Caspian. */
const waveFromWind = (windMs: number) => 0.03 * Math.max(windMs, 0) ** 1.5;

// Scripted storm fronts, in hours relative to the scenario epoch: a north-westerly gale that
// closed Aktau/Kuryk overnight and is now easing, and a second front reaching Baku in ~30 h.
const FRONTS: Record<CaspianPort, { centerH: number; peakMs: number; widthH: number }[]> = {
  aktau: [{ centerH: -8, peakMs: 13.5, widthH: 13 }],
  kuryk: [{ centerH: -7, peakMs: 12, widthH: 12 }],
  baku: [
    { centerH: -40, peakMs: 12.5, widthH: 9 },
    { centerH: 30, peakMs: 10.5, widthH: 9 },
  ],
};

function mockWind(port: CaspianPort, epoch: Date, at: Date) {
  const h = (at.getTime() - epoch.getTime()) / HOUR_MS;
  const diurnal = 1.2 * Math.sin(((at.getUTCHours() - 9) / 24) * 2 * Math.PI);
  const front = FRONTS[port].reduce(
    (sum, f) => sum + f.peakMs * Math.exp(-((h - f.centerH) ** 2) / (2 * f.widthH ** 2)),
    0,
  );
  return Math.max(1, 6 + diurnal + front + 0.8 * smoothNoise(`wind:${port}`, h / 3));
}

/** Simulated feed. `epoch` anchors the scripted scenario; `now` is the live clock. */
export function mockCaspianWeather(epoch: Date, now: Date): CaspianWeather {
  const start = new Date(Math.floor(now.getTime() / HOUR_MS) * HOUR_MS);
  const result = {} as CaspianWeather;
  for (const port of CASPIAN_PORTS) {
    const series: WeatherPoint[] = [];
    for (let h = -HISTORY_H; h <= FORECAST_H; h++) {
      const at = addHours(start, h);
      const wind = mockWind(port, epoch, at);
      // Sea state lags the wind by ~2 h.
      const wave = waveFromWind(mockWind(port, epoch, addHours(at, -2)));
      series.push(point(at, wind, wind * 1.35, wave));
    }
    const wind = mockWind(port, epoch, now);
    result[port] = {
      port,
      current: point(
        now,
        wind,
        wind * 1.35,
        waveFromWind(mockWind(port, epoch, addHours(now, -2))),
      ),
      series,
      provenance: {
        source: "SilkSol Caspian weather simulator",
        mode: "simulated",
        retrievedAt: now.toISOString(),
      },
    };
  }
  return result;
}

/** Weather at an arbitrary time: nearest hourly point, or seasonal climatology outside the window. */
export function weatherAt(pw: PortWeather, at: Date): WeatherPoint {
  const first = pw.series[0];
  if (!first) return pw.current;
  const idx = Math.round((at.getTime() - new Date(first.at).getTime()) / HOUR_MS);
  const hit = pw.series[idx];
  if (hit) return hit;
  return point(at, 7.5, 10, waveFromWind(7.5));
}

// --- Live feed (Open-Meteo, free, no API key) -------------------------------------------------

type OpenMeteoHourly = {
  hourly?: {
    time?: string[];
    wind_speed_10m?: (number | null)[];
    wind_gusts_10m?: (number | null)[];
    wave_height?: (number | null)[];
  };
};

const OPEN_METEO = "https://api.open-meteo.com/v1/forecast";
const OPEN_METEO_MARINE = "https://marine-api.open-meteo.com/v1/marine";

async function getJson(url: string, fetcher: typeof fetch): Promise<OpenMeteoHourly> {
  const res = await fetcher(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return (await res.json()) as OpenMeteoHourly;
}

/** Live Caspian weather from Open-Meteo. Throws if the feed is unreachable — callers fall back to mock. */
export async function fetchLiveCaspianWeather(
  now = new Date(),
  fetcher: typeof fetch = fetch,
): Promise<CaspianWeather> {
  const result = {} as CaspianWeather;
  await Promise.all(
    CASPIAN_PORTS.map(async (port) => {
      const { lat, lon } = NODES[port];
      const q = `latitude=${lat}&longitude=${lon}&past_days=2&forecast_days=4&timezone=GMT`;
      const [atmo, marine] = await Promise.all([
        getJson(
          `${OPEN_METEO}?${q}&hourly=wind_speed_10m,wind_gusts_10m&wind_speed_unit=ms`,
          fetcher,
        ),
        // Marine coverage of the Caspian is patchy; missing waves are estimated from wind.
        getJson(`${OPEN_METEO_MARINE}?${q}&hourly=wave_height`, fetcher).catch(
          () => ({}) as OpenMeteoHourly,
        ),
      ]);
      const times = atmo.hourly?.time ?? [];
      const all = times.map((t, i) => {
        const wind = atmo.hourly?.wind_speed_10m?.[i] ?? 0;
        const gust = atmo.hourly?.wind_gusts_10m?.[i] ?? wind * 1.35;
        const wave = marine.hourly?.wave_height?.[i] ?? waveFromWind(wind);
        return point(new Date(`${t}Z`), wind, gust, wave);
      });
      const nowH = Math.floor(now.getTime() / HOUR_MS) * HOUR_MS;
      const series = all.filter((p) => {
        const dh = (new Date(p.at).getTime() - nowH) / HOUR_MS;
        return dh >= -HISTORY_H && dh <= FORECAST_H;
      });
      const current = series.find((p) => new Date(p.at).getTime() === nowH);
      if (!current) throw new Error(`Open-Meteo returned no current hour for ${port}`);
      result[port] = {
        port,
        current,
        series,
        provenance: {
          source: "Open-Meteo forecast + marine API",
          mode: "live",
          retrievedAt: new Date().toISOString(),
        },
      };
    }),
  );
  return result;
}
