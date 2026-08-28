export const THEME_STORAGE_KEY = "tagium:theme";

export type Theme = "light" | "dark";

const isTheme = (value: string | null): value is Theme => value === "light" || value === "dark";

export const resolveInitialTheme = (): Theme => {
  if (!("window" in globalThis)) return "dark";

  try {
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (isTheme(storedTheme)) return storedTheme;
  } catch {
    // Storage may be unavailable in private browsing mode.
  }

  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
};

export const applyTheme = (mode: Theme) => {
  if (!("document" in globalThis)) return;

  document.documentElement.classList.toggle("dark", mode === "dark");
  document.documentElement.dataset.theme = mode;
};

export const setStoredTheme = (mode: Theme) => {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // Storage may be unavailable in private browsing mode.
  }
};
