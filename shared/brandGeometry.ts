/**
 * The Assembly A and the preloader's lines, in one place. The splash in index.html, the launch gate and
 * its Three.js scene, and the OG renderer all read these so they agree to the unit.
 *
 * Coordinates are in the splash's 720-unit view box (viewBox "-104 -96 720 720"): the A sits in a 512 box
 * with its apex at (256,102), feet at (86,426) and (426,426), crossbar from x 177 to 290 at y 320.
 */

/** Outline of the A, Timeless Serif, as drawn in public/icons/favicon.svg. Outer contour, then the counter. */
export const A_OUTER =
  "M131.2 381.7 246.6 102H266.3L379.5 380Q385 393.4 390.8 399.8Q396.6 406.3 403.9 408.8Q411.3 411.4 425.9 413.3V426H283.7V413.3Q302.9 411.6 310.1 408.4Q317.4 405.1 317.7 399.1Q318 393.1 313.3 381L289.7 320.5H176.9L152.7 382.2Q148.3 393.4 150 399.3Q151.7 405.3 160.2 408.5Q168.8 411.6 188.7 413.3V426H86.1V413.3Q99.8 411.5 106.9 409.2Q114 406.9 120.1 400.8Q126.1 394.7 131.2 381.7Z";
export const A_COUNTER = "M283 301.5 234.4 178.9 185 301.5Z";
export const A_PATH = `${A_OUTER}${A_COUNTER}`;

/** The splash zooms through the right stem at this point. */
export const A_ZOOM_POINT = { x: 294, y: 250 } as const;

/** The view box the paths and lines are drawn in. */
export const VIEW_BOX = { x: -104, y: -96, w: 720, h: 720 } as const;

export interface BrandLine {
  /** Off-screen start. */
  from: { x: number; y: number };
  /** The A vertex the line arrives at. */
  to: { x: number; y: number };
  /** Stagger after the first line, in seconds (60 ms steps, as in the splash CSS). */
  delay: number;
  /** One line in eight is UV instead of accent. */
  uv?: boolean;
}

/** The eight preloader lines, in the order they fire. Endpoints are the A's vertices. */
export const BRAND_LINES: readonly BrandLine[] = [
  { from: { x: 256, y: -1400 }, to: { x: 256, y: 102 }, delay: 0 }, // straight down to the apex
  { from: { x: -1500, y: -1100 }, to: { x: 131, y: 381 }, delay: 0.06 }, // left shoulder
  { from: { x: 1900, y: -1000 }, to: { x: 380, y: 380 }, delay: 0.12 }, // right shoulder
  { from: { x: -1700, y: 320 }, to: { x: 177, y: 320 }, delay: 0.18 }, // crossbar, left end
  { from: { x: 2200, y: 320 }, to: { x: 290, y: 320 }, delay: 0.24 }, // crossbar, right end
  { from: { x: -1300, y: 1700 }, to: { x: 86, y: 426 }, delay: 0.3 }, // left foot
  { from: { x: 1800, y: 1700 }, to: { x: 426, y: 426 }, delay: 0.36 }, // right foot
  { from: { x: 2100, y: -1600 }, to: { x: 266, y: 102 }, delay: 0.42, uv: true }, // apex, right side
];

/** Splash timing the gate's scene continues from (seconds). */
export const LINE_TIMING = { shoot: 0.75, ease: "cubic-bezier(0.55, 0, 0.2, 1)", dash: 22, gap: 100 } as const;

export const BRAND_COLORS = { ground: "#0a0a0b", fg: "#ededee", accent: "#ff3df2", uv: "#a98bff" } as const;
