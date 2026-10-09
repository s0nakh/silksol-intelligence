import { Download, FileCheck2, ShieldCheck, ShieldX } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/i18n";
import { shortHash } from "@/services/ledger/sha256";
import {
  verifyDelayReport,
  type DelayReport,
  type ReportVerification,
} from "@/services/reports/delayReport";
import { DemoTag } from "./DemoTag";
import { nodeName } from "./labels";

type Props = { report: DelayReport | null; open: boolean; onOpenChange: (open: boolean) => void };

/** "Passport of delay": renders a sealed report and lets anyone re-verify or export it. */
export function DelayReportDialog({ report, open, onOpenChange }: Props) {
  const i18n = useI18n();
  const { t, num, dateTime, hours } = i18n;
  const [check, setCheck] = useState<ReportVerification | null>(null);
  if (!report) return null;

  const download = () => {
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${report.reportId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const f = report.forecast;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setCheck(null);
      }}
    >
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileCheck2 className="size-4 text-primary" /> {t("report.title")} · #{report.cargo.id}{" "}
            <DemoTag kind="SHA-256" />
          </DialogTitle>
          <DialogDescription>{t("report.description")}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 text-xs sm:grid-cols-3">
          <Field label={t("report.id")} value={report.reportId} mono />
          <Field label={t("report.issuedAt")} value={dateTime(report.issuedAt)} />
          <Field
            label={t("report.hash")}
            value={shortHash(report.reportHash)}
            mono
            tone="text-primary"
          />
        </div>

        <Section title={t("report.attribution")}>
          {report.delay.attribution.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("report.none")}</p>
          ) : (
            <Table head={[t("report.node"), t("report.cause"), t("report.hours")]}>
              {report.delay.attribution.map((a) => (
                <tr key={`${a.node}-${a.cause}`}>
                  <td>{nodeName(i18n, a.node)}</td>
                  <td>{t(`causes.${a.cause}`)}</td>
                  <td className="font-semibold text-foreground">{hours(a.hours)}</td>
                </tr>
              ))}
              <tr>
                <td colSpan={2} className="font-semibold text-foreground">
                  {t("report.total")}
                </td>
                <td className="font-semibold text-warning">
                  {hours(report.delay.observedExcessH)}
                </td>
              </tr>
            </Table>
          )}
        </Section>

        <Section title={t("report.forecast")}>
          <div className="grid gap-2 text-xs sm:grid-cols-4">
            <Field
              label={t("report.risk")}
              value={`${f.risk}%`}
              tone={f.risk > 60 ? "text-warning" : "text-success"}
            />
            <Field label={t("report.contractEta")} value={dateTime(f.contractualEta)} />
            <Field
              label={t("report.predictedEta")}
              value={`${dateTime(f.predictedEta)} (${hours(f.etaDriftH, { signed: true, digits: 0 })})`}
            />
            <Field
              label={t("report.band")}
              value={`${dateTime(f.etaP10)} – ${dateTime(f.etaP90)}`}
            />
          </div>
          <p className="mt-1 font-mono text-[10px] text-muted-foreground">
            {f.model} · {f.modelStatus}
          </p>
        </Section>

        {report.evidence.weather.map((w) => (
          <Section key={w.port} title={t("report.weather", { port: nodeName(i18n, w.port) })}>
            <Table
              head={[t("report.time"), t("report.wind"), t("report.wave"), t("report.closed")]}
            >
              {w.points.map((p) => (
                <tr key={p.at}>
                  <td>{dateTime(p.at)}</td>
                  <td className={p.portClosed ? "font-semibold text-warning" : ""}>
                    {num(p.windMs, 1)}
                  </td>
                  <td>{num(p.waveM, 1)}</td>
                  <td>{p.portClosed ? t("report.yes") : t("report.no")}</td>
                </tr>
              ))}
            </Table>
          </Section>
        ))}

        {report.evidence.ais.length > 0 && (
          <Section title={t("report.ais")}>
            <Table
              head={[
                t("report.vessel"),
                "MMSI",
                t("report.position"),
                t("report.speed"),
                t("report.queue"),
              ]}
            >
              {report.evidence.ais.map((v) => (
                <tr key={v.mmsi}>
                  <td className="text-foreground">{v.name}</td>
                  <td className="font-mono">{v.mmsi}</td>
                  <td className="font-mono">
                    {v.lat.toFixed(3)}, {v.lon.toFixed(3)}
                  </td>
                  <td>{num(v.sog, 1)}</td>
                  <td>{v.queueH !== undefined ? num(v.queueH, 0) : "—"}</td>
                </tr>
              ))}
            </Table>
          </Section>
        )}

        <Section title={t("report.dwell")}>
          <Table
            head={[
              t("report.node"),
              t("report.arrived"),
              t("report.departed"),
              t("report.actual"),
              t("report.planned"),
              t("report.sla"),
            ]}
          >
            {report.evidence.dwell.map((d) => (
              <tr key={d.node}>
                <td className="text-foreground">{nodeName(i18n, d.node)}</td>
                <td>{d.arrivedAt ? dateTime(d.arrivedAt) : "—"}</td>
                <td>{d.departedAt ? dateTime(d.departedAt) : "—"}</td>
                <td
                  className={
                    d.dwellH !== null && d.dwellH > d.slaDwellH ? "font-semibold text-warning" : ""
                  }
                >
                  {d.dwellH !== null ? num(d.dwellH, 0) : "—"}
                </td>
                <td>{d.plannedDwellH}</td>
                <td>{d.slaDwellH}</td>
              </tr>
            ))}
          </Table>
        </Section>

        <Section title={t("report.ledger", { n: report.ledger.entries.length })}>
          <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-border p-2">
            {report.ledger.entries.map((e) => (
              <div key={e.seq} className="flex items-center gap-2 text-[10px]">
                <span className="w-5 shrink-0 text-muted-foreground">#{e.seq}</span>
                <span className="min-w-0 flex-1 truncate">
                  {t(`events.${e.type}`)} · {nodeName(i18n, e.node)}
                </span>
                <span className="hidden text-muted-foreground sm:inline">
                  {dateTime(e.occurredAt)}
                </span>
                <span className="font-mono text-primary">{shortHash(e.hash)}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section title={t("report.sources")}>
          <ul className="space-y-0.5 text-[11px] text-muted-foreground">
            {report.sources.map((s) => (
              <li key={s.source} className="flex items-center gap-2">
                • {s.source}
                <DemoTag kind={s.mode === "live" ? "LIVE" : "SIMULATED"} />
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[10px] text-muted-foreground">{t("report.disclaimer")}</p>
        </Section>

        {check && (
          <p
            data-testid="report-verification"
            className={`flex items-start gap-2 rounded-md border p-2 text-xs ${check.valid ? "border-success/40 bg-success/10 text-success" : "border-warning/40 bg-warning/10 text-warning"}`}
          >
            {check.valid ? (
              <ShieldCheck className="size-4 shrink-0" />
            ) : (
              <ShieldX className="size-4 shrink-0" />
            )}
            {check.valid
              ? t("report.verified", { n: report.ledger.entries.length })
              : t("report.broken")}
          </p>
        )}
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={() => setCheck(verifyDelayReport(report))}>
            <ShieldCheck className="size-4" /> {t("report.verify")}
          </Button>
          <Button onClick={download}>
            <Download className="size-4" /> {t("report.download")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Field({
  label,
  value,
  mono = false,
  tone = "",
}: {
  label: string;
  value: string;
  mono?: boolean;
  tone?: string;
}) {
  return (
    <div className="min-w-0 rounded-md border border-border p-2">
      <p className="text-[9px] text-muted-foreground">{label}</p>
      <p className={`mt-0.5 truncate font-semibold ${mono ? "font-mono text-[11px]" : ""} ${tone}`}>
        {value}
      </p>
    </div>
  );
}

function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-left">
        <thead>
          <tr className="text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
            {head.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
