// Serves event link-preview images at /api/og/e/:id.png. Each is drawn once per version of the event
// (worker/ogRender.ts) and kept in R2 under og/, so crawlers get a stored file after the first request.
// Until the preview fonts are in R2 (npm run fonts:upload), these redirect to the flyer or the site image.
import { Hono } from "hono";
// Wasm imports become compiled modules (Workers can't compile wasm from bytes at run time). TypeScript resolves
// these paths to the .wasm files themselves and has no types for them, hence the expect-errors.
// @ts-expect-error wasm module
import resvgWasm from "@resvg/resvg-wasm/index_bg.wasm";
// @ts-expect-error wasm module
import yogaWasm from "satori/yoga.wasm";
// @ts-expect-error wasm module
import webpWasm from "@jsquash/webp/codec/dec/webp_dec.wasm";
import type { AppContext, Env } from "./env";
import { renderEventOg, type OgFonts } from "./ogRender";
import { ogVersion, type OgRow } from "./ogVersion";

const wasm = { resvg: resvgWasm as WebAssembly.Module, yoga: yogaWasm as WebAssembly.Module, webp: webpWasm as WebAssembly.Module };

export const OG_FONT_FILES = {
  serifLight: "TimelessSerif-Light.ttf",
  groteskRegular: "TimelessGrotesk-Regular.ttf",
  groteskMedium: "TimelessGrotesk-Medium.ttf",
} as const;

let fontCache: OgFonts | null = null;
async function loadFonts(env: Env): Promise<OgFonts | null> {
  if (fontCache) return fontCache;
  const entries = await Promise.all(
    Object.entries(OG_FONT_FILES).map(async ([k, f]) => [k, await (await env.MEDIA.get(`fonts/og/${f}`))?.arrayBuffer()] as const),
  );
  if (entries.some(([, b]) => !b)) return null;
  fontCache = Object.fromEntries(entries) as OgFonts;
  return fontCache;
}

function when(e: OgRow) {
  const tz = e.timezone;
  const day = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" }).format(new Date(e.starts_at));
  const t = (iso: string) =>
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(iso)).replace(":00", "");
  return { day: day.replace(",", ""), time: `${t(e.starts_at)}–${t(e.ends_at)}` };
}

const png = (body: Uint8Array | ReadableStream, maxAge: number) =>
  new Response(body, { headers: { "Content-Type": "image/png", "Cache-Control": `public, max-age=${maxAge}` } });

export const ogImages = new Hono<AppContext>();

ogImages.get("/e/:file", async (c) => {
  const id = decodeURIComponent(c.req.param("file").replace(/\.png$/, ""));
  const e = await c.env.DB.prepare(
    `SELECT e.id, e.title, e.starts_at, e.ends_at, e.status, e.neighborhood, e.flyer_key, e.door_price, v.name AS venue_name,
            ci.timezone, ci.name AS city_name
     FROM events e JOIN cities ci ON ci.id = e.city_id LEFT JOIN venues v ON v.id = e.venue_id
     WHERE e.id = ? AND e.status IN ('live', 'cancelled')`,
  )
    .bind(id)
    .first<OgRow>();
  if (!e) return c.redirect("/icons/og.png", 302);
  const fallback = () => c.redirect(e.flyer_key ? `/api/media/${e.flyer_key}` : "/icons/og.png", 302);

  const key = `og/e/${e.id}/${await ogVersion(e)}.png`;
  const stored = await c.env.MEDIA.get(key);
  if (stored) return png(stored.body, 86400);
  const fonts = await loadFonts(c.env);
  if (!fonts) return fallback();

  try {
    const flyerObj = e.flyer_key ? await c.env.MEDIA.get(e.flyer_key) : null;
    const flyer = flyerObj ? { bytes: await flyerObj.arrayBuffer(), type: flyerObj.httpMetadata?.contentType ?? "" } : null;
    const out = await renderEventOg(
      {
        id: e.id,
        title: e.title,
        ...when(e),
        place: [e.venue_name, e.neighborhood].filter(Boolean).join(" / ") || null,
        doorPrice: e.door_price,
        cancelled: e.status === "cancelled",
        city: e.city_name,
        flyer,
      },
      wasm,
      fonts,
    );
    c.executionCtx.waitUntil(c.env.MEDIA.put(key, out, { httpMetadata: { contentType: "image/png" } }));
    return png(out, 86400);
  } catch (err) {
    console.error("og image", e.id, err instanceof Error ? err.stack : err);
    return fallback();
  }
});
