import type { Provenance } from "@/services/ledger/auditLedger";
import { NODES, isSeaLeg, transitHours, type NodeId } from "./corridor";
import { addHours, round } from "./prng";

// Rail & port dwell feed: checkpoint arrivals/departures for container shipments along
// Lianyungang → Khorgos → Aktau/Kuryk → Baku → Poti/Tbilisi/Istanbul. In production this is fed by
// forwarder GPS/IoT trackers and CMR/SMGS consignment records; here a scripted scenario replays it.

/** What the shipment is doing at its current node. */
export type Phase = "border_crossing" | "awaiting_vessel" | "at_roadstead" | "rail_transfer";

export type Shipment = {
  id: string;
  route: NodeId[];
  /** Index in `route` of the node the shipment is at now. */
  currentIndex: number;
  phase: Phase;
  /** Hours spent at the current node so far (at the scenario epoch). */
  currentDwellH: number;
  /** Actual dwell (hours) at each node already left, in route order. */
  pastDwellH: number[];
  containers: number;
  commodity: "electronics" | "auto_parts" | "polymers" | "textiles";
  customsHold?: boolean;
};

export const SHIPMENTS: Shipment[] = [
  {
    id: "JOL-8921",
    route: ["lianyungang", "khorgos", "aktau", "baku", "istanbul"],
    currentIndex: 2,
    phase: "awaiting_vessel",
    currentDwellH: 34,
    pastDwellH: [20, 22],
    containers: 2,
    commodity: "electronics",
  },
  {
    id: "MCC-2048",
    route: ["xian", "khorgos", "aktau", "baku"],
    currentIndex: 1,
    phase: "border_crossing",
    currentDwellH: 9,
    pastDwellH: [16],
    containers: 4,
    commodity: "auto_parts",
  },
  {
    id: "KZL-4107",
    route: ["lianyungang", "khorgos", "kuryk", "baku", "tbilisi"],
    currentIndex: 3,
    phase: "at_roadstead",
    currentDwellH: 60,
    pastDwellH: [22, 41, 26],
    containers: 3,
    commodity: "polymers",
  },
  {
    id: "TRK-7782",
    route: ["almaty", "aktau", "baku", "istanbul"],
    currentIndex: 2,
    phase: "rail_transfer",
    currentDwellH: 8,
    pastDwellH: [12, 24],
    containers: 1,
    commodity: "textiles",
  },
];

export type DwellRecord = {
  node: NodeId;
  arrivedAt: string | null;
  departedAt: string | null;
  /** Actual dwell so far (current node) or total (past node); null for nodes not reached. */
  dwellH: number | null;
  plannedDwellH: number;
  slaDwellH: number;
  state: "complete" | "active" | "pending";
};

export type DwellTimeline = {
  shipmentId: string;
  records: DwellRecord[];
  /** Departure from the origin terminal. */
  departedOriginAt: string;
  /** Contractual ETA at destination, quoted with planned dwell at every node. */
  contractualEta: string;
  provenance: Provenance;
};

/** Reconstructs checkpoint times backwards from `now` for a scripted shipment. */
export function buildDwellTimeline(s: Shipment, now: Date): DwellTimeline {
  const records: DwellRecord[] = s.route.map((node) => ({
    node,
    arrivedAt: null,
    departedAt: null,
    dwellH: null,
    plannedDwellH: NODES[node].plannedDwellH,
    slaDwellH: NODES[node].slaDwellH,
    state: "pending",
  }));

  let arrival = addHours(now, -s.currentDwellH);
  const current = records[s.currentIndex]!;
  current.arrivedAt = arrival.toISOString();
  current.dwellH = s.currentDwellH;
  current.state = "active";

  for (let i = s.currentIndex - 1; i >= 0; i--) {
    const departed = addHours(arrival, -transitHours(s.route[i]!, s.route[i + 1]!));
    const dwell = s.pastDwellH[i] ?? NODES[s.route[i]!].plannedDwellH;
    arrival = addHours(departed, -dwell);
    Object.assign(records[i]!, {
      arrivedAt: arrival.toISOString(),
      departedAt: departed.toISOString(),
      dwellH: dwell,
      state: "complete",
    });
  }

  const departedOriginAt = records[0]!.departedAt ?? now.toISOString();
  let eta = new Date(departedOriginAt);
  for (let i = 1; i < s.route.length; i++) {
    eta = addHours(eta, transitHours(s.route[i - 1]!, s.route[i]!));
    if (i < s.route.length - 1) eta = addHours(eta, NODES[s.route[i]!].plannedDwellH);
  }

  return {
    shipmentId: s.id,
    records,
    departedOriginAt,
    contractualEta: eta.toISOString(),
    provenance: {
      source: "SilkSol rail & port dwell simulator (CMR/SMGS replay)",
      mode: "simulated",
      retrievedAt: now.toISOString(),
    },
  };
}

/** Hours of the remaining planned journey after the current node (transit + planned dwell). */
export function remainingPlanH(s: Shipment) {
  let h = 0;
  for (let i = s.currentIndex + 1; i < s.route.length; i++) {
    h += transitHours(s.route[i - 1]!, s.route[i]!);
    if (i < s.route.length - 1) h += NODES[s.route[i]!].plannedDwellH;
  }
  return round(h);
}

export const nextLegIsSea = (s: Shipment) => {
  const here = s.route[s.currentIndex]!;
  const next = s.route[s.currentIndex + 1];
  return !!next && isSeaLeg(here, next);
};
