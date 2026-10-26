// Live state on the server: the grace period, and organizers ending a night early or keeping it going.
// An event is live from its start until 30 minutes after its end, unless the organizer ended it (then it's over
// at the moment they did). "Still going" moves the end time an hour later. Neither counts as an edit, so RSVPs
// don't get an "Updated" tag for it.
import { Hono } from "hono";
import type { AppContext, Env } from "./env";
import { canHost, notMigrated } from "./checkins";
import { LIMITS } from "./validate";

export const LIVE_GRACE_MS = 30 * 60e3;
const DOORS_EARLY_MS = 30 * 60e3;

/** Which of these events the organizer ended early. Empty before migration 0009. */
export async function endedEarly(env: Env, ids: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (!ids.length) return out;
  try {
    for (let i = 0; i < ids.length; i += 90) {
      const chunk = ids.slice(i, i + 90);
      const { results } = await env.DB.prepare(`SELECT event_id FROM event_ended WHERE event_id IN (${chunk.map(() => "?").join(",")})`)
        .bind(...chunk)
        .all<{ event_id: string }>();
      for (const r of results) out.add(r.event_id);
    }
  } catch (err) {
    if (!notMigrated(err)) console.error("ended early", err);
  }
  return out;
}

/** Events that could be live or just ended: the only ones worth looking up. */
export const nearNow = (e: { startsAt: string; endsAt: string }, now = Date.now()) =>
  Date.parse(e.startsAt) - DOORS_EARLY_MS <= now && Date.parse(e.endsAt) + 6 * 3600e3 >= now;

/** Mark the ones the organizer ended, in place. */
export async function markEnded<T extends { id: string; startsAt: string; endsAt: string; endedEarly?: boolean }>(env: Env, list: T[]): Promise<T[]> {
  const ended = await endedEarly(env, list.filter((e) => nearNow(e)).map((e) => e.id));
  for (const e of list) if (ended.has(e.id)) e.endedEarly = true;
  return list;
}

export const live = new Hono<AppContext>();

/** end: it's over now. extend: an hour more (also reopens a night that was ended). Host or moderator, while it's on. */
live.post("/:id/live", async (c) => {
  const userId = c.get("userId");
  if (!userId) return c.json({ error: "Sign in to change this." }, 401);
  const id = c.req.param("id");
  if (!(await canHost(c.env, id, userId))) return c.json({ error: "Only the organizer can change this." }, 403);
  const body = (await c.req.json().catch(() => ({}))) as { action?: string };
  if (body.action !== "end" && body.action !== "extend") return c.json({ error: "Action must be end or extend." }, 400);
  const db = c.env.DB;
  const e = await db.prepare("SELECT starts_at, ends_at, status FROM events WHERE id = ?").bind(id).first<{ starts_at: string; ends_at: string; status: string }>();
  if (!e || e.status !== "live") return c.json({ error: "That event isn't on." }, 404);
  const now = Date.now();
  const start = Date.parse(e.starts_at);
  const end = Date.parse(e.ends_at);
  let wasEnded = false;
  try {
    wasEnded = !!(await db.prepare("SELECT 1 FROM event_ended WHERE event_id = ?").bind(id).first());
  } catch (err) {
    if (notMigrated(err)) return c.json({ error: "This isn't set up on the server yet." }, 503);
    throw err;
  }
  // While it's on, or within an hour of ending (so a night ended by mistake can be reopened).
  const liveUntil = end + (wasEnded ? 3600e3 : LIVE_GRACE_MS);
  if (now < start - DOORS_EARLY_MS || now > liveUntil) return c.json({ error: "You can change this while the event is on." }, 409);

  if (body.action === "end") {
    const at = new Date(Math.max(start, Math.min(now, end))).toISOString();
    await db.batch([
      db.prepare("UPDATE events SET ends_at = ? WHERE id = ?").bind(at, id),
      db.prepare("INSERT INTO event_ended (event_id, ended_at, ended_by) VALUES (?, ?, ?) ON CONFLICT (event_id) DO UPDATE SET ended_at = excluded.ended_at").bind(id, at, userId),
    ]);
    return c.json({ endsAt: at, endedEarly: true });
  }
  // Still going: an hour past now or past the current end, whichever is later, within the longest allowed night.
  const next = Math.min(Math.max(now, end) + 3600e3, start + LIMITS.maxHours * 3600e3);
  const at = new Date(next).toISOString();
  await db.batch([db.prepare("UPDATE events SET ends_at = ? WHERE id = ?").bind(at, id), db.prepare("DELETE FROM event_ended WHERE event_id = ?").bind(id)]);
  return c.json({ endsAt: at, endedEarly: false });
});
