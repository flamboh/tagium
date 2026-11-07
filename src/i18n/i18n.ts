import { useSyncExternalStore } from "react";
import { getTranslationsSnapshot, initializeGTSPA, useLocale } from "gt-react";
import gtConfig from "../../gt.config.json";

export const displayLocales = [gtConfig.defaultLocale, ...gtConfig.locales];

const translationFiles = import.meta.glob(["./translations/*.json", "!./translations/en.json"], {
  import: "default",
});

const loadTranslations = async (locale: string) => {
  const loadFile = translationFiles[`./translations/${locale}.json`];

  return loadFile ? await loadFile() : {};
};

const localeChangeListeners = new Set<() => void>();

let localeRevision = 0;

const showLocale = async (locale: string) => {
  await getTranslationsSnapshot(locale);
  localeRevision += 1;

  for (const notify of localeChangeListeners) notify();
};

const subscribeToLocaleChanges = (notify: () => void) => {
  localeChangeListeners.add(notify);

  return () => {
    localeChangeListeners.delete(notify);
  };
};

const getLocaleRevision = () => localeRevision;

const readChosenLocale = () =>
  document.cookie
    .split("; ")
    .find((cookie) => cookie.startsWith("generaltranslation.locale="))
    ?.slice("generaltranslation.locale=".length);

export const useDisplayedLocale = () => {
  useSyncExternalStore(subscribeToLocaleChanges, getLocaleRevision);

  return useLocale();
};

export const initializeI18n = () =>
  initializeGTSPA({
    defaultLocale: gtConfig.defaultLocale,
    locales: gtConfig.locales,
    customMapping: gtConfig.customMapping,
    locale: [readChosenLocale(), gtConfig.defaultLocale].filter((locale) => locale !== undefined),
    loadTranslations,
    _reload: ({ locale }) => void showLocale(locale),
  });
