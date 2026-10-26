// Link previews and search metadata for /a/<artist>, /v/<venue>, /o/<organizer>: the app's index.html with the
// page's title, a description built from the bio and next show, Open Graph tags, and schema.org data.
import { Hono, type Context } from "hono";
import type { Env } from "./env";
import { findPage, pageEvents } from "./pages";
import type { PageKind } from "../shared/types";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const json = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");
const KIND: Record<string, PageKind> = { a: "artist", v: "venue", o: "organizer" };
const NOUN: Record<PageKind, string> = { artist: "Artist", venue: "Venue", organizer: "Organizer" };

export const ogPages = new Hono<{ Bindings: Env }>();

// Three explicit routes: a param regex like {a|v|o} isn't anchored per alternative and would swallow /api/*.
for (const k of ["a", "v", "o"] as const) ogPages.get(`/${k}/:slug`, (c) => render(c, k));

async function render(c: Context<{ Bindings: Env }>, k: "a" | "v" | "o") {
  const origin = new URL(c.req.url).origin;
  const page = await c.env.ASSETS.fetch(new Request(`${origin}/`, { headers: c.req.raw.headers }));
  if (!page.ok || !(page.headers.get("Content-Type") ?? "").includes("text/html")) return page;
  const kind = KIND[k];
  const t = await findPage(c.env, kind, decodeURIComponent(c.req.param("slug") ?? "")).catch(() => null);
  if (!t) {
    const res = new Response(page.body, page);
    res.headers.set("X-Robots-Tag", "noindex");
    res.headers.set("Cache-Control", "public, max-age=60");
    return res;
  }
  const { events } = await pageEvents(c.env, t, "upcoming", null, 10).catch(() => ({ events: [] }));
  const next = events[0];
  const tz =
    (t.cityId ? await c.env.DB.prepare("SELECT timezone FROM cities WHERE id = ?").bind(t.cityId).first<{ timezone: string }>().catch(() => null) : null)?.timezone ??
    "America/Chicago";
  const day = (iso: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" }).format(new Date(iso));
  const url = `${origin}/${k}/${encodeURIComponent(t.slug)}`;
  const nextLine = next ? `Next: ${next.title}, ${day(next.startsAt)}${kind !== "venue" && next.venueName ? ` at ${next.venueName}` : ""}.` : "No shows coming up yet.";
  const place = t.venue ? [t.venue.neighborhood, t.venue.address].filter(Boolean).join(", ") : "";
  const description = [t.bio ? t.bio.replace(/\s+/g, " ").slice(0, 160) : place || `${NOUN[kind]} on Assembly.`, nextLine].join(" ").slice(0, 280);
  const title = t.name;
  // A page photo if there is one; otherwise the next show's designed preview; otherwise the site default stays.
  const image = t.photo ? new URL(t.photo, origin).toString() : next ? `${origin}/api/og/e/${encodeURIComponent(next.id)}.png` : null;

  const ld: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": kind === "artist" ? "MusicGroup" : kind === "venue" ? "MusicVenue" : "Organization",
    name: t.name,
    url,
    ...(t.bio ? { description: t.bio.slice(0, 500) } : {}),
    ...(image ? { image } : {}),
    sameAs: Object.values(t.links).filter(Boolean),
    ...(t.venue
      ? { address: t.venue.address, geo: { "@type": "GeoCoordinates", latitude: t.venue.lat, longitude: t.venue.lng } }
      : {}),
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
  const tags = [
    `<meta property="og:type" content="profile">`,
    `<meta property="og:site_name" content="Assembly">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(description)}">`,
    `<meta property="og:url" content="${esc(url)}">`,
    ...(image ? [`<meta property="og:image" content="${esc(image)}">`, `<meta property="og:image:alt" content="${esc(t.name)}">`] : []),
    `<meta name="twitter:card" content="${image && !t.photo ? "summary_large_image" : "summary"}">`,
    `<link rel="canonical" href="${esc(url)}">`,
    `<link rel="alternate" type="application/atom+xml" title="${esc(`${t.name} on Assembly`)}" href="${esc(feed)}">`,
    `<script type="application/ld+json">${json(ld)}</script>`,
  ].join("");

  const rewritten = new HTMLRewriter()
    .on("title", { element: (el) => void el.setInnerContent(`${title} · Assembly`) })
    .on('meta[name="description"]', { element: (el) => void el.setAttribute("content", description) })
    .on('meta[property^="og:"], meta[name^="twitter:"], link[rel="canonical"]', { element: (el) => void el.remove() })
    .on("head", { element: (el) => void el.append(tags, { html: true }) })
    .transform(page);
  const res = new Response(rewritten.body, rewritten);
  res.headers.set("Cache-Control", "public, max-age=60");
  return res;
}
