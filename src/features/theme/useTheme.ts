import { useCallback, useEffect, useState } from "react";
import { applyTheme, resolveInitialTheme, setStoredTheme, type Theme } from "./theme";

export const useTheme = () => {
  const [theme, setTheme] = useState<Theme>(resolveInitialTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    const nextTheme = theme === "light" ? "dark" : "light";
    applyTheme(nextTheme);
    setStoredTheme(nextTheme);
    setTheme(nextTheme);
  }, [theme]);

  return { theme, toggleTheme };
};
