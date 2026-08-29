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

  const root = document.documentElement;
  // Disable transitions (see index.css) while the swap lands so themed colors snap
  // together; the forced style read commits the change before they come back.
  const themeChanged = root.dataset.theme !== undefined && root.dataset.theme !== mode;
  if (themeChanged) root.classList.add("theme-switching");
  root.classList.toggle("dark", mode === "dark");
  root.dataset.theme = mode;
  if (themeChanged) {
    void window.getComputedStyle(root).transitionProperty;
    window.requestAnimationFrame(() => root.classList.remove("theme-switching"));
  }
};

export const setStoredTheme = (mode: Theme) => {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // Storage may be unavailable in private browsing mode.
  }
};
