// CLAUDE.md: all JS motion goes through src/lib/motion.ts, reduced motion is read through reducedMotion(),
// and animations move transform and opacity only.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function files(dir: string, ext: RegExp): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p, ext) : ext.test(n) ? [p] : [];
  });
}
const src = join(__dirname, "..", "src");
const scripts = files(src, /\.tsx?$/).filter((p) => !p.endsWith(join("lib", "motion.ts")));
const styles = files(src, /\.css$/);

// Known exceptions, each with a reason. Add to this list only with one.
const LAYOUT_TRANSITIONS = [
  "components/ui.css", // segmented pill: width follows the option's label width
  "map/map.css", // location accuracy circle: its size is real meters on the map
];

describe("motion rules", () => {
  it("no Web Animations or reduced-motion queries outside motion.ts", () => {
    const bad = scripts.filter((p) => /\.animate\??\.?\(|prefers-reduced-motion/.test(readFileSync(p, "utf8")));
    expect(bad).toEqual([]);
  });
  it("CSS animates transform and opacity, not layout or backgrounds", () => {
    const bad: string[] = [];
    for (const p of styles) {
      const css = readFileSync(p, "utf8");
      const rel = p.slice(src.length + 1);
      for (const m of css.matchAll(/@keyframes\s+([\w-]+)\s*\{([^{}]*(?:\{[^}]*\}[^{}]*)*)\}/g))
        if (/\b(width|height|top|left|right|bottom|background-position|margin)\s*:/.test(m[2])) bad.push(`${rel} @keyframes ${m[1]}`);
      if (!LAYOUT_TRANSITIONS.includes(rel))
        for (const m of css.matchAll(/transition:([^;}]*)/g)) if (/\b(width|height|top|left|background-position)\b/.test(m[1])) bad.push(`${rel} transition:${m[1].trim()}`);
    }
    expect(bad).toEqual([]);
  });
});
