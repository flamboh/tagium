import { useSyncExternalStore } from "react";
import { getTranslationsSnapshot, initializeGTSPA } from "gt-react";
import gtConfig from "../../gt.config.json";

const translationFiles = import.meta.glob("./translations/*.json", { import: "default" });

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

export const useLocaleRevision = () =>
  useSyncExternalStore(subscribeToLocaleChanges, getLocaleRevision);

export const initializeI18n = () =>
  initializeGTSPA({
    defaultLocale: gtConfig.defaultLocale,
    locales: gtConfig.locales,
    loadTranslations,
    _reload: ({ locale }) => void showLocale(locale),
  });
