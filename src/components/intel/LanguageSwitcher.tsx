import { LANGS, useI18n } from "@/i18n";

/** EN | RU | KK segmented switch; the choice persists per browser. */
export function LanguageSwitcher() {
  const { lang, setLang, t } = useI18n();
  return (
    <div
      role="group"
      aria-label={t("header.language")}
      className="flex h-9 items-center rounded-md border border-border bg-secondary p-0.5"
    >
      {LANGS.map((l, i) => (
        <span key={l} className="flex items-center">
          {i > 0 && <span className="h-3.5 w-px bg-border" aria-hidden="true" />}
          <button
            type="button"
            lang={l}
            aria-pressed={lang === l}
            onClick={() => setLang(l)}
            className={`rounded px-2 py-1 text-[11px] font-semibold transition-colors ${lang === l ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            {l.toUpperCase()}
          </button>
        </span>
      ))}
    </div>
  );
}
