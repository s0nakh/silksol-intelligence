import { Banknote, CheckCircle2, XCircle } from "lucide-react";
import { useI18n } from "@/i18n";
import type { DelayCost } from "@/services/economics/delayCost";
import {
  MIN_NET_SAVING_KZT,
  type Recommendation,
  type ShipmentEconomics,
} from "@/services/economics/recommendations";
import { DemoTag } from "./DemoTag";
import { kzt, nodeName } from "./labels";

const COST_PARTS = ["storageKzt", "wagonIdleKzt", "slaPenaltyKzt", "lateDeliveryKzt"] as const;

const PART_LABEL = {
  storageKzt: "econ.storage",
  wagonIdleKzt: "econ.wagonIdle",
  slaPenaltyKzt: "econ.slaPenalty",
  lateDeliveryKzt: "econ.lateDelivery",
} as const satisfies Record<(typeof COST_PARTS)[number], string>;

/** Cost of delay in tenge for the selected cargo and the operational options, with verdicts. */
export function EconomicsPanel({ economics }: { economics: ShipmentEconomics }) {
  const i18n = useI18n();
  const { t } = i18n;
  const { cost, options } = economics;

  return (
    <div className="panel min-w-0" data-testid="economics-panel">
      <div className="flex items-center gap-3 border-b border-border px-5 py-4">
        <div className="flex size-8 items-center justify-center rounded-md bg-accent text-primary">
          <Banknote className="size-4" />
        </div>
        <div className="min-w-0">
          <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {t("econ.eyebrow")}
          </p>
          <h2 className="mt-0.5 text-sm font-semibold">
            {t("econ.title", { id: economics.shipmentId })}
          </h2>
        </div>
        <DemoTag kind="SIMULATED" className="ml-auto" />
      </div>

      <div className="space-y-4 p-5">
        <div>
          <p className="text-[10px] text-muted-foreground">{t("econ.total")}</p>
          <p className="mt-0.5 text-2xl font-semibold" data-testid="expected-loss">
            {kzt(i18n, cost.totalKzt)}
          </p>
          <div className="mt-3 space-y-1.5">
            {COST_PARTS.map((part) => (
              <CostBar
                key={part}
                label={t(PART_LABEL[part])}
                value={kzt(i18n, cost[part])}
                share={cost.totalKzt ? cost[part] / cost.totalKzt : 0}
              />
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 text-[10px] font-semibold text-muted-foreground">
            {t("econ.options")}
          </p>
          {options.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">{t("econ.none")}</p>
          ) : (
            <ul className="space-y-2">
              {options.map((o) => (
                <OptionRow key={o.code} option={o} />
              ))}
            </ul>
          )}
        </div>

        <p className="text-[10px] leading-4 text-muted-foreground">{t("econ.tariffNote")}</p>
      </div>
    </div>
  );
}

function CostBar({ label, value, share }: { label: string; value: string; share: number }) {
  return (
    <div className="text-[11px]">
      <div className="flex justify-between gap-2">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{value}</span>
      </div>
      <div className="mt-0.5 h-1 rounded-full bg-accent">
        <div
          className="h-1 rounded-full bg-primary"
          style={{ width: `${Math.round(share * 100)}%` }}
        />
      </div>
    </div>
  );
}

function OptionRow({ option: o }: { option: Recommendation }) {
  const i18n = useI18n();
  const { t, hours } = i18n;
  const worth = o.netSavingKzt >= MIN_NET_SAVING_KZT;
  const Icon = worth ? CheckCircle2 : XCircle;
  const title = t(`econ.${o.code}`, {
    from: o.from ? nodeName(i18n, o.from) : "",
    to: o.to ? nodeName(i18n, o.to) : "",
    h: o.holdH ?? 0,
  });
  const details = [t(`econ.${o.method}`), t("econ.actionCost", { v: kzt(i18n, o.actionCostKzt) })];
  if (o.method === "simulation")
    details.push(
      t("econ.risk", { a: o.riskBefore, b: o.riskAfter }),
      t("econ.eta", { h: hours(o.etaShiftH, { signed: true, digits: 0 }) }),
    );

  return (
    <li
      className={`rounded-md border p-3 text-xs ${worth ? "border-success/40 bg-success/5" : "border-border bg-card/60"}`}
      data-testid={`option-${o.code}`}
    >
      <div className="flex items-start gap-2">
        <Icon
          className={`mt-0.5 size-3.5 shrink-0 ${worth ? "text-success" : "text-muted-foreground"}`}
        />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{title}</p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">{details.join(" · ")}</p>
        </div>
        <div className="shrink-0 text-right">
          <p
            className={`text-[10px] font-semibold ${worth ? "text-success" : "text-muted-foreground"}`}
          >
            {t(worth ? "econ.recommended" : "econ.notWorth")}
          </p>
          <p className="text-[11px] font-semibold">
            {o.netSavingKzt >= 0
              ? t("econ.net", { v: kzt(i18n, o.netSavingKzt) })
              : t("econ.loss", { v: kzt(i18n, -o.netSavingKzt) })}
          </p>
        </div>
      </div>
    </li>
  );
}
