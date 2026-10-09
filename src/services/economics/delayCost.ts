import type { ShipmentForecast } from "@/services/ml/riskEngine";
import { NODES, type NodeKind, type Phase, type Shipment } from "@/services/telemetry";

// Cost of delay in tenge: turns the risk engine's Monte Carlo forecast into expected money lost
// per shipment. Tariffs are PLANNING ASSUMPTIONS for the demo; a pilot replaces them with the
// partner's contract rates (storage, wagon rent, SLA penalties, delivery terms).

export const DELAY_TARIFFS = {
  currency: "KZT",
  status: "planning_assumptions",
  /** Terminal storage / demurrage per container-day beyond planned dwell. */
  storagePerContainerDay: { sea_port: 12_000, rail_border: 7_000, rail_terminal: 5_000 },
  /** Flat-car rent while cargo waits on wagons, per wagon-day. */
  wagonIdlePerWagonDay: 8_000,
  /** Contractual penalty per container when dwell breaches the SLA threshold. */
  slaPenaltyPerContainer: 150_000,
  /** Cost of late delivery to the consignee (capital, production stoppage) per container-day. */
  lateDeliveryPerContainerDay: {
    electronics: 60_000,
    auto_parts: 45_000,
    polymers: 20_000,
    textiles: 25_000,
  },
  /** One-off cost of re-routing to another Caspian port, per container. */
  portSwitchPerContainer: 30_000,
  /** Priority ferry / berth slot surcharge, per container. */
  priorityBerthPerContainer: 40_000,
} as const satisfies {
  storagePerContainerDay: Record<NodeKind, number>;
  lateDeliveryPerContainerDay: Record<Shipment["commodity"], number>;
} & Record<string, unknown>;

/** 40-ft containers ride one per flat car. */
export const CONTAINERS_PER_WAGON = 1;

/** Phases in which the containers are still on wagons. */
export const ON_WAGONS: readonly Phase[] = ["border_crossing", "awaiting_vessel", "rail_transfer"];

export const HOURS_PER_DAY = 24;
const ROUND_TO_KZT = 1_000;

export type DelayCost = {
  storageKzt: number;
  wagonIdleKzt: number;
  slaPenaltyKzt: number;
  lateDeliveryKzt: number;
  totalKzt: number;
};

export const roundKzt = (v: number) => Math.round(v / ROUND_TO_KZT) * ROUND_TO_KZT;

/** Expected delay cost of a shipment under a forecast (mean over the Monte Carlo samples). */
export function expectedDelayCost(s: Shipment, f: ShipmentForecast): DelayCost {
  const kind = NODES[s.route[s.currentIndex]!].kind;
  const excessDays = f.expectedExcessDwellH / HOURS_PER_DAY;
  const wagons = ON_WAGONS.includes(s.phase) ? s.containers / CONTAINERS_PER_WAGON : 0;

  const storageKzt = roundKzt(
    s.containers * excessDays * DELAY_TARIFFS.storagePerContainerDay[kind],
  );
  const wagonIdleKzt = roundKzt(wagons * excessDays * DELAY_TARIFFS.wagonIdlePerWagonDay);
  const slaPenaltyKzt = roundKzt(
    (f.currentNodeSlaRisk / 100) * s.containers * DELAY_TARIFFS.slaPenaltyPerContainer,
  );
  const lateDeliveryKzt = roundKzt(
    s.containers *
      (f.expectedLateH / HOURS_PER_DAY) *
      DELAY_TARIFFS.lateDeliveryPerContainerDay[s.commodity],
  );
  return {
    storageKzt,
    wagonIdleKzt,
    slaPenaltyKzt,
    lateDeliveryKzt,
    totalKzt: storageKzt + wagonIdleKzt + slaPenaltyKzt + lateDeliveryKzt,
  };
}
