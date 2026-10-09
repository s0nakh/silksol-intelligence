import { describe, expect, it } from "vitest";
import {
  DEMO_EPOCH,
  PORT_CLOSURE_WIND_MS,
  fetchLiveCaspianWeather,
  mockSnapshot,
  normalizeAis,
  remainingPlanH,
  SHIPMENTS,
  telemetryConfigFromEnv,
} from ".";
import { addHours } from "./prng";

describe("mock telemetry", () => {
  it("is deterministic for the same clock", () => {
    expect(mockSnapshot(DEMO_EPOCH, addHours(DEMO_EPOCH, 0.5))).toEqual(
      mockSnapshot(DEMO_EPOCH, addHours(DEMO_EPOCH, 0.5)),
    );
  });

  it("scripts a storm closing Aktau now and a front reaching Baku later", () => {
    const { weather } = mockSnapshot();
    expect(weather.aktau.current.windMs).toBeGreaterThan(PORT_CLOSURE_WIND_MS);
    expect(weather.aktau.current.portClosed).toBe(true);
    expect(weather.baku.current.portClosed).toBe(false);
    expect(weather.baku.series.some((p) => p.portClosed && new Date(p.at) > DEMO_EPOCH)).toBe(true);
    expect(weather.aktau.series).toHaveLength(48 + 72 + 1);
  });

  it("summarises AIS roadstead queues per port", () => {
    const { ais } = mockSnapshot();
    expect(ais.queues.aktau.anchored).toBe(7);
    expect(ais.queues.aktau.density).toBe(0.88); // 7 anchored / (4 berths × 2 per day)
    expect(
      ais.vessels.filter((v) => v.status === "at_anchor").every((v) => (v.queueH ?? 0) > 0),
    ).toBe(true);
  });

  it("reconstructs rail & port dwell timelines with a contractual ETA", () => {
    const snap = mockSnapshot();
    const jol = snap.timelines["JOL-8921"]!;
    expect(jol.records.map((r) => r.state)).toEqual([
      "complete",
      "complete",
      "active",
      "pending",
      "pending",
    ]);
    expect(jol.records[2]!.dwellH).toBe(34);
    expect(new Date(jol.contractualEta) > DEMO_EPOCH).toBe(true);
    expect(remainingPlanH(SHIPMENTS[0]!)).toBeGreaterThan(0);
  });
});

describe("live adapters", () => {
  it("maps raw AIS positions to the nearest port roadstead", () => {
    const snap = normalizeAis(
      [
        { mmsi: 1, lat: 43.62, lon: 51.15, navStatus: 1, statusSinceH: 12 },
        { mmsi: 2, lat: 40.12, lon: 49.38, navStatus: 5 },
        { mmsi: 3, lat: 30, lon: 10 },
      ],
      "test",
    );
    expect(snap.vessels).toHaveLength(2);
    expect(snap.queues.aktau).toMatchObject({ anchored: 1, avgQueueH: 12 });
    expect(snap.queues.baku.moored).toBe(1);
    expect(snap.provenance.mode).toBe("live");
  });

  it("parses Open-Meteo responses and estimates missing waves", async () => {
    const now = new Date("2026-10-02T06:20:00Z");
    const time = Array.from({ length: 6 * 24 }, (_, i) =>
      addHours(new Date("2026-09-30T00:00:00Z"), i).toISOString().slice(0, 16),
    );
    const fetcher = (async (url: string) => {
      if (String(url).includes("marine")) return new Response("{}", { status: 500 });
      return Response.json({
        hourly: { time, wind_speed_10m: time.map(() => 16.5), wind_gusts_10m: time.map(() => 22) },
      });
    }) as typeof fetch;
    const weather = await fetchLiveCaspianWeather(now, fetcher);
    expect(weather.aktau.current).toMatchObject({
      windMs: 16.5,
      portClosed: true,
      at: "2026-10-02T06:00:00.000Z",
    });
    expect(weather.aktau.current.waveM).toBeGreaterThan(1);
    expect(weather.baku.provenance.mode).toBe("live");
  });

  it("only enables live AIS when a proxy URL is configured", () => {
    expect(telemetryConfigFromEnv({ VITE_AIS_MODE: "live" }).aisMode).toBe("mock");
    expect(
      telemetryConfigFromEnv({ VITE_AIS_MODE: "live", VITE_AIS_API_URL: "https://x/ais" }).aisMode,
    ).toBe("live");
  });
});
