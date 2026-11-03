import { A_ZOOM_POINT, BRAND_LINES, VIEW_BOX, type BrandLine } from "../../../shared/brandGeometry";

/**
 * The scene lies on the ground plane (x, z). The splash's 720-unit view box maps onto it so the A, the lines
 * and the grid agree: 100 view-box units are one world unit, the A's centre is the origin, and the view box's
 * y runs along world z (away from the camera is negative z, like a map seen from the south).
 */
export const UNIT = 1 / 45; // the A spans ~7.5 world units: wider than the form's panel, so the panel sits between its stems
const CX = VIEW_BOX.x + VIEW_BOX.w / 2; // 256
const CZ = VIEW_BOX.y + VIEW_BOX.h / 2; // 264

export const toWorld = (p: { x: number; y: number }): [number, number] => [(p.x - CX) * UNIT, (p.y - CZ) * UNIT];

export const ZOOM_POINT = toWorld(A_ZOOM_POINT);

export interface SceneLine {
  from: [number, number];
  /** The A vertex. */
  at: [number, number];
  /** Where the line leaves on the far side, continuing in a straight line past the vertex. */
  exit: [number, number];
  /** Unit direction from `from` toward `at`. */
  dir: [number, number];
  /** Distance from `from` to `at` and from `from` to `exit`. */
  toAt: number;
  toExit: number;
  delay: number;
  uv: boolean;
}

/** The eight lines in world space, each extended past its vertex so it crosses the screen edge to edge. */
export function sceneLines(): SceneLine[] {
  return BRAND_LINES.map((l: BrandLine) => {
    const from = toWorld(l.from);
    const at = toWorld(l.to);
    const dx = at[0] - from[0];
    const dz = at[1] - from[1];
    const toAt = Math.hypot(dx, dz);
    const dir: [number, number] = [dx / toAt, dz / toAt];
    const toExit = toAt * 2.1; // past the vertex by as far as it came
    return { from, at, exit: [from[0] + dir[0] * toExit, from[1] + dir[1] * toExit], dir, toAt, toExit, delay: l.delay, uv: !!l.uv };
  });
}
