import { describe, expect, it } from "vitest";
import { DEMO_EPOCH, mockSnapshot } from "@/services/telemetry";
import { addHours } from "@/services/telemetry/prng";
import { CLOSURE_CALIBRATION, closureOutlook, closureProbability } from "./closureModel";
import { MODEL_CARD } from "./riskEngine";

describe("calibrated closure model", () => {
  it("rises monotonically with forecast wind and gusts", () => {
    expect(closureProbability(6, 9)).toBeLessThan(0.02);
    expect(closureProbability(12, 17)).toBeGreaterThan(closureProbability(9, 13));
    expect(closureProbability(16, 22)).toBeGreaterThan(CLOSURE_CALIBRATION.warningThreshold);
  });

  it("was backtested out of time and beats climatology at every lead", () => {
    expect(CLOSURE_CALIBRATION.test.start > CLOSURE_CALIBRATION.train.end).toBe(true);
    for (const b of CLOSURE_CALIBRATION.backtest) {
      expect(b.events).toBeGreaterThan(20);
      expect(b.auc).toBeGreaterThan(0.8);
      expect(b.brierSkill).toBeGreaterThan(0);
    }
    expect(MODEL_CARD.backtest).toHaveLength(3);
  });

  it("builds the outlook for fully forecast days and flags the scripted Baku front", () => {
    const snap = mockSnapshot(DEMO_EPOCH, DEMO_EPOCH);
    const outlook = closureOutlook(snap.weather.baku, new Date(snap.now));
    expect(outlook.map((d) => d.leadDays)).toEqual([1, 2]); // D+3 is only partly inside the 72 h window
    expect(outlook.some((d) => d.warning)).toBe(true);
    const calm = closureOutlook(snap.weather.aktau, addHours(DEMO_EPOCH, 0));
    expect(calm.every((d) => d.probability < 50)).toBe(true);
  });
});
