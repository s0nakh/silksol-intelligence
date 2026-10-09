import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_LANG,
  formatDateTime,
  formatHours,
  formatNumber,
  formatWeekdayTime,
  isLang,
  translate,
  type Lang,
  type TKey,
  type TVars,
} from "./translate";

export * from "./translate";

const STORAGE_KEY = "silksol.lang";

export type I18n = {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: TKey, vars?: TVars) => string;
  dateTime: (iso: string) => string;
  weekdayTime: (iso: string) => string;
  num: (n: number, digits?: number) => string;
  hours: (h: number, opts?: { signed?: boolean; digits?: number }) => string;
};

function makeI18n(lang: Lang, setLang: (lang: Lang) => void): I18n {
  return {
    lang,
    setLang,
    t: (key, vars) => translate(lang, key, vars),
    dateTime: (iso) => formatDateTime(lang, iso),
    weekdayTime: (iso) => formatWeekdayTime(lang, iso),
    num: (n, digits) => formatNumber(lang, n, digits),
    hours: (h, opts) => formatHours(lang, h, opts),
  };
}

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  // Server and first client render use English; the stored choice is applied after hydration.
  const [lang, setLangState] = useState<Lang>(DEFAULT_LANG);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (isLang(stored)) setLangState(stored);
    } catch {
      // Storage can be blocked (private mode, previews); English stays.
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Not persisted; the choice still applies for this visit.
    }
  }, []);

  const value = useMemo(() => makeI18n(lang, setLang), [lang, setLang]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

const fallback = makeI18n(DEFAULT_LANG, () => undefined);

/** Translation helpers. Outside the provider (e.g. the root error boundary) it renders English. */
export function useI18n(): I18n {
  return useContext(I18nContext) ?? fallback;
}
