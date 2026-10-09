import type { I18n, TKey } from "@/i18n";
import type { BottleneckReason } from "@/services/ml/riskEngine";
import { NODES, type NodeId } from "@/services/telemetry";

// Translated labels for domain codes coming out of the service layer.

export const nodeName = (i18n: I18n, node: string) => i18n.t(`nodes.${node}` as TKey);

export const countryName = (i18n: I18n, node: NodeId) => i18n.t(`countries.${NODES[node].country}`);

export function reasonText(i18n: I18n, r: BottleneckReason) {
  const { t, num } = i18n;
  switch (r.code) {
    case "storm_closure":
      return t("reasons.storm_closure", { wind: num(r.windMs, 1), threshold: r.thresholdMs });
    case "storm_forecast":
      return t("reasons.storm_forecast", { h: r.inH, wind: num(r.windMs, 1) });
    case "queue_backlog":
      return t("reasons.queue_backlog", { n: r.anchored, h: num(r.avgQueueH, 0) });
    case "seasonal_peak":
      return t("reasons.seasonal_peak", { index: num(r.index, 2) });
    case "rail_load":
      return t("reasons.rail_load", { pct: r.loadPct });
  }
}

export const riskBand = (i18n: I18n, risk: number) =>
  i18n.t(
    risk >= 70
      ? "band.high"
      : risk >= 45
        ? "band.elevated"
        : risk >= 25
          ? "band.moderate"
          : "band.low",
  );
