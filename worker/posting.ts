import { Hono, type Context } from "hono";
import { notifyUsers, rsvpUserIds } from "./push";
import { describeChange } from "./notify";
import { isModerator } from "./moderation";
import type { AppContext } from "./env";
import { slugify, validateEvent, type EventInput } from "./validate";
import type { ArtistLinks } from "../shared/types";

// Pins must fall within this many degrees of the city center (about 60 km).
const CITY_RADIUS_DEG = 0.6;
const REPORTS_TO_HIDE = 3;

export async function cityBounds(db: D1Database, cityId: string) {
  const row = await db.prepare("SELECT center_lat, center_lng FROM cities WHERE id = ?").bind(cityId).first<{ center_lat: number; center_lng: number }>();
  const center: [number, number] = row ? [row.center_lng, row.center_lat] : [-90.01, 35.14];
  return { center, radiusDeg: CITY_RADIUS_DEG };
}

/** A small fixed-window rate limit in KV, per user and action. */
export async function rateLimit(kv: KVNamespace, key: string, max: number, windowSec: number): Promise<boolean> {
  const bucket = Math.floor(Date.now() / 1000 / windowSec);
  const k = `rl:${key}:${bucket}`;
  const n = Number((await kv.get(k)) ?? 0);
  if (n >= max) return false;
  await kv.put(k, String(n + 1), { expirationTtl: windowSec + 60 });
  return true;
}

function randomSuffix(len = 6) {
  const abc = "abcdefghijkmnpqrstuvwxyz23456789";
  return [...crypto.getRandomValues(new Uint8Array(len))].map((b) => abc[b % abc.length]).join("");
}

async function isHost(db: D1Database, eventId: string, userId: string) {
  return !!(await db.prepare("SELECT 1 FROM event_hosts WHERE event_id = ? AND user_id = ?").bind(eventId, userId).first());
}

/** Resolves the venue (if any) to its address and coordinates, so every event stores its own location. */
async function resolveLocation(db: D1Database, cityId: string, v: EventInput) {
  if (!v.venueId) return { venueId: null, address: v.address, neighborhood: v.neighborhood, lat: v.lat, lng: v.lng };
  const venue = await db
    .prepare("SELECT id, address, neighborhood, lat, lng FROM venues WHERE id = ? AND city_id = ?")
    .bind(v.venueId, cityId)
    .first<{ id: string; address: string; neighborhood: string | null; lat: number; lng: number }>();
  if (!venue) return null;
  return { venueId: venue.id, address: venue.address, neighborhood: venue.neighborhood, lat: venue.lat, lng: venue.lng };
}

/** Statements that replace an event's lineup. Artists are matched by slug and reused across events. */
async function lineupStatements(db: D1Database, eventId: string, lineup: EventInput["lineup"]) {
  const stmts: D1PreparedStatement[] = [db.prepare("DELETE FROM lineup_slots WHERE event_id = ?").bind(eventId)];
  const seen = new Set<string>();
  for (const [position, slot] of lineup.entries()) {
    let artistId = slot.artistId ?? null;
    let existing: { id: string; links: string } | null = null;
    if (artistId) existing = await db.prepare("SELECT id, links FROM artists WHERE id = ?").bind(artistId).first();
    if (!existing) {
      existing = await db.prepare("SELECT id, links FROM artists WHERE slug = ?").bind(slugify(slot.name)).first();
    }
    if (existing) {
      artistId = existing.id;
      // Fill in links the artist doesn't have yet; never overwrite links someone else set.
      const current = JSON.parse(existing.links || "{}") as ArtistLinks;
      const merged = { ...slot.links, ...current };
      if (JSON.stringify(merged) !== JSON.stringify(current)) {
        stmts.push(db.prepare("UPDATE artists SET links = ? WHERE id = ?").bind(JSON.stringify(merged), artistId));
      }
    } else {
      artistId = crypto.randomUUID();
      stmts.push(
        db.prepare("INSERT INTO artists (id, name, slug, links) VALUES (?, ?, ?, ?)").bind(artistId, slot.name, slugify(slot.name), JSON.stringify(slot.links)),
      );
    }
    if (seen.has(artistId)) continue; // the same artist twice in one lineup
    seen.add(artistId);
    stmts.push(
      db
        .prepare("INSERT INTO lineup_slots (event_id, artist_id, set_start, room, note, position) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(eventId, artistId, slot.setStart, slot.room, slot.note, position),
    );
  }
  return stmts;
}

/** Video uploads are recorded per user in KV, so you can only attach videos you uploaded. */
async function ownsVideo(kv: KVNamespace, uid: string, userId: string) {
  return (await kv.get(`video:${uid}`)) === userId;
}

function needUser(c: Context<AppContext>) {
  const userId = c.get("userId");
  return userId ? userId : null;
}

export const posting = new Hono<AppContext>();

posting.post("/events", async (c) => {
  const userId = needUser(c);
  if (!userId) return c.json({ error: "Sign in to post an event." }, 401);
  if (!(await rateLimit(c.env.SESSIONS, `post:${userId}`, 10, 3600))) {
    return c.json({ error: "You've posted a lot in the last hour. Try again a little later." }, 429);
  }
  const city = c.env.DEFAULT_CITY;
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const result = validateEvent(body, { now: new Date(), bounds: await cityBounds(c.env.DB, city), userId });
  if (!result.ok) return c.json({ error: "Some details need another look.", fields: result.errors }, 400);
  const v = result.value;
  if (v.videoId && !(await ownsVideo(c.env.SESSIONS, v.videoId, userId))) {
    return c.json({ error: "Some details need another look.", fields: { video: "That video didn't upload from this account." } }, 400);
  }
  const loc = await resolveLocation(c.env.DB, city, v);
  if (!loc) return c.json({ error: "Some details need another look.", fields: { venueId: "That venue isn't listed." } }, 400);

  const id = `${slugify(v.title)}-${randomSuffix()}`;
  const db = c.env.DB;
  // A new organizer's first event waits for a moderator (status 'draft' = in review).
  const trusted = (await isTrustedOrganizer(db, userId)) || (await isModerator(c.env, userId));
  const status = trusted ? "live" : "draft";
  await db.batch([
    db
      .prepare(
        `INSERT INTO events (id, city_id, venue_id, title, pitch, description, starts_at, ends_at, address, neighborhood, lat, lng,
           getting_there, door_price, ticket_url, policy_tags, scenes, flyer_key, video_id, status, is_sample)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      )
      .bind(
        id, city, loc.venueId, v.title, v.pitch, v.description, v.startsAt, v.endsAt, loc.address, loc.neighborhood, loc.lat, loc.lng,
        v.gettingThere, v.doorPrice, v.ticketUrl, JSON.stringify(v.policyTags), JSON.stringify(v.scenes), v.flyerKey, v.videoId, status,
      ),
    db.prepare("INSERT INTO event_hosts (event_id, user_id, role) VALUES (?, ?, 'owner')").bind(id, userId),
    ...(await lineupStatements(db, id, v.lineup)),
  ]);
  await setFlyerDownloads(c.env.DB, id, body?.flyerDownloads !== false);
  return c.json({ id, status }, 201);
});

/**
 * Trusted organizers post straight to the map: verified ones, and anyone who already has an
 * approved event (live or since cancelled). Everyone else's first post goes to review.
 */
export async function isTrustedOrganizer(db: D1Database, userId: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT (SELECT is_verified_organizer FROM users WHERE id = ?) AS verified,
              EXISTS (SELECT 1 FROM events e JOIN event_hosts h ON h.event_id = e.id
                      WHERE h.user_id = ? AND e.status IN ('live', 'cancelled')) AS approved`,
    )
    .bind(userId, userId)
    .first<{ verified: number | null; approved: number }>();
  return row?.verified === 1 || row?.approved === 1;
}

posting.patch("/events/:id", async (c) => {
  const userId = needUser(c);
  if (!userId) return c.json({ error: "Sign in to edit this event." }, 401);
  const id = c.req.param("id");
  // Hosts edit their own events; moderators can edit any (imported listings, posts made for an organizer).
  if (!(await isHost(c.env.DB, id, userId)) && !(await isModerator(c.env, userId))) return c.json({ error: "Only the event's hosts can edit it." }, 403);
  const city = c.env.DEFAULT_CITY;
  const current = await c.env.DB.prepare("SELECT video_id, flyer_key, title, starts_at, ends_at, address, venue_id, status FROM events WHERE id = ?")
    .bind(id)
    .first<{ video_id: string | null; flyer_key: string | null; title: string; starts_at: string; ends_at: string; address: string; venue_id: string | null; status: string }>();
  const raw = ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  // The flyer already on this event stays attachable even if another host uploaded it.
  const keepFlyer = !!current?.flyer_key && raw.flyerKey === current.flyer_key;
  const result = validateEvent(keepFlyer ? { ...raw, flyerKey: null } : raw, { now: new Date(), bounds: await cityBounds(c.env.DB, city), userId, editing: true });
  if (!result.ok) return c.json({ error: "Some details need another look.", fields: result.errors }, 400);
  const v = result.value;
  if (keepFlyer) v.flyerKey = current!.flyer_key;

  // Likewise the video already on this event; a new one must be the editor's own upload.
  if (v.videoId && v.videoId !== current?.video_id && !(await ownsVideo(c.env.SESSIONS, v.videoId, userId))) {
    return c.json({ error: "Some details need another look.", fields: { video: "That video didn't upload from this account." } }, 400);
  }
  const loc = await resolveLocation(c.env.DB, city, v);
  if (!loc) return c.json({ error: "Some details need another look.", fields: { venueId: "That venue isn't listed." } }, 400);

  const db = c.env.DB;
  await db.batch([
    db
      .prepare(
        `UPDATE events SET venue_id = ?, title = ?, pitch = ?, description = ?, starts_at = ?, ends_at = ?, address = ?, neighborhood = ?,
           lat = ?, lng = ?, getting_there = ?, door_price = ?, ticket_url = ?, policy_tags = ?, scenes = ?, flyer_key = ?, video_id = ?,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?`,
      )
      .bind(
        loc.venueId, v.title, v.pitch, v.description, v.startsAt, v.endsAt, loc.address, loc.neighborhood, loc.lat, loc.lng,
        v.gettingThere, v.doorPrice, v.ticketUrl, JSON.stringify(v.policyTags), JSON.stringify(v.scenes),
        v.flyerKey, v.videoId, id,
      ),
    ...(await lineupStatements(db, id, v.lineup)),
  ]);

  // Tell people who RSVP'd when the plan changes: time or place. Small text edits don't notify.
  if (current && current.status === "live") {
    const tz = (await c.env.DB.prepare("SELECT timezone FROM cities WHERE id = ?").bind(city).first<{ timezone: string }>())?.timezone ?? "America/Chicago";
    const change = describeChange(current, { startsAt: v.startsAt, endsAt: v.endsAt, address: loc.address, venueId: loc.venueId }, tz);
    if (change) {
      c.executionCtx.waitUntil(
        rsvpUserIds(c.env, id)
          .then((users) => notifyUsers(c.env, users, { title: `Updated: ${v.title}`, body: change, url: `/e/${id}`, tag: `update-${id}` }))
          .catch((err) => console.error("update push", err)),
      );
    }
  }
  if (typeof raw.flyerDownloads === "boolean") await setFlyerDownloads(c.env.DB, id, raw.flyerDownloads);
  return c.json({ id });
});

posting.post("/events/:id/cancel", async (c) => {
  const userId = needUser(c);
  if (!userId) return c.json({ error: "Sign in to cancel this event." }, 401);
  const id = c.req.param("id");
  if (!(await isHost(c.env.DB, id, userId)) && !(await isModerator(c.env, userId))) return c.json({ error: "Only the event's hosts can cancel it." }, 403);
  // Only live events can be cancelled; a hidden (reported) event stays hidden until reviewed.
  const res = await c.env.DB.prepare(
    "UPDATE events SET status = 'cancelled', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND status = 'live'",
  )
    .bind(id)
    .run();
  if (!res.meta.changes) return c.json({ error: "This event can't be cancelled right now." }, 409);
  const ev = await c.env.DB.prepare("SELECT title FROM events WHERE id = ?").bind(id).first<{ title: string }>();
  c.executionCtx.waitUntil(
    rsvpUserIds(c.env, id)
      .then((users) =>
        notifyUsers(c.env, users, { title: `Cancelled: ${ev?.title ?? "an event you saved"}`, body: "The organizer called it off. Tap for details.", url: `/e/${id}`, tag: `update-${id}` }),
      )
      .catch((err) => console.error("cancel push", err)),
  );
  return c.json({ id, status: "cancelled" });
});

const REPORT_REASONS = new Set(["unsafe", "hateful", "spam", "wrong-info", "other"]);

posting.post("/events/:id/report", async (c) => {
  const userId = needUser(c);
  if (!userId) return c.json({ error: "Sign in to report an event." }, 401);
  const id = c.req.param("id");
  const body = await c.req.json<{ reason?: string; note?: string }>().catch(() => ({}) as { reason?: string; note?: string });
  const reason = REPORT_REASONS.has(body.reason ?? "") ? body.reason! : "other";
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : "";
  const db = c.env.DB;
  const exists = await db.prepare("SELECT 1 FROM events WHERE id = ?").bind(id).first();
  if (!exists) return c.json({ error: "We couldn't find that event." }, 404);
  const already = await db
    .prepare("SELECT 1 FROM reports WHERE target_type = 'event' AND target_id = ? AND reporter_id = ?")
    .bind(id, userId)
    .first();
  if (!already) {
    await db
      .prepare("INSERT INTO reports (id, target_type, target_id, reporter_id, reason) VALUES (?, 'event', ?, ?, ?)")
      .bind(crypto.randomUUID(), id, userId, note ? `${reason}: ${note}` : reason)
      .run();
  }
  // Three different people reporting hides the event until someone reviews it.
  const n = await db
    .prepare("SELECT COUNT(DISTINCT reporter_id) AS n FROM reports WHERE target_type = 'event' AND target_id = ? AND status = 'open'")
    .bind(id)
    .first<{ n: number }>();
  if ((n?.n ?? 0) >= REPORTS_TO_HIDE) {
    await db.prepare("UPDATE events SET status = 'hidden' WHERE id = ? AND status = 'live'").bind(id).run();
  }
  return c.json({ ok: true });
});

posting.get("/venues", async (c) => {
  const city = c.req.query("city") ?? c.env.DEFAULT_CITY;
  const { results } = await c.env.DB.prepare(
    "SELECT id, name, type, address, neighborhood, lat, lng FROM venues WHERE city_id = ? ORDER BY name",
  )
    .bind(city)
    .all();
  c.header("Cache-Control", "public, max-age=300");
  return c.json({ venues: results });
});

posting.get("/artists", async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  if (q.length < 2) return c.json({ artists: [] });
  const { results } = await c.env.DB.prepare("SELECT id, name, slug, links FROM artists WHERE name LIKE ? ORDER BY name LIMIT 8")
    .bind(`%${q.replace(/[%_]/g, "")}%`)
    .all<{ id: string; name: string; slug: string; links: string }>();
  return c.json({ artists: results.map((a) => ({ ...a, links: JSON.parse(a.links || "{}") })) });
});

posting.get("/me/events", async (c) => {
  const userId = needUser(c);
  if (!userId) return c.json({ hosting: [], going: [] });
  const db = c.env.DB;
  const [hosting, going] = await Promise.all([
    db
      .prepare(
        `SELECT e.id, e.title, e.starts_at, e.status FROM events e JOIN event_hosts h ON h.event_id = e.id
         WHERE h.user_id = ? ORDER BY e.starts_at DESC LIMIT 50`,
      )
      .bind(userId)
      .all(),
    db
      .prepare(
        `SELECT e.id, e.title, e.starts_at, e.status, r.status AS rsvp, e.ticket_url, v.name AS venue_name
         FROM events e JOIN rsvps r ON r.event_id = e.id LEFT JOIN venues v ON v.id = e.venue_id
         WHERE r.user_id = ? AND e.ends_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ORDER BY e.starts_at ASC LIMIT 50`,
      )
      .bind(userId)
      .all(),
  ]);
  c.header("Cache-Control", "private, no-store");
  return c.json({ hosting: hosting.results, going: going.results });
});

/** Address search for the posting form, through Photon (OpenStreetMap data), biased to the city. */
posting.get("/geocode", async (c) => {
  const q = (c.req.query("q") ?? "").trim().slice(0, 120);
  if (q.length < 3) return c.json({ results: [] });
  const { center, radiusDeg } = await cityBounds(c.env.DB, c.env.DEFAULT_CITY);
  const url = new URL("https://photon.komoot.io/api/");
  url.searchParams.set("q", q);
  url.searchParams.set("lat", String(center[1]));
  url.searchParams.set("lon", String(center[0]));
  url.searchParams.set("limit", "8");
  url.searchParams.set("lang", "en");
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Assembly (https://assembly.rsvp)" }, cf: { cacheTtl: 86400, cacheEverything: true } });
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as {
      features: { geometry: { coordinates: [number, number] }; properties: Record<string, string | undefined> }[];
    };
    const results = data.features
      .filter(({ geometry: { coordinates: [lng, lat] } }) => Math.abs(lat - center[1]) <= radiusDeg && Math.abs(lng - center[0]) <= radiusDeg)
      .slice(0, 5)
      .map(({ geometry: { coordinates: [lng, lat] }, properties: p }) => {
        const street = [p.housenumber, p.street].filter(Boolean).join(" ");
        const label = [p.name && p.name !== street ? p.name : null, street || null, p.city].filter(Boolean).join(", ");
        return { label, address: [street || p.name, p.city].filter(Boolean).join(", "), neighborhood: p.district ?? p.locality ?? null, lat, lng };
      });
    return c.json({ results });
  } catch {
    return c.json({ results: [], error: "Address search isn't responding. Place the pin by hand." });
  }
});

/** Flyer downloads are on by default; a row in flyer_downloads_off turns them off. Quiet before migration 0009. */
export async function setFlyerDownloads(db: D1Database, eventId: string, on: boolean) {
  try {
    if (on) await db.prepare("DELETE FROM flyer_downloads_off WHERE event_id = ?").bind(eventId).run();
    else await db.prepare("INSERT OR IGNORE INTO flyer_downloads_off (event_id) VALUES (?)").bind(eventId).run();
  } catch (err) {
    if (!(err instanceof Error && /no such table/i.test(err.message))) throw err;
  }
}

export async function flyerDownloadsOn(db: D1Database, eventId: string): Promise<boolean> {
  try {
    return !(await db.prepare("SELECT 1 FROM flyer_downloads_off WHERE event_id = ?").bind(eventId).first());
  } catch {
    return true;
  }
}
