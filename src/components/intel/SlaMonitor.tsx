import { BrainCircuit, Check, ShieldCheck, TriangleAlert } from "lucide-react";
import { useI18n } from "@/i18n";
import { MODEL_CARD, type ShipmentForecast } from "@/services/ml/riskEngine";
import type { ShipmentSla } from "@/services/sla/slaMonitor";
import type { Shipment } from "@/services/telemetry";
import { DemoTag } from "./DemoTag";
import { nodeName } from "./labels";

type Props = { shipment: Shipment; forecast: ShipmentForecast; sla: ShipmentSla };

/** SLA Violation Monitor: dwell vs contractual thresholds at every checkpoint of the selected cargo. */
export function SlaMonitor({ shipment, forecast, sla }: Props) {
  const i18n = useI18n();
  const { t, num, hours } = i18n;
  const active = sla.checks.find((c) => c.state === "active");
  const past = sla.violations.filter((c) => c.state === "complete");
  const steps = shipment.route.slice(1);

  return (
    <div className="panel min-w-0">
      <div className="flex items-center gap-3 border-b border-border px-5 py-4">
        <div className="flex size-8 items-center justify-center rounded-md bg-accent text-primary">
          <ShieldCheck className="size-4" />
        </div>
        <div className="min-w-0">
          <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {t("sla.eyebrow")}
          </p>
          <h2 className="mt-0.5 text-sm font-semibold">{t("sla.title", { id: shipment.id })}</h2>
        </div>
        <DemoTag kind="SIMULATED" className="ml-auto" />
      </div>
      <div className="space-y-4 p-5">
        <div className="grid grid-cols-3 gap-2 text-xs">
          <Cell
            label={t("sla.risk")}
            value={`${forecast.risk}%`}
            tone={forecast.risk > 60 ? "text-warning" : "text-success"}
          />
          <Cell
            label={t("sla.dwell")}
            value={active ? hours(active.dwellH) : "—"}
            tone={active && active.status !== "ok" ? "text-warning" : ""}
          />
          <Cell
            label={t("sla.threshold")}
            value={active ? hours(active.thresholdH, { digits: 0 }) : "—"}
          />
        </div>
        <p className="-mt-2 text-[10px] text-muted-foreground">
          {t("sla.note", { h: MODEL_CARD.delayToleranceH })}
        </p>
        <div className="flex items-center gap-2">
          {steps.map((node, i) => {
            const check = sla.checks.find((c) => c.node === node);
            const tone = !check
              ? "bg-accent text-muted-foreground"
              : check.status === "breach"
                ? "bg-warning/20 text-warning"
                : check.state === "active"
                  ? "bg-primary/20 text-primary"
                  : "bg-success/20 text-success";
            return (
              <div key={node} className="flex min-w-0 flex-1 items-center gap-2">
                <span
                  className={`flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] ${tone}`}
                >
                  {check?.status === "breach" ? (
                    "!"
                  ) : check?.state === "complete" ? (
                    <Check className="size-3" />
                  ) : (
                    i + 1
                  )}
                </span>
                <span className="truncate text-[11px] text-muted-foreground">
                  {nodeName(i18n, node)}
                </span>
                {i < steps.length - 1 && <span className="h-px min-w-2 flex-1 bg-border" />}
              </div>
            );
          })}
        </div>
        {active && (
          <div
            className={`rounded-md border p-3 text-xs ${active.status === "breach" || active.predictedStatus === "breach" ? "border-warning/40 bg-warning/10" : "border-success/40 bg-success/10"}`}
            data-testid="sla-status"
          >
            <p
              className={`flex items-center gap-2 font-semibold ${active.status === "ok" ? "text-success" : "text-warning"}`}
            >
              {active.status === "ok" ? (
                <Check className="size-4" />
              ) : (
                <TriangleAlert className="size-4" />
              )}
              {t(`sla.${active.status}`, {
                node: nodeName(i18n, active.node),
                dwell: num(active.dwellH, 1),
                threshold: active.thresholdH,
              })}
            </p>
            {active.status !== "breach" && active.predictedDwellH !== undefined && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                {active.predictedStatus === "breach"
                  ? t("sla.predictedBreach", {
                      node: nodeName(i18n, active.node),
                      predicted: num(active.predictedDwellH, 0),
                      threshold: active.thresholdH,
                      p: forecast.currentNodeSlaRisk,
                    })
                  : t("sla.predictedOk", {
                      node: nodeName(i18n, active.node),
                      remaining: num(forecast.currentNodeRemainingH, 0),
                      p: forecast.currentNodeSlaRisk,
                    })}
              </p>
            )}
            {past.length > 0 && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                {t("sla.pastViolations", {
                  nodes: past
                    .map((c) => `${nodeName(i18n, c.node)} (${hours(c.dwellH, { digits: 0 })})`)
                    .join(", "),
                })}
              </p>
            )}
          </div>
        )}
        <ModelCard forecast={forecast} />
      </div>
    </div>
  );
}

/** Explainability: which features push the current node's delay odds up, straight from the model. */
function ModelCard({ forecast }: { forecast: ShipmentForecast }) {
  const { t, num } = useI18n();
  const drivers = forecast.contributions
    .filter((c) => c.weight > 0.05)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3);
  return (
    <div
      data-testid="model-card"
      className="rounded-md border border-border bg-card/60 p-3 text-[11px]"
    >
      <div className="flex items-center gap-2">
        <BrainCircuit className="size-3.5 text-primary" />
        <span className="font-semibold">{t("model.title")}</span>
        <span className="ml-auto flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
          {MODEL_CARD.version}
          <DemoTag kind="BASELINE" />
        </span>
      </div>
      <p className="mt-1 text-[10px] text-muted-foreground">{t("model.status")}</p>
      {drivers.length > 0 && (
        <div className="mt-2 space-y-1">
          <p className="text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
            {t("model.drivers")}
          </p>
          {drivers.map((d) => (
            <div key={d.feature} className="flex items-center gap-2 text-[10px]">
              <span
                className={`size-1.5 rounded-full ${d.weight > 1 ? "bg-warning" : "bg-primary"}`}
              />
              <span>{t(`model.features.${d.feature}`)}</span>
              <span className="text-muted-foreground">{num(d.value, d.value >= 10 ? 0 : 2)}</span>
              <span className="ml-auto font-mono text-primary">+{num(d.weight, 2)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Cell({ label, value, tone = "" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-md border border-border p-2">
      <p className="text-[9px] text-muted-foreground">{label}</p>
      <p className={`mt-0.5 font-semibold ${tone}`}>{value}</p>
    </div>
  );
}
