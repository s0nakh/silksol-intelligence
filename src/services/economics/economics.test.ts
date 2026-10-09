import { describe, expect, it } from "vitest";
import { forecastCorridor, type ShipmentForecast } from "@/services/ml/riskEngine";
import { DEMO_EPOCH, SHIPMENTS, mockSnapshot, type Shipment } from "@/services/telemetry";
import { DELAY_TARIFFS, expectedDelayCost } from "./delayCost";
import { MIN_NET_SAVING_KZT, assessEconomics, economicsSummary } from "./recommendations";

const shipment = (id: string): Shipment => SHIPMENTS.find((s) => s.id === id)!;

const forecastWith = (overrides: Partial<ShipmentForecast>): ShipmentForecast =>
  ({
    expectedExcessDwellH: 0,
    expectedLateH: 0,
    currentNodeSlaRisk: 0,
    ...overrides,
  }) as ShipmentForecast;

describe("expected delay cost", () => {
  it("is zero when the forecast has no excess dwell, lateness or SLA risk", () => {
    expect(expectedDelayCost(shipment("JOL-8921"), forecastWith({})).totalKzt).toBe(0);
  });

  it("prices one day of excess dwell at the port with storage and wagon idle", () => {
    // Arrange: JOL-8921 waits for a vessel at Aktau, 2 containers still on wagons.
    const s = shipment("JOL-8921");

    // Act
    const cost = expectedDelayCost(s, forecastWith({ expectedExcessDwellH: 24 }));

    // Assert
    expect(cost.storageKzt).toBe(2 * DELAY_TARIFFS.storagePerContainerDay.sea_port);
    expect(cost.wagonIdleKzt).toBe(2 * DELAY_TARIFFS.wagonIdlePerWagonDay);
    expect(cost.totalKzt).toBe(cost.storageKzt + cost.wagonIdleKzt);
  });

  it("charges no wagon idle once the cargo is on a vessel at the roadstead", () => {
    const cost = expectedDelayCost(
      shipment("KZL-4107"),
      forecastWith({ expectedExcessDwellH: 48 }),
    );
    expect(cost.wagonIdleKzt).toBe(0);
    expect(cost.storageKzt).toBeGreaterThan(0);
  });

  it("weights the SLA penalty by breach probability and lateness by commodity", () => {
    const s = shipment("JOL-8921");
    const cost = expectedDelayCost(s, forecastWith({ currentNodeSlaRisk: 50, expectedLateH: 24 }));
    expect(cost.slaPenaltyKzt).toBe(0.5 * 2 * DELAY_TARIFFS.slaPenaltyPerContainer);
    expect(cost.lateDeliveryKzt).toBe(2 * DELAY_TARIFFS.lateDeliveryPerContainerDay.electronics);
  });
});

describe("recommendations", () => {
  const snap = mockSnapshot(DEMO_EPOCH, DEMO_EPOCH);
  const forecast = forecastCorridor(snap);
  const economics = assessEconomics(snap, forecast);

  it("evaluates a priority ferry slot for cargo waiting at a Caspian port", () => {
    const option = economics["JOL-8921"]!.options.find((o) => o.code === "priority_berth");
    expect(option).toMatchObject({ method: "simulation", to: "aktau" });
    expect(option!.riskAfter).toBeLessThanOrEqual(option!.riskBefore);
    expect(option!.actionCostKzt).toBe(2 * DELAY_TARIFFS.priorityBerthPerContainer);
  });

  it("evaluates switching the departure port for cargo that has not reached it", () => {
    const option = economics["MCC-2048"]!.options.find((o) => o.code === "switch_port");
    expect(option).toMatchObject({ from: "aktau", to: "kuryk", method: "simulation" });
    expect(option!.netSavingKzt).toBe(
      option!.baselineCostKzt - option!.scenarioCostKzt - option!.actionCostKzt,
    );
  });

  it("recommends only options above the minimum net saving, best first", () => {
    for (const e of Object.values(economics)) {
      expect(e.recommendations.every((r) => r.netSavingKzt >= MIN_NET_SAVING_KZT)).toBe(true);
      const savings = e.options.map((o) => o.netSavingKzt);
      expect(savings).toEqual([...savings].sort((a, b) => b - a));
    }
  });

  it("is deterministic for the same snapshot", () => {
    expect(assessEconomics(snap, forecast)).toEqual(economics);
  });

  it("sums the corridor expected loss over shipments", () => {
    const summary = economicsSummary(economics);
    const total = Object.values(economics).reduce((n, e) => n + e.cost.totalKzt, 0);
    expect(summary.expectedLossKzt).toBe(total);
    expect(summary.expectedLossKzt).toBeGreaterThan(0);
  });
});
