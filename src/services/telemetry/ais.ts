import type { Provenance } from "@/services/ledger/auditLedger";
import { CASPIAN_PORTS, NODES, type CaspianPort } from "./corridor";
import type { CaspianWeather } from "./weather";
import { HOUR_MS, clamp, round, smoothNoise } from "./prng";

// Marine AIS telemetry for Caspian ferries, ro-ro and feeders around Aktau, Kuryk and Baku (Alat).
// Mock mode simulates a fleet; live mode reads any AIS provider (MarineTraffic, Spire,
// VesselFinder, AISStream relay) through a proxy that returns `RawAisPosition[]`.

export type NavStatus = "under_way" | "at_anchor" | "moored";
export type VesselType = "ro_ro" | "rail_ferry" | "container_feeder" | "general_cargo";

export type Vessel = {
  mmsi: string;
  name: string;
  type: VesselType;
  lat: number;
  lon: number;
  /** Speed over ground, knots. */
  sog: number;
  /** Course over ground, degrees. */
  cog: number;
  status: NavStatus;
  /** Port the vessel is queuing at or heading to. */
  port: CaspianPort;
  /** Hours spent at anchor on the roadstead (queue time), when anchored. */
  queueH?: number;
};

export type PortQueue = {
  port: CaspianPort;
  anchored: number;
  moored: number;
  inbound: number;
  avgQueueH: number;
  maxQueueH: number;
  /** Anchored vessels per berth-day of capacity — ML feature (≈1 = one full day of backlog). */
  density: number;
};

export type AisSnapshot = {
  vessels: Vessel[];
  queues: Record<CaspianPort, PortQueue>;
  provenance: Provenance;
};

type FleetEntry = {
  mmsi: string;
  name: string;
  type: VesselType;
  port: CaspianPort;
} & (
  | { status: "at_anchor"; queueH: number }
  | { status: "moored" }
  | { status: "under_way"; from: CaspianPort; departedH: number }
);

// Simulated fleet at the scenario epoch. Names are fictional; MMSIs use KZ (436) / AZ (423) MIDs.
export const MOCK_FLEET: FleetEntry[] = [
  {
    mmsi: "436000101",
    name: "Steppe Carrier",
    type: "rail_ferry",
    port: "aktau",
    status: "at_anchor",
    queueH: 31,
  },
  {
    mmsi: "436000102",
    name: "Mangystau Line",
    type: "ro_ro",
    port: "aktau",
    status: "at_anchor",
    queueH: 27,
  },
  {
    mmsi: "423000201",
    name: "Absheron Trader",
    type: "container_feeder",
    port: "aktau",
    status: "at_anchor",
    queueH: 22,
  },
  {
    mmsi: "436000103",
    name: "Tengiz Bridge",
    type: "general_cargo",
    port: "aktau",
    status: "at_anchor",
    queueH: 18,
  },
  {
    mmsi: "423000202",
    name: "Shirvan Express",
    type: "ro_ro",
    port: "aktau",
    status: "at_anchor",
    queueH: 12,
  },
  {
    mmsi: "436000104",
    name: "Caspian Pioneer",
    type: "container_feeder",
    port: "aktau",
    status: "at_anchor",
    queueH: 7,
  },
  {
    mmsi: "436000105",
    name: "Ustyurt",
    type: "general_cargo",
    port: "aktau",
    status: "at_anchor",
    queueH: 3,
  },
  { mmsi: "436000106", name: "Aral Spirit", type: "rail_ferry", port: "aktau", status: "moored" },
  {
    mmsi: "436000107",
    name: "Kuryk Star",
    type: "rail_ferry",
    port: "kuryk",
    status: "at_anchor",
    queueH: 19,
  },
  {
    mmsi: "423000203",
    name: "Ganja Way",
    type: "ro_ro",
    port: "kuryk",
    status: "at_anchor",
    queueH: 11,
  },
  { mmsi: "436000108", name: "Beineu", type: "general_cargo", port: "kuryk", status: "moored" },
  {
    mmsi: "423000204",
    name: "Caspian Meridian",
    type: "container_feeder",
    port: "baku",
    status: "at_anchor",
    queueH: 60,
  },
  {
    mmsi: "423000205",
    name: "Alat Gate",
    type: "rail_ferry",
    port: "baku",
    status: "at_anchor",
    queueH: 41,
  },
  {
    mmsi: "423000206",
    name: "Nakhchivan Sea",
    type: "ro_ro",
    port: "baku",
    status: "at_anchor",
    queueH: 26,
  },
  {
    mmsi: "436000109",
    name: "Silk Horizon",
    type: "ro_ro",
    port: "baku",
    status: "at_anchor",
    queueH: 9,
  },
  { mmsi: "423000207", name: "Qobustan", type: "rail_ferry", port: "baku", status: "moored" },
  {
    mmsi: "423000208",
    name: "Lankaran",
    type: "container_feeder",
    port: "baku",
    status: "under_way",
    from: "aktau",
    departedH: 9,
  },
  {
    mmsi: "436000110",
    name: "Zhetysu",
    type: "ro_ro",
    port: "aktau",
    status: "under_way",
    from: "baku",
    departedH: 14,
  },
];

/** Vessel carrying a given shipment (simulated booking data). */
export const CARGO_VESSEL: Record<string, string> = { "KZL-4107": "423000204" };

const BERTH_DAY_CAPACITY = 2;

export function summarizeQueues(vessels: Vessel[]): Record<CaspianPort, PortQueue> {
  const out = {} as Record<CaspianPort, PortQueue>;
  for (const port of CASPIAN_PORTS) {
    const here = vessels.filter((v) => v.port === port);
    const anchored = here.filter((v) => v.status === "at_anchor");
    const waits = anchored.map((v) => v.queueH ?? 0);
    const berths = NODES[port].berths ?? 1;
    out[port] = {
      port,
      anchored: anchored.length,
      moored: here.filter((v) => v.status === "moored").length,
      inbound: here.filter((v) => v.status === "under_way").length,
      avgQueueH: waits.length ? round(waits.reduce((a, b) => a + b, 0) / waits.length) : 0,
      maxQueueH: waits.length ? round(Math.max(...waits)) : 0,
      density: round(anchored.length / (berths * BERTH_DAY_CAPACITY), 2),
    };
  }
  return out;
}

const bearing = (aLat: number, aLon: number, bLat: number, bLon: number) =>
  (Math.round((Math.atan2(bLon - aLon, bLat - aLat) * 180) / Math.PI) + 360) % 360;

/** Simulated AIS positions at `now`; vessels drift and steam forward between refreshes. */
export function mockAis(epoch: Date, now: Date, weather: CaspianWeather): AisSnapshot {
  const elapsedH = Math.max(0, (now.getTime() - epoch.getTime()) / HOUR_MS);
  const vessels: Vessel[] = MOCK_FLEET.map((f, i) => {
    const port = NODES[f.port];
    const noise = (k: string) => smoothNoise(`${f.mmsi}:${k}`, elapsedH * 6);
    if (f.status === "under_way") {
      const from = NODES[f.from];
      const severity = weather[f.port].current.severity;
      const sog = round(clamp(11.5 - 4 * severity + 0.6 * noise("sog"), 4, 14));
      const progress = clamp((f.departedH + elapsedH) / 22, 0.05, 0.95);
      return {
        mmsi: f.mmsi,
        name: f.name,
        type: f.type,
        lat: round(from.lat + (port.lat - from.lat) * progress, 4),
        lon: round(from.lon + (port.lon - from.lon) * progress, 4),
        sog,
        cog: bearing(from.lat, from.lon, port.lat, port.lon),
        status: "under_way",
        port: f.port,
      };
    }
    const ring = 0.06 + 0.012 * i;
    const angle = (i * 137.5 * Math.PI) / 180;
    const anchored = f.status === "at_anchor";
    return {
      mmsi: f.mmsi,
      name: f.name,
      type: f.type,
      lat: round(port.lat + (anchored ? ring * Math.sin(angle) : 0.004) + 0.0008 * noise("lat"), 4),
      lon: round(
        port.lon - (anchored ? Math.abs(ring * Math.cos(angle)) : 0.004) + 0.0008 * noise("lon"),
        4,
      ),
      sog: anchored ? round(Math.abs(0.25 * noise("sog")), 1) : 0,
      cog: Math.round(((((noise("cog") + 1) * 180) % 360) + 360) % 360),
      status: f.status,
      port: f.port,
      ...(anchored ? { queueH: round(f.queueH + elapsedH) } : {}),
    };
  });
  return {
    vessels,
    queues: summarizeQueues(vessels),
    provenance: {
      source: "SilkSol AIS simulator (Caspian fleet)",
      mode: "simulated",
      retrievedAt: now.toISOString(),
    },
  };
}

// --- Live feed adapter ------------------------------------------------------------------------

/** Normalised position as returned by the AIS proxy (provider-specific fields mapped server-side). */
export type RawAisPosition = {
  mmsi: string | number;
  name?: string;
  lat: number;
  lon: number;
  sog?: number;
  cog?: number;
  /** ITU-R M.1371 navigational status: 0 under way, 1 at anchor, 5 moored. */
  navStatus?: number;
  /** Hours since the vessel's status last changed, when the provider reports it. */
  statusSinceH?: number;
};

const ROADSTEAD_DEG = 0.35;

/** Assigns raw positions to the nearest Caspian port roadstead and builds queue statistics. */
export function normalizeAis(
  raw: RawAisPosition[],
  source: string,
  retrievedAt = new Date(),
): AisSnapshot {
  const vessels: Vessel[] = [];
  for (const r of raw) {
    let best: { port: CaspianPort; d: number } | null = null;
    for (const port of CASPIAN_PORTS) {
      const d = Math.hypot(r.lat - NODES[port].lat, r.lon - NODES[port].lon);
      if (!best || d < best.d) best = { port, d };
    }
    if (!best || best.d > ROADSTEAD_DEG * 6) continue;
    const status: NavStatus =
      r.navStatus === 1 ? "at_anchor" : r.navStatus === 5 ? "moored" : "under_way";
    vessels.push({
      mmsi: String(r.mmsi),
      name: r.name ?? String(r.mmsi),
      type: "general_cargo",
      lat: r.lat,
      lon: r.lon,
      sog: r.sog ?? 0,
      cog: r.cog ?? 0,
      status: status === "at_anchor" && best.d > ROADSTEAD_DEG ? "under_way" : status,
      port: best.port,
      ...(status === "at_anchor" ? { queueH: r.statusSinceH ?? 0 } : {}),
    });
  }
  return {
    vessels,
    queues: summarizeQueues(vessels),
    provenance: { source, mode: "live", retrievedAt: retrievedAt.toISOString() },
  };
}

/** Reads live AIS positions from a proxy endpoint (keeps provider API keys server-side). */
export async function fetchLiveAis(
  url: string,
  fetcher: typeof fetch = fetch,
): Promise<AisSnapshot> {
  const res = await fetcher(url);
  if (!res.ok) throw new Error(`AIS feed ${res.status}`);
  const raw = (await res.json()) as RawAisPosition[];
  if (!Array.isArray(raw)) throw new Error("AIS feed returned an unexpected payload");
  return normalizeAis(raw, `AIS proxy ${new URL(url).host}`);
}
