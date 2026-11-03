import * as THREE from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import gsap from "gsap";
import { A_PATH, BRAND_COLORS, LINE_TIMING, VIEW_BOX } from "../../../shared/brandGeometry";
import { sceneLines, toWorld, type SceneLine } from "./space";

/**
 * Layer 2: the preloader's eight lines, continued in world space. Each is a short bright segment that flies
 * in from off-screen, passes its vertex of the A, and leaves on the far side, so something is always
 * crossing the screen edge to edge. Every so often (and on a form submit or the Google tap) a "formation"
 * beat brings all eight to their vertices at once and holds, and the A's outline comes up for that moment.
 * That is the only time the A is legible; the rest of the time the lines point at where it was.
 */
const Y = 0.08; // just above the grid
const SEG = LINE_TIMING.dash / LINE_TIMING.gap; // the dash is 22% of its path, as in the splash CSS
const CYCLE = 2.6; // seconds from entry to exit at idle
const EASE = "power2.inOut"; // close to the splash's cubic-bezier(0.55, 0, 0.2, 1)

export class Lines {
  readonly group = new THREE.Group();
  readonly a: Line2;
  private readonly lines: { def: SceneLine; mesh: Line2; geo: LineGeometry; t: { v: number } }[] = [];
  private readonly accent: LineMaterial;
  private readonly uv: LineMaterial;
  private readonly aMat: LineMaterial;
  private idle: gsap.core.Timeline | null = null;
  private beatTl: gsap.core.Timeline | null = null;
  private speed = 1;
  private readonly size = new THREE.Vector2(1, 1);

  constructor(width: number, height: number, pixelRatio: number) {
    this.size.set(width * pixelRatio, height * pixelRatio);
    const mk = (color: string, opacity: number, lw: number) =>
      new LineMaterial({ color, linewidth: lw, transparent: true, opacity, resolution: this.size, fog: true, depthWrite: false, worldUnits: false });
    this.accent = mk(BRAND_COLORS.accent, 0.95, 1.5);
    this.uv = mk(BRAND_COLORS.uv, 0.95, 1.5);
    this.aMat = mk(BRAND_COLORS.fg, 0, 1.25);

    for (const def of sceneLines()) {
      const geo = new LineGeometry();
      geo.setPositions([def.from[0], Y, def.from[1], def.from[0], Y, def.from[1]]);
      const mesh = new Line2(geo, def.uv ? this.uv : this.accent);
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.lines.push({ def, mesh, geo, t: { v: -SEG } });
    }

    this.a = makeOutline(this.aMat);
    this.group.add(this.a);
  }

  setSize(width: number, height: number, pixelRatio: number) {
    this.size.set(width * pixelRatio, height * pixelRatio);
    // LineMaterial copies the vector it's given, so each one is told again.
    for (const m of [this.accent, this.uv, this.aMat]) m.resolution.copy(this.size);
  }

  /** Typing speeds the lines up a little; the field dimming slows them. */
  setSpeed(s: number) {
    this.speed = s;
    if (this.idle) this.idle.timeScale(s);
  }

  /** The idle loop: lines fire with the splash's stagger, pause a random beat, and fire again. */
  startIdle(reduced: boolean) {
    this.stop();
    if (reduced) {
      // Parked in formation: each segment ends on its vertex and the A shows faintly.
      for (const l of this.lines) l.t.v = 1;
      this.aMat.opacity = 0.35;
      this.write();
      return;
    }
    const tl = gsap.timeline({ repeat: -1, repeatDelay: 0.6, defaults: { ease: EASE } });
    this.lines.forEach((l, i) => {
      // Entry at -SEG (fully off-screen before the start), exit when the tail is past the far edge.
      tl.fromTo(l.t, { v: -SEG }, { v: 1 + SEG + 0.6, duration: CYCLE + (i % 3) * 0.3 }, l.def.delay + Math.random() * 0.4);
    });
    tl.timeScale(this.speed);
    this.idle = tl;
    this.scheduleBeat();
  }

  private beatTimer = 0;
  private scheduleBeat() {
    window.clearTimeout(this.beatTimer);
    this.beatTimer = window.setTimeout(() => this.beat(), 12_000 + Math.random() * 8_000);
  }

  /** All eight arrive together, hold 400 ms with the A up, then fly on. Returns when the hold is over. */
  beat(): Promise<void> {
    if (this.beatTl?.isActive()) return Promise.resolve();
    window.clearTimeout(this.beatTimer);
    this.idle?.pause();
    const tl = gsap.timeline({ defaults: { ease: EASE } });
    for (const l of this.lines) {
      // Come in from wherever the segment is (or from the start if it's already past the vertex), and stop
      // with the head on the vertex: t = 1.
      const start = l.t.v > 0.6 ? -SEG : l.t.v;
      tl.fromTo(l.t, { v: start }, { v: 1, duration: 0.75 }, l.def.delay);
    }
    const arrive = 0.42 + 0.75; // the last line lands
    tl.to(this.aMat, { opacity: 0.35, duration: 0.3 }, arrive - 0.25);
    tl.to({}, { duration: 0.4 }, arrive); // the hold
    tl.to(this.aMat, { opacity: 0, duration: 0.5 }, arrive + 0.4);
    for (const l of this.lines) tl.to(l.t, { v: 1 + SEG + 0.6, duration: CYCLE * 0.8 }, arrive + 0.4);
    tl.call(() => {
      this.idle?.restart();
      this.idle?.timeScale(this.speed);
      this.scheduleBeat();
    });
    this.beatTl = tl;
    return new Promise((res) => tl.call(res, [], arrive + 0.4));
  }

  /** Writes the segments' current positions. Call once per frame. */
  write() {
    for (const l of this.lines) {
      const { def, t } = l;
      // The segment runs from t (head) back by SEG, measured in units of the from→at distance; past the
      // vertex it keeps going along the same direction toward the exit.
      const head = t.v * def.toAt;
      const tail = head - SEG * def.toAt;
      const p = (d: number) => [def.from[0] + def.dir[0] * d, Y, def.from[1] + def.dir[1] * d];
      l.geo.setPositions([...p(tail), ...p(head)]);
      l.mesh.visible = head > 0 && tail < def.toExit;
    }
  }

  stop() {
    window.clearTimeout(this.beatTimer);
    this.idle?.kill();
    this.beatTl?.kill();
    this.idle = this.beatTl = null;
  }

  dispose() {
    this.stop();
    for (const l of this.lines) l.geo.dispose();
    this.a.geometry.dispose();
    this.accent.dispose();
    this.uv.dispose();
    this.aMat.dispose();
  }
}

/** The A's outline as one polyline, sampled from the brand path. */
function makeOutline(mat: LineMaterial): Line2 {
  const svg = new SVGLoader().parse(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VIEW_BOX.x} ${VIEW_BOX.y} ${VIEW_BOX.w} ${VIEW_BOX.h}"><path d="${A_PATH}"/></svg>`);
  const pos: number[] = [];
  for (const path of svg.paths) {
    for (const sub of path.subPaths) {
      const pts = sub.getPoints(24);
      // Each contour is closed; join contours with a zero-length jump so they stay one geometry.
      const run = pts.map((p) => toWorld({ x: p.x, y: p.y }));
      if (pos.length) pos.push(...pos.slice(-3)); // repeat the last point: an invisible bridge
      for (const [x, z] of run) pos.push(x, Y + 0.01, z);
      pos.push(run[0][0], Y + 0.01, run[0][1]);
    }
  }
  const geo = new LineGeometry();
  geo.setPositions(pos);
  const line = new Line2(geo, mat);
  line.frustumCulled = false;
  return line;
}
