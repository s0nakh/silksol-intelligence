import { describe, expect, it } from "vitest";
import { DEMO_EPOCH, mockSnapshot } from "@/services/telemetry";
import { addHours } from "@/services/telemetry/prng";
import {
  createContext,
  detectBottlenecks,
  disruptionProbability,
  forecastCorridor,
  hazardMultiplier,
  nodeRiskSeries,
  type NodeFeatures,
} from "./riskEngine";

const calm: NodeFeatures = {
  weatherSeverity: 0,
  queueDensity: 0,
  seasonalIndex: 1,
  railLoad: 0.8,
  customsHold: false,
  portClosed: false,
};

describe("feature model", () => {
  it("raises delay probability monotonically with each adverse feature", () => {
    const base = disruptionProbability(calm);
    expect(base).toBeLessThan(0.1);
    expect(disruptionProbability({ ...calm, weatherSeverity: 0.9 })).toBeGreaterThan(base);
    expect(disruptionProbability({ ...calm, queueDensity: 1 })).toBeGreaterThan(base);
    expect(disruptionProbability({ ...calm, seasonalIndex: 1.25 })).toBeGreaterThan(base);
    expect(disruptionProbability({ ...calm, customsHold: true })).toBeGreaterThan(base);
  });

  it("slows queue exit (lower hazard) in storms and stops it when the port is closed", () => {
    expect(hazardMultiplier(calm)).toBeCloseTo(1);
    expect(hazardMultiplier({ ...calm, weatherSeverity: 0.8 })).toBeLessThan(0.5);
    expect(hazardMultiplier({ ...calm, portClosed: true })).toBeLessThan(0.1);
  });
});

describe("corridor forecast", () => {
  const forecast = forecastCorridor(mockSnapshot());

  it("is deterministic", () => {
    expect(forecastCorridor(mockSnapshot())).toEqual(forecast);
  });

  it("ranks the demo scenarios as expected", () => {
    const s = forecast.shipments;
    expect(s["KZL-4107"]!.risk).toBeGreaterThanOrEqual(90);
    expect(s["JOL-8921"]!.risk).toBeGreaterThanOrEqual(55);
    expect(s["JOL-8921"]!.risk).toBeLessThan(85);
    expect(s["MCC-2048"]!.risk).toBeLessThan(35);
    expect(s["TRK-7782"]!.risk).toBeLessThan(20);
    expect(s["JOL-8921"]!.etaDriftH).toBeGreaterThan(s["TRK-7782"]!.etaDriftH);
  });

  it("returns an ordered probabilistic ETA band", () => {
    for (const f of Object.values(forecast.shipments)) {
      expect(new Date(f.etaP10) <= new Date(f.predictedEta)).toBe(true);
      expect(new Date(f.predictedEta) <= new Date(f.etaP90)).toBe(true);
    }
  });

  it("flags the storm-closed port as the top bottleneck and Baku's incoming front", () => {
    const [top] = forecast.bottlenecks;
    expect(top!.node).toBe("aktau");
    expect(top!.level).toBe("high");
    expect(top!.reasons.map((r) => r.code)).toContain("storm_closure");
    const baku = forecast.bottlenecks.find((b) => b.node === "baku")!;
    expect(baku.reasons.map((r) => r.code)).toContain("storm_forecast");
    expect(baku.riskPeak).toBeGreaterThan(baku.riskNow);
  });

  it("stays stable within a refresh cycle (no flicker of table statuses)", () => {
    const later = forecastCorridor(mockSnapshot(DEMO_EPOCH, addHours(DEMO_EPOCH, 0.25)));
    for (const [id, f] of Object.entries(forecast.shipments))
      expect(Math.abs(later.shipments[id]!.risk - f.risk)).toBeLessThanOrEqual(5);
  });

  it("projects Aktau risk recovering as the storm passes", () => {
    const series = nodeRiskSeries(createContext(mockSnapshot()), "aktau", true);
    expect(series).toHaveLength(13);
    expect(series[0]!.risk).toBeGreaterThan(80);
    expect(series.at(-1)!.risk).toBeLessThan(40);
    expect(detectBottlenecks(createContext(mockSnapshot())).length).toBe(4);
  });
});
