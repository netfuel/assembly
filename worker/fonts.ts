import { Hono } from "hono";
import type { Env } from "./env";

/**
 * Serves the Timeless fonts from the private R2 bucket (key prefix fonts/timeless/).
 * The license allows embedding fonts in a website but not offering them for download on their own,
 * so this only answers requests made by Assembly's own pages, and only for the three known files.
 * If a file isn't in R2 (local dev before upload), it falls through to the static assets,
 * which serve public/fonts/timeless/ from the developer's machine.
 */
const FILES = new Set(["TimelessSansVF.woff2", "TimelessSerifVF.woff2", "TimelessSerifItalicVF.woff2"]);

function fromOwnSite(req: Request): boolean {
  const site = req.headers.get("Sec-Fetch-Site");
  if (site) return site === "same-origin";
  // Older browsers without Fetch Metadata: fall back to the Referer.
  const referer = req.headers.get("Referer");
  if (!referer) return false;
  try {
    return new URL(referer).origin === new URL(req.url).origin;
  } catch {
    return false;
  }
}

export const fonts = new Hono<{ Bindings: Env }>();

fonts.get("/timeless/:file", async (c) => {
  const file = c.req.param("file");
  if (!FILES.has(file)) return c.notFound();
  if (!fromOwnSite(c.req.raw)) return c.text("Fonts are served only to assembly.rsvp pages.", 403);

  const obj = await c.env.MEDIA.get(`fonts/timeless/${file}`);
  if (!obj) {
    // Local dev: serve from public/fonts/timeless/. Static-asset hosting answers unknown paths with
    // the app's index.html (single-page fallback), so pass through only a real font.
    const local = await c.env.ASSETS.fetch(c.req.raw);
    const type = local.headers.get("Content-Type") ?? "";
    if (local.ok && (type.includes("font") || type.includes("octet-stream"))) return local;
    return c.text("Font not uploaded yet. Run npm run fonts:upload.", 404);
  }

  const headers = new Headers({
    "Content-Type": "font/woff2",
    "Cache-Control": "public, max-age=31536000, immutable",
    ETag: obj.httpEtag,
    Vary: "Sec-Fetch-Site, Referer",
  });
  return new Response(obj.body, { headers });
});
