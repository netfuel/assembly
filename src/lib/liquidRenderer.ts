import type { ArtParams } from "./flyerArt";

/**
 * Draws generated flyer art (lib/flyerArt.ts) with one shared WebGL context for the whole page: browsers allow
 * only ~16 contexts, and a feed has more cards than that. Each card owns a small 2D canvas at "art pixel"
 * resolution (CSS scales it up with crisp edges); the shared context renders into a corner of its buffer and the
 * result is copied to the card. One loop animates the visible cards, capped and throttled, and stops when the tab
 * is hidden. Without WebGL, cards keep their CSS fallback.
 */

const MAX = 512; // largest art size in art pixels, per side
const FPS = 30;
const MAX_ANIMATED = 6;

const VERT = `attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uTime, uSeed, uScale, uWarp, uSwirl, uBands, uLevels, uMode, uPrint, uDither;
uniform vec2 uDir;
uniform vec3 uC0, uC1, uC2, uC3;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7)) + uSeed * 13.17) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + 17.0; a *= 0.5; }
  return v;
}
float bayer2(vec2 a) { a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
float bayer8(vec2 a) { return bayer4(0.5 * a) * 0.25 + bayer2(a); }
vec2 swirl(vec2 p, vec2 c, float k) {
  vec2 d = p - c;
  float a = k * exp(-length(d) * 1.2);
  float s = sin(a), co = cos(a);
  return c + vec2(co * d.x - s * d.y, s * d.x + co * d.y);
}

float field(vec2 uv, float t) {
  if (uMode < 0.5) {
    // marble: noise warped through itself
    vec2 q = vec2(fbm(uv + uDir * t), fbm(uv + vec2(5.2, 1.3) - uDir * t * 0.7));
    vec2 r = vec2(fbm(uv + uWarp * q + vec2(1.7, 9.2) + t * 0.4), fbm(uv + uWarp * q + vec2(8.3, 2.8) - t * 0.3));
    return fbm(uv + uWarp * r) * 1.7 - 0.35;
  } else if (uMode < 1.5) {
    // lava: drifting metaballs with a wobble
    float v = 0.0;
    for (int i = 0; i < 6; i++) {
      float fi = float(i);
      vec2 c = vec2(sin(t * 1.3 * (0.5 + hash(vec2(fi, 1.0))) + fi * 2.1), cos(t * 1.1 * (0.5 + hash(vec2(fi, 2.0))) + fi * 1.7)) * vec2(0.9, 1.1);
      float rr = 0.18 + 0.25 * hash(vec2(fi, 3.0));
      v += rr * rr / max(dot(uv - c, uv - c), 0.001);
    }
    v += (fbm(uv * 2.0 + t) - 0.5) * 0.1 * uWarp;
    return v * 0.35;
  } else if (uMode < 2.5) {
    // ripples: drops on water, rings interfering
    float v = 0.0;
    for (int i = 0; i < 4; i++) {
      float fi = float(i);
      vec2 c = vec2(hash(vec2(fi, 7.0)) * 2.0 - 1.0, hash(vec2(fi, 9.0)) * 2.0 - 1.0) * 1.2;
      float d = length(uv - c);
      v += sin(d * (10.0 + uScale * 4.0) - t * 20.0 * (0.6 + 0.4 * hash(vec2(fi, 4.0)))) / (1.0 + d * 2.0);
    }
    v += (fbm(uv * 3.0 + t) - 0.5) * uWarp * 0.15;
    return v * 0.28 + 0.5;
  } else if (uMode < 3.5) {
    // vortex: a whirlpool that breathes
    vec2 c = vec2(sin(t * 0.7), cos(t * 0.5)) * 0.3;
    vec2 p = swirl(uv, c, (2.5 + uSwirl * 3.0) * sin(t * 0.6 + 1.0) + 4.0);
    return fbm(p * 1.3 + uDir * t * 0.5 + fbm(p * 2.0) * uWarp * 0.3) * 1.7 - 0.35;
  } else if (uMode < 4.5) {
    // ink: marbled stripes, combed through
    vec2 q = vec2(fbm(uv * 0.8 + t * uDir), fbm(uv * 0.8 + vec2(3.1, 7.4) - t * uDir));
    float s = dot(uv + uWarp * 0.6 * q, vec2(uDir.y, -uDir.x));
    return 0.5 + 0.5 * sin(s * (5.0 + uScale * 3.0) + t * 3.0);
  }
  // plasma: interfering waves
  vec2 p = uv * (1.5 + uScale * 0.6);
  float v = sin(p.x * 2.0 + t * 3.0) + sin(p.y * 2.3 - t * 2.4) + sin((p.x + p.y) * 1.7 + t * 1.9)
          + sin(length(p + vec2(sin(t), cos(t * 0.8))) * 3.0);
  v += (fbm(uv * 2.0) - 0.5) * uWarp * 0.5;
  return v * 0.125 + 0.5;
}

void main() {
  vec2 px = floor(gl_FragCoord.xy);
  vec2 uv = (px - 0.5 * uRes) / uRes.y * uScale;
  float t = uTime;
  // A light swirl on the modes that don't already swirl (all but marble and vortex).
  if (uMode > 0.5 && (uMode < 2.5 || uMode > 3.5)) uv = swirl(uv, vec2(0.0), uSwirl * sin(t * 0.5));
  float tone = clamp(field(uv, t), 0.0, 1.0);
  if (uBands > 0.5) {
    float b = fract(tone * uBands);
    tone = mix(tone, (floor(tone * uBands) + smoothstep(0.35, 0.65, b)) / uBands, 0.8);
  }
  float th;
  if (uPrint < 0.5) th = uDither < 6.0 ? bayer4(px) : bayer8(px);
  else if (uPrint < 1.5) th = hash(px + floor(uTime * 40.0));
  else th = mod(px.y, 2.0) < 1.0 ? 0.2 + 0.1 * bayer2(px) : 0.7 + 0.1 * bayer2(px);
  float lvl = clamp(floor(min(tone, 0.999) * (uLevels - 1.0) + th), 0.0, uLevels - 1.0);
  vec3 col = lvl < 0.5 ? uC0 : lvl < 1.5 ? uC1 : lvl < 2.5 ? uC2 : uC3;
  gl_FragColor = vec4(col, 1.0);
}`;

type Gl = {
  canvas: HTMLCanvasElement;
  gl: WebGLRenderingContext;
  u: Record<string, WebGLUniformLocation | null>;
};

let shared: Gl | null | undefined;

function setup(): Gl | null {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = MAX;
    const gl = canvas.getContext("webgl", { antialias: false, alpha: false, preserveDrawingBuffer: false, powerPreference: "low-power" });
    if (!gl) return null;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? "link");
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const names = ["uRes", "uTime", "uSeed", "uScale", "uWarp", "uSwirl", "uBands", "uLevels", "uMode", "uPrint", "uDither", "uDir", "uC0", "uC1", "uC2", "uC3"];
    const u = Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(prog, n)]));
    canvas.addEventListener("webglcontextlost", () => {
      shared = undefined; // rebuilt on the next draw
      for (const it of items) it.drawn = false;
    });
    return { canvas, gl, u };
  } catch {
    return null;
  }
}

function context(): Gl | null {
  if (shared === undefined) shared = setup();
  return shared;
}

/** Draw one frame of an event's art into a 2D canvas (sized in art pixels). Returns false without WebGL. */
export function drawArt(p: ArtParams, target: HTMLCanvasElement, time: number): boolean {
  const g = context();
  if (!g) return false;
  const w = Math.min(MAX, Math.max(1, target.width));
  const h = Math.min(MAX, Math.max(1, target.height));
  const { gl, u } = g;
  gl.viewport(0, 0, w, h);
  gl.uniform2f(u.uRes, w, h);
  gl.uniform1f(u.uTime, time * p.speed * 10);
  gl.uniform1f(u.uSeed, p.seed);
  gl.uniform1f(u.uScale, p.scale);
  gl.uniform1f(u.uWarp, p.warp);
  gl.uniform1f(u.uSwirl, p.swirl);
  gl.uniform1f(u.uBands, p.bands);
  gl.uniform1f(u.uLevels, p.levels);
  gl.uniform1f(u.uMode, p.mode);
  gl.uniform1f(u.uPrint, p.print);
  gl.uniform1f(u.uDither, p.dither);
  gl.uniform2f(u.uDir, p.dir[0], p.dir[1]);
  gl.uniform3fv(u.uC0, p.inks[0]);
  gl.uniform3fv(u.uC1, p.inks[1]);
  gl.uniform3fv(u.uC2, p.inks[2]);
  gl.uniform3fv(u.uC3, p.inks[3]);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  const ctx = target.getContext("2d");
  if (!ctx) return false;
  // WebGL's origin is bottom-left: the frame sits at the bottom of the shared buffer.
  ctx.drawImage(g.canvas, 0, MAX - h, w, h, 0, 0, target.width, target.height);
  return true;
}

/** A still frame as a canvas at art-pixel size, for the story card. Null without WebGL. */
export function renderStill(p: ArtParams, cssW: number, cssH: number): HTMLCanvasElement | null {
  const c = document.createElement("canvas");
  const k = Math.max(p.pixel, Math.ceil(Math.max(cssW, cssH) / MAX));
  c.width = Math.ceil(cssW / k);
  c.height = Math.ceil(cssH / k);
  return drawArt(p, c, 7.3) ? c : null;
}

type Item = { canvas: HTMLCanvasElement; params: ArtParams; visible: boolean; still: boolean; drawn: boolean; order: number };
const items = new Set<Item>();
let raf = 0;
let last = 0;
let counter = 0;
const t0 = performance.now();

function frame(now: number) {
  raf = items.size ? requestAnimationFrame(frame) : 0;
  if (document.visibilityState !== "visible" || now - last < 1000 / FPS) return;
  last = now;
  const t = (now - t0) / 1000;
  let animated = 0;
  // Oldest visible first, so cards already on screen keep moving as new ones scroll in.
  for (const it of [...items].sort((a, b) => a.order - b.order)) {
    if (!it.visible) continue;
    if (!it.still && animated < MAX_ANIMATED) {
      animated++;
      if (!drawArt(it.params, it.canvas, t)) return;
      it.drawn = true;
    } else if (!it.drawn) {
      it.drawn = drawArt(it.params, it.canvas, t);
    }
  }
}

/** Keep a card's canvas drawn while it's visible; animated unless `still`. */
export function registerArt(canvas: HTMLCanvasElement, params: ArtParams, still: boolean) {
  const it: Item = { canvas, params, visible: false, still, drawn: false, order: counter++ };
  items.add(it);
  if (!raf) raf = requestAnimationFrame(frame);
  return {
    supported: () => context() !== null,
    setVisible(v: boolean) {
      it.visible = v;
      if (v) it.order = counter++;
    },
    resized() {
      it.drawn = false;
    },
    dispose() {
      items.delete(it);
    },
  };
}
