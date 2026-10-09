import { describe, expect, it } from "vitest";
import {
  DICTIONARIES,
  LANGS,
  formatDateTime,
  formatHours,
  formatWeekdayTime,
  translate,
} from "./translate";

function leaves(node: unknown, prefix = ""): Record<string, string> {
  if (typeof node === "string") return { [prefix]: node };
  return Object.entries(node as Record<string, unknown>).reduce<Record<string, string>>(
    (acc, [k, v]) => ({ ...acc, ...leaves(v, prefix ? `${prefix}.${k}` : k) }),
    {},
  );
}
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("locales", () => {
  const en = leaves(DICTIONARIES.en);

  for (const lang of LANGS) {
    it(`${lang} has exactly the English keys, non-empty, with the same placeholders`, () => {
      const dict = leaves(DICTIONARIES[lang]);
      expect(Object.keys(dict).sort()).toEqual(Object.keys(en).sort());
      for (const [key, value] of Object.entries(dict)) {
        expect(value.trim(), key).not.toBe("");
        expect(placeholders(value), key).toEqual(placeholders(en[key]!));
      }
    });
  }

  it("interpolates variables and falls back to the key template when a var is missing", () => {
    expect(translate("ru", "kpi.atRisk", { n: 2 })).toBe("под риском: 2");
    expect(translate("kk", "tracker.bottleneck", { node: "Ақтау" })).toBe("Тар орын · Ақтау");
    expect(translate("en", "kpi.atRisk")).toBe("{n} at risk");
  });

  it("formats times in the corridor time zone (UTC+5) and localised hour units", () => {
    expect(formatDateTime("en", "2026-10-02T06:00:00Z")).toBe("02 Oct, 11:00");
    expect(formatDateTime("kk", "2026-10-02T21:30:00Z")).toBe("03 қаз, 02:30");
    expect(formatWeekdayTime("ru", "2026-10-02T06:00:00Z")).toBe("Пт 11:00");
    expect(formatHours("ru", 12.5, { signed: true })).toBe("+12,5 ч");
    expect(formatHours("kk", -3, { digits: 0 })).toBe("−3 сағ");
  });
});
