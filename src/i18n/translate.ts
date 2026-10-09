import en from "@/locales/en.json";
import kk from "@/locales/kk.json";
import ru from "@/locales/ru.json";

export const LANGS = ["en", "ru", "kk"] as const;
export type Lang = (typeof LANGS)[number];
export const DEFAULT_LANG: Lang = "en";
export const isLang = (v: unknown): v is Lang =>
  typeof v === "string" && (LANGS as readonly string[]).includes(v);

type Dictionary = typeof en;
export const DICTIONARIES: Record<Lang, Dictionary> = { en, ru, kk };

/** Every dotted path to a string in the English dictionary, e.g. "kpi.riskIndex". */
type Leaves<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];
export type TKey = Leaves<Dictionary>;
export type TVars = Record<string, string | number>;

function lookup(dict: unknown, key: string): string | undefined {
  let node = dict;
  for (const part of key.split(".")) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}

/** Looks up a key (falling back to English) and fills `{name}` placeholders. */
export function translate(lang: Lang, key: TKey, vars?: TVars): string {
  const template = lookup(DICTIONARIES[lang], key) ?? lookup(en, key) ?? key;
  return vars
    ? template.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m))
    : template;
}

// --- Formatting ---------------------------------------------------------------------------------

export const LOCALE_TAG: Record<Lang, string> = { en: "en-GB", ru: "ru-RU", kk: "kk-KZ" };

/** Corridor operations clock (Aktau, UTC+5). */
export const DISPLAY_TZ_LABEL = "UTC+5";

/** Aktau has no DST, so a fixed offset keeps formatting independent of the runtime's ICU data. */
const DISPLAY_OFFSET_H = 5;
const pad = (n: number) => String(n).padStart(2, "0");

function displayParts(lang: Lang, iso: string) {
  const d = new Date(new Date(iso).getTime() + DISPLAY_OFFSET_H * 3_600_000);
  return {
    day: pad(d.getUTCDate()),
    month: translate(lang, "calendar.months").split(",")[d.getUTCMonth()]!,
    weekday: translate(lang, "calendar.weekdays").split(",")[d.getUTCDay()]!,
    time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
  };
}

/** "02 Oct, 11:00" in corridor time. Month names come from the dictionaries, not Intl, so the
 * server and every browser render identical text (some browsers ship without Kazakh ICU data). */
export function formatDateTime(lang: Lang, iso: string) {
  const p = displayParts(lang, iso);
  return `${p.day} ${p.month}, ${p.time}`;
}

/** "Fri 11:00" in corridor time. */
export function formatWeekdayTime(lang: Lang, iso: string) {
  const p = displayParts(lang, iso);
  return `${p.weekday} ${p.time}`;
}

export function formatNumber(lang: Lang, n: number, digits = 0) {
  return new Intl.NumberFormat(LOCALE_TAG[lang], {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(n);
}

/** "+12.5 h" / "+12,5 ч" / "−3 сағ". */
export function formatHours(lang: Lang, h: number, { signed = false, digits = 1 } = {}) {
  const sign = signed ? (h > 0 ? "+" : h < 0 ? "−" : "") : h < 0 ? "−" : "";
  return `${sign}${formatNumber(lang, Math.abs(h), digits)} ${translate(lang, "units.h")}`;
}
