// Static model of the Trans-Caspian International Transport Route (TITR / Middle Corridor).
// Dwell baselines, SLA thresholds and seasonal indices are SYNTHETIC planning assumptions, not
// measured data. Replace them with historical exports (KTZ, Port of Aktau, ADY, Port of Baku)
// before using the risk scores for commercial decisions.

export type NodeId =
  | "lianyungang"
  | "xian"
  | "almaty"
  | "khorgos"
  | "aktau"
  | "kuryk"
  | "baku"
  | "tbilisi"
  | "poti"
  | "istanbul";

export type NodeKind = "rail_terminal" | "rail_border" | "sea_port";

export type CorridorNode = {
  id: NodeId;
  kind: NodeKind;
  country: "CN" | "KZ" | "AZ" | "GE" | "TR";
  lat: number;
  lon: number;
  /** Weibull scale (hours) of dwell time under neutral conditions. */
  baseDwellH: number;
  /** Contractual SLA: dwell above this many hours is a violation. */
  slaDwellH: number;
  /** Dwell assumed when the contractual ETA was quoted. */
  plannedDwellH: number;
  /** Berths serving Caspian ferries / ro-ro (sea ports only). */
  berths?: number;
};

export const NODES: Record<NodeId, CorridorNode> = {
  lianyungang: {
    id: "lianyungang",
    kind: "rail_terminal",
    country: "CN",
    lat: 34.6,
    lon: 119.2,
    baseDwellH: 26,
    slaDwellH: 48,
    plannedDwellH: 20,
  },
  xian: {
    id: "xian",
    kind: "rail_terminal",
    country: "CN",
    lat: 34.34,
    lon: 108.94,
    baseDwellH: 22,
    slaDwellH: 48,
    plannedDwellH: 18,
  },
  almaty: {
    id: "almaty",
    kind: "rail_terminal",
    country: "KZ",
    lat: 43.24,
    lon: 76.89,
    baseDwellH: 18,
    slaDwellH: 36,
    plannedDwellH: 14,
  },
  khorgos: {
    id: "khorgos",
    kind: "rail_border",
    country: "KZ",
    lat: 44.21,
    lon: 80.4,
    baseDwellH: 22,
    slaDwellH: 36,
    plannedDwellH: 18,
  },
  aktau: {
    id: "aktau",
    kind: "sea_port",
    country: "KZ",
    lat: 43.6,
    lon: 51.2,
    baseDwellH: 24,
    slaDwellH: 48,
    plannedDwellH: 20,
    berths: 4,
  },
  kuryk: {
    id: "kuryk",
    kind: "sea_port",
    country: "KZ",
    lat: 43.17,
    lon: 51.67,
    baseDwellH: 26,
    slaDwellH: 48,
    plannedDwellH: 22,
    berths: 3,
  },
  baku: {
    id: "baku",
    kind: "sea_port",
    country: "AZ",
    lat: 40.1,
    lon: 49.4,
    baseDwellH: 18,
    slaDwellH: 36,
    plannedDwellH: 15,
    berths: 5,
  },
  tbilisi: {
    id: "tbilisi",
    kind: "rail_terminal",
    country: "GE",
    lat: 41.72,
    lon: 44.79,
    baseDwellH: 12,
    slaDwellH: 24,
    plannedDwellH: 10,
  },
  poti: {
    id: "poti",
    kind: "sea_port",
    country: "GE",
    lat: 42.15,
    lon: 41.67,
    baseDwellH: 20,
    slaDwellH: 36,
    plannedDwellH: 16,
    berths: 6,
  },
  istanbul: {
    id: "istanbul",
    kind: "rail_terminal",
    country: "TR",
    lat: 41.01,
    lon: 28.98,
    baseDwellH: 12,
    slaDwellH: 24,
    plannedDwellH: 10,
  },
};

/** Ports with Caspian hydrometeorological exposure. */
export const CASPIAN_PORTS = ["aktau", "kuryk", "baku"] as const satisfies readonly NodeId[];
export type CaspianPort = (typeof CASPIAN_PORTS)[number];
export const isCaspianPort = (id: NodeId): id is CaspianPort =>
  (CASPIAN_PORTS as readonly NodeId[]).includes(id);

/** Planned transit time (hours) between consecutive nodes. */
const TRANSIT_H: Record<string, number> = {
  "lianyungang>khorgos": 110,
  "xian>khorgos": 86,
  "khorgos>aktau": 72,
  "khorgos>kuryk": 74,
  "almaty>aktau": 64,
  "aktau>baku": 22,
  "kuryk>baku": 20,
  "baku>tbilisi": 18,
  "baku>poti": 30,
  "baku>istanbul": 76,
  "poti>istanbul": 60,
};

export function transitHours(from: NodeId, to: NodeId): number {
  const h = TRANSIT_H[`${from}>${to}`];
  if (h === undefined) throw new Error(`No corridor leg ${from} → ${to}`);
  return h;
}

export const isSeaLeg = (from: NodeId, to: NodeId) => isCaspianPort(from) && isCaspianPort(to);

/** Corridor-wide dashboard route (Lianyungang → Khorgos → Aktau → Baku → Poti/Istanbul). */
export const TRACKER_ROUTE: NodeId[] = ["lianyungang", "khorgos", "aktau", "baku", "istanbul"];

/** Port closes for ferry/ro-ro operations at sustained wind above this (m/s). */
export const PORT_CLOSURE_WIND_MS = 15;

// Monthly dwell index relative to the annual mean (Jan … Dec). Caspian ports peak with
// autumn/winter storms; rail borders peak with Q4 volume. SYNTHETIC baseline.
const SEASONAL_INDEX: Record<NodeKind, number[]> = {
  sea_port: [1.25, 1.2, 1.1, 0.95, 0.9, 0.85, 0.85, 0.9, 0.95, 1.05, 1.2, 1.3],
  rail_border: [1.1, 1.0, 1.05, 1.0, 0.95, 0.95, 1.0, 1.05, 1.1, 1.15, 1.2, 1.25],
  rail_terminal: [1.05, 1.0, 1.0, 0.95, 0.95, 0.95, 1.0, 1.0, 1.05, 1.05, 1.1, 1.15],
};

/** Rail network utilisation by month (0–1). SYNTHETIC baseline. */
const RAIL_LOAD = [0.86, 0.8, 0.83, 0.8, 0.78, 0.78, 0.8, 0.83, 0.87, 0.91, 0.94, 0.95];

export const seasonalIndex = (kind: NodeKind, at: Date) => SEASONAL_INDEX[kind][at.getUTCMonth()]!;
export const railLoadFactor = (at: Date) => RAIL_LOAD[at.getUTCMonth()]!;
