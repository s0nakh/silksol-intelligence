import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  appendEntry,
  ledgerRoot,
  verifyChain,
  type LedgerEntry,
} from "@/services/ledger/auditLedger";
import { buildCargoLedgers } from "@/services/ledger/cargoLedger";
import { assessEconomics } from "@/services/economics/recommendations";
import { forecastCorridor } from "@/services/ml/riskEngine";
import {
  buildDelayReport,
  reportIssuedEvent,
  type DelayReport,
} from "@/services/reports/delayReport";
import {
  evaluateSla,
  shipmentStatus,
  type ShipmentSla,
  type ShipmentStatus,
} from "@/services/sla/slaMonitor";
import {
  loadSnapshot,
  mockSnapshot,
  scenarioEpoch,
  telemetryConfigFromEnv,
  type CorridorSnapshot,
} from "@/services/telemetry";

export const REFRESH_MS = 15_000;

const config = telemetryConfigFromEnv(import.meta.env as Record<string, string | undefined>);
export const LIVE_FEEDS = config.weatherMode === "live" || config.aisMode === "live";

const initialSnapshot = () => {
  const epoch = scenarioEpoch();
  return mockSnapshot(epoch, epoch);
};

/**
 * Corridor state for the dashboard: telemetry snapshot (refreshed every 15 s), ML forecast,
 * SLA evaluation, per-cargo audit chains and issued delay reports.
 *
 * The scenario is anchored at the start of the current hour, so dates are today's: mock mode
 * replays the scripted storm from that hour (every visitor sees the same storm), live mode pulls
 * the configured feeds.
 */
export function useCorridorIntel() {
  const [snapshot, setSnapshot] = useState<CorridorSnapshot>(initialSnapshot);
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  const [secondsAgo, setSecondsAgo] = useState(0);

  const forecast = useMemo(() => forecastCorridor(snapshot), [snapshot]);
  const economics = useMemo(() => assessEconomics(snapshot, forecast), [snapshot, forecast]);
  const startRisk = useRef(forecast.corridorRisk);

  // Audit chains are built once per scenario epoch; later events (reports) are appended.
  const [ledgers, setLedgers] = useState<Record<string, LedgerEntry[]>>(() =>
    buildCargoLedgers(snapshot, forecast),
  );
  const ledgerEpoch = useRef(snapshot.epoch);
  useEffect(() => {
    if (ledgerEpoch.current === snapshot.epoch) return;
    ledgerEpoch.current = snapshot.epoch;
    startRisk.current = forecast.corridorRisk;
    setLedgers(buildCargoLedgers(snapshot, forecast));
  }, [snapshot, forecast]);

  useEffect(() => {
    const epoch = scenarioEpoch();
    let active = true;
    const refresh = async () => {
      const now = new Date();
      const next = LIVE_FEEDS ? await loadSnapshot(config, epoch, now) : mockSnapshot(epoch, now);
      if (!active) return;
      setSnapshot(next);
      setSyncedAt(Date.now());
    };
    void refresh();
    const sync = window.setInterval(() => void refresh(), REFRESH_MS);
    return () => {
      active = false;
      window.clearInterval(sync);
    };
  }, []);

  useEffect(() => {
    if (syncedAt === null) return;
    setSecondsAgo(0);
    const id = window.setInterval(
      () => setSecondsAgo(Math.round((Date.now() - syncedAt) / 1000)),
      1000,
    );
    return () => window.clearInterval(id);
  }, [syncedAt]);

  const sla = useMemo(
    () =>
      Object.fromEntries(
        snapshot.shipments.map((s) => [s.id, evaluateSla(snapshot, s, forecast.shipments[s.id])]),
      ) as Record<string, ShipmentSla>,
    [snapshot, forecast],
  );

  const statuses = useMemo(
    () =>
      Object.fromEntries(
        snapshot.shipments.map((s) => [
          s.id,
          shipmentStatus(sla[s.id]!, forecast.shipments[s.id]!.risk),
        ]),
      ) as Record<string, ShipmentStatus>,
    [snapshot, sla, forecast],
  );

  const [reports, setReports] = useState<Record<string, DelayReport>>({});

  /** Seals the evidence for a cargo, then anchors the report hash in its audit chain. */
  const issueReport = useCallback(
    (cargoId: string) => {
      const shipment = snapshot.shipments.find((s) => s.id === cargoId);
      const f = forecast.shipments[cargoId];
      const chain = ledgers[cargoId];
      if (!shipment || !f || !chain) return undefined;
      const report = buildDelayReport({
        snap: snapshot,
        shipment,
        forecast: f,
        sla: sla[cargoId]!,
        chain,
        issuedAt: new Date(snapshot.now),
      });
      setLedgers((prev) => ({
        ...prev,
        [cargoId]: appendEntry(prev[cargoId] ?? [], cargoId, reportIssuedEvent(report)),
      }));
      setReports((prev) => ({ ...prev, [cargoId]: report }));
      return report;
    },
    [snapshot, forecast, ledgers, sla],
  );

  const verifyLedgers = useCallback(
    () =>
      Object.entries(ledgers).map(([cargoId, chain]) => ({ cargoId, result: verifyChain(chain) })),
    [ledgers],
  );

  const root = useMemo(() => ledgerRoot(ledgers), [ledgers]);
  const eventCount = useMemo(
    () => Object.values(ledgers).reduce((n, c) => n + c.length, 0),
    [ledgers],
  );

  return {
    snapshot,
    forecast,
    economics,
    sla,
    statuses,
    ledgers,
    ledgerRoot: root,
    eventCount,
    reports,
    issueReport,
    verifyLedgers,
    riskDelta: forecast.corridorRisk - startRisk.current,
    secondsAgo,
    live: LIVE_FEEDS,
  };
}

export type CorridorIntel = ReturnType<typeof useCorridorIntel>;
