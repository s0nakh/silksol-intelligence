import { describe, expect, it } from "vitest";
import { HOUR_MS } from "@/services/telemetry/prng";
import { CorridorService, SCENARIO_MAX_AGE_H } from "./corridorService";

const MOCK = { weatherMode: "mock", aisMode: "mock" } as const;

describe("corridor service scenario anchor", () => {
  it("anchors the scenario at the start of the current hour, so dates are today's", async () => {
    // Arrange
    const now = Date.parse("2026-10-09T11:35:00Z");
    const service = new CorridorService(MOCK, () => now);

    // Act
    const { snapshot } = await service.current();

    // Assert
    expect(snapshot.epoch).toBe("2026-10-09T11:00:00.000Z");
    expect(snapshot.now).toBe("2026-10-09T11:35:00.000Z");
  });

  it("re-anchors to a new day once the scenario is older than the maximum age", async () => {
    let now = Date.parse("2026-10-09T11:35:00Z");
    const service = new CorridorService(MOCK, () => now);
    await service.issueReport("JOL-8921");
    expect(Object.keys((await service.current()).reports)).toEqual(["JOL-8921"]);

    now += (SCENARIO_MAX_AGE_H + 1) * HOUR_MS;
    const state = await service.current();

    expect(state.snapshot.epoch).toBe("2026-10-10T12:00:00.000Z");
    expect(state.reports).toEqual({});
  });
});
