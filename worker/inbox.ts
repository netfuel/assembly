// Notifications under the avatar: built from what already happened, not a separate store, so there's nothing to
// keep in sync. Friend requests, friends' invites, changes to nights you RSVP'd to (cancelled or updated),
// nights starting soon, friends checked in somewhere now, and page claims a moderator decided.
// "Read" is one timestamp per person in KV: everything newer than it is new.
import { Hono } from "hono";
import type { AppContext, Env } from "./env";
import { notMigrated } from "./checkins";
import { friendsAtEvents } from "./friends";
import type { FriendAt, Inbox, InboxItem } from "../shared/types";

const DAY = 86400e3;
const seenKey = (userId: string) => `inbox-seen:${userId}`;

async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch (err) {
    if (!notMigrated(err)) console.error("inbox", err);
    return fallback;
  }
}

export async function buildInbox(env: Env, userId: string): Promise<Inbox> {
  const db = env.DB;
  const now = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();
  const items: InboxItem[] = [];

  const [requests, invites, changed, soon, here, claims] = await Promise.all([
    safe(
      db
        .prepare(
          `SELECT u.id, u.display_name, u.avatar_url, f.created_at FROM friendships f
           JOIN users u ON u.id = CASE WHEN f.user_a = ?1 THEN f.user_b ELSE f.user_a END
           WHERE (f.user_a = ?1 OR f.user_b = ?1) AND f.status = 'pending' AND f.requested_by <> ?1
           ORDER BY f.created_at DESC LIMIT 20`,
        )
        .bind(userId)
        .all<{ id: string; display_name: string; avatar_url: string | null; created_at: string }>(),
      { results: [] } as never,
    ),
    safe(
      db
        .prepare(
          `SELECT i.event_id, i.created_at, e.title, e.starts_at, u.display_name, u.avatar_url FROM event_invites i
           JOIN events e ON e.id = i.event_id AND e.status = 'live' AND e.ends_at > ?2 JOIN users u ON u.id = i.from_id
           WHERE i.to_id = ?1 ORDER BY i.created_at DESC LIMIT 20`,
        )
        .bind(userId, iso(now))
        .all<{ event_id: string; created_at: string; title: string; starts_at: string; display_name: string; avatar_url: string | null }>(),
      { results: [] } as never,
    ),
    // Nights you RSVP'd to that were cancelled or edited after you RSVP'd (an edit within 10 minutes of posting doesn't count).
    safe(
      db
        .prepare(
          `SELECT e.id, e.title, e.status, e.updated_at, e.starts_at FROM rsvps r JOIN events e ON e.id = r.event_id
           WHERE r.user_id = ?1 AND e.ends_at > ?2 AND e.updated_at > r.created_at
             AND (e.status = 'cancelled' OR julianday(e.updated_at) - julianday(e.created_at) > 10.0 / 1440)
           ORDER BY e.updated_at DESC LIMIT 20`,
        )
        .bind(userId, iso(now - DAY))
        .all<{ id: string; title: string; status: string; updated_at: string; starts_at: string }>(),
      { results: [] } as never,
    ),
    safe(
      db
        .prepare(
          `SELECT e.id, e.title, e.starts_at FROM rsvps r JOIN events e ON e.id = r.event_id
           WHERE r.user_id = ?1 AND r.status = 'going' AND e.status = 'live' AND e.starts_at > ?2 AND e.starts_at < ?3
           ORDER BY e.starts_at LIMIT 5`,
        )
        .bind(userId, iso(now), iso(now + 3 * 3600e3))
        .all<{ id: string; title: string; starts_at: string }>(),
      { results: [] } as never,
    ),
    // Friends checked in right now who share that with you: the same privacy rules as the map.
    safe(friendsAtEvents(env, userId, iso(now - 8 * 3600e3), iso(now + 60e3)), {} as Record<string, FriendAt[]>),
    safe(
      db
        .prepare(
          `SELECT pc.id, pc.target_type, pc.status, pc.decided_at, COALESCE(a.name, v.name) AS name, COALESCE(a.slug, v.slug, v.id) AS slug
           FROM page_claims pc LEFT JOIN artists a ON pc.target_type = 'artist' AND a.id = pc.target_id
           LEFT JOIN venues v ON pc.target_type = 'venue' AND v.id = pc.target_id
           WHERE pc.user_id = ?1 AND pc.status <> 'open' AND pc.decided_at > ?2 ORDER BY pc.decided_at DESC LIMIT 10`,
        )
        .bind(userId, iso(now - 30 * DAY))
        .all<{ id: string; target_type: "artist" | "venue"; status: string; decided_at: string; name: string | null; slug: string | null }>(),
      { results: [] } as never,
    ),
  ]);

  for (const r of requests.results ?? [])
    items.push({ id: `req:${r.id}`, kind: "friend-request", at: r.created_at, title: `${r.display_name} wants to be friends`, body: "Accept to see each other's nights.", target: { type: "friends" }, person: { displayName: r.display_name, avatarUrl: r.avatar_url } });
  for (const r of invites.results ?? [])
    items.push({ id: `inv:${r.event_id}:${r.display_name}`, kind: "invite", at: r.created_at, title: `${r.display_name} invited you`, body: r.title, target: { type: "event", id: r.event_id }, person: { displayName: r.display_name, avatarUrl: r.avatar_url } });
  for (const r of changed.results ?? [])
    items.push({
      id: `chg:${r.id}:${r.updated_at}`,
      kind: r.status === "cancelled" ? "cancelled" : "updated",
      at: r.updated_at,
      title: r.status === "cancelled" ? `Cancelled: ${r.title}` : `Updated: ${r.title}`,
      body: r.status === "cancelled" ? "The organizer called it off." : "Check the time, place, or lineup.",
      target: { type: "event", id: r.id },
    });
  for (const r of soon.results ?? [])
    items.push({ id: `soon:${r.id}`, kind: "starting-soon", at: iso(Math.max(now - 60e3, Date.parse(r.starts_at) - 3 * 3600e3)), title: `Starting soon: ${r.title}`, body: "Your door info is saved on this device.", target: { type: "event", id: r.id } });
  // Friends here now, one line per event. Titles come from the events they're at.
  const hereIds = Object.entries(here).filter(([, fs]) => fs.some((f) => f.state === "here"));
  if (hereIds.length) {
    const { results: evs } = await safe(
      db.prepare(`SELECT id, title, starts_at FROM events WHERE id IN (${hereIds.map(() => "?").join(",")})`).bind(...hereIds.map(([id]) => id)).all<{ id: string; title: string; starts_at: string }>(),
      { results: [] } as never,
    );
    for (const ev of evs ?? []) {
      const fs = (here[ev.id] ?? []).filter((f) => f.state === "here");
      const names = fs.length > 2 ? `${fs[0].displayName} and ${fs.length - 1} friends` : fs.map((f) => f.displayName).join(" and ");
      // Dated to when the night started, so it doesn't turn new again on every load.
      const at = ev.starts_at;
      items.push({ id: `here:${ev.id}:${fs.map((f) => f.id).join(",")}`, kind: "friend-here", at, title: `${names} ${fs.length > 1 ? "are" : "is"} at ${ev.title}`, body: "Checked in now.", target: { type: "event", id: ev.id }, person: { displayName: fs[0].displayName, avatarUrl: fs[0].avatarUrl } });
    }
  }
  for (const r of claims.results ?? [])
    if (r.name)
      items.push({
        id: `claim:${r.id}`,
        kind: "claim",
        at: r.decided_at,
        title: r.status === "approved" ? `${r.name} is yours to edit` : `Your claim for ${r.name} wasn't approved`,
        body: r.status === "approved" ? "Add a photo, bio and links." : "Reply to the moderator's email if that's wrong.",
        target: { type: "page", kind: r.target_type, slug: r.slug ?? "" },
      });

  items.sort((a, b) => b.at.localeCompare(a.at));
  const seen = (await env.SESSIONS.get(seenKey(userId))) ?? "";
  return { items: items.slice(0, 40), unread: items.filter((i) => i.at > seen).length };
}

export const inbox = new Hono<AppContext>();

inbox.get("/", async (c) => {
  const userId = c.get("userId");
  c.header("Cache-Control", "private, no-store");
  if (!userId) return c.json({ items: [], unread: 0 } satisfies Inbox);
  return c.json(await buildInbox(c.env, userId));
});

/** Opened Notifications: everything up to now is read. */
inbox.post("/seen", async (c) => {
  const userId = c.get("userId");
  if (!userId) return c.json({ error: "Sign in first." }, 401);
  await c.env.SESSIONS.put(seenKey(userId), new Date().toISOString(), { expirationTtl: 90 * 86400 });
  return c.json({ ok: true });
});
