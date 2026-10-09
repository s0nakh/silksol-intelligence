import { GitBranch, ScrollText, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useI18n } from "@/i18n";
import type { ChainVerification, LedgerEntry } from "@/services/ledger/auditLedger";
import { shortHash } from "@/services/ledger/sha256";
import { DemoTag } from "./DemoTag";
import { nodeName } from "./labels";

type Props = {
  ledgers: Record<string, LedgerEntry[]>;
  root: string;
  verify: () => { cargoId: string; result: ChainVerification }[];
};

export function AuditDrawer({ ledgers, root, verify }: Props) {
  const i18n = useI18n();
  const { t, dateTime } = i18n;
  const [checked, setChecked] = useState<boolean | null>(null);
  const entries = Object.values(ledgers)
    .flat()
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.seq - a.seq);
  const chains = Object.keys(ledgers).length;

  const runVerify = () => {
    const results = verify();
    const broken = results.find((r) => !r.result.valid);
    setChecked(!broken);
    if (broken) toast.error(t("audit.brokenToast", { id: broken.cargoId }));
    else toast.success(t("audit.verifiedToast", { n: results.length }));
  };

  return (
    <Sheet onOpenChange={(open) => open && setChecked(verify().every((r) => r.result.valid))}>
      <SheetTrigger asChild>
        <Button variant="secondary">
          <ScrollText className="size-4" />
          <span className="hidden md:inline">{t("audit.button")}</span>
          <DemoTag kind="SHA-256" />
        </Button>
      </SheetTrigger>
      <SheetContent className="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {t("audit.title")} <DemoTag kind="SHA-256" />
          </SheetTitle>
          <SheetDescription>{t("audit.description")}</SheetDescription>
        </SheetHeader>
        <div className="grid grid-cols-3 gap-2 text-center">
          <Metric label={t("audit.events")} value={String(entries.length)} />
          <Metric label={t("audit.chains")} value={String(chains)} />
          <Metric
            label={t("audit.integrity")}
            value={checked === false ? t("audit.invalid") : t("audit.valid")}
            tone={checked === false ? "text-warning" : "text-success"}
          />
        </div>
        <div className="rounded-md border border-border p-2">
          <p className="text-[9px] text-muted-foreground">{t("audit.root")}</p>
          <p
            className="mt-0.5 break-all font-mono text-[10px] text-primary"
            data-testid="ledger-root"
          >
            {root}
          </p>
        </div>
        <Button variant="secondary" onClick={runVerify}>
          <ShieldCheck className="size-4" /> {t("audit.verify")}
        </Button>
        <div className="space-y-2">
          {entries.map((e) => (
            <div
              key={`${e.cargoId}-${e.seq}`}
              className="rounded-md border border-border bg-card/60 p-3 text-xs"
            >
              <div className="flex items-center gap-2">
                <GitBranch className="size-3.5 text-primary" />
                <span className="font-semibold">{t(`events.${e.type}`)}</span>
                <span className="ml-auto whitespace-nowrap text-muted-foreground">
                  {dateTime(e.occurredAt)}
                </span>
              </div>
              <p className="mt-1 text-muted-foreground">
                {t("audit.entry", { id: e.cargoId, node: nodeName(i18n, e.node), seq: e.seq })}
              </p>
              <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
                {t("audit.prev")} {shortHash(e.prevHash)}
              </p>
              <p className="truncate font-mono text-[10px] text-primary">sha256 {e.hash}</p>
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Metric({ label, value, tone = "" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-md border border-border p-2">
      <p className="text-[9px] text-muted-foreground">{label}</p>
      <p className={`mt-0.5 truncate text-sm font-semibold ${tone}`}>{value}</p>
    </div>
  );
}
