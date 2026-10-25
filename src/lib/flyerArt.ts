/**
 * Generated flyer art for events without an uploaded flyer (to-do: Generated flyer art).
 *
 * Deterministic: the event id seeds both the style and every detail, so an event always looks the
 * same and no two look alike. Five styles share one system of lines, circles, and printed ink:
 *   print    noise in contour bands; still in SVG (a filter per frame is too heavy for a feed), animated on the
 *            event page by the WebGL shader (FlyerShader.tsx)
 *   rings    concentric circles and crossing rules, off-register
 *   halftone dot screen shaped by two hot spots
 *   grid     Swiss grid of solid, outlined, and hot cells
 *   waves    stacked contour lines that drift
 * Inks follow the pin colors: violet for queer-centered events, sodium for everything else, magenta as the
 * hot third ink. Output is SVG markup with no user text in it; titles go on top as HTML.
 * Elements with class "a-*" animate in CSS (app.css); GeneratedArt pauses them offscreen.
 */

export const STYLES = ["print", "rings", "halftone", "grid", "waves"] as const;
export type ArtStyle = (typeof STYLES)[number];

const INK = "#0a0a0b";
const HOT = "#ff3df2";
const PAPER = { queer: "#a98bff", other: "#ff9a3c" };
const ALT = { queer: "#4fe3a8", other: "#f4f4f5" };

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** mulberry32: small, fast, and good enough for art. */
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

export function artStyle(id: string): ArtStyle {
  return STYLES[hash(id) % STYLES.length];
}

/** Two-digit style number for the "Generated" mark, e.g. "GEN 03". */
export function artNumber(id: string): string {
  return String(STYLES.indexOf(artStyle(id)) + 1).padStart(2, "0");
}

const W = 400;
const H = 500;
const f = (n: number) => Math.round(n * 10) / 10;

export function artSvg(id: string, queer: boolean, opts: { style?: ArtStyle } = {}): string {
  const style = opts.style ?? artStyle(id);
  const r = rng(hash(`${id}:${style}`));
  const paper = queer ? PAPER.queer : PAPER.other;
  const alt = queer ? ALT.queer : ALT.other;
  const body = BUILDERS[style]({ r, paper, alt, seed: hash(id) % 997 });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" class="gen-svg gen-${style}">${body}</svg>`;
}

type Ctx = { r: () => number; paper: string; alt: string; seed: number };

const BUILDERS: Record<ArtStyle, (c: Ctx) => string> = {
  // Contour bands from turbulence, posterized to two inks plus a hot ridge. Static stand-in for the shader.
  print: ({ r, paper, seed }) => {
    const freq = 0.006 + r() * 0.006;
    const id = `p${seed}`;
    // Discrete tables map luminance bands to ink / paper / hot per channel.
    const ch = (hexIdx: number) => {
      const c = [INK, paper, INK, paper, HOT, paper].map((h) => parseInt(h.slice(1 + hexIdx * 2, 3 + hexIdx * 2), 16) / 255);
      return c.map((v) => v.toFixed(3)).join(" ");
    };
    return `<defs><filter id="${id}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
<feTurbulence type="fractalNoise" baseFrequency="${freq.toFixed(4)}" numOctaves="4" seed="${seed}" result="n"/>
<feColorMatrix in="n" type="matrix" values="0.33 0.33 0.33 0 0  0.33 0.33 0.33 0 0  0.33 0.33 0.33 0 0  0 0 0 0 1"/>
<feComponentTransfer><feFuncR type="discrete" tableValues="${ch(0)}"/><feFuncG type="discrete" tableValues="${ch(1)}"/><feFuncB type="discrete" tableValues="${ch(2)}"/></feComponentTransfer>
</filter></defs><rect width="${W}" height="${H}" fill="${INK}"/><rect x="0" y="0" width="${W}" height="${H}" filter="url(#${id})"/>`;
  },

  rings: ({ r, paper, alt }) => {
    const cx = f(80 + r() * 240);
    const cy = f(120 + r() * 220);
    const n = 6 + Math.floor(r() * 5);
    let s = `<rect width="${W}" height="${H}" fill="${INK}"/>`;
    s += `<g class="a-spin" style="transform-origin:${cx}px ${cy}px">`;
    for (let i = 1; i <= n; i++) {
      const rad = f(i * (28 + r() * 10));
      const dash = r() < 0.4 ? ` stroke-dasharray="${f(4 + r() * 30)} ${f(4 + r() * 18)}"` : "";
      s += `<circle cx="${cx}" cy="${cy}" r="${rad}" fill="none" stroke="${paper}" stroke-width="${f(1 + r() * (i === n ? 10 : 3))}"${dash}/>`;
    }
    s += `</g>`;
    // Off-register hot ring and crossing rules.
    s += `<circle class="a-pulse" cx="${f(cx + 10)}" cy="${f(cy - 8)}" r="${f(40 + r() * 70)}" fill="none" stroke="${HOT}" stroke-width="3" style="transform-origin:${cx}px ${cy}px"/>`;
    for (let i = 0; i < 3; i++) {
      const a = r() * Math.PI;
      const dx = Math.cos(a) * 700;
      const dy = Math.sin(a) * 700;
      s += `<line x1="${f(cx - dx)}" y1="${f(cy - dy)}" x2="${f(cx + dx)}" y2="${f(cy + dy)}" stroke="${i === 0 ? alt : paper}" stroke-width="1"/>`;
    }
    s += `<circle cx="${cx}" cy="${cy}" r="6" fill="${HOT}"/>`;
    return s;
  },

  halftone: ({ r, paper }) => {
    const step = 20;
    const p1 = [r() * W, r() * H];
    const p2 = [r() * W, r() * H];
    const hotRow = Math.floor(r() * (H / step));
    let s = `<rect width="${W}" height="${H}" fill="${paper}"/><g class="a-drift-slow">`;
    for (let y = -step; y < H + step; y += step) {
      for (let x = -step; x < W + step; x += step) {
        const d1 = Math.hypot(x - p1[0], y - p1[1]);
        const d2 = Math.hypot(x - p2[0], y - p2[1]);
        const v = Math.max(0, 1 - Math.min(d1, d2 * 1.3) / 260);
        const rad = f(1.2 + v * (step / 2 + 1));
        const hot = Math.floor(y / step) === hotRow;
        s += `<circle cx="${x + step / 2}" cy="${y + step / 2}" r="${rad}" fill="${hot ? HOT : INK}"/>`;
      }
    }
    return s + `</g>`;
  },

  grid: ({ r, paper, alt }) => {
    const cols = 5;
    const rows = 6 + Math.floor(r() * 3);
    const cw = W / cols;
    const rh = H / rows;
    let s = `<rect width="${W}" height="${H}" fill="${INK}"/>`;
    const hotCell = Math.floor(r() * cols * rows);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const k = r();
        const i = y * cols + x;
        const gx = f(x * cw + 3);
        const gy = f(y * rh + 3);
        const w = f(cw - 6);
        const h = f(rh - 6);
        if (i === hotCell) s += `<rect class="a-blink" x="${gx}" y="${gy}" width="${w}" height="${h}" fill="${HOT}"/>`;
        else if (k < 0.32) s += `<rect x="${gx}" y="${gy}" width="${w}" height="${h}" fill="${paper}"/>`;
        else if (k < 0.55) s += `<rect x="${gx}" y="${gy}" width="${w}" height="${h}" fill="none" stroke="${paper}" stroke-width="1.5"/>`;
        else if (k < 0.7) s += `<circle cx="${f(gx + w / 2)}" cy="${f(gy + h / 2)}" r="${f(Math.min(w, h) / 2.6)}" fill="none" stroke="${alt}" stroke-width="1.5"/>`;
      }
    }
    // A bar that slides across one row.
    const row = Math.floor(r() * rows);
    s += `<rect class="a-slide" x="0" y="${f(row * rh + rh / 2 - 2)}" width="${f(cw * 1.4)}" height="4" fill="${HOT}"/>`;
    return s;
  },

  waves: ({ r, paper, alt }) => {
    const lines = 16 + Math.floor(r() * 8);
    const amp = 10 + r() * 26;
    // A whole number of periods across the width, so the drift by one width loops without a seam.
    const freq = (1 + Math.floor(r() * 4)) * ((Math.PI * 2) / W);
    const hot = Math.floor(r() * lines);
    let s = `<rect width="${W}" height="${H}" fill="${INK}"/><g class="a-wave">`;
    for (let i = 0; i < lines; i++) {
      const y0 = (H / (lines + 1)) * (i + 1);
      const ph = i * (0.35 + r() * 0.2);
      const a = amp * (0.4 + Math.sin(i / 3) * 0.6);
      let d = "";
      // Two periods wide so the drift can loop seamlessly.
      for (let x = 0; x <= W * 2; x += 10) d += `${x === 0 ? "M" : "L"}${x} ${f(y0 + Math.sin(x * freq + ph) * a)}`;
      const color = i === hot ? HOT : i % 5 === 0 ? alt : paper;
      s += `<path d="${d}" fill="none" stroke="${color}" stroke-width="${i === hot ? 3 : 1.4}"/>`;
    }
    return s + `</g>`;
  },
};

/** Static SVG as a data URL, for canvas (story card). */
export function artDataUrl(id: string, queer: boolean): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(artSvg(id, queer))}`;
}
