import { useCallback } from 'react';
import { useI18nStore, selectT, selectLocale } from './store';
import type { Translations, Locale } from './types';

interface UseTranslationReturn {
  t: Translations;
  locale: Locale;
  setLocale: (locale: Locale) => void;
  toggleLocale: () => void;
  format: (template: string, params: Record<string, string | number>) => string;
}

export function useTranslation(): UseTranslationReturn {
  const t = useI18nStore(selectT);
  const locale = useI18nStore(selectLocale);
  const setLocale = useI18nStore((s) => s.setLocale);
  const toggleLocale = useI18nStore((s) => s.toggleLocale);

  const format = useCallback(
    (template: string, params: Record<string, string | number>) => {
      return template.replace(/{(\w+)}/g, (_, key) =>
        String(params[key] ?? `{${key}}`)
      );
    },
    []
  );

  return { t, locale, setLocale, toggleLocale, format };
}
