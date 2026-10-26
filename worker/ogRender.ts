// Link-preview images (1200 x 630), in the splash's look: the serif A drawn as a hairline with a magenta echo
// printed off register and speed lines landing on its corners. Pure rendering: no bindings, so tests and local
// scripts can call it with fonts and wasm from disk. worker/ogImage.ts serves and caches the results.
import "./ogPolyfill";
import satori, { init as initSatori, type Font } from "satori/standalone";
import { initWasm as initResvg, Resvg } from "@resvg/resvg-wasm";
import decodeWebp, { init as initWebp } from "@jsquash/webp/decode.js";
import { artParams } from "../shared/flyerArt";
import { renderArtCpu } from "../shared/liquidCpu";
import { base64, encodePng, upscale } from "./png";

export const OG_W = 1200;
export const OG_H = 630;

const C = {
  ground: "#0a0a0b",
  surface: "#121215",
  line: "#34343a",
  fg: "#ededee",
  muted: "#8e8e96",
  accent: "#ff3df2",
  uv: "#a98bff",
};

export type OgWasm = { yoga: WebAssembly.Module; resvg: WebAssembly.Module; webp: WebAssembly.Module };
export type OgFonts = { serifLight: ArrayBuffer; groteskRegular: ArrayBuffer; groteskMedium: ArrayBuffer };

let ready: Promise<void> | null = null;
// On globalThis, so it outlives a module reload in dev (the wasm libraries keep their own state either way).
const done: { satori: boolean; resvg: boolean; webp: boolean } = ((globalThis as { __ogInit?: typeof done }).__ogInit ??= {
  satori: false,
  resvg: false,
  webp: false,
});
function setup(wasm: OgWasm) {
  ready ??= (async () => {
    // Each library can be initialized once per isolate; a retry after a failure skips the ones that worked.
    if (!done.satori) await initSatori(wasm.yoga).then(() => (done.satori = true));
    if (!done.resvg) {
      await initResvg(wasm.resvg).catch((err: unknown) => {
        // A dev reload can leave resvg initialized while this module's flags start over.
        if (!String(err).includes("Already initialized")) throw err;
      });
      done.resvg = true;
    }
    // jsquash takes a compiled module as its first argument, though its types only list the options.
    if (!done.webp) await (initWebp as (m: WebAssembly.Module) => Promise<void>)(wasm.webp).then(() => (done.webp = true));
  })().catch((err) => {
    ready = null;
    throw err;
  });
  return ready;
}

// ---------------------------------------------------------------------------------------------------------------
// The A, as in index.html: outer contour and counter in a 512-unit box, and where the speed lines land.
const A_OUTER =
  "M131.2 381.7 246.6 102H266.3L379.5 380Q385 393.4 390.8 399.8Q396.6 406.3 403.9 408.8Q411.3 411.4 425.9 413.3V426H283.7V413.3Q302.9 411.6 310.1 408.4Q317.4 405.1 317.7 399.1Q318 393.1 313.3 381L289.7 320.5H176.9L152.7 382.2Q148.3 393.4 150 399.3Q151.7 405.3 160.2 408.5Q168.8 411.6 188.7 413.3V426H86.1V413.3Q99.8 411.5 106.9 409.2Q114 406.9 120.1 400.8Q126.1 394.7 131.2 381.7Z";
const A_COUNTER = "M283 301.5 234.4 178.9 185 301.5Z";
const A_LINES: [number, number, number, number][] = [
  [256, -1400, 256, 102],
  [-1500, -1100, 131, 381],
  [1900, -1000, 380, 380],
  [-1700, 320, 177, 320],
  [2200, 320, 290, 320],
  [-1300, 1700, 86, 426],
  [1800, 1700, 426, 426],
  [2100, -1600, 266, 102],
];

/** SVG for the mark: echo, outline, and streaks. `x, y` places A unit (0, 0); `s` is pixels per unit. */
function aMarkSvg(x: number, y: number, s: number, o: { line: number; outline: string; echo: string; streak?: number; id: string }) {
  const sw = o.line / s;
  let streaks = "";
  if (o.streak) {
    streaks = A_LINES.map(([x1, y1, x2, y2], i) => {
      const len = Math.hypot(x2 - x1, y2 - y1);
      const t = 1 - (o.streak! * (0.7 + ((i * 37) % 10) / 20)) / len;
      const sx = x1 + (x2 - x1) * t;
      const sy = y1 + (y2 - y1) * t;
      const col = i === A_LINES.length - 1 ? C.uv : C.accent;
      return `<linearGradient id="${o.id}g${i}" gradientUnits="userSpaceOnUse" x1="${sx}" y1="${sy}" x2="${x2}" y2="${y2}"><stop offset="0" stop-color="${col}" stop-opacity="0"/><stop offset="1" stop-color="${col}"/></linearGradient><line x1="${sx}" y1="${sy}" x2="${x2}" y2="${y2}" stroke="url(#${o.id}g${i})" stroke-width="${sw}"/>`;
    }).join("");
  }
  return `<g transform="translate(${x} ${y}) scale(${s})" fill="none" stroke-width="${sw}">${streaks}<g transform="translate(14 12)" stroke="${o.echo}"><path d="${A_OUTER}"/><path d="${A_COUNTER}"/></g><g stroke="${o.outline}"><path d="${A_OUTER}"/><path d="${A_COUNTER}"/></g></g>`;
}

const svgUrl = (svg: string) => `data:image/svg+xml;base64,${base64(new TextEncoder().encode(svg))}`;

// ---------------------------------------------------------------------------------------------------------------
// A tiny element builder, so the Worker needs no JSX.
type Node = { type: string; props: Record<string, unknown> };
function el(type: string, style: Record<string, unknown>, children?: unknown, props: Record<string, unknown> = {}): Node {
  return { type, props: { style, children, ...props } };
}

const TRACK = (px: number, em: number) => `${(px * em).toFixed(1)}px`;

/** "ASSEMBLY · MEMPHIS" with the magenta dot, as on the splash. */
function caption(city: string, px: number) {
  const base = { fontFamily: "Grotesk", fontWeight: 500, fontSize: px, letterSpacing: TRACK(px, 0.24), color: C.fg };
  return el("div", { display: "flex", ...base }, [
    el("span", {}, "ASSEMBLY"),
    el("span", { color: C.accent, margin: `0 ${px * 0.6}px` }, "·"),
    el("span", {}, city.toUpperCase()),
  ]);
}

/** Parts joined with magenta dots: "SAT OCT 31 · 10 PM–3 AM". */
function dotted(parts: string[], px: number, color = C.fg) {
  const kids: Node[] = [];
  parts.forEach((p, i) => {
    if (i) kids.push(el("span", { color: C.accent, margin: `0 ${px * 0.55}px` }, "·"));
    kids.push(el("span", {}, p));
  });
  return el("div", { display: "flex", flexWrap: "wrap", fontFamily: "Grotesk", fontWeight: 500, fontSize: px, letterSpacing: TRACK(px, 0.16), color }, kids);
}

async function render(tree: Node, fonts: OgFonts): Promise<Uint8Array> {
  const fontList: Font[] = [
    { name: "Serif", data: fonts.serifLight, weight: 300, style: "normal" },
    { name: "Grotesk", data: fonts.groteskRegular, weight: 400, style: "normal" },
    { name: "Grotesk", data: fonts.groteskMedium, weight: 500, style: "normal" },
  ];
  // satori's types want a React node; the plain object is what React would produce.
  const svg = await satori(tree as unknown as Parameters<typeof satori>[0], { width: OG_W, height: OG_H, fonts: fontList });
  return new Resvg(svg, { fitTo: { mode: "width", value: OG_W } }).render().asPng();
}

function backdrop(extra = "") {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_W}" height="${OG_H}" viewBox="0 0 ${OG_W} ${OG_H}">
<defs><radialGradient id="glow" cx="0.82" cy="0.95" r="0.75"><stop offset="0" stop-color="${C.accent}" stop-opacity="0.2"/><stop offset="0.5" stop-color="${C.uv}" stop-opacity="0.07"/><stop offset="1" stop-color="${C.ground}" stop-opacity="0"/></radialGradient></defs>
<rect width="${OG_W}" height="${OG_H}" fill="${C.ground}"/><rect width="${OG_W}" height="${OG_H}" fill="url(#glow)"/>${extra}</svg>`;
}

// ---------------------------------------------------------------------------------------------------------------

export type OgEvent = {
  id: string;
  title: string;
  /** Already formatted in the city's timezone. */
  day: string;
  time: string;
  place: string | null;
  doorPrice: string | null;
  cancelled: boolean;
  city: string;
  /** Uploaded flyer bytes and type, or null for the generated art. */
  flyer: { bytes: ArrayBuffer; type: string } | null;
};

/** The flyer as something resvg can draw (PNG or JPEG), and its size. WebP is decoded and re-encoded as PNG. */
async function flyerImage(f: { bytes: ArrayBuffer; type: string }): Promise<{ url: string; w: number; h: number } | null> {
  const b = new Uint8Array(f.bytes);
  const isPng = b[0] === 0x89 && b[1] === 0x50;
  const isJpeg = b[0] === 0xff && b[1] === 0xd8;
  const isWebp = b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50;
  if (isWebp) {
    const img = await decodeWebp(f.bytes);
    const png = await encodePng(new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.byteLength), img.width, img.height, 4);
    return { url: `data:image/png;base64,${base64(png)}`, w: img.width, h: img.height };
  }
  if (isPng) {
    const v = new DataView(f.bytes);
    return { url: `data:image/png;base64,${base64(b)}`, w: v.getUint32(16), h: v.getUint32(20) };
  }
  if (isJpeg) {
    // Walk the markers to the frame header for the size.
    let i = 2;
    while (i < b.length - 9) {
      if (b[i] !== 0xff) return null;
      const m = b[i + 1];
      const len = (b[i + 2] << 8) | b[i + 3];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        const h = (b[i + 5] << 8) | b[i + 6];
        const w = (b[i + 7] << 8) | b[i + 8];
        return { url: `data:image/jpeg;base64,${base64(b)}`, w, h };
      }
      i += 2 + len;
    }
  }
  return null;
}

/** The event's generated art at `w` x `h` CSS pixels, with art pixels a bit chunkier than in the app. */
async function generatedArt(id: string, w: number, h: number) {
  const p = artParams(id);
  const k = Math.round(p.pixel * 1.5);
  const aw = Math.ceil(w / k);
  const ah = Math.ceil(h / k);
  const big = upscale(renderArtCpu(p, aw, ah), aw, ah, k);
  const png = await encodePng(big, aw * k, ah * k, 3);
  return { url: `data:image/png;base64,${base64(png)}`, number: p.number };
}

export async function renderEventOg(e: OgEvent, wasm: OgWasm, fonts: OgFonts): Promise<Uint8Array> {
  await setup(wasm);
  const M = 56; // margin
  const boxH = OG_H - M * 2;
  const flyer = e.flyer ? await flyerImage(e.flyer).catch(() => null) : null;
  // The box takes the flyer's shape within reason, so it isn't cropped hard or letterboxed.
  const aspect = flyer ? Math.min(1.1, Math.max(0.62, flyer.w / flyer.h)) : 0.78;
  const boxW = Math.round(boxH * aspect);
  let gen: { url: string; number: string } | null = null;
  if (!flyer) gen = await generatedArt(e.id, boxW, boxH);

  const colX = M + boxW + 14 + 56;
  const colW = OG_W - colX - M;
  // Big A behind the text column, bleeding off the bottom.
  const s = 1.5;
  const decor = aMarkSvg(colX + colW * 0.62 - 256 * s, 210 - 102 * s, s, {
    line: 1.6,
    outline: "rgba(237,237,238,0.13)",
    echo: "rgba(255,61,242,0.36)",
    streak: 230,
    id: "big",
  });
  // The flyer's printed echo, under the image.
  const echo = `<rect x="${M + 12}" y="${M + 10}" width="${boxW}" height="${boxH}" fill="none" stroke="${e.cancelled ? C.line : C.accent}" stroke-width="2"/>`;
  const mark = aMarkSvg(colX - 86 * 0.075, M - 4 - 102 * 0.075, 0.075, { line: 1.5, outline: C.fg, echo: C.accent, id: "mk" });

  // Title size from a rough measure: up to three lines in the column.
  const chars = e.title.length;
  const size = [74, 64, 54, 46].find((px) => (chars * px * 0.44) / colW <= 3) ?? 46;

  const parts = [e.cancelled ? "CANCELLED" : e.day.toUpperCase(), e.time.toUpperCase()];

  const tree = el("div", { display: "flex", width: OG_W, height: OG_H, position: "relative", backgroundColor: C.ground }, [
    el("img", { position: "absolute", left: 0, top: 0, width: OG_W, height: OG_H }, undefined, { src: svgUrl(backdrop(decor + echo + mark)), width: OG_W, height: OG_H }),
    // Flyer box.
    el(
      "div",
      { position: "absolute", left: M, top: M, width: boxW, height: boxH, display: "flex", backgroundColor: C.surface, overflow: "hidden" },
      flyer
        ? el("img", { width: boxW, height: boxH, objectFit: "cover" }, undefined, { src: flyer.url, width: boxW, height: boxH })
        : gen
          ? [
              el("img", { width: boxW, height: boxH }, undefined, { src: gen.url, width: boxW, height: boxH }),
              el(
                "div",
                { position: "absolute", left: 16, top: 14, fontFamily: "Grotesk", fontWeight: 500, fontSize: 14, letterSpacing: TRACK(14, 0.16), color: "rgba(237,237,238,0.75)", backgroundColor: "rgba(10,10,11,0.55)", padding: "4px 8px" },
                `GEN ${gen.number}`,
              ),
            ]
          : undefined,
    ),
    e.cancelled ? el("div", { position: "absolute", left: M, top: M, width: boxW, height: boxH, backgroundColor: "rgba(10,10,11,0.55)" }) : null,
    el("div", { position: "absolute", left: M, top: M, width: boxW, height: boxH, border: `2px solid ${e.cancelled ? C.muted : C.fg}` }),
    // Text column.
    el("div", { position: "absolute", left: colX, top: M, width: colW, height: boxH, display: "flex", flexDirection: "column" }, [
      el("div", { display: "flex", paddingLeft: 44, height: 30, alignItems: "center" }, caption(e.city, 16)),
      el("div", { display: "flex", flexDirection: "column", flexGrow: 1, justifyContent: "center" }, [
        el("div", { display: "flex", marginBottom: 22 }, dotted(parts, 19, e.cancelled ? C.muted : C.fg)),
        el(
          "div",
          { display: "block", fontFamily: "Serif", fontWeight: 300, fontSize: size, lineHeight: 1.02, letterSpacing: TRACK(size, -0.015), color: C.fg, lineClamp: 3 },
          e.title,
        ),
        e.place
          ? el("div", { display: "block", marginTop: 22, fontFamily: "Grotesk", fontWeight: 400, fontSize: 24, color: C.muted, lineClamp: 1 }, e.place)
          : null,
        e.doorPrice && !e.cancelled
          ? el("div", { display: "block", marginTop: 12, fontFamily: "Grotesk", fontWeight: 500, fontSize: 17, letterSpacing: TRACK(17, 0.16), color: C.accent, lineClamp: 1 }, e.doorPrice.toUpperCase())
          : null,
      ]),
      el("div", { display: "flex", alignItems: "baseline", justifyContent: "space-between" }, [
        el("div", { display: "flex", fontFamily: "Serif", fontWeight: 300, fontSize: 30, color: C.fg }, e.cancelled ? "This night is off." : "RSVP on Assembly"),
        el("div", { display: "flex", fontFamily: "Grotesk", fontWeight: 500, fontSize: 15, letterSpacing: TRACK(15, 0.24), color: C.muted }, "ASSEMBLY.RSVP"),
      ]),
    ]),
  ]);
  return render(tree, fonts);
}

/** The site-wide preview: the splash A, big, with the name and the line from the home page. Drawn once into
 * public/icons/og.png (static, so it never depends on R2); run it again if the design changes. */
export async function renderSiteOg(wasm: OgWasm, fonts: OgFonts, city = "Memphis"): Promise<Uint8Array> {
  await setup(wasm);
  const s = 1.32;
  const ax = 300 - 256 * s;
  const ay = 315 - 264 * s;
  const decor = aMarkSvg(ax, ay, s, { line: 2.2, outline: C.fg, echo: C.accent, streak: 300, id: "big" });
  const tree = el("div", { display: "flex", width: OG_W, height: OG_H, position: "relative", backgroundColor: C.ground }, [
    el("img", { position: "absolute", left: 0, top: 0, width: OG_W, height: OG_H }, undefined, { src: svgUrl(backdrop(decor)), width: OG_W, height: OG_H }),
    el("div", { position: "absolute", left: 610, top: 0, width: 534, height: OG_H, display: "flex", flexDirection: "column", justifyContent: "center" }, [
      el("div", { display: "flex", marginBottom: 28 }, caption(city, 17)),
      el("div", { display: "flex", fontFamily: "Serif", fontWeight: 300, fontSize: 112, lineHeight: 1, letterSpacing: TRACK(112, -0.02), color: C.fg }, "Assembly"),
      el(
        "div",
        { display: "block", marginTop: 26, fontFamily: "Grotesk", fontWeight: 400, fontSize: 28, lineHeight: 1.3, color: C.muted, width: 470 },
        "Underground music, DIY shows, raves, and queer nights on one live map.",
      ),
      el("div", { display: "flex", marginTop: 40, fontFamily: "Grotesk", fontWeight: 500, fontSize: 16, letterSpacing: TRACK(16, 0.24), color: C.accent }, "ASSEMBLY.RSVP"),
    ]),
  ]);
  return render(tree, fonts);
}
