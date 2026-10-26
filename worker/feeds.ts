// Public, no-login feeds: Atom (/feeds/memphis.xml), JSON Feed (.json), and a calendar subscription (.ics),
// for a whole city or one scene (/feeds/memphis/queer.xml). Plus /sitemap.xml for search engines.
// Public event data only: live and cancelled events, never drafts, hidden events, or anything about attendees.
import { Hono, type Context } from "hono";
import type { Env } from "./env";
import { SCENES } from "../shared/types";
import { findPage } from "./pages";

export interface FeedEvent {
  id: string;
  title: string;
  pitch: string | null;
  description: string | null;
  starts_at: string;
  ends_at: string;
  status: string;
  address: string;
  neighborhood: string | null;
  lat: number;
  lng: number;
  door_price: string | null;
  ticket_url: string | null;
  scenes: string;
  flyer_key: string | null;
  created_at: string;
  updated_at: string;
  venue_name: string | null;
  lineup: string | null;
}

interface CityRow {
  id: string;
  name: string;
  slug: string;
  timezone: string;
}

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const ics = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const icsDate = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
/** iCalendar lines must be folded at 75 octets. */
const fold = (line: string) => {
  const out: string[] = [];
  let rest = line;
  while (new TextEncoder().encode(rest).length > 75) {
    let cut = 74;
    while (new TextEncoder().encode(rest.slice(0, cut)).length > 74) cut--;
    out.push(rest.slice(0, cut));
    rest = ` ${rest.slice(cut)}`;
  }
  out.push(rest);
  return out.join("\r\n");
};

function whenText(e: FeedEvent, tz: string) {
  const day = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric" }).format(new Date(e.starts_at));
  const t = (iso: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
  return `${day}, ${t(e.starts_at)} to ${t(e.ends_at)}`;
}

const sceneLabel = (id: string) => SCENES.find((s) => s.id === id)?.label ?? id;

/** Upcoming public events in a city, optionally one scene. Sample events stay out of public feeds. */
export async function upcoming(env: Env, cityId: string, scene: string | null, limit = 200) {
  const rows = await env.DB.prepare(
    `SELECT e.id, e.title, e.pitch, e.description, e.starts_at, e.ends_at, e.status, e.address, e.neighborhood, e.lat, e.lng,
            e.door_price, e.ticket_url, e.scenes, e.flyer_key, e.created_at, e.updated_at, v.name AS venue_name,
            (SELECT group_concat(a.name, ', ') FROM (SELECT ar.name FROM lineup_slots ls JOIN artists ar ON ar.id = ls.artist_id
               WHERE ls.event_id = e.id ORDER BY ls.position) a) AS lineup
     FROM events e LEFT JOIN venues v ON v.id = e.venue_id
     WHERE e.city_id = ?1 AND e.status IN ('live', 'cancelled') AND e.is_sample = 0 AND e.ends_at > ?2
       AND (?3 IS NULL OR EXISTS (SELECT 1 FROM json_each(e.scenes) WHERE value = ?3))
     ORDER BY e.starts_at LIMIT ?4`,
  )
    .bind(cityId, new Date().toISOString(), scene, limit)
    .all<FeedEvent>();
  return rows.results ?? [];
}

/** Upcoming public events on an artist, venue or organizer page (/feeds/a|v|o/<slug>.xml). */
export async function upcomingFor(env: Env, kind: "artist" | "venue" | "organizer", id: string, limit = 200) {
  const scope =
    kind === "artist"
      ? "EXISTS (SELECT 1 FROM lineup_slots s WHERE s.event_id = e.id AND s.artist_id = ?1)"
      : kind === "venue"
        ? "e.venue_id = ?1"
        : "EXISTS (SELECT 1 FROM event_hosts h WHERE h.event_id = e.id AND h.user_id = ?1)";
  const rows = await env.DB.prepare(
    `SELECT e.id, e.title, e.pitch, e.description, e.starts_at, e.ends_at, e.status, e.address, e.neighborhood, e.lat, e.lng,
            e.door_price, e.ticket_url, e.scenes, e.flyer_key, e.created_at, e.updated_at, v.name AS venue_name,
            (SELECT group_concat(a.name, ', ') FROM (SELECT ar.name FROM lineup_slots ls JOIN artists ar ON ar.id = ls.artist_id
               WHERE ls.event_id = e.id ORDER BY ls.position) a) AS lineup
     FROM events e LEFT JOIN venues v ON v.id = e.venue_id
     WHERE ${scope} AND e.status IN ('live', 'cancelled') AND e.is_sample = 0 AND e.ends_at > ?2
     ORDER BY e.starts_at LIMIT ?3`,
  )
    .bind(id, new Date().toISOString(), limit)
    .all<FeedEvent>();
  return rows.results ?? [];
}

function summary(e: FeedEvent, tz: string) {
  const place = [e.venue_name, e.address].filter(Boolean).join(", ");
  const scenes = (JSON.parse(e.scenes || "[]") as string[]).map(sceneLabel).join(", ");
  return [
    e.status === "cancelled" ? "Cancelled. The organizer called this one off." : null,
    whenText(e, tz),
    place,
    e.lineup ? `Lineup: ${e.lineup}` : null,
    e.door_price ? `Door: ${e.door_price}` : null,
    scenes ? `Scenes: ${scenes}` : null,
    e.pitch,
  ].filter(Boolean) as string[];
}

const titleOf = (e: FeedEvent) => `${e.status === "cancelled" ? "Cancelled: " : ""}${e.title}`;

export function atom(events: FeedEvent[], o: { origin: string; self: string; title: string; tz: string; home: string }) {
  const updated = events.reduce((m, e) => (e.updated_at > m ? e.updated_at : m), "1970-01-01T00:00:00Z");
  const entries = events.map((e) => {
    const url = `${o.origin}/e/${encodeURIComponent(e.id)}`;
    const lines = summary(e, o.tz);
    const img = e.flyer_key ? `${o.origin}/api/media/${e.flyer_key}` : null;
    const html = `${img ? `<p><img src="${xml(img)}" alt="Flyer for ${xml(e.title)}"></p>` : ""}${lines.map((l) => `<p>${xml(l)}</p>`).join("")}${
      e.ticket_url ? `<p><a href="${xml(e.ticket_url)}">Tickets</a></p>` : ""
    }`;
    return [
      "<entry>",
      `<id>tag:assembly.rsvp,2026:event/${xml(e.id)}</id>`,
      `<title>${xml(titleOf(e))}</title>`,
      `<link rel="alternate" type="text/html" href="${xml(url)}"/>`,
      // Readers sort by publish time, so published is when it was posted; the event time is in the body and a custom element.
      `<published>${new Date(e.created_at).toISOString()}</published>`,
      `<updated>${new Date(e.updated_at).toISOString()}</updated>`,
      `<assembly:starts>${new Date(e.starts_at).toISOString()}</assembly:starts>`,
      `<assembly:ends>${new Date(e.ends_at).toISOString()}</assembly:ends>`,
      `<summary>${xml(lines.join(" · "))}</summary>`,
      `<content type="html">${xml(html)}</content>`,
      ...(JSON.parse(e.scenes || "[]") as string[]).map((s) => `<category term="${xml(s)}" label="${xml(sceneLabel(s))}"/>`),
      img ? `<link rel="enclosure" type="image/webp" href="${xml(img)}"/>` : "",
      "</entry>",
    ].join("");
  });
  return [
    `<?xml version="1.0" encoding="utf-8"?>`,
    `<feed xmlns="http://www.w3.org/2005/Atom" xmlns:assembly="https://assembly.rsvp/ns/feed">`,
    `<id>${xml(o.self)}</id>`,
    `<title>${xml(o.title)}</title>`,
    `<subtitle>Underground music, DIY shows, raves, and queer nights.</subtitle>`,
    `<link rel="self" type="application/atom+xml" href="${xml(o.self)}"/>`,
    `<link rel="alternate" type="text/html" href="${xml(o.home)}"/>`,
    `<updated>${new Date(updated).toISOString()}</updated>`,
    `<author><name>Assembly</name><uri>${xml(o.origin)}</uri></author>`,
    `<icon>${xml(o.origin)}/icons/icon-192.png</icon>`,
    ...entries,
    `</feed>`,
  ].join("\n");
}

export function jsonFeed(events: FeedEvent[], o: { origin: string; self: string; title: string; tz: string; home: string }) {
  return {
    version: "https://jsonfeed.org/version/1.1",
    title: o.title,
    home_page_url: o.home,
    feed_url: o.self,
    description: "Underground music, DIY shows, raves, and queer nights.",
    icon: `${o.origin}/icons/icon-512.png`,
    items: events.map((e) => ({
      id: `tag:assembly.rsvp,2026:event/${e.id}`,
      url: `${o.origin}/e/${encodeURIComponent(e.id)}`,
      external_url: e.ticket_url ?? undefined,
      title: titleOf(e),
      content_text: summary(e, o.tz).join("\n"),
      image: e.flyer_key ? `${o.origin}/api/media/${e.flyer_key}` : undefined,
      date_published: new Date(e.created_at).toISOString(),
      date_modified: new Date(e.updated_at).toISOString(),
      tags: JSON.parse(e.scenes || "[]"),
      _assembly: { starts_at: e.starts_at, ends_at: e.ends_at, status: e.status, venue: e.venue_name, address: e.address },
    })),
  };
}

export function calendar(events: FeedEvent[], o: { origin: string; title: string; tz: string }) {
  const stamp = icsDate(new Date().toISOString());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Assembly//Feeds//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${ics(o.title)}`,
    `X-WR-TIMEZONE:${o.tz}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT2H",
    "X-PUBLISHED-TTL:PT2H",
  ];
  for (const e of events) {
    const url = `${o.origin}/e/${encodeURIComponent(e.id)}`;
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.id}@assembly.rsvp`,
      `DTSTAMP:${stamp}`,
      `LAST-MODIFIED:${icsDate(e.updated_at)}`,
      `DTSTART:${icsDate(e.starts_at)}`,
      `DTEND:${icsDate(e.ends_at)}`,
      `SUMMARY:${ics(titleOf(e))}`,
      `LOCATION:${ics([e.venue_name, e.address].filter(Boolean).join(", "))}`,
      `GEO:${e.lat};${e.lng}`,
      `URL:${url}`,
      `STATUS:${e.status === "cancelled" ? "CANCELLED" : "CONFIRMED"}`,
      `DESCRIPTION:${ics([...summary(e, o.tz).slice(1), url].join("\n"))}`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

/** A weak ETag from the newest change and the count, so readers that poll get a cheap 304. */
function etagFor(events: FeedEvent[], kind: string) {
  const newest = events.reduce((m, e) => (e.updated_at > m ? e.updated_at : m), "");
  return `W/"${kind}-${events.length}-${newest.replace(/\D/g, "")}-${new Date().toISOString().slice(0, 13)}"`;
}

function respond(c: Context<{ Bindings: Env }>, body: string, type: string, etag: string) {
  if (c.req.header("If-None-Match") === etag) return c.body(null, 304, { ETag: etag });
  return c.body(body, 200, {
    "Content-Type": type,
    ETag: etag,
    "Cache-Control": "public, max-age=900",
    "Access-Control-Allow-Origin": "*",
  });
}

export const feeds = new Hono<{ Bindings: Env }>();

// /feeds/memphis.xml, /feeds/memphis.json, /feeds/memphis.ics, and /feeds/memphis/queer.xml
feeds.get("/:a/:b?", async (c) => {
  const { a, b } = c.req.param();
  const last = b ?? a;
  const m = last.match(/^([a-z0-9-]+)\.(xml|json|ics)$/);
  if (!m) return c.notFound();
  const format = m[2] as "xml" | "json" | "ics";
  // Page feeds: /feeds/a/<artist>.xml, /feeds/v/<venue>.xml, /feeds/o/<organizer>.xml
  const pageKind = b ? ({ a: "artist", v: "venue", o: "organizer" } as const)[a as "a" | "v" | "o"] : undefined;
  if (pageKind) {
    const page = await findPage(c.env, pageKind, m[1]).catch(() => null);
    if (!page) return c.notFound();
    const city = page.cityId ? await c.env.DB.prepare("SELECT id, name, slug, timezone FROM cities WHERE id = ?").bind(page.cityId).first<CityRow>() : null;
    const tz = city?.timezone ?? "America/Chicago";
    const origin = new URL(c.req.url).origin;
    const events = await upcomingFor(c.env, pageKind, page.id);
    const home = `${origin}/${a}/${encodeURIComponent(page.slug)}`;
    const o = { origin, self: `${origin}${c.req.path}`, title: `Assembly: ${page.name}`, tz, home };
    const etag = etagFor(events, `${format}-${a}-${page.id}-${(page.updatedAt ?? "").replace(/\D/g, "")}`);
    if (format === "xml") return respond(c, atom(events, o), "application/atom+xml; charset=utf-8", etag);
    if (format === "json") return respond(c, JSON.stringify(jsonFeed(events, o)), "application/feed+json; charset=utf-8", etag);
    return respond(c, calendar(events, o), "text/calendar; charset=utf-8", etag);
  }
  const citySlug = b ? a : m[1];
  const scene = b ? m[1] : null;
  if (scene && !SCENES.some((s) => s.id === scene)) return c.notFound();
  const city = await c.env.DB.prepare("SELECT id, name, slug, timezone FROM cities WHERE slug = ?").bind(citySlug).first<CityRow>();
  if (!city) return c.notFound();

  const origin = new URL(c.req.url).origin;
  const events = await upcoming(c.env, city.id, scene);
  const title = `Assembly: ${scene ? `${sceneLabel(scene)} in ` : ""}${city.name}`;
  const self = `${origin}${c.req.path}`;
  const o = { origin, self, title, tz: city.timezone, home: origin };
  const etag = etagFor(events, `${format}-${scene ?? "all"}`);
  if (format === "xml") return respond(c, atom(events, o), "application/atom+xml; charset=utf-8", etag);
  if (format === "json") return respond(c, JSON.stringify(jsonFeed(events, o)), "application/feed+json; charset=utf-8", etag);
  return respond(c, calendar(events, o), "text/calendar; charset=utf-8", etag);
});

/** /sitemap.xml: the home page, policy pages, and every upcoming public event. */
export async function sitemap(c: Context<{ Bindings: Env }>) {
  const origin = new URL(c.req.url).origin;
  const rows = await c.env.DB.prepare(
    `SELECT id, updated_at FROM events WHERE status IN ('live', 'cancelled') AND is_sample = 0 AND ends_at > ? ORDER BY starts_at LIMIT 5000`,
  )
    .bind(new Date().toISOString())
    .all<{ id: string; updated_at: string }>();
  // Artist and venue pages with something coming up (an empty page isn't worth a crawl).
  const pagesUp = await c.env.DB.prepare(
    `SELECT 'a' AS k, a.slug AS slug, a.updated_at AS updated_at FROM artists a
       WHERE EXISTS (SELECT 1 FROM lineup_slots s JOIN events e ON e.id = s.event_id WHERE s.artist_id = a.id AND e.status = 'live' AND e.is_sample = 0 AND e.ends_at > ?1)
     UNION ALL
     SELECT 'v', COALESCE(v.slug, v.id), v.updated_at FROM venues v
       WHERE EXISTS (SELECT 1 FROM events e WHERE e.venue_id = v.id AND e.status = 'live' AND e.is_sample = 0 AND e.ends_at > ?1)
     LIMIT 5000`,
  )
    .bind(new Date().toISOString())
    .all<{ k: string; slug: string; updated_at: string | null }>()
    .catch(() => ({ results: [] as { k: string; slug: string; updated_at: string | null }[] }));
  const urls = [
    `<url><loc>${origin}/</loc><changefreq>hourly</changefreq></url>`,
    `<url><loc>${origin}/feed</loc><changefreq>hourly</changefreq></url>`,
    ...["terms", "privacy", "guidelines"].map((p) => `<url><loc>${origin}/${p}</loc><changefreq>monthly</changefreq></url>`),
    ...(rows.results ?? []).map(
      (r) => `<url><loc>${origin}/e/${xml(encodeURIComponent(r.id))}</loc><lastmod>${new Date(r.updated_at).toISOString()}</lastmod></url>`,
    ),
    ...(pagesUp.results ?? []).map(
      (r) => `<url><loc>${origin}/${r.k}/${xml(encodeURIComponent(r.slug))}</loc>${r.updated_at ? `<lastmod>${new Date(r.updated_at).toISOString()}</lastmod>` : ""}</url>`,
    ),
  ];
  return c.body(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`, 200, {
    "Content-Type": "application/xml; charset=utf-8",
    "Cache-Control": "public, max-age=3600",
  });
}
