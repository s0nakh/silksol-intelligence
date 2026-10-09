import { createFileRoute } from "@tanstack/react-router";
import {
  Activity,
  ArrowUpRight,
  Check,
  ChevronRight,
  Banknote,
  Clock3,
  Container,
  FileCheck2,
  FileSearch,
  Gauge,
  Hourglass,
  MapPin,
  Radio,
  Search,
  ShieldCheck,
  Ship,
  Sparkles,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  Waves,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AuditDrawer } from "@/components/intel/AuditDrawer";
import { DelayReportDialog } from "@/components/intel/DelayReportDialog";
import { DemoTag } from "@/components/intel/DemoTag";
import { EconomicsPanel } from "@/components/intel/EconomicsPanel";
import { LanguageSwitcher } from "@/components/intel/LanguageSwitcher";
import { SlaMonitor } from "@/components/intel/SlaMonitor";
import { WeatherPanel } from "@/components/intel/WeatherPanel";
import { countryName, kzt, nodeName, reasonText, riskBand } from "@/components/intel/labels";
import { useCorridorIntel } from "@/hooks/use-corridor-intel";
import { DISPLAY_TZ_LABEL, translate, useI18n } from "@/i18n";
import { economicsSummary } from "@/services/economics/recommendations";
import { shortHash } from "@/services/ledger/sha256";
import { attributeDelay, primaryCause } from "@/services/reports/delayReport";
import {
  createContext as createEngineContext,
  isExposed,
  MODEL_CARD,
  nodeRiskSeries,
} from "@/services/ml/riskEngine";
import type { ShipmentStatus } from "@/services/sla/slaMonitor";
import {
  CARGO_VESSEL,
  CASPIAN_PORTS,
  isCaspianPort,
  TRACKER_ROUTE,
  type CaspianPort,
  type NodeId,
  type Shipment,
} from "@/services/telemetry";

const SITE_URL = "https://silksol-intelligence.datariglab.kz";
// ?v=1 lets messengers re-fetch the preview when the image changes.
const OG_IMAGE = `${SITE_URL}/og-image.png?v=1`;
const OG_IMAGE_ALT = "SilkSol Intelligence — предиктивная аналитика задержек на Среднем коридоре";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: translate("en", "meta.title") },
      { name: "description", content: translate("en", "meta.description") },
      { property: "og:title", content: translate("en", "meta.title") },
      { property: "og:description", content: translate("en", "meta.ogDescription") },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "SilkSol Intelligence" },
      { property: "og:url", content: SITE_URL },
      { property: "og:image", content: OG_IMAGE },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:image:alt", content: OG_IMAGE_ALT },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: translate("en", "meta.title") },
      { name: "twitter:description", content: translate("en", "meta.ogDescription") },
      { name: "twitter:image", content: OG_IMAGE },
    ],
  }),
  component: Dashboard,
});

type Filter = "all" | ShipmentStatus;
const FILTERS: Filter[] = ["all", "in_transit", "at_risk", "sla_breach"];

const statusClass: Record<ShipmentStatus, string> = {
  in_transit: "status-transit",
  at_risk: "status-risk",
  sla_breach: "status-triggered",
};

const TRACKER_STATES = ["complete", "complete", "active", "pending", "pending"] as const;
/** Tracker column a corridor node is shown under (Kuryk shares Aktau's, Tbilisi/Poti the last). */
const trackerColumn = (node: NodeId) =>
  node === "kuryk" ? 2 : node === "tbilisi" || node === "poti" ? 4 : TRACKER_ROUTE.indexOf(node);

/** Caspian port whose weather matters to a cargo: where it is now, else the next one on its route. */
function relevantPort(s: Shipment): CaspianPort {
  const ahead = s.route.slice(s.currentIndex).find(isCaspianPort);
  return ahead ?? [...s.route].reverse().find(isCaspianPort) ?? "aktau";
}

function Dashboard() {
  const i18n = useI18n();
  const { t, num, hours, dateTime, weekdayTime } = i18n;
  const intel = useCorridorIntel();
  const { snapshot, forecast, sla, statuses, ledgers, reports } = intel;
  const shipments = snapshot.shipments;

  const [selectedId, setSelectedId] = useState(shipments[0]?.id ?? "JOL-8921");
  const [filter, setFilter] = useState<Filter>("all");
  const [reportOpen, setReportOpen] = useState(false);

  const selected = shipments.find((s) => s.id === selectedId) ?? shipments[0]!;
  const selForecast = forecast.shipments[selected.id]!;
  const selSla = sla[selected.id]!;
  const selNode = selected.route[selected.currentIndex]!;
  const selReport = reports[selected.id] ?? null;
  const port = relevantPort(selected);
  const queue = snapshot.ais.queues[port];
  const vessel = snapshot.ais.vessels.find((v) => v.mmsi === CARGO_VESSEL[selected.id]);
  const activeCheck = selSla.checks.find((c) => c.state === "active");
  const timelineRecord = snapshot.timelines[selected.id]?.records[selected.currentIndex];
  const overPlan =
    activeCheck && timelineRecord ? activeCheck.dwellH - timelineRecord.plannedDwellH : 0;

  const riskSeries = useMemo(() => {
    const ctx = createEngineContext(snapshot);
    return nodeRiskSeries(
      ctx,
      selNode,
      isExposed(selected),
      6,
      MODEL_CARD.horizonH,
      !!selected.customsHold,
    );
  }, [snapshot, selNode, selected]);
  const chartData = riskSeries.map((p) => ({ time: weekdayTime(p.at), risk: p.risk }));
  const peak = riskSeries.reduce((a, b) => (b.risk > a.risk ? b : a), riskSeries[0]!);
  const trend = riskSeries.at(-1)!.risk - riskSeries[0]!.risk;

  const visible = useMemo(
    () => (filter === "all" ? shipments : shipments.filter((s) => statuses[s.id] === filter)),
    [filter, shipments, statuses],
  );

  const containers = shipments.reduce((n, s) => n + s.containers, 0);
  const atRisk = shipments.filter((s) => statuses[s.id] !== "in_transit").length;
  const violations = Object.values(sla).reduce((n, s) => n + s.violations.length, 0);
  const affected = Object.values(sla).filter((s) => s.violations.length > 0).length;
  const predicted = Object.values(sla).filter((s) =>
    s.checks.some(
      (c) => c.state === "active" && c.status !== "breach" && c.predictedStatus === "breach",
    ),
  ).length;
  const drifts = Object.values(forecast.shipments).map((f) => f.etaDriftH);
  const avgDrift = drifts.reduce((a, b) => a + b, 0) / Math.max(1, drifts.length);
  const p90Drift = Math.max(
    ...Object.values(forecast.shipments).map(
      (f) => (new Date(f.etaP90).getTime() - new Date(f.contractualEta).getTime()) / 3_600_000,
    ),
  );
  const delta = Math.round(intel.riskDelta * 10) / 10;
  const money = economicsSummary(intel.economics);

  const kpis = [
    {
      label: t("kpi.containers"),
      value: num(containers),
      detail: t("kpi.containersDetail", { n: shipments.length }),
      change: t("kpi.atRisk", { n: atRisk }),
      icon: Container,
      tone: "primary",
      good: atRisk === 0,
    },
    {
      label: t("kpi.riskIndex"),
      value: `${num(forecast.corridorRisk, 1)}%`,
      detail: riskBand(i18n, forecast.corridorRisk),
      change: t("kpi.riskDelta", {
        delta: `${delta > 0 ? "+" : delta < 0 ? "−" : "±"}${num(Math.abs(delta), 1)}`,
      }),
      icon: ShieldCheck,
      tone: "success",
      good: delta <= 0,
    },
    {
      label: t("kpi.slaViolations"),
      value: num(violations),
      detail: t("kpi.slaDetail", { n: affected }),
      change: t("kpi.predicted", { n: predicted }),
      icon: Hourglass,
      tone: "primary",
      good: predicted === 0,
    },
    {
      label: t("kpi.etaDrift"),
      value: hours(avgDrift, { signed: true }),
      detail: t("kpi.etaDriftDetail"),
      change: t("kpi.p90", { h: hours(p90Drift, { signed: true, digits: 0 }) }),
      icon: Clock3,
      tone: "success",
      good: avgDrift <= 0,
    },
    {
      label: t("kpi.expectedLoss"),
      value: kzt(i18n, money.expectedLossKzt, true),
      detail: t("kpi.expectedLossDetail", { n: shipments.length }),
      change: t("kpi.savings", { v: kzt(i18n, money.savingsAvailableKzt, true) }),
      icon: Banknote,
      tone: "primary",
      good: money.savingsAvailableKzt > 0,
    },
  ];

  const topBottleneck = forecast.bottlenecks.find((b) => b.level !== "low");
  const signals = snapshot.ais.vessels.length + CASPIAN_PORTS.length + shipments.length;
  const feedMode =
    snapshot.weather.aktau.provenance.mode === "live" || snapshot.ais.provenance.mode === "live"
      ? "LIVE"
      : "SIMULATED";

  const generateReport = (cargoId: string) => {
    setSelectedId(cargoId);
    const report = intel.issueReport(cargoId);
    if (!report) return;
    toast.success(t("report.toast", { id: cargoId }), {
      description: `sha256 ${shortHash(report.reportHash)} · ${report.reportId}`,
    });
    setReportOpen(true);
  };

  const location = (s: Shipment) =>
    `${nodeName(i18n, s.route[s.currentIndex]!)} · ${t(`phase.${s.phase}`)}`;
  const attribution = useMemo(() => attributeDelay(snapshot, selected), [snapshot, selected]);
  const excess = attribution.reduce((n, a) => n + a.hours, 0);
  const cause = primaryCause(attribution);
  const chainLength = ledgers[selected.id]?.length ?? 0;

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="border-b border-warning/30 bg-warning/10 px-4 py-1.5 text-center text-[11px] text-warning">
        {t("banner")}
      </div>
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-[1600px] items-center gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <div className="solana-mark" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <div className="text-[17px] font-bold tracking-normal">
              SilkSol <span className="text-gradient">Intelligence</span>
            </div>
          </div>
          <div className="hidden h-6 w-px bg-border lg:block" />
          <div className="hidden items-center gap-2 text-xs text-muted-foreground lg:flex">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-50" />
              <span className="relative inline-flex size-2 rounded-full bg-success" />
            </span>
            <span className="font-semibold text-foreground">{t("header.telemetry")}</span>
            <span>•</span>
            <span>{t("header.aisPorts", { n: CASPIAN_PORTS.length })}</span>
            <span>•</span>
            <span>{t("header.model", { version: MODEL_CARD.version })}</span>
            <DemoTag kind={feedMode} />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <AuditDrawer ledgers={ledgers} root={intel.ledgerRoot} verify={intel.verifyLedgers} />
            <LanguageSwitcher />
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1600px] px-4 py-5 sm:px-6 sm:py-7">
        <section className="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div>
            <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              <Radio className="size-3.5 text-success" /> {t("hero.eyebrow")}
            </div>
            <h1 className="text-2xl font-semibold tracking-normal sm:text-3xl">
              {t("hero.title")}
            </h1>
            <p className="mt-1.5 max-w-xl text-sm text-muted-foreground">{t("hero.subtitle")}</p>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Clock3 className="size-3.5" />{" "}
            {t(intel.live ? "hero.live" : "hero.replay", {
              time: `${dateTime(snapshot.now)} ${DISPLAY_TZ_LABEL}`,
            })}{" "}
            · {t("hero.lastSync", { n: intel.secondsAgo })}
          </div>
        </section>

        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {kpis.map((kpi) => {
            const Icon = kpi.icon;
            return (
              <article className="metric-card" key={kpi.label}>
                <div className="flex items-start justify-between">
                  <div
                    className={`metric-icon ${kpi.tone === "success" ? "metric-icon-success" : ""}`}
                  >
                    <Icon className="size-4" />
                  </div>
                  <span
                    className={
                      kpi.good
                        ? "text-xs font-semibold text-success"
                        : "text-xs font-semibold text-primary"
                    }
                  >
                    {kpi.change}
                  </span>
                </div>
                <p className="mt-5 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  {kpi.label}
                  <DemoTag kind="DEMO DATA" />
                </p>
                <div className="mt-1 flex items-baseline gap-2">
                  <strong className="text-2xl font-semibold tracking-normal">{kpi.value}</strong>
                  <span className="text-[11px] text-muted-foreground">{kpi.detail}</span>
                </div>
              </article>
            );
          })}
        </section>

        <section className="mt-4 grid gap-4 xl:grid-cols-[1.65fr_1fr]">
          <div className="grid min-w-0 content-start gap-4">
            <div className="panel min-w-0 overflow-hidden">
              <PanelHeader
                icon={MapPin}
                eyebrow={t("tracker.eyebrow")}
                title={t("tracker.title")}
                aside={
                  <span className="flex items-center gap-2">
                    <DemoTag kind="DEMO DATA" />
                    <span className="status-pill status-transit">
                      <Activity className="size-3" /> {t("tracker.signals", { n: signals })}
                    </span>
                  </span>
                }
              />
              <div className="corridor-map">
                <div className="map-grid" />
                <div className="route-rail">
                  {TRACKER_ROUTE.map((node, index) => {
                    const state = TRACKER_STATES[index]!;
                    return (
                      <button
                        key={node}
                        onClick={() => {
                          const hit = shipments.find(
                            (s) => trackerColumn(s.route[s.currentIndex]!) === index,
                          );
                          if (hit) setSelectedId(hit.id);
                        }}
                        className={`route-stop route-${state}`}
                        aria-label={`${nodeName(i18n, node)}, ${state}`}
                      >
                        <span className="route-dot">
                          {state === "complete" ? <Check className="size-3" /> : index + 1}
                        </span>
                        <span className="route-city">{nodeName(i18n, node)}</span>
                        <span className="route-country">{countryName(i18n, node)}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="map-event">
                  <TriangleAlert className="size-4" />
                  {topBottleneck ? (
                    <div>
                      <strong>
                        {t("tracker.bottleneck", { node: nodeName(i18n, topBottleneck.node) })} ·{" "}
                        {topBottleneck.riskNow}%
                      </strong>
                      <span>
                        {topBottleneck.reasons[0]
                          ? reasonText(i18n, topBottleneck.reasons[0])
                          : t(`levels.${topBottleneck.level}`)}
                      </span>
                    </div>
                  ) : (
                    <div>
                      <strong>{t("tracker.noBottleneck")}</strong>
                    </div>
                  )}
                </div>
                <div className="absolute bottom-4 left-5 flex items-center gap-2 text-[10px] text-muted-foreground">
                  <Waves className="size-3.5 text-primary" /> {t("tracker.routeName")}
                </div>
              </div>

              <div className="border-t border-border">
                <div className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-center">
                  <h3 className="text-sm font-semibold">{t("table.title")}</h3>
                  <div className="flex gap-1 overflow-x-auto sm:ml-auto">
                    {FILTERS.map((item) => (
                      <Button
                        key={item}
                        variant="ghost"
                        onClick={() => setFilter(item)}
                        className={`whitespace-nowrap px-2.5 py-1.5 text-[11px] ${filter === item ? "bg-accent text-foreground" : ""}`}
                      >
                        {t(`table.filters.${item}`)}
                      </Button>
                    ))}
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-left" data-testid="shipments-table">
                    <thead>
                      <tr className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                        <th>{t("table.cols.cargo")}</th>
                        <th>{t("table.cols.route")}</th>
                        <th>{t("table.cols.location")}</th>
                        <th>{t("table.cols.eta")}</th>
                        <th>{t("table.cols.status")}</th>
                        <th>{t("table.cols.risk")}</th>
                        <th>{t("table.cols.drift")}</th>
                        <th>{t("table.cols.report")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((s) => {
                        const f = forecast.shipments[s.id]!;
                        const status = statuses[s.id]!;
                        return (
                          <tr
                            key={s.id}
                            onClick={() => setSelectedId(s.id)}
                            className={selected.id === s.id ? "table-row-active" : ""}
                          >
                            <td className="whitespace-nowrap font-semibold text-foreground">
                              #{s.id}
                            </td>
                            <td>
                              <span className="text-foreground">{nodeName(i18n, s.route[0]!)}</span>
                              <ChevronRight className="mx-1 inline size-3" />
                              {nodeName(i18n, s.route.at(-1)!)}
                            </td>
                            <td>{location(s)}</td>
                            <td className="whitespace-nowrap">{dateTime(f.predictedEta)}</td>
                            <td>
                              <span className={`status-pill ${statusClass[status]}`}>
                                {t(`status.${status}`)}
                              </span>
                            </td>
                            <td>
                              <span
                                className={
                                  f.risk > 60
                                    ? "font-semibold text-warning"
                                    : "font-semibold text-success"
                                }
                              >
                                {f.risk}%
                              </span>
                            </td>
                            <td className="whitespace-nowrap">
                              {hours(f.etaDriftH, { signed: true, digits: 0 })}
                            </td>
                            <td>
                              {reports[s.id] ? (
                                <span className="text-[11px] text-primary">
                                  {t("table.issued")}
                                </span>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  className="h-7 whitespace-nowrap px-2 text-[11px]"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    generateReport(s.id);
                                  }}
                                >
                                  {t("table.generate")}
                                </Button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
            <div className="panel overflow-hidden">
              <PanelHeader
                icon={Sparkles}
                eyebrow={t("chart.eyebrow")}
                title={t("chart.title", { node: nodeName(i18n, selNode), id: selected.id })}
                aside={
                  <span className="flex items-center gap-2">
                    <DemoTag kind="SIMULATED" />
                    <span
                      className={`text-xl font-semibold ${selForecast.risk > 60 ? "text-warning" : "text-success"}`}
                    >
                      {selForecast.risk}%
                    </span>
                  </span>
                }
              />
              <div className="px-2 pb-2 pt-4 sm:px-4">
                <div className="h-[220px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={chartData}
                      margin={{ top: 8, right: 14, left: -24, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient id="riskFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="var(--chart-risk)" stopOpacity={0.42} />
                          <stop offset="100%" stopColor="var(--chart-risk)" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                      <XAxis
                        dataKey="time"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: "var(--chart-label)", fontSize: 10 }}
                      />
                      <YAxis
                        domain={[0, 100]}
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: "var(--chart-label)", fontSize: 10 }}
                        tickFormatter={(v) => `${v}%`}
                      />
                      <Tooltip
                        contentStyle={{
                          background: "var(--popover)",
                          border: "1px solid var(--border)",
                          borderRadius: 6,
                          fontSize: 11,
                        }}
                        formatter={(value) => [`${value}%`, t("chart.tooltip")]}
                      />
                      <ReferenceLine
                        y={50}
                        stroke="var(--chart-warning)"
                        strokeDasharray="4 4"
                        label={{ value: t("chart.alert"), fill: "var(--chart-label)", fontSize: 9 }}
                      />
                      <Area
                        type="monotone"
                        dataKey="risk"
                        stroke="var(--chart-risk)"
                        strokeWidth={2.5}
                        fill="url(#riskFill)"
                        isAnimationActive={false}
                        activeDot={{
                          r: 5,
                          fill: "var(--chart-risk)",
                          stroke: "var(--background)",
                          strokeWidth: 3,
                        }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                <div className="mx-2 mb-3 flex items-center justify-between border-t border-border pt-3 text-[11px] text-muted-foreground">
                  <span>{t("chart.peak", { risk: peak.risk, time: weekdayTime(peak.at) })}</span>
                  <span
                    className={`flex items-center gap-1 ${trend > 5 ? "text-warning" : trend < -5 ? "text-success" : ""}`}
                  >
                    {trend > 5 ? (
                      <TrendingUp className="size-3" />
                    ) : (
                      <TrendingDown className="size-3" />
                    )}{" "}
                    {t(trend > 5 ? "chart.rising" : trend < -5 ? "chart.recovery" : "chart.stable")}
                  </span>
                </div>
              </div>
            </div>
            <div className="panel">
              <PanelHeader
                icon={Ship}
                eyebrow={t("telemetry.eyebrow")}
                title={t("telemetry.title")}
                aside={
                  <DemoTag kind={snapshot.ais.provenance.mode === "live" ? "LIVE" : "SIMULATED"} />
                }
              />
              <div className="grid grid-cols-3 divide-x divide-border px-2 py-5">
                <Sensor
                  icon={Waves}
                  label={`${t("telemetry.queue")} · ${nodeName(i18n, port)}`}
                  value={t("telemetry.queueValue", { n: queue.anchored })}
                  note={t("telemetry.avgWait", { h: num(queue.avgQueueH, 0) })}
                  alert={queue.density >= 0.7}
                />
                <Sensor
                  icon={Gauge}
                  label={vessel ? `${t("telemetry.speed")} · ${vessel.name}` : t("telemetry.speed")}
                  value={vessel ? `${num(vessel.sog, 1)} ${t("units.kn")}` : `0 ${t("units.kmh")}`}
                  note={
                    vessel?.status === "at_anchor"
                      ? t("telemetry.atAnchor")
                      : t("telemetry.atTerminal")
                  }
                />
                <Sensor
                  icon={Clock3}
                  label={t("telemetry.dwell")}
                  value={activeCheck ? hours(activeCheck.dwellH) : "—"}
                  note={
                    overPlan > 0
                      ? t("telemetry.overPlan", { h: num(overPlan, 1) })
                      : t("telemetry.withinPlan")
                  }
                  alert={overPlan > 0}
                />
              </div>
            </div>
          </div>

          <div className="grid min-w-0 content-start gap-4">
            <SlaMonitor shipment={selected} forecast={selForecast} sla={selSla} />
            <EconomicsPanel economics={intel.economics[selected.id]!} />
            <WeatherPanel
              weather={snapshot.weather[port]}
              outlook={forecast.closureOutlook[port]}
              bottlenecks={forecast.bottlenecks}
            />
          </div>
        </section>

        <section className="mt-4 panel settlement-panel overflow-hidden">
          <div className="relative grid gap-6 p-5 lg:grid-cols-[1fr_auto_1fr] lg:items-center lg:p-7">
            <div>
              <div className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">
                <FileSearch className="size-4" /> {t("proof.eyebrow")} <DemoTag kind="SHA-256" />
              </div>
              <h2 className="text-lg font-semibold">{t("proof.title", { id: selected.id })}</h2>
              <p className="mt-2 max-w-lg text-sm leading-6 text-muted-foreground">
                {cause
                  ? t("proof.body", {
                      id: selected.id,
                      location: location(selected),
                      h: num(excess, 1),
                      cause: t(`causes.${cause}`),
                    })
                  : t("proof.bodyNoDelay", { id: selected.id, location: location(selected) })}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <span className="condition-chip">
                  <Clock3 className="size-3" /> {t("proof.excess", { h: num(excess, 1) })}
                </span>
                <span className="condition-chip">
                  <TriangleAlert className="size-3" />{" "}
                  {t("proof.cause", { cause: t(`causes.${cause ?? "none"}`) })}
                </span>
                <span className="condition-chip">
                  <ShieldCheck className="size-3" /> {t("proof.events", { n: chainLength })}
                </span>
              </div>
            </div>
            <div className="hidden items-center gap-2 lg:flex">
              <div className="h-px w-12 bg-border" />
              <div className="flex size-10 items-center justify-center rounded-full border border-primary/40 bg-primary/10 text-primary shadow-glow">
                <FileCheck2 className="size-4" />
              </div>
              <div className="h-px w-12 bg-border" />
            </div>
            <div className="settlement-result">
              <div className="flex items-start gap-3">
                <div
                  className={`flex size-10 shrink-0 items-center justify-center rounded-md ${selReport ? "bg-success/15 text-success" : "bg-primary/15 text-primary"}`}
                >
                  {selReport ? <Check className="size-5" /> : <FileCheck2 className="size-5" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-success">
                    {selReport ? t("proof.issued") : t("proof.ready")}
                  </p>
                  <p className="mt-1 text-xl font-semibold">
                    {t("proof.eventsVerified", { n: chainLength })}{" "}
                    <span className="text-sm font-normal text-muted-foreground">
                      {t("proof.evidence")}
                    </span>
                  </p>
                  <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                    {t("proof.head")}: {shortHash(ledgers[selected.id]?.at(-1)?.hash ?? "")}
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {selReport
                      ? `${selReport.reportId} · sha256 ${shortHash(selReport.reportHash)}`
                      : t("proof.hint")}
                  </p>
                </div>
              </div>
              <div className="mt-5 flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center">
                <span className="text-[11px] text-muted-foreground">
                  {t("report.predictedEta")}:{" "}
                  <strong className="text-foreground">{dateTime(selForecast.predictedEta)}</strong>{" "}
                  ({hours(selForecast.etaDriftH, { signed: true, digits: 0 })})
                </span>
                <Button
                  className="sm:ml-auto"
                  onClick={() => (selReport ? setReportOpen(true) : generateReport(selected.id))}
                >
                  {selReport ? t("proof.view") : t("proof.generate")}{" "}
                  <ArrowUpRight className="size-4" />
                </Button>
              </div>
            </div>
          </div>
        </section>
        <DelayReportDialog report={selReport} open={reportOpen} onOpenChange={setReportOpen} />
        <footer className="flex flex-col gap-2 px-1 pb-3 pt-7 text-[10px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>{t("footer.copy")}</span>
          <span className="flex items-center gap-1.5" data-testid="footer-ledger">
            <ShieldCheck className="size-3" />{" "}
            {t("footer.ledger", { hash: shortHash(intel.ledgerRoot), n: intel.eventCount })}
            <DemoTag kind="SHA-256" />
          </span>
        </footer>
      </div>
    </main>
  );
}

function PanelHeader({
  icon: Icon,
  eyebrow,
  title,
  aside,
}: {
  icon: typeof Search;
  eyebrow: string;
  title: string;
  aside?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-border px-5 py-4">
      <div className="flex size-8 items-center justify-center rounded-md bg-accent text-primary">
        <Icon className="size-4" />
      </div>
      <div>
        <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {eyebrow}
        </p>
        <h2 className="mt-0.5 text-sm font-semibold">{title}</h2>
      </div>
      {aside && <div className="ml-auto">{aside}</div>}
    </div>
  );
}

function Sensor({
  icon: Icon,
  label,
  value,
  note,
  alert = false,
}: {
  icon: typeof Gauge;
  label: string;
  value: string;
  note: string;
  alert?: boolean;
}) {
  return (
    <div className="min-w-0 px-3 sm:px-4">
      <Icon className={`mb-3 size-4 ${alert ? "text-warning" : "text-primary"}`} />
      <p className="truncate text-[10px] text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-base font-semibold">{value}</p>
      <p className={`mt-1 truncate text-[9px] ${alert ? "text-warning" : "text-success"}`}>
        {note}
      </p>
    </div>
  );
}
