import { useCallback, useState } from "react";

export type Theme = "light" | "dark";

// Only a tap on the theme toggle writes this. Renamed from "assembly-theme" when dark became the
// default, so choices saved under the old light default don't carry over.
const KEY = "assembly-theme-choice";
const THEME_COLOR: Record<Theme, string> = { light: "#e9eaec", dark: "#0a0a0b" };

/** Dark is the default. Only an explicit choice switches to light; the OS setting doesn't. */
export function readTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[theme]);
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>(() => (document.documentElement.dataset.theme === "light" ? "light" : readTheme()));
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
