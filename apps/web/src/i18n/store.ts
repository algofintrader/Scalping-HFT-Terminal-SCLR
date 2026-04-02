import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Locale, Translations } from './types';
import { ru } from './locales/ru';
import { en } from './locales/en';

const translations: Record<Locale, Translations> = { ru, en };

function detectBrowserLocale(): Locale {
  const browserLang = navigator.language.split('-')[0];
  if (browserLang === 'ru') return 'ru';
  return 'en';
}

interface I18nState {
  locale: Locale;
  translations: Translations;

  setLocale: (locale: Locale) => void;
  toggleLocale: () => void;
}

export const useI18nStore = create<I18nState>()(
  persist(
    (set, get) => ({
      locale: detectBrowserLocale(),
      translations: translations[detectBrowserLocale()],

      setLocale: (locale: Locale) => {
        set({
          locale,
          translations: translations[locale],
        });
      },

      toggleLocale: () => {
        const current = get().locale;
        const next: Locale = current === 'ru' ? 'en' : 'ru';
        set({
          locale: next,
          translations: translations[next],
        });
      },
    }),
    {
      name: 'sclr-locale',
      partialize: (state) => ({ locale: state.locale }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.translations = translations[state.locale];
        }
      },
    }
  )
);

export const selectLocale = (state: I18nState) => state.locale;
export const selectT = (state: I18nState) => state.translations;
