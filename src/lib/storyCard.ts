// Instagram story card (1080 x 1920): flyer, title, date, venue, and a QR code back to the event.
// Drawn on a canvas in the browser, so no server rendering and nothing to store.
import qrcode from "qrcode-generator";
import { clock, dayLabel } from "./time";
import { artFallback, artParams } from "./flyerArt";
import { renderStill } from "./liquidRenderer";
import type { EventSummary } from "../../shared/types";

const W = 1080;
const H = 1920;
// Instagram covers roughly the top and bottom 250 px with its own UI; keep the essentials between.
const SAFE_TOP = 250;
const SAFE_BOTTOM = H - 250;

const C = {
  ground: "#0a0a0b",
  surface: "#121215",
  line: "#34343a",
  fg: "#ededee",
  muted: "#8e8e96",
  accent: "#ff3df2",
  sodium: "#ff9a3c",
  uv: "#a98bff",
};

const SERIF = '"Timeless Serif", Georgia, serif';
const SANS = '"Timeless Sans", "Helvetica Neue", Arial, sans-serif';

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image"));
    img.src = src;
  });
}

/** Wraps text into at most `maxLines`, adding an ellipsis when it runs over. */
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number, maxLines: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width <= width || !line) line = next;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    let last = kept[maxLines - 1];
    while (ctx.measureText(`${last}…`).width > width && last.length) last = last.slice(0, -1);
    kept[maxLines - 1] = `${last.trimEnd()}…`;
    return kept;
  }
  return lines;
}

// The serif A from the splash (index.html), in its own 512-unit box: outer contour and the counter.
const A_OUTER =
  "M131.2 381.7 246.6 102H266.3L379.5 380Q385 393.4 390.8 399.8Q396.6 406.3 403.9 408.8Q411.3 411.4 425.9 413.3V426H283.7V413.3Q302.9 411.6 310.1 408.4Q317.4 405.1 317.7 399.1Q318 393.1 313.3 381L289.7 320.5H176.9L152.7 382.2Q148.3 393.4 150 399.3Q151.7 405.3 160.2 408.5Q168.8 411.6 188.7 413.3V426H86.1V413.3Q99.8 411.5 106.9 409.2Q114 406.9 120.1 400.8Q126.1 394.7 131.2 381.7Z";
const A_COUNTER = "M283 301.5 234.4 178.9 185 301.5Z";
// Where the splash's speed lines land: apex, feet, crossbar ends. [from, to] in A units.
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

/** Letter spacing where the canvas supports it (Chrome, Safari 17+); plain text elsewhere. */
function track(ctx: CanvasRenderingContext2D, em: number, px: number) {
  const c = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
  if ("letterSpacing" in c) c.letterSpacing = `${Math.round(em * px)}px`;
}

/**
 * The splash's mark: a hairline outline of the A with a magenta echo printed slightly off register, and the speed
 * lines caught mid-flight toward its corners. `x, y` is where A unit (0, 0) lands; `s` is pixels per unit.
 */
function aMark(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  o: { line: number; outline: string; echo: string; streaks?: number },
) {
  const outer = new Path2D(A_OUTER);
  const counter = new Path2D(A_COUNTER);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.lineWidth = o.line / s;
  ctx.lineJoin = "miter";
  if (o.streaks) {
    // Each streak is the last stretch of its line, fading in toward the A, like the splash at the moment it lands.
    A_LINES.forEach(([x1, y1, x2, y2], i) => {
      const len = Math.hypot(x2 - x1, y2 - y1);
      const t = 1 - (o.streaks! * (0.7 + ((i * 37) % 10) / 20)) / len;
      const sx = x1 + (x2 - x1) * t;
      const sy = y1 + (y2 - y1) * t;
      const g = ctx.createLinearGradient(sx, sy, x2, y2);
      const col = i === A_LINES.length - 1 ? C.uv : C.accent;
      g.addColorStop(0, `${col}00`);
      g.addColorStop(1, col);
      ctx.strokeStyle = g;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    });
  }
  ctx.save();
  ctx.translate(14, 12);
  ctx.strokeStyle = o.echo;
  ctx.stroke(outer);
  ctx.stroke(counter);
  ctx.restore();
  ctx.strokeStyle = o.outline;
  ctx.stroke(outer);
  ctx.stroke(counter);
  ctx.restore();
}

/** A hairline box with the same off-register magenta echo, the splash's print look applied to a frame. */
function printedFrame(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, stroke: string, echo: string) {
  ctx.lineWidth = 2;
  ctx.strokeStyle = echo;
  ctx.strokeRect(x + 14, y + 12, w, h);
  ctx.strokeStyle = stroke;
  ctx.strokeRect(x, y, w, h);
}

/** Without uploaded art: the event's generated art (same as in the app). The title is set below it. */
async function generatedFlyer(ctx: CanvasRenderingContext2D, e: EventSummary, x: number, y: number, w: number, h: number) {
  const p = artParams(e.id);
  ctx.fillStyle = artFallback(p);
  ctx.fillRect(x, y, w, h);
  // The card is ~2.5x a phone card, so render at that scale for the same chunky pixels.
  const still = renderStill(p, w / 2.5, h / 2.5);
  if (still) {
    // Keep the pixels hard when scaling the art up.
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(still, x, y, w, h);
    ctx.restore();
  }
  ctx.font = `500 26px ui-monospace, Menlo, monospace`;
  ctx.fillStyle = "rgba(237,237,238,0.7)";
  ctx.fillText(`GEN ${p.number}`, x + 32, y + 52);
}

export async function renderStoryCard(e: EventSummary, url: string, tz: string): Promise<Blob> {
  await Promise.all([
    document.fonts.load(`300 120px ${SERIF}`),
    document.fonts.load(`400 40px ${SERIF}`),
    document.fonts.load(`500 40px ${SANS}`),
  ]).catch(() => undefined);

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.textBaseline = "alphabetic";
  const cancelled = e.status === "cancelled";
  const pad = 90;

  // Ground, a soft magenta glow low on the card, and the splash A, huge, bleeding off the right edge.
  ctx.fillStyle = C.ground;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W * 0.8, H * 0.82, 0, W * 0.8, H * 0.82, 900);
  glow.addColorStop(0, "rgba(255,61,242,0.16)");
  glow.addColorStop(0.5, "rgba(169,139,255,0.06)");
  glow.addColorStop(1, "rgba(10,10,11,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  aMark(ctx, W / 2 - 256 * 3.2, 1130 - 102 * 3.2, 3.2, { line: 2.5, outline: "rgba(237,237,238,0.16)", echo: "rgba(255,61,242,0.4)", streaks: 280 });

  // Masthead: the A mark and the splash caption, in mono with wide tracking.
  const mono = (px: number) => `500 ${px}px ui-monospace, "SF Mono", Menlo, monospace`;
  aMark(ctx, pad - 86 * 0.16, SAFE_TOP - 102 * 0.16 - 52, 0.16, { line: 2, outline: C.fg, echo: C.accent });
  ctx.font = mono(24);
  track(ctx, 0.24, 24);
  ctx.fillStyle = C.fg;
  const capX = pad + 80;
  const capY = SAFE_TOP - 6;
  ctx.fillText("ASSEMBLY", capX, capY);
  const w1 = ctx.measureText("ASSEMBLY ").width;
  ctx.fillStyle = C.accent;
  ctx.fillText("·", capX + w1, capY);
  ctx.fillStyle = C.fg;
  ctx.fillText(" MEMPHIS", capX + w1 + ctx.measureText("·").width, capY);
  ctx.textAlign = "right";
  ctx.fillStyle = C.muted;
  ctx.fillText(dayLabel(e.startsAt, new Date(), tz).toUpperCase(), W - pad, capY);
  ctx.textAlign = "left";
  track(ctx, 0, 0);

  // Laid out from the bottom up: QR row, venue, when, title; the flyer takes whatever height is left.
  const qrSize = 200;
  const qy = SAFE_BOTTOM - qrSize - 12;
  let size = 96;
  ctx.font = `300 ${size}px ${SERIF}`;
  let lines = wrap(ctx, e.title, W - pad * 2, 2);
  if (ctx.measureText(e.title).width > (W - pad * 2) * 1.9) {
    size = 72;
    ctx.font = `300 ${size}px ${SERIF}`;
    lines = wrap(ctx, e.title, W - pad * 2, 3);
  }
  const lh = size * 0.98;
  const venueY = qy - 84;
  const metaY = venueY - 58;
  const lastTitleY = metaY - 76;
  const firstTitleY = lastTitleY - (lines.length - 1) * lh;

  // Flyer, in a printed frame.
  const fx = pad;
  const fy = SAFE_TOP + 70;
  const fw = W - pad * 2 - 14;
  const fh = firstTitleY - size * 0.72 - 72 - fy;
  ctx.fillStyle = C.surface;
  ctx.fillRect(fx, fy, fw, fh);
  let drew = false;
  if (e.flyerUrl) {
    try {
      const img = await loadImage(e.flyerUrl);
      ctx.save();
      ctx.beginPath();
      ctx.rect(fx, fy, fw, fh);
      ctx.clip();
      // The flyer itself, whole; behind it the same flyer blown up, blurred and dimmed, so the box never shows bars.
      const cover = Math.max(fw / img.width, fh / img.height) * 1.1;
      ctx.filter = "blur(36px) brightness(0.45) saturate(1.3)";
      ctx.drawImage(img, fx + (fw - img.width * cover) / 2, fy + (fh - img.height * cover) / 2, img.width * cover, img.height * cover);
      ctx.filter = "none";
      const s = Math.min(fw / img.width, fh / img.height);
      ctx.drawImage(img, fx + (fw - img.width * s) / 2, fy + (fh - img.height * s) / 2, img.width * s, img.height * s);
      ctx.restore();
      drew = true;
    } catch {
      // Fall through to the generated flyer.
    }
  }
  if (!drew) await generatedFlyer(ctx, e, fx, fy, fw, fh);
  if (cancelled) {
    ctx.fillStyle = "rgba(10,10,11,0.55)";
    ctx.fillRect(fx, fy, fw, fh);
  }
  printedFrame(ctx, fx, fy, fw, fh, cancelled ? C.muted : C.fg, cancelled ? C.line : C.accent);

  // Title in the display serif.
  ctx.fillStyle = C.fg;
  ctx.font = `300 ${size}px ${SERIF}`;
  track(ctx, -0.015, size);
  lines.forEach((line, i) => ctx.fillText(line, pad, firstTitleY + i * lh));
  track(ctx, 0, 0);

  // When, in tracked mono with magenta separators; where, quieter.
  let y = metaY;
  ctx.font = mono(30);
  track(ctx, 0.16, 30);
  let x = pad;
  const parts = [cancelled ? "CANCELLED" : dayLabel(e.startsAt, new Date(), tz).toUpperCase(), `${clock(e.startsAt, tz)}–${clock(e.endsAt, tz)}`.toUpperCase()];
  if (e.doorPrice) parts.push(e.doorPrice.toUpperCase());
  parts.forEach((part, i) => {
    if (i) {
      ctx.fillStyle = C.accent;
      ctx.fillText(" · ", x, y);
      x += ctx.measureText(" · ").width;
    }
    ctx.fillStyle = i === 0 && cancelled ? C.muted : C.fg;
    const fit = wrap(ctx, part, W - pad - x, 1)[0];
    ctx.fillText(fit, x, y);
    x += ctx.measureText(fit).width;
  });
  track(ctx, 0, 0);
  y = venueY;
  ctx.fillStyle = C.muted;
  ctx.font = `400 34px ${SANS}`;
  ctx.fillText(wrap(ctx, [e.venueName, e.neighborhood].filter(Boolean).join(" / ") || e.address, W - pad * 2, 1)[0], pad, y);

  // QR code in its own printed frame, and the call to action, ending at the bottom of the safe area.
  const qr = qrcode(0, "M");
  qr.addData(url);
  qr.make();
  const n = qr.getModuleCount();
  const quiet = 14;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(pad, qy, qrSize, qrSize);
  const cell = (qrSize - quiet * 2) / n;
  ctx.fillStyle = "#000000";
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) if (qr.isDark(r, c)) ctx.fillRect(pad + quiet + c * cell, qy + quiet + r * cell, Math.ceil(cell), Math.ceil(cell));
  ctx.lineWidth = 2;
  ctx.strokeStyle = C.accent;
  ctx.strokeRect(pad + 14, qy + 12, qrSize, qrSize);

  const tx = pad + qrSize + 56;
  ctx.fillStyle = C.fg;
  ctx.font = `300 60px ${SERIF}`;
  ctx.fillText(cancelled ? "This night is off." : "RSVP on Assembly", tx, qy + 92);
  ctx.font = mono(24);
  track(ctx, 0.24, 24);
  ctx.fillStyle = C.muted;
  ctx.fillText(url.replace(/^https?:\/\//, "").replace(/\/e\/.+$/, "").toUpperCase(), tx, qy + 146);
  ctx.fillStyle = C.accent;
  ctx.fillText("SCAN FOR DETAILS →", tx, qy + 186);
  track(ctx, 0, 0);

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("canvas"))), "image/png"));
}
