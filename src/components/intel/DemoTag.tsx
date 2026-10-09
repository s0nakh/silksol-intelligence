import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

export type TagKind = "SIMULATED" | "LIVE" | "DEMO DATA" | "BASELINE" | "SHA-256";

/** Provenance badge: every number on the dashboard says whether it is simulated or live. */
export function DemoTag({ kind = "DEMO DATA", className }: { kind?: TagKind; className?: string }) {
  const { t } = useI18n();
  const tone =
    kind === "LIVE" || kind === "SHA-256"
      ? "border-success/40 bg-success/10 text-success"
      : kind === "SIMULATED"
        ? "border-warning/40 bg-warning/10 text-warning"
        : "border-primary/40 bg-primary/10 text-primary";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase leading-none tracking-wider",
        tone,
        className,
      )}
    >
      {t(`tags.${kind}`)}
    </span>
  );
}
