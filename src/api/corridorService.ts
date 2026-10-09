import { appendEntry, type LedgerEntry } from "@/services/ledger/auditLedger";
import { buildCargoLedgers } from "@/services/ledger/cargoLedger";
import { assessEconomics, type ShipmentEconomics } from "@/services/economics/recommendations";
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
  loadSnapshot,
  mockSnapshot,
  scenarioEpoch,
  type CorridorSnapshot,
  type TelemetryConfig,
} from "@/services/telemetry";
import { HOUR_MS } from "@/services/telemetry/prng";

// Server-side corridor state behind the REST API: the same services the dashboard runs in the
// browser, refreshed on a timer. State is in memory for the MVP (one instance); a production
// deployment keeps ledgers and issued reports in PostgreSQL so several replicas can share them.

export const API_REFRESH_MS = 15_000;
/** The scripted scenario is re-anchored to the current hour once it is this old. */
export const SCENARIO_MAX_AGE_H = 24;

export type CorridorState = {
  snapshot: CorridorSnapshot;
  forecast: CorridorForecast;
  sla: Record<string, ShipmentSla>;
  statuses: Record<string, ShipmentStatus>;
  economics: Record<string, ShipmentEconomics>;
  ledgers: Record<string, LedgerEntry[]>;
  reports: Record<string, DelayReport>;
  refreshedAt: number;
};

export class CorridorService {
  private state: CorridorState | undefined;
  private pending: Promise<CorridorState> | undefined;
  private epoch: Date;
  private readonly live: boolean;

  constructor(
    private readonly config: TelemetryConfig,
    private readonly clock: () => number = Date.now,
  ) {
    this.live = config.weatherMode === "live" || config.aisMode === "live";
    // Like the dashboard, the scenario is anchored at the current hour so dates are today's.
    this.epoch = scenarioEpoch(clock());
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
    const now = new Date(this.clock());
    if (now.getTime() - this.epoch.getTime() > SCENARIO_MAX_AGE_H * HOUR_MS) {
      // A new scenario day: fresh audit chains, previously issued reports belong to the old one.
      this.epoch = scenarioEpoch(now.getTime());
      this.state = undefined;
    }
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
      economics: assessEconomics(snapshot, forecast),
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
