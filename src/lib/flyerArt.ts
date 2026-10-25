/**
 * Generated flyer art for events without an uploaded flyer (to-do: Generated flyer art).
 *
 * Liquid, printed in pixels: a moving flow field dithered down to a few inks at a chunky pixel size, like a
 * photocopied rave flyer of something poured. Everything is seeded from the event id, so an event always looks the
 * same and no two look alike. Variation comes in layers:
 *   mode     six kinds of liquid: marble (warped noise), lava (metaballs), ripples (drops on water),
 *            vortex (a whirlpool), ink (marbled stripes), plasma (interfering waves)
 *   print    ordered dither (4x4 or 8x8), grain, or scanlines
 *   palette  2 to 4 inks from one of five schemes
 *   and      pixel size, scale, warp, swirl, flow direction and speed, smooth or banded
 * This module is pure (parameters only); lib/liquidRenderer.ts draws it with WebGL.
 */

export type Rgb = [number, number, number];

export const MODES = ["marble", "lava", "ripples", "vortex", "ink", "plasma"] as const;
export const PRINTS = ["dither", "grain", "scanlines"] as const;

export type ArtParams = {
  seed: number;
  /** Index into MODES. */
  mode: number;
  /** Index into PRINTS. */
  print: number;
  /** Inks from darkest to lightest; the shader dithers between neighbors. Always 4 entries (repeats when fewer). */
  inks: [Rgb, Rgb, Rgb, Rgb];
  /** How many of the inks are used: 2 to 4. */
  levels: number;
  /** CSS pixels per art pixel. */
  pixel: number;
  scale: number;
  warp: number;
  swirl: number;
  speed: number;
  dir: [number, number];
  /** 0 = smooth gradient, otherwise the number of contour bands. */
  bands: number;
  /** 4 or 8: ordered-dither matrix size. */
  dither: 4 | 8;
  /** Variation number shown in the "Gen" mark. */
  number: string;
};

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** mulberry32 */
function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hsl(h: number, s: number, l: number): Rgb {
  h = ((h % 360) + 360) % 360;
  const a = s * Math.min(l, 1 - l);
  const k = (n: number) => (n + h / 30) % 12;
  const c = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [c(0), c(8), c(4)];
}

const SCHEMES = ["analogous", "complement", "triad", "mono", "acid"] as const;

/** A palette from a random scheme, ordered dark to light so dithering reads as tone. */
function palette(r: () => number, levels: number): Rgb[] {
  const base = r() * 360;
  const scheme = SCHEMES[Math.floor(r() * SCHEMES.length)];
  const hues =
    scheme === "analogous" ? [base, base + 25, base + 50, base - 25]
    : scheme === "complement" ? [base, base + 180, base + 15, base + 195]
    : scheme === "triad" ? [base, base + 120, base + 240, base + 60]
    : scheme === "mono" ? [base, base, base + 8, base - 8]
    : [base, base + 90, base + 200, base + 300]; // acid: anything goes
  // Darkest ink is near-black (or a deep tint) so the title on top keeps its contrast.
  const darkL = 0.04 + r() * 0.1;
  const lights = [darkL, 0.32 + r() * 0.14, 0.55 + r() * 0.12, 0.74 + r() * 0.16];
  const sat = 0.65 + r() * 0.35;
  const out: Rgb[] = [];
  for (let i = 0; i < levels; i++) {
    const l = lights[Math.round((i * 3) / (levels - 1))];
    out.push(hsl(hues[i % hues.length], i === 0 ? sat * 0.6 : sat, l));
  }
  return out;
}

export function artParams(id: string): ArtParams {
  const seed = hash(id);
  const r = rng(seed);
  const levels = 2 + Math.floor(r() * 3);
  const inks = palette(r, levels);
  while (inks.length < 4) inks.push(inks[inks.length - 1]);
  const angle = r() * Math.PI * 2;
  const bandsRoll = r();
  const mode = Math.floor(r() * MODES.length);
  return {
    seed: (seed % 1000) / 10,
    mode,
    print: r() < 0.6 ? 0 : r() < 0.6 ? 1 : 2,
    inks: inks as ArtParams["inks"],
    levels,
    pixel: [3, 4, 4, 5, 6][Math.floor(r() * 5)],
    scale: 1.4 + r() * 2.2,
    warp: 2 + r() * 3.5,
    swirl: r() * 1.6,
    speed: 0.04 + r() * 0.09,
    dir: [Math.cos(angle), Math.sin(angle)],
    bands: bandsRoll < 0.45 ? 0 : 3 + Math.floor(r() * 6),
    dither: r() < 0.5 ? 4 : 8,
    // Mode letter + variation, e.g. "L42" for lava.
    number: `${"MLRVIP"[mode]}${String((seed % 99) + 1).padStart(2, "0")}`,
  };
}

/** CSS color of the middle ink: the fallback fill when WebGL isn't available. */
export function artFallback(p: ArtParams): string {
  const [r, g, b] = p.inks[Math.min(2, p.levels - 1)].map((v) => Math.round(v * 255));
  return `rgb(${r} ${g} ${b})`;
}

export function artNumber(id: string): string {
  return artParams(id).number;
}
