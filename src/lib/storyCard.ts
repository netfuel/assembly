// Instagram story card (1080 x 1920): flyer, title, date, venue, and a QR code back to the event.
// Drawn on a canvas in the browser, so no server rendering and nothing to store.
import qrcode from "qrcode-generator";
import { clock, dayLabel } from "./time";
import { artDataUrl, artNumber } from "./flyerArt";
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

function diamond(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, stroke: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = C.ground;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2;
  ctx.fillRect(-r, -r, r * 2, r * 2);
  ctx.strokeRect(-r, -r, r * 2, r * 2);
  ctx.restore();
}

/** Hairline frame with diamond corner nodes, the app's signature shape. */
function frame(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, stroke: string) {
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
  for (const [cx, cy] of [
    [x, y],
    [x + w, y],
    [x, y + h],
    [x + w, y + h],
  ])
    diamond(ctx, cx, cy, 7, stroke);
}

/** Without uploaded art: the event's generated art (same as in the app), with the title set big. */
async function generatedFlyer(ctx: CanvasRenderingContext2D, e: EventSummary, x: number, y: number, w: number, h: number) {
  const queer = e.scenes.includes("queer");
  ctx.fillStyle = queer ? C.uv : C.sodium;
  ctx.fillRect(x, y, w, h);
  try {
    const img = await loadImage(artDataUrl(e.id, queer));
    // The art is 4:5 and scales without limit: cover the box.
    const s = Math.max(w / 400, h / 500);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.drawImage(img, x + (w - 400 * s) / 2, y + (h - 500 * s) / 2, 400 * s, 500 * s);
    ctx.restore();
  } catch {
    // The scene color stays.
  }
  const fade = ctx.createLinearGradient(0, y + h * 0.45, 0, y + h);
  fade.addColorStop(0, "rgba(10,10,11,0)");
  fade.addColorStop(0.6, "rgba(10,10,11,0.85)");
  ctx.fillStyle = fade;
  ctx.fillRect(x, y + h * 0.45, w, h * 0.55);
  ctx.fillStyle = C.fg;
  ctx.font = `italic 800 112px ${SANS}`;
  ctx.textBaseline = "alphabetic";
  const lines = wrap(ctx, e.title.toUpperCase(), w - 96, 4);
  lines.forEach((l, i) => ctx.fillText(l, x + 48, y + h - 64 - (lines.length - 1 - i) * 104));
  ctx.font = `500 26px ui-monospace, Menlo, monospace`;
  ctx.fillStyle = "rgba(237,237,238,0.7)";
  ctx.fillText(`GEN ${artNumber(e.id)}`, x + 32, y + 52);
}

export async function renderStoryCard(e: EventSummary, url: string, tz: string): Promise<Blob> {
  await Promise.all([
    document.fonts.load(`300 120px ${SERIF}`),
    document.fonts.load(`500 40px ${SANS}`),
    document.fonts.load(`italic 800 112px ${SANS}`),
  ]).catch(() => undefined);

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.textBaseline = "alphabetic";

  // Ground with a faint dot grid.
  ctx.fillStyle = C.ground;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  for (let y = 12; y < H; y += 24) for (let x = 12; x < W; x += 24) ctx.fillRect(x, y, 2, 2);

  // Masthead, inside the safe area.
  const pad = 90;
  ctx.fillStyle = C.fg;
  ctx.font = `400 52px ${SERIF}`;
  ctx.fillText("Assembly", pad, SAFE_TOP + 20);
  ctx.fillStyle = C.muted;
  ctx.font = `500 26px ${SANS}`;
  ctx.textAlign = "right";
  ctx.fillText("MEMPHIS", W - pad, SAFE_TOP + 16);
  ctx.textAlign = "left";

  // Flyer box.
  const fx = pad;
  const fy = SAFE_TOP + 60;
  const fw = W - pad * 2;
  const fh = 780;
  ctx.fillStyle = C.surface;
  ctx.fillRect(fx, fy, fw, fh);
  let drew = false;
  if (e.flyerUrl) {
    try {
      const img = await loadImage(e.flyerUrl);
      const s = Math.min(fw / img.width, fh / img.height);
      const dw = img.width * s;
      const dh = img.height * s;
      ctx.drawImage(img, fx + (fw - dw) / 2, fy + (fh - dh) / 2, dw, dh);
      drew = true;
    } catch {
      // Fall through to the generated flyer.
    }
  }
  if (!drew) await generatedFlyer(ctx, e, fx, fy, fw, fh);
  const queer = e.scenes.includes("queer");
  frame(ctx, fx, fy, fw, fh, e.status === "cancelled" ? C.muted : C.accent);

  // Title, date, place.
  let y = fy + fh + 110;
  ctx.fillStyle = C.fg;
  ctx.font = `300 92px ${SERIF}`;
  for (const line of wrap(ctx, e.title, W - pad * 2, 2)) {
    ctx.fillText(line, pad, y);
    y += 92;
  }
  y += 6;
  ctx.font = `500 34px ${SANS}`;
  ctx.fillStyle = C.fg;
  const when = `${dayLabel(e.startsAt, new Date(), tz)} / ${clock(e.startsAt, tz)} to ${clock(e.endsAt, tz)}`.toUpperCase();
  ctx.fillText(when, pad, y);
  y += 52;
  ctx.fillStyle = C.muted;
  ctx.font = `400 32px ${SANS}`;
  ctx.fillText(wrap(ctx, [e.venueName, e.neighborhood].filter(Boolean).join(" / ") || e.address, W - pad * 2, 1)[0], pad, y);

  // QR code and call to action, ending at the bottom of the safe area.
  const qrSize = 220;
  const qy = SAFE_BOTTOM - qrSize;
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

  const tx = pad + qrSize + 40;
  ctx.fillStyle = queer ? C.uv : C.sodium;
  ctx.fillRect(tx, qy + 6, 16, 16);
  ctx.fillStyle = C.fg;
  ctx.font = `300 56px ${SERIF}`;
  ctx.fillText(e.status === "cancelled" ? "Cancelled." : "RSVP on Assembly", tx, qy + 100);
  ctx.fillStyle = C.muted;
  ctx.font = `500 28px ${SANS}`;
  ctx.fillText(url.replace(/^https?:\/\//, "").replace(/\/e\/.+$/, "").toUpperCase(), tx, qy + 150);
  ctx.fillStyle = C.accent;
  ctx.fillText(e.doorPrice ? e.doorPrice.toUpperCase() : "", tx, qy + 196);

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("canvas"))), "image/png"));
}
