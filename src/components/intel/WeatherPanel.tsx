import { Anchor, CloudLightning, TriangleAlert, Waves, Wind } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useI18n } from "@/i18n";
import type { ClosureOutlookDay } from "@/services/ml/closureModel";
import { MODEL_CARD, type Bottleneck } from "@/services/ml/riskEngine";
import { PORT_CLOSURE_WIND_MS, type PortWeather } from "@/services/telemetry";
import { DemoTag } from "./DemoTag";
import { nodeName, reasonText } from "./labels";

const LEVEL_CLASS: Record<Bottleneck["level"], string> = {
  high: "status-risk",
  medium: "status-triggered",
  low: "status-transit",
};

/** Caspian port weather for the selected cargo, plus the corridor bottleneck list. */
export function WeatherPanel({
  weather,
  outlook,
  bottlenecks,
}: {
  weather: PortWeather;
  outlook: ClosureOutlookDay[];
  bottlenecks: Bottleneck[];
}) {
  const i18n = useI18n();
  const { t, num, weekdayTime } = i18n;
  const w = weather.current;
  const port = nodeName(i18n, weather.port);
  return (
    <div className="panel">
      <div className="flex items-center gap-3 border-b border-border px-5 py-4">
        <div className="flex size-8 items-center justify-center rounded-md bg-accent text-primary">
          <CloudLightning className="size-4" />
        </div>
        <div className="min-w-0">
          <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {t("weather.eyebrow")}
          </p>
          <h2 className="mt-0.5 text-sm font-semibold">{t("weather.title", { port })}</h2>
        </div>
        <DemoTag
          kind={weather.provenance.mode === "live" ? "LIVE" : "SIMULATED"}
          className="ml-auto"
        />
      </div>
      <div className="grid grid-cols-3 divide-x divide-border py-4">
        <Stat
          icon={Wind}
          label={t("weather.wind")}
          value={`${num(w.windMs, 1)} ${t("units.ms")}`}
          alert={w.windMs > PORT_CLOSURE_WIND_MS}
        />
        <Stat
          icon={Waves}
          label={t("weather.waves")}
          value={`${num(w.waveM, 1)} ${t("units.m")}`}
          alert={w.waveM >= 2}
        />
        <Stat
          icon={Anchor}
          label={t("weather.port")}
          value={w.portClosed ? t("weather.closed") : t("weather.open")}
          alert={w.portClosed}
        />
      </div>
      {outlook.length > 0 && (
        <div className="border-t border-border px-5 py-3" data-testid="closure-outlook">
          <p className="text-[10px] font-semibold text-muted-foreground">{t("weather.outlook")}</p>
          <div className="mt-1.5 grid grid-cols-3 gap-2">
            {outlook.map((d) => (
              <div key={d.day} className="rounded-md border border-border bg-card/60 px-2 py-1.5">
                <p className="text-[10px] text-muted-foreground">
                  {t("weather.outlookDay", { n: d.leadDays })}
                </p>
                <p className={`text-sm font-semibold ${d.warning ? "text-warning" : ""}`}>
                  {d.probability}%
                </p>
              </div>
            ))}
          </div>
          <p className="mt-1.5 text-[10px] leading-4 text-muted-foreground">
            {t("weather.outlookNote", { auc: num(MODEL_CARD.backtest[0]?.auc ?? 0, 2) })}
          </p>
        </div>
      )}
      <div className="flex items-center gap-2 border-t border-border px-5 py-3">
        <p className="text-[10px] leading-4 text-muted-foreground">
          {w.stormAlert ? (
            <span className="font-semibold text-warning">{t("weather.alert")} · </span>
          ) : null}
          {t("weather.note", { n: PORT_CLOSURE_WIND_MS })}
        </p>
        <Dialog>
          <DialogTrigger asChild>
            <Button size="sm" className="ml-auto shrink-0">
              {t("weather.button")}
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {t("weather.dialogTitle", { h: MODEL_CARD.horizonH })} <DemoTag kind="SIMULATED" />
              </DialogTitle>
              <DialogDescription>{t("weather.dialogDescription")}</DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              {bottlenecks.map((b) => (
                <div
                  key={b.node}
                  className="rounded-md border border-border bg-card/60 p-3 text-xs"
                  data-testid={`bottleneck-${b.node}`}
                >
                  <div className="flex items-center gap-2">
                    {b.level === "high" && <TriangleAlert className="size-3.5 text-warning" />}
                    <span className="font-semibold">{nodeName(i18n, b.node)}</span>
                    <span className={`status-pill ${LEVEL_CLASS[b.level]}`}>
                      {t(`levels.${b.level}`)}
                    </span>
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      {t("weather.now", { risk: b.riskNow })} ·{" "}
                      {t("weather.peak", { risk: b.riskPeak, time: weekdayTime(b.peakAt) })}
                    </span>
                  </div>
                  {b.reasons.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5 text-[11px] text-muted-foreground">
                      {b.reasons.map((r) => (
                        <li key={r.code}>• {reasonText(i18n, r)}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  alert = false,
}: {
  icon: typeof Wind;
  label: string;
  value: string;
  alert?: boolean;
}) {
  return (
    <div className="min-w-0 px-4">
      <Icon className={`mb-2 size-4 ${alert ? "text-warning" : "text-primary"}`} />
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className={`mt-0.5 truncate text-base font-semibold ${alert ? "text-warning" : ""}`}>
        {value}
      </p>
    </div>
  );
}
