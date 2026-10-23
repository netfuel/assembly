import { useCallback, useState } from "react";

export type Theme = "light" | "dark";

const KEY = "assembly-theme";
const THEME_COLOR: Record<Theme, string> = { light: "#e9eaec", dark: "#0a0a0b" };

/** Light is the default. Only an explicit choice switches to dark; the OS setting doesn't. */
export function readTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[theme]);
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>(() => (document.documentElement.dataset.theme === "dark" ? "dark" : readTheme()));
  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    applyTheme(t);
    try {
      localStorage.setItem(KEY, t);
    } catch {
      /* private mode: the choice lasts for this visit */
    }
  }, []);
  return [theme, setTheme];
}
