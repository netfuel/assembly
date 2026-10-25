// Link previews: /e/:id serves the app's index.html with the event's title, date, place, and flyer
// in Open Graph and Twitter tags, so shared links unfurl in iMessage, Instagram DMs, Slack, and so on.
import { Hono } from "hono";
import type { Env } from "./env";

interface Row {
  id: string;
  title: string;
  pitch: string | null;
  starts_at: string;
  ends_at: string;
  status: string;
  neighborhood: string | null;
  flyer_key: string | null;
  venue_name: string | null;
  timezone: string;
  address: string;
  lat: number;
  lng: number;
  door_price: string | null;
  ticket_url: string | null;
  lineup: string | null;
  host_name: string | null;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function previewText(e: Row): { title: string; description: string } {
  const tz = e.timezone;
  const day = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" }).format(new Date(e.starts_at));
  const t = (iso: string) =>
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" })
      .format(new Date(iso))
      .replace(":00", "")
      .replace(" AM", " am")
      .replace(" PM", " pm");
  const place = [e.venue_name, e.neighborhood].filter(Boolean).join(", ");
  const when = `${day}, ${t(e.starts_at)} to ${t(e.ends_at)}`;
  const status = e.status === "cancelled" ? "Cancelled. " : "";
  return {
    title: `${e.status === "cancelled" ? "Cancelled: " : ""}${e.title}`,
    description: `${status}${when}${place ? ` · ${place}` : ""}${e.pitch ? `. ${e.pitch}` : ""}`.slice(0, 280),
  };
}

export const og = new Hono<{ Bindings: Env }>();

og.get("/:id", async (c) => {
  const origin = new URL(c.req.url).origin;
  const page = await c.env.ASSETS.fetch(new Request(`${origin}/`, { headers: c.req.raw.headers }));
  const id = decodeURIComponent(c.req.param("id"));
  const e = await c.env.DB.prepare(
    `SELECT e.id, e.title, e.pitch, e.starts_at, e.ends_at, e.status, e.neighborhood, e.flyer_key, v.name AS venue_name, ci.timezone,
            e.address, e.lat, e.lng, e.door_price, e.ticket_url,
            (SELECT json_group_array(name) FROM (SELECT ar.name FROM lineup_slots ls JOIN artists ar ON ar.id = ls.artist_id
               WHERE ls.event_id = e.id ORDER BY ls.position)) AS lineup,
            (SELECT u.display_name FROM event_hosts h JOIN users u ON u.id = h.user_id WHERE h.event_id = e.id AND h.role = 'owner' LIMIT 1) AS host_name
     FROM events e JOIN cities ci ON ci.id = e.city_id LEFT JOIN venues v ON v.id = e.venue_id
     WHERE e.id = ? AND e.status IN ('live', 'cancelled')`,
  )
    .bind(id)
    .first<Row>()
    .catch(() => null);
  if (!page.ok || !(page.headers.get("Content-Type") ?? "").includes("text/html")) return page;
  // Unknown, hidden, or in-review events get the plain app page (the app shows its own message), kept out of search.
  if (!e) {
    const res = new Response(page.body, page);
    res.headers.set("X-Robots-Tag", "noindex");
    res.headers.set("Cache-Control", "public, max-age=60");
    return res;
  }

  const { title, description } = previewText(e);
  const url = `${origin}/e/${encodeURIComponent(e.id)}`;
  const image = e.flyer_key ? `${origin}/api/media/${e.flyer_key}` : `${origin}/icons/og.png`;
  const tags = [
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="Assembly">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(description)}">`,
    `<meta property="og:url" content="${esc(url)}">`,
    `<meta property="og:image" content="${esc(image)}">`,
    `<meta property="og:image:alt" content="${esc(e.flyer_key ? `Flyer for ${e.title}` : "Assembly")}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<link rel="canonical" href="${esc(url)}">`,
    `<script type="application/ld+json">${structuredData(e, url, image, origin)}</script>`,
  ].join("");

  const rewritten = new HTMLRewriter()
    .on("title", { element: (el) => void el.setInnerContent(`${title} · Assembly`) })
    .on('meta[name="description"]', { element: (el) => void el.setAttribute("content", description) })
    // The page's default preview tags give way to the event's.
    .on('meta[property^="og:"], meta[name^="twitter:"], link[rel="canonical"]', { element: (el) => void el.remove() })
    .on("head", { element: (el) => void el.append(tags, { html: true }) })
    .transform(page);
  const res = new Response(rewritten.body, rewritten);
  res.headers.set("Cache-Control", "public, max-age=60");
  return res;
});

/** schema.org/Event, so search engines can show date, place, and tickets. Escaped so it can't close the script tag. */
export function structuredData(e: Row, url: string, image: string, origin: string) {
  let performers: string[] = [];
  try {
    performers = JSON.parse(e.lineup ?? "[]");
  } catch {
    performers = [];
  }
  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "MusicEvent",
    name: e.title,
    url,
    image: [image],
    startDate: e.starts_at,
    endDate: e.ends_at,
    eventStatus: e.status === "cancelled" ? "https://schema.org/EventCancelled" : "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    ...(e.pitch ? { description: e.pitch } : {}),
    location: {
      "@type": "Place",
      name: e.venue_name ?? e.neighborhood ?? e.address,
      address: e.address,
      geo: { "@type": "GeoCoordinates", latitude: e.lat, longitude: e.lng },
    },
    ...(performers.length ? { performer: performers.map((name) => ({ "@type": "PerformingGroup", name })) } : {}),
    organizer: e.host_name ? { "@type": "Person", name: e.host_name } : { "@type": "Organization", name: "Assembly", url: origin },
  };
  if (e.ticket_url) {
    const price = e.door_price?.match(/\$\s?(\d+(?:\.\d{2})?)/)?.[1];
    data.offers = {
      "@type": "Offer",
      url: e.ticket_url,
      ...(price ? { price, priceCurrency: "USD" } : {}),
      availability: "https://schema.org/InStock",
    };
  } else if (e.door_price && /\bfree\b/i.test(e.door_price)) {
    data.isAccessibleForFree = true;
  }
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
