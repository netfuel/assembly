// Check-in: "I'm here" for an event that's on. The phone compares its own location with the event's and sends
// only whether it's close; we store who, which event, when, and how, never coordinates. A door code (or its QR)
// from the host is the fallback for warehouses, basements, and bad GPS.
import { Hono } from "hono";
import type { AppContext, Env } from "./env";
import { isModerator } from "./moderation";
import { rateLimit } from "./posting";
import { alertFriendsOfCheckIn } from "./friends";
import type { Presence } from "../shared/types";

const OPEN_BEFORE_MS = 30 * 60e3;
const CLOSE_AFTER_MS = 30 * 60e3;
/** Check-ins stop counting as "here now" two hours after the end, without anyone tapping Check out. */
export const AUTO_CHECKOUT_MS = 2 * 3600e3;

export function checkinWindow(startsAt: string, endsAt: string) {
  return { opens: Date.parse(startsAt) - OPEN_BEFORE_MS, closes: Date.parse(endsAt) + CLOSE_AFTER_MS };
}

/** True when the error is a missing table or column: the database hasn't had migration 0005 yet. */
export function notMigrated(err: unknown) {
  return err instanceof Error && /no such (table|column)/i.test(err.message);
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function newDoorCode() {
  return [...crypto.getRandomValues(new Uint8Array(6))].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

export async function canHost(env: Env, eventId: string, userId: string | null) {
  if (!userId) return false;
  if (await env.DB.prepare("SELECT 1 FROM event_hosts WHERE event_id = ? AND user_id = ?").bind(eventId, userId).first()) return true;
  return isModerator(env, userId);
}

/** People checked in now, per event. Empty (not an error) on a database without check-ins yet. */
export async function hereNowCounts(env: Env, eventIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!eventIds.length) return out;
  try {
    const since = new Date(Date.now() - AUTO_CHECKOUT_MS).toISOString();
    const { results } = await env.DB.prepare(
      `SELECT ck.event_id, COUNT(*) AS n FROM checkins ck JOIN events e ON e.id = ck.event_id
       WHERE ck.checked_out_at IS NULL AND e.ends_at > ? AND e.starts_at < ?
         AND ck.event_id IN (${eventIds.map(() => "?").join(",")})
       GROUP BY ck.event_id`,
    )
      .bind(since, new Date(Date.now() + OPEN_BEFORE_MS).toISOString(), ...eventIds)
      .all<{ event_id: string; n: number }>();
    for (const r of results) out.set(r.event_id, r.n);
  } catch (err) {
    if (!notMigrated(err)) console.error("here now", err);
  }
  return out;
}

interface EventTimes {
  id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  door_code: string | null;
}

async function presence(env: Env, e: EventTimes, userId: string | null): Promise<Presence> {
  const { opens, closes } = checkinWindow(e.starts_at, e.ends_at);
  const now = Date.now();
  const here = await hereNowCounts(env, [e.id]);
  const mine = userId
    ? await env.DB.prepare("SELECT method, checked_out_at FROM checkins WHERE event_id = ? AND user_id = ?")
        .bind(e.id, userId)
        .first<{ method: "gps" | "code" | "host"; checked_out_at: string | null }>()
    : null;
  const autoOut = now > Date.parse(e.ends_at) + AUTO_CHECKOUT_MS;
  return {
    hereNow: here.get(e.id) ?? 0,
    open: e.status === "live" && now >= opens && now <= closes,
    opensAt: new Date(opens).toISOString(),
    closesAt: new Date(closes).toISOString(),
    viewerIsHost: await canHost(env, e.id, userId),
    viewer: mine ? { checkedIn: true, method: mine.method, checkedOut: !!mine.checked_out_at || autoOut } : null,
  };
}

export const checkins = new Hono<AppContext>();

async function loadEvent(env: Env, id: string) {
  return env.DB.prepare("SELECT id, starts_at, ends_at, status, door_code FROM events WHERE id = ? AND status IN ('live', 'cancelled')")
    .bind(id)
    .first<EventTimes>();
}

checkins.get("/:id/presence", async (c) => {
  try {
    const e = await loadEvent(c.env, c.req.param("id"));
    if (!e) return c.json({ error: "We couldn't find that event." }, 404);
    c.header("Cache-Control", "private, no-store");
    return c.json(await presence(c.env, e, c.get("userId")));
  } catch (err) {
    if (notMigrated(err)) return c.json({ error: "Check-in isn't set up on this server yet." }, 503);
    throw err;
  }
});

/**
 * Check in. Body: { method: "gps", near: true } after the phone's own distance check, or { method: "code", code }.
 * Hosts can always check in (method "host").
 */
checkins.post("/:id/checkin", async (c) => {
  const userId = c.get("userId");
  if (!userId) return c.json({ error: "Sign in to check in." }, 401);
  if (!(await rateLimit(c.env.SESSIONS, `checkin:${userId}`, 30, 3600))) return c.json({ error: "Too many tries. Wait a few minutes." }, 429);
  try {
    const e = await loadEvent(c.env, c.req.param("id"));
    if (!e) return c.json({ error: "We couldn't find that event." }, 404);
    if (e.status !== "live") return c.json({ error: "This event was cancelled." }, 409);
    const { opens, closes } = checkinWindow(e.starts_at, e.ends_at);
    const now = Date.now();
    if (now < opens) return c.json({ error: "Check-in opens 30 minutes before the start." }, 409);
    if (now > closes) return c.json({ error: "Check-in for this one has closed." }, 409);

    const body = (await c.req.json().catch(() => ({}))) as { method?: string; near?: boolean; code?: string };
    let method: "gps" | "code" | "host";
    if (await canHost(c.env, e.id, userId)) method = "host";
    else if (body.method === "gps") {
      if (body.near !== true) return c.json({ error: "You don't look close enough yet. Use the door code instead." }, 400);
      method = "gps";
    } else if (body.method === "code") {
      // Codes are short, so tries are limited per event as well as per person.
      if (!(await rateLimit(c.env.SESSIONS, `doorcode:${e.id}:${userId}`, 8, 900))) return c.json({ error: "Too many wrong codes. Ask the door for help." }, 429);
      const code = (body.code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (!e.door_code || code !== e.door_code) return c.json({ error: "That code doesn't match. Check it at the door." }, 400);
      method = "code";
    } else return c.json({ error: "Choose how to check in." }, 400);

    await c.env.DB.prepare(
      `INSERT INTO checkins (event_id, user_id, method) VALUES (?, ?, ?)
       ON CONFLICT (event_id, user_id) DO UPDATE SET checked_out_at = NULL, method = excluded.method`,
    )
      .bind(e.id, userId, method)
      .run();
    c.executionCtx.waitUntil(alertFriendsOfCheckIn(c.env, e.id, userId));
    return c.json(await presence(c.env, e, userId));
  } catch (err) {
    if (notMigrated(err)) return c.json({ error: "Check-in isn't set up on this server yet." }, 503);
    throw err;
  }
});

checkins.delete("/:id/checkin", async (c) => {
  const userId = c.get("userId");
  if (!userId) return c.json({ error: "Sign in first." }, 401);
  try {
    const e = await loadEvent(c.env, c.req.param("id"));
    if (!e) return c.json({ error: "We couldn't find that event." }, 404);
    await c.env.DB.prepare("UPDATE checkins SET checked_out_at = ? WHERE event_id = ? AND user_id = ?")
      .bind(new Date().toISOString(), e.id, userId)
      .run();
    return c.json(await presence(c.env, e, userId));
  } catch (err) {
    if (notMigrated(err)) return c.json({ error: "Check-in isn't set up on this server yet." }, 503);
    throw err;
  }
});

/** The door code for hosts (made on first ask). POST rotates it, for when it's been shared too widely. */
async function doorCode(c: import("hono").Context<AppContext>, rotate: boolean) {
  const userId = c.get("userId");
  try {
    const e = await loadEvent(c.env, c.req.param("id") ?? "");
    if (!e) return c.json({ error: "We couldn't find that event." }, 404);
    if (!(await canHost(c.env, e.id, userId))) return c.json({ error: "Only the host can see the door code." }, 403);
    let code = e.door_code;
    if (!code || rotate) {
      code = newDoorCode();
      await c.env.DB.prepare("UPDATE events SET door_code = ? WHERE id = ?").bind(code, e.id).run();
    }
    c.header("Cache-Control", "private, no-store");
    return c.json({ code });
  } catch (err) {
    if (notMigrated(err)) return c.json({ error: "Check-in isn't set up on this server yet." }, 503);
    throw err;
  }
}
checkins.get("/:id/door-code", (c) => doorCode(c, false));
checkins.post("/:id/door-code", (c) => doorCode(c, true));
