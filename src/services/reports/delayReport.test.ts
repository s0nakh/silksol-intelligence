import { describe, expect, it } from "vitest";
import { buildCargoLedgers } from "@/services/ledger/cargoLedger";
import { verifyChain } from "@/services/ledger/auditLedger";
import { forecastCorridor } from "@/services/ml/riskEngine";
import { evaluateSla, shipmentStatus } from "@/services/sla/slaMonitor";
import { mockSnapshot, SHIPMENTS } from "@/services/telemetry";
import { buildDelayReport, verifyDelayReport, type DelayReport } from "./delayReport";

const snap = mockSnapshot();
const forecast = forecastCorridor(snap, 200);
const ledgers = buildCargoLedgers(snap, forecast);
const shipment = (id: string) => SHIPMENTS.find((s) => s.id === id)!;

describe("SLA monitor", () => {
  it("classifies dwell against contractual thresholds", () => {
    const kzl = evaluateSla(snap, shipment("KZL-4107"), forecast.shipments["KZL-4107"]);
    expect(kzl.status).toBe("breach");
    expect(kzl.violations.map((v) => v.node)).toEqual(["khorgos", "baku"]);
    const jol = evaluateSla(snap, shipment("JOL-8921"), forecast.shipments["JOL-8921"]);
    expect(jol.status).toBe("ok");
    expect(jol.checks.at(-1)!.predictedStatus).toBe("breach");
    expect(shipmentStatus(jol, forecast.shipments["JOL-8921"]!.risk)).toBe("at_risk");
    expect(shipmentStatus(kzl, 10)).toBe("sla_breach");
  });
});

describe("cargo ledgers", () => {
  it("builds a valid chain per cargo with storm and SLA evidence", () => {
    for (const chain of Object.values(ledgers)) expect(verifyChain(chain).valid).toBe(true);
    const jolTypes = ledgers["JOL-8921"]!.map((e) => e.type);
    expect(jolTypes).toEqual(
      expect.arrayContaining([
        "GATE_IN",
        "CUSTOMS_CLEARED",
        "STORM_ALERT",
        "PORT_CLOSED",
        "RISK_ASSESSED",
      ]),
    );
    const kzlTypes = ledgers["KZL-4107"]!.map((e) => e.type);
    expect(kzlTypes).toEqual(
      expect.arrayContaining(["VESSEL_ANCHORED", "SLA_BREACH", "PORT_CLOSED", "PORT_REOPENED"]),
    );
  });

  it("orders events chronologically", () => {
    for (const chain of Object.values(ledgers)) {
      const times = chain.map((e) => e.occurredAt);
      expect([...times].sort()).toEqual(times);
    }
  });
});

describe("verifiable delay report", () => {
  const build = (id: string): DelayReport =>
    buildDelayReport({
      snap,
      shipment: shipment(id),
      forecast: forecast.shipments[id]!,
      sla: evaluateSla(snap, shipment(id), forecast.shipments[id]),
      chain: ledgers[id]!,
    });

  it("attributes the KZL-4107 delay to evidence and seals it", () => {
    const r = build("KZL-4107");
    expect(r.delay.observedExcessH).toBeGreaterThan(40);
    expect(r.delay.attribution.map((a) => a.cause)).toEqual(
      expect.arrayContaining(["weather_closure", "port_queue", "rail_border"]),
    );
    expect(r.evidence.ais.some((v) => v.name === "Caspian Meridian")).toBe(true);
    expect(r.evidence.weather.map((w) => w.port)).toEqual(["baku"]);
    expect(r.evidence.weather[0]!.points.some((p) => p.portClosed)).toBe(true);
    expect(r.reportHash).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyDelayReport(r)).toEqual({
      valid: true,
      reportHash: true,
      chain: true,
      head: true,
    });
  });

  it("survives a JSON round-trip and detects tampering", () => {
    const r = build("JOL-8921");
    const parsed = JSON.parse(JSON.stringify(r)) as DelayReport;
    expect(verifyDelayReport(parsed).valid).toBe(true);

    const edited = { ...parsed, delay: { ...parsed.delay, observedExcessH: 0 } };
    expect(verifyDelayReport(edited)).toMatchObject({ valid: false, reportHash: false });

    const forged = JSON.parse(JSON.stringify(r)) as DelayReport;
    forged.ledger.entries[1]!.payload = { forged: true };
    expect(verifyDelayReport(forged)).toMatchObject({ valid: false, chain: false });
  });
});
