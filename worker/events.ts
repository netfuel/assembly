import { Hono } from "hono";
import type { AppContext } from "./env";
import type { EventDetail, EventSummary, LineupSlot, RsvpStatus, SceneId } from "../shared/types";

interface EventRow {
  id: string;
  title: string;
  pitch: string | null;
  description: string | null;
  starts_at: string;
  ends_at: string;
  address: string;
  neighborhood: string | null;
  lat: number;
  lng: number;
  getting_there: string | null;
  door_price: string | null;
  ticket_url: string | null;
  policy_tags: string;
  scenes: string;
  flyer_key: string | null;
  video_id: string | null;
  is_sample: number;
  updated_at: string;
  venue_name: string | null;
  venue_type: string | null;
  going_count: number;
}

const EVENT_SELECT = `
  SELECT e.id, e.title, e.pitch, e.description, e.starts_at, e.ends_at, e.address, e.neighborhood,
         e.lat, e.lng, e.getting_there, e.door_price, e.ticket_url, e.policy_tags, e.scenes,
         e.flyer_key, e.video_id, e.is_sample, e.updated_at,
         v.name AS venue_name, v.type AS venue_type,
         (SELECT COUNT(*) FROM rsvps r WHERE r.event_id = e.id AND r.status = 'going') AS going_count
  FROM events e LEFT JOIN venues v ON v.id = e.venue_id`;

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function toSummary(row: EventRow): EventSummary {
  return {
    id: row.id,
    title: row.title,
    pitch: row.pitch,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    venueName: row.venue_name,
    venueType: row.venue_type,
    address: row.address,
    neighborhood: row.neighborhood,
    lat: row.lat,
    lng: row.lng,
    doorPrice: row.door_price,
    ticketUrl: row.ticket_url,
    scenes: parseJson<SceneId[]>(row.scenes, []),
    policyTags: parseJson<string[]>(row.policy_tags, []),
    flyerUrl: row.flyer_key ? `/api/media/${encodeURIComponent(row.flyer_key)}` : null,
    videoId: row.video_id,
    goingCount: row.going_count,
    isSample: row.is_sample === 1,
  };
}

function isIso(value: string | undefined): value is string {
  return !!value && !Number.isNaN(Date.parse(value));
}

export const events = new Hono<AppContext>();

/** Events in a city that overlap a time window. Defaults: six hours ago to two weeks out. */
events.get("/", async (c) => {
  const city = c.req.query("city") ?? c.env.DEFAULT_CITY;
  const now = Date.now();
  const fromQ = c.req.query("from");
  const toQ = c.req.query("to");
  const from = isIso(fromQ) ? new Date(fromQ).toISOString() : new Date(now - 6 * 3600e3).toISOString();
  const to = isIso(toQ) ? new Date(toQ).toISOString() : new Date(now + 14 * 86400e3).toISOString();

  const { results } = await c.env.DB.prepare(
    `${EVENT_SELECT}
     WHERE e.city_id = ? AND e.status = 'live' AND e.ends_at > ? AND e.starts_at < ?
     ORDER BY e.starts_at ASC LIMIT 500`,
  )
    .bind(city, from, to)
    .all<EventRow>();

  c.header("Cache-Control", "public, max-age=30");
  return c.json({ events: results.map(toSummary) });
});

events.get("/:id", async (c) => {
  const id = c.req.param("id");
  const row = await c.env.DB.prepare(`${EVENT_SELECT} WHERE e.id = ? AND e.status IN ('live', 'cancelled')`)
    .bind(id)
    .first<EventRow>();
  if (!row) return c.json({ error: "We couldn't find that event. It may have been removed." }, 404);

  const { results: slots } = await c.env.DB.prepare(
    `SELECT a.id, a.name, a.slug, a.links, s.set_start, s.room, s.note
     FROM lineup_slots s JOIN artists a ON a.id = s.artist_id
     WHERE s.event_id = ? ORDER BY s.position ASC`,
  )
    .bind(id)
    .all<{ id: string; name: string; slug: string; links: string; set_start: string | null; room: string | null; note: string | null }>();

  let viewerRsvp: RsvpStatus | null = null;
  const userId = c.get("userId");
  if (userId) {
    const r = await c.env.DB.prepare("SELECT status FROM rsvps WHERE event_id = ? AND user_id = ?")
      .bind(id, userId)
      .first<{ status: RsvpStatus }>();
    viewerRsvp = r?.status ?? null;
  }

  const lineup: LineupSlot[] = slots.map((s) => ({
    artistId: s.id,
    name: s.name,
    slug: s.slug,
    links: parseJson(s.links, {}),
    setStart: s.set_start,
    room: s.room,
    note: s.note,
  }));

  const detail: EventDetail = {
    ...toSummary(row),
    description: row.description,
    gettingThere: row.getting_there,
    lineup,
    viewerRsvp,
    updatedAt: row.updated_at,
  };
  c.header("Cache-Control", userId ? "private, no-store" : "public, max-age=30");
  return c.json(detail);
});

events.put("/:id/rsvp", async (c) => {
  const userId = c.get("userId");
  if (!userId) return c.json({ error: "Sign in to RSVP." }, 401);
  const body = await c.req.json<{ status?: string }>().catch(() => ({}) as { status?: string });
  if (body.status !== "going" && body.status !== "interested") {
    return c.json({ error: "Status must be going or interested." }, 400);
  }
  const id = c.req.param("id");
  const exists = await c.env.DB.prepare("SELECT 1 FROM events WHERE id = ? AND status = 'live'").bind(id).first();
  if (!exists) return c.json({ error: "We couldn't find that event." }, 404);
  await c.env.DB.prepare(
    `INSERT INTO rsvps (event_id, user_id, status) VALUES (?, ?, ?)
     ON CONFLICT (event_id, user_id) DO UPDATE SET status = excluded.status`,
  )
    .bind(id, userId, body.status)
    .run();
  return c.json({ status: body.status });
});

events.delete("/:id/rsvp", async (c) => {
  const userId = c.get("userId");
  if (!userId) return c.json({ error: "Sign in to change your RSVP." }, 401);
  await c.env.DB.prepare("DELETE FROM rsvps WHERE event_id = ? AND user_id = ?").bind(c.req.param("id"), userId).run();
  return c.json({ status: null });
});
