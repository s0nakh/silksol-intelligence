import type { CorridorForecast } from "@/services/ml/riskEngine";
import { MODEL_CARD } from "@/services/ml/riskEngine";
import {
  CARGO_VESSEL,
  NODES,
  isCaspianPort,
  isSeaLeg,
  type CorridorSnapshot,
  type NodeId,
  type Shipment,
} from "@/services/telemetry";
import { addHours } from "@/services/telemetry/prng";
import { buildChain, type LedgerEntry, type NewLedgerEvent, type Provenance } from "./auditLedger";

// Turns telemetry into the per-cargo audit chain: checkpoint gate events, AIS anchoring, storm
// closures observed while the cargo was exposed, SLA breaches and the risk assessment.

function arrivalType(s: Shipment, i: number): NewLedgerEvent["type"] {
  const node = s.route[i]!;
  const prev = s.route[i - 1];
  if (prev && isSeaLeg(prev, node))
    return s.phase === "at_roadstead" && i === s.currentIndex
      ? "VESSEL_ANCHORED"
      : "VESSEL_BERTHED";
  return NODES[node].kind === "rail_terminal" && i === 0 ? "GATE_IN" : "RAIL_ARRIVED";
}

function departureType(s: Shipment, i: number): NewLedgerEvent["type"] {
  const next = s.route[i + 1];
  if (next && isSeaLeg(s.route[i]!, next)) return "VESSEL_DEPARTED";
  return "RAIL_DEPARTED";
}

export function cargoEvents(
  snap: CorridorSnapshot,
  s: Shipment,
  forecast?: CorridorForecast,
): NewLedgerEvent[] {
  const timeline = snap.timelines[s.id];
  if (!timeline) return [];
  const epoch = new Date(snap.epoch);
  const dwellSrc = timeline.provenance;
  const events: NewLedgerEvent[] = [];

  timeline.records.forEach((r, i) => {
    if (!r.arrivedAt) return;
    const node = r.node;
    const vesselMmsi = CARGO_VESSEL[s.id];
    const vessel = vesselMmsi ? snap.ais.vessels.find((v) => v.mmsi === vesselMmsi) : undefined;
    const arrival = arrivalType(s, i);
    events.push({
      type: arrival,
      occurredAt: r.arrivedAt,
      node,
      payload:
        arrival === "VESSEL_ANCHORED" && vessel
          ? {
              containers: s.containers,
              mmsi: vessel.mmsi,
              vessel: vessel.name,
              lat: vessel.lat,
              lon: vessel.lon,
            }
          : { containers: s.containers },
      provenance: arrival === "VESSEL_ANCHORED" ? snap.ais.provenance : dwellSrc,
    });

    if (NODES[node].kind === "rail_border" && r.departedAt) {
      events.push({
        type: "CUSTOMS_CLEARED",
        occurredAt: addHours(new Date(r.departedAt), -1).toISOString(),
        node,
        payload: { declaration: `${s.id}-${node.toUpperCase()}` },
        provenance: dwellSrc,
      });
    }

    // Storm closures observed at a Caspian port while the cargo was waiting there.
    const exposed =
      r.state === "active"
        ? s.phase === "awaiting_vessel" || s.phase === "at_roadstead"
        : isCaspianPort(node);
    if (isCaspianPort(node) && exposed) {
      const pw = snap.weather[node];
      const from = new Date(r.arrivedAt).getTime();
      const to = r.departedAt ? new Date(r.departedAt).getTime() : epoch.getTime();
      let closed = false;
      let alerted = false;
      for (const p of pw.series) {
        const t = new Date(p.at).getTime();
        if (t < from || t > to) continue;
        if (p.stormAlert && !alerted) {
          alerted = true;
          events.push({
            type: "STORM_ALERT",
            occurredAt: p.at,
            node,
            payload: { windMs: p.windMs, gustMs: p.gustMs, waveM: p.waveM },
            provenance: pw.provenance,
          });
        }
        if (p.portClosed !== closed) {
          closed = p.portClosed;
          events.push({
            type: closed ? "PORT_CLOSED" : "PORT_REOPENED",
            occurredAt: p.at,
            node,
            payload: { windMs: p.windMs, waveM: p.waveM },
            provenance: pw.provenance,
          });
        }
      }
    }

    const slaAt = addHours(new Date(r.arrivedAt), r.slaDwellH);
    const end = r.departedAt ? new Date(r.departedAt) : epoch;
    if (i > 0 && slaAt < end) {
      events.push({
        type: "SLA_BREACH",
        occurredAt: slaAt.toISOString(),
        node,
        payload: { thresholdH: r.slaDwellH },
        provenance: {
          source: "SilkSol SLA monitor",
          mode: dwellSrc.mode,
          retrievedAt: dwellSrc.retrievedAt,
        },
      });
    }

    if (r.departedAt) {
      events.push({
        type: departureType(s, i),
        occurredAt: r.departedAt,
        node,
        payload: { dwellH: r.dwellH ?? 0 },
        provenance: dwellSrc,
      });
    }
  });

  const f = forecast?.shipments[s.id];
  if (f) {
    events.push({
      type: "RISK_ASSESSED",
      occurredAt: snap.now,
      node: s.route[s.currentIndex]!,
      payload: {
        risk: f.risk,
        etaDriftH: f.etaDriftH,
        predictedEta: f.predictedEta,
        model: MODEL_CARD.version,
      },
      provenance: riskProvenance(snap.now),
    });
  }

  return events.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
}

export const riskProvenance = (at: string): Provenance => ({
  source: `${MODEL_CARD.name} ${MODEL_CARD.version}`,
  mode: "simulated",
  retrievedAt: at,
});

export function buildCargoLedgers(
  snap: CorridorSnapshot,
  forecast?: CorridorForecast,
): Record<string, LedgerEntry[]> {
  return Object.fromEntries(
    snap.shipments.map((s) => [s.id, buildChain(s.id, cargoEvents(snap, s, forecast))]),
  );
}

export const currentNode = (s: Shipment): NodeId => s.route[s.currentIndex]!;
