// Link previews and search metadata for /a/<artist>, /v/<venue>, /o/<organizer>, /c/<city> and /c/<city>/<scene>:
// the app's index.html with the page's title, a description, Open Graph and Twitter tags, and schema.org data.
// Tag building and the HTML swap live in worker/ogHead.ts; the event route (worker/og.ts) uses the same.
import { Hono, type Context } from "hono";
import type { Env } from "./env";
import { findPage, pageEvents } from "./pages";
import { OG_H, OG_W, absolute, esc, htmlResponse, imageSize, noindexHtml, rewriteHead } from "./ogHead";
import { SCENES, type PageKind } from "../shared/types";

const json = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");
const KIND: Record<string, PageKind> = { a: "artist", v: "venue", o: "organizer" };
const NOUN: Record<PageKind, string> = { artist: "Artist", venue: "Venue", organizer: "Organizer" };
const PUBLIC = "e.status IN ('live', 'cancelled') AND e.is_sample = 0";

export const ogPages = new Hono<{ Bindings: Env }>();

// Explicit routes: a param regex like {a|v|o} isn't anchored per alternative and would swallow /api/*.
for (const k of ["a", "v", "o"] as const) ogPages.get(`/${k}/:slug`, (c) => render(c, k));
ogPages.get("/c/:city", (c) => renderPlace(c));
ogPages.get("/c/:city/:scene", (c) => renderPlace(c));

type Ctx = Context<{ Bindings: Env }>;

/** The app's page, or null when the asset isn't HTML (then the caller passes the response through). */
async function appPage(c: Ctx, origin: string): Promise<Response | null> {
  const page = await c.env.ASSETS.fetch(new Request(`${origin}/`, { headers: c.req.raw.headers }));
  return page.ok && (page.headers.get("Content-Type") ?? "").includes("text/html") ? page : null;
}

const noindexPage = async (page: Response) => htmlResponse(noindexHtml(await page.text()), page, { noindex: true });

/** A stored page photo is used as the preview only when we can read its real size and it's big enough for a large card. */
async function photoPreview(env: Env, photo: string | null, origin: string): Promise<{ url: string; w: number; h: number } | null> {
  if (!photo) return null;
  const key = photo.startsWith("/api/media/") ? photo.slice("/api/media/".length) : null;
  if (!key) return null; // an off-site avatar: its size isn't ours to vouch for
  try {
    const obj = await env.MEDIA.get(key, { range: { offset: 0, length: 65536 } });
    if (!obj) return null;
    const size = imageSize(new Uint8Array(await obj.arrayBuffer()));
    if (!size || size.width < 600 || size.height < 315) return null;
    return { url: absolute(photo, origin, `${origin}/icons/og.png`), w: size.width, h: size.height };
  } catch {
    return null;
  }
}

const dayFmt = (iso: string, tz: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" }).format(new Date(iso));

async function render(c: Ctx, k: "a" | "v" | "o") {
  const origin = new URL(c.req.url).origin;
  const page = await appPage(c, origin);
  if (!page) return c.env.ASSETS.fetch(new Request(`${origin}/`, { headers: c.req.raw.headers }));
  const kind = KIND[k];
  const t = await findPage(c.env, kind, decodeURIComponent(c.req.param("slug") ?? "")).catch(() => null);
  if (!t) return noindexPage(page);
  const { events } = await pageEvents(c.env, t, "upcoming", null, 10).catch(() => ({ events: [] }));
  const next = events[0];
  const tz =
    (t.cityId ? await c.env.DB.prepare("SELECT timezone FROM cities WHERE id = ?").bind(t.cityId).first<{ timezone: string }>().catch(() => null) : null)?.timezone ??
    "America/Chicago";
  const url = `${origin}/${k}/${encodeURIComponent(t.slug)}`;
  const nextLine = next ? `Next: ${next.title}, ${dayFmt(next.startsAt, tz)}${kind !== "venue" && next.venueName ? ` at ${next.venueName}` : ""}.` : "No shows coming up yet.";
  const place = t.venue ? [t.venue.neighborhood, t.venue.address].filter(Boolean).join(", ") : "";
  const description = [t.bio ? t.bio.replace(/\s+/g, " ").slice(0, 160) : place || `${NOUN[kind]} on Assembly.`, nextLine].join(" ").slice(0, 280);
  // The page's own photo when it's big enough and we know its size; otherwise the next show's designed preview;
  // otherwise the site image. The designed ones are always 1200 x 630.
  const photo = await photoPreview(c.env, t.photo, origin);
  const image = photo ? { url: photo.url, w: photo.w, h: photo.h } : next ? { url: `${origin}/api/og/e/${encodeURIComponent(next.id)}.png`, w: OG_W, h: OG_H } : { url: `${origin}/icons/og.png`, w: OG_W, h: OG_H };

  const ld: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": kind === "artist" ? "MusicGroup" : kind === "venue" ? "MusicVenue" : "Organization",
    name: t.name,
    url,
    ...(t.bio ? { description: t.bio.slice(0, 500) } : {}),
    image: image.url,
    sameAs: Object.values(t.links).filter(Boolean),
    ...(t.venue ? { address: t.venue.address, geo: { "@type": "GeoCoordinates", latitude: t.venue.lat, longitude: t.venue.lng } } : {}),
    event: events.slice(0, 10).map((e) => ({
      "@type": "MusicEvent",
      name: e.title,
      startDate: e.startsAt,
      endDate: e.endsAt,
      url: `${origin}/e/${encodeURIComponent(e.id)}`,
      eventStatus: e.status === "cancelled" ? "https://schema.org/EventCancelled" : "https://schema.org/EventScheduled",
      location: { "@type": "Place", name: e.venueName ?? e.neighborhood ?? e.address, address: e.address },
    })),
  };
  const feed = `${origin}/feeds/${k}/${encodeURIComponent(t.slug)}.xml`;
  const html = rewriteHead(await page.text(), {
    title: t.name,
    description,
    url,
    image: image.url,
    imageWidth: image.w,
    imageHeight: image.h,
    imageAlt: photo ? `${t.name}, ${kind} on Assembly` : next ? `${next.title}: preview of ${t.name}'s next show` : "Assembly: underground music, DIY shows, raves, and queer nights on one live map.",
    ogType: "profile",
    extra: `<link rel="alternate" type="application/atom+xml" title="${esc(`${t.name} on Assembly`)}" href="${esc(feed)}"><script type="application/ld+json">${json(ld)}</script>`,
  });
  return htmlResponse(html, page);
}

interface CityRow {
  id: string;
  name: string;
  slug: string;
  timezone: string;
}

/** /c/<city> and /c/<city>/<scene>: what's on in a city, or one scene in it. */
async function renderPlace(c: Ctx) {
  const origin = new URL(c.req.url).origin;
  const page = await appPage(c, origin);
  if (!page) return c.env.ASSETS.fetch(new Request(`${origin}/`, { headers: c.req.raw.headers }));
  const slug = decodeURIComponent(c.req.param("city") ?? "").toLowerCase();
  const sceneId = c.req.param("scene") ? decodeURIComponent(c.req.param("scene") ?? "").toLowerCase() : null;
  const scene = sceneId ? SCENES.find((s) => s.id === sceneId) : null;
  const city = await c.env.DB.prepare("SELECT id, name, slug, timezone FROM cities WHERE slug = ?").bind(slug).first<CityRow>().catch(() => null);
  if (!city || (sceneId && !scene)) return noindexPage(page);

  const now = new Date().toISOString();
  const sceneSql = scene ? "AND EXISTS (SELECT 1 FROM json_each(e.scenes) WHERE value = ?3)" : "";
  const binds = scene ? [city.id, now, scene.id] : [city.id, now];
  const where = `e.city_id = ?1 AND ${PUBLIC} AND e.ends_at > ?2 ${sceneSql}`;
  const [count, next] = await Promise.all([
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM events e WHERE ${where}`).bind(...binds).first<{ n: number }>().catch(() => null),
    c.env.DB.prepare(`SELECT e.id, e.title, e.starts_at, v.name AS venue_name FROM events e LEFT JOIN venues v ON v.id = e.venue_id WHERE ${where} ORDER BY e.starts_at LIMIT 1`)
      .bind(...binds)
      .first<{ id: string; title: string; starts_at: string; venue_name: string | null }>()
      .catch(() => null),
  ]);
  const n = count?.n ?? 0;
  const url = `${origin}/c/${encodeURIComponent(city.slug)}${scene ? `/${scene.id}` : ""}`;
  const title = scene ? `${scene.label} in ${city.name}` : `Underground music in ${city.name}`;
  const lead = scene
    ? `${scene.label} shows, parties and nights in ${city.name}: ${n ? `${n} coming up` : "nothing posted yet"}.`
    : `DIY shows, raves, queer nights and club nights in ${city.name}: ${n ? `${n} coming up` : "nothing posted yet"}.`;
  const nextLine = next ? ` Next: ${next.title}, ${dayFmt(next.starts_at, city.timezone)}${next.venue_name ? ` at ${next.venue_name}` : ""}.` : "";
  const description = (lead + nextLine).slice(0, 280);
  const image = next ? `${origin}/api/og/e/${encodeURIComponent(next.id)}.png` : `${origin}/icons/og.png`;
  const ld = { "@context": "https://schema.org", "@type": "CollectionPage", name: title, url, description, about: { "@type": "City", name: city.name } };
  const html = rewriteHead(await page.text(), {
    title,
    description,
    url,
    image,
    imageWidth: OG_W,
    imageHeight: OG_H,
    imageAlt: next ? `${next.title}: the next ${scene ? scene.label.toLowerCase() : "show"} in ${city.name}` : `Assembly: underground music in ${city.name}`,
    extra: `<link rel="alternate" type="application/atom+xml" title="${esc(`${title} on Assembly`)}" href="${esc(`${origin}/feeds/${city.slug}${scene ? `/${scene.id}` : ""}.xml`)}"><script type="application/ld+json">${json(ld)}</script>`,
  });
  return htmlResponse(html, page);
}
