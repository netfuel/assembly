import type { ArtParams } from "./flyerArt";

/**
 * A CPU port of the generated-art shader (src/lib/liquidRenderer.ts), for places without WebGL: the Worker draws
 * link-preview images with it. Same fields, dither and inks, so a preview looks like the event's art in the app
 * (not pixel-identical: the GPU's sin() and float precision differ a little). Keep the two in step.
 */

const fract = (x: number) => x - Math.floor(x);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * Renders `w` x `h` art pixels as RGB bytes, top row first. `time` matches the app's still frame (7.3).
 */
export function renderArtCpu(p: ArtParams, w: number, h: number, time = 7.3): Uint8Array {
  const seed = p.seed;
  const hash = (x: number, y: number) => fract(Math.sin(x * 127.1 + y * 311.7 + seed * 13.17) * 43758.5453);
  const noise = (x: number, y: number) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    return mix(mix(hash(ix, iy), hash(ix + 1, iy), ux), mix(hash(ix, iy + 1), hash(ix + 1, iy + 1), ux), uy);
  };
  const fbm = (x: number, y: number) => {
    let v = 0;
    let a = 0.5;
    for (let i = 0; i < 4; i++) {
      v += a * noise(x, y);
      x = x * 2.03 + 17;
      y = y * 2.03 + 17;
      a *= 0.5;
    }
    return v;
  };
  const bayer2 = (x: number, y: number) => {
    x = Math.floor(x);
    y = Math.floor(y);
    return fract(x / 2 + y * y * 0.75);
  };
  const bayer4 = (x: number, y: number) => bayer2(0.5 * x, 0.5 * y) * 0.25 + bayer2(x, y);
  const bayer8 = (x: number, y: number) => bayer4(0.5 * x, 0.5 * y) * 0.25 + bayer2(x, y);
  const swirl = (x: number, y: number, cx: number, cy: number, k: number): [number, number] => {
    const dx = x - cx;
    const dy = y - cy;
    const a = k * Math.exp(-Math.hypot(dx, dy) * 1.2);
    const s = Math.sin(a);
    const c = Math.cos(a);
    return [cx + c * dx - s * dy, cy + s * dx + c * dy];
  };

  const [dx, dy] = p.dir;
  const t = time * p.speed * 10;

  const field = (x: number, y: number): number => {
    switch (p.mode) {
      case 0: {
        // marble
        const qx = fbm(x + dx * t, y + dy * t);
        const qy = fbm(x + 5.2 - dx * t * 0.7, y + 1.3 - dy * t * 0.7);
        const rx = fbm(x + p.warp * qx + 1.7 + t * 0.4, y + p.warp * qy + 9.2 + t * 0.4);
        const ry = fbm(x + p.warp * qx + 8.3 - t * 0.3, y + p.warp * qy + 2.8 - t * 0.3);
        return fbm(x + p.warp * rx, y + p.warp * ry) * 1.7 - 0.35;
      }
      case 1: {
        // lava
        let v = 0;
        for (let i = 0; i < 6; i++) {
          const cx = Math.sin(t * 1.3 * (0.5 + hash(i, 1)) + i * 2.1) * 0.9;
          const cy = Math.cos(t * 1.1 * (0.5 + hash(i, 2)) + i * 1.7) * 1.1;
          const rr = 0.18 + 0.25 * hash(i, 3);
          v += (rr * rr) / Math.max((x - cx) ** 2 + (y - cy) ** 2, 0.001);
        }
        v += (fbm(x * 2 + t, y * 2 + t) - 0.5) * 0.1 * p.warp;
        return v * 0.35;
      }
      case 2: {
        // ripples
        let v = 0;
        for (let i = 0; i < 4; i++) {
          const cx = (hash(i, 7) * 2 - 1) * 1.2;
          const cy = (hash(i, 9) * 2 - 1) * 1.2;
          const d = Math.hypot(x - cx, y - cy);
          v += Math.sin(d * (10 + p.scale * 4) - t * 20 * (0.6 + 0.4 * hash(i, 4))) / (1 + d * 2);
        }
        v += (fbm(x * 3 + t, y * 3 + t) - 0.5) * p.warp * 0.15;
        return v * 0.28 + 0.5;
      }
      case 3: {
        // vortex
        const cx = Math.sin(t * 0.7) * 0.3;
        const cy = Math.cos(t * 0.5) * 0.3;
        const [sx, sy] = swirl(x, y, cx, cy, (2.5 + p.swirl * 3) * Math.sin(t * 0.6 + 1) + 4);
        const f = fbm(sx * 2, sy * 2) * p.warp * 0.3;
        return fbm(sx * 1.3 + dx * t * 0.5 + f, sy * 1.3 + dy * t * 0.5 + f) * 1.7 - 0.35;
      }
      case 4: {
        // ink
        const qx = fbm(x * 0.8 + t * dx, y * 0.8 + t * dy);
        const qy = fbm(x * 0.8 + 3.1 - t * dx, y * 0.8 + 7.4 - t * dy);
        const s = (x + p.warp * 0.6 * qx) * dy - (y + p.warp * 0.6 * qy) * dx;
        return 0.5 + 0.5 * Math.sin(s * (5 + p.scale * 3) + t * 3);
      }
      default: {
        // plasma
        const k = 1.5 + p.scale * 0.6;
        const px = x * k;
        const py = y * k;
        let v =
          Math.sin(px * 2 + t * 3) +
          Math.sin(py * 2.3 - t * 2.4) +
          Math.sin((px + py) * 1.7 + t * 1.9) +
          Math.sin(Math.hypot(px + Math.sin(t), py + Math.cos(t * 0.8)) * 3);
        v += (fbm(x * 2, y * 2) - 0.5) * p.warp * 0.5;
        return v * 0.125 + 0.5;
      }
    }
  };

  const out = new Uint8Array(w * h * 3);
  const inks = p.inks.map((c) => c.map((v) => Math.round(clamp(v, 0, 1) * 255)));
  for (let row = 0; row < h; row++) {
    // gl_FragCoord counts rows from the bottom.
    const fy = h - 1 - row;
    for (let col = 0; col < w; col++) {
      let ux = ((col - 0.5 * w) / h) * p.scale;
      let uy = ((fy - 0.5 * h) / h) * p.scale;
      if (p.mode !== 0 && p.mode !== 3) [ux, uy] = swirl(ux, uy, 0, 0, p.swirl * Math.sin(t * 0.5));
      let tone = clamp(field(ux, uy), 0, 1);
      if (p.bands > 0) {
        const b = fract(tone * p.bands);
        tone = mix(tone, (Math.floor(tone * p.bands) + smoothstep(0.35, 0.65, b)) / p.bands, 0.8);
      }
      let th: number;
      if (p.print === 0) th = p.dither < 6 ? bayer4(col, fy) : bayer8(col, fy);
      else if (p.print === 1) th = hash(col + Math.floor(time * p.speed * 10 * 40), fy + Math.floor(time * p.speed * 10 * 40));
      else th = fy % 2 < 1 ? 0.2 + 0.1 * bayer2(col, fy) : 0.7 + 0.1 * bayer2(col, fy);
      const lvl = clamp(Math.floor(Math.min(tone, 0.999) * (p.levels - 1) + th), 0, p.levels - 1);
      const c = inks[lvl];
      const o = (row * w + col) * 3;
      out[o] = c[0];
      out[o + 1] = c[1];
      out[o + 2] = c[2];
    }
  }
  return out;
}
