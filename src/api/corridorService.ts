import { appendEntry, type LedgerEntry } from "@/services/ledger/auditLedger";
import { buildCargoLedgers } from "@/services/ledger/cargoLedger";
import { forecastCorridor, type CorridorForecast } from "@/services/ml/riskEngine";
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
  DEMO_EPOCH,
  loadSnapshot,
  mockSnapshot,
  type CorridorSnapshot,
  type TelemetryConfig,
} from "@/services/telemetry";
import { HOUR_MS } from "@/services/telemetry/prng";

// Server-side corridor state behind the REST API: the same services the dashboard runs in the
// browser, refreshed on a timer. State is in memory for the MVP (one instance); a production
// deployment keeps ledgers and issued reports in PostgreSQL so several replicas can share them.

export const API_REFRESH_MS = 15_000;

export type CorridorState = {
  snapshot: CorridorSnapshot;
  forecast: CorridorForecast;
  sla: Record<string, ShipmentSla>;
  statuses: Record<string, ShipmentStatus>;
  ledgers: Record<string, LedgerEntry[]>;
  reports: Record<string, DelayReport>;
  refreshedAt: number;
};

export class CorridorService {
  private state: CorridorState | undefined;
  private pending: Promise<CorridorState> | undefined;
  private readonly startedAt: number;
  private readonly epoch: Date;
  private readonly live: boolean;

  constructor(
    private readonly config: TelemetryConfig,
    private readonly clock: () => number = Date.now,
  ) {
    this.startedAt = clock();
    this.live = config.weatherMode === "live" || config.aisMode === "live";
    // Mock mode replays the scripted scenario from DEMO_EPOCH, like the dashboard; live mode
    // anchors it at the hour the service started.
    this.epoch = this.live ? new Date(Math.floor(this.startedAt / HOUR_MS) * HOUR_MS) : DEMO_EPOCH;
  }

  get isLive() {
    return this.live;
  }

  async current(): Promise<CorridorState> {
    if (this.state && this.clock() - this.state.refreshedAt < API_REFRESH_MS) return this.state;
    this.pending ??= this.refresh().finally(() => (this.pending = undefined));
    return this.pending;
  }

  private async refresh(): Promise<CorridorState> {
    const now = this.live
      ? new Date(this.clock())
      : new Date(this.epoch.getTime() + (this.clock() - this.startedAt));
    const snapshot = this.live
      ? await loadSnapshot(this.config, this.epoch, now)
      : mockSnapshot(this.epoch, now);
    const forecast = forecastCorridor(snapshot);
    const sla = Object.fromEntries(
      snapshot.shipments.map((s) => [s.id, evaluateSla(snapshot, s, forecast.shipments[s.id])]),
    );
    const statuses = Object.fromEntries(
      snapshot.shipments.map((s) => [
        s.id,
        shipmentStatus(sla[s.id]!, forecast.shipments[s.id]!.risk),
      ]),
    );
    // Audit chains are built once per scenario epoch; issued reports are appended to them.
    const ledgers = this.state?.ledgers ?? buildCargoLedgers(snapshot, forecast);
    this.state = {
      snapshot,
      forecast,
      sla,
      statuses,
      ledgers,
      reports: this.state?.reports ?? {},
      refreshedAt: this.clock(),
    };
    return this.state;
  }

  /** Seals the evidence for a cargo and anchors the report hash in its audit chain. */
  async issueReport(cargoId: string): Promise<DelayReport | undefined> {
    const state = await this.current();
    const shipment = state.snapshot.shipments.find((s) => s.id === cargoId);
    const forecast = state.forecast.shipments[cargoId];
    const chain = state.ledgers[cargoId];
    const sla = state.sla[cargoId];
    if (!shipment || !forecast || !chain || !sla) return undefined;
    const report = buildDelayReport({
      snap: state.snapshot,
      shipment,
      forecast,
      sla,
      chain,
      issuedAt: new Date(state.snapshot.now),
    });
    state.ledgers[cargoId] = appendEntry(chain, cargoId, reportIssuedEvent(report));
    state.reports[cargoId] = report;
    return report;
  }
}
