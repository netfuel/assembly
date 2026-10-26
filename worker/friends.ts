// Friends on the map. Friends are mutual: both people agree. A friend's presence is only ever "going" or
// "here now" at an event, never a position, and only when they turned friends on, didn't hide that event
// (or hide themselves from you), and neither of you blocked the other. Nobody can see anyone else's friend list.
import { Hono, type Context } from "hono";
import type { AppContext, Env } from "./env";
import { notMigrated } from "./checkins";
import { rateLimit } from "./posting";
import type { FriendAt, FriendPerson, FriendsState, UserRelation } from "../shared/types";

const RESERVED = new Set(["admin", "assembly", "mod", "mods", "moderator", "support", "help", "root", "api", "hello", "staff", "team", "official", "null", "undefined", "me", "you", "feed", "map", "search"]);
export function validUsername(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof raw !== "string") return { ok: false, error: "Choose a username." };
  const v = raw.trim().replace(/^@/, "").toLowerCase();
  if (v.length < 3 || v.length > 24) return { ok: false, error: "Usernames are 3 to 24 characters." };
  if (!/^[a-z0-9][a-z0-9._]*[a-z0-9]$/.test(v) || /[._]{2}/.test(v)) return { ok: false, error: "Use letters, numbers, dots, and underscores, starting and ending with a letter or number." };
  if (RESERVED.has(v)) return { ok: false, error: "That username isn't available." };
  return { ok: true, value: v };
}

const pair = (a: string, b: string) => (a < b ? [a, b] : [b, a]) as [string, string];
const token = () => [...crypto.getRandomValues(new Uint8Array(18))].map((b) => b.toString(36).padStart(2, "0")).join("").slice(0, 24);

interface PersonRow {
  id: string;
  display_name: string;
  avatar_url: string | null;
  username: string | null;
}
const person = (r: PersonRow): FriendPerson => ({ id: r.id, displayName: r.display_name, avatarUrl: r.avatar_url, username: r.username });

async function blockedEitherWay(env: Env, a: string, b: string) {
  return !!(await env.DB.prepare("SELECT 1 FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)").bind(a, b, b, a).first());
}

async function relation(env: Env, me: string, other: string): Promise<UserRelation> {
  if (me === other) return "self";
  const [a, b] = pair(me, other);
  const f = await env.DB.prepare("SELECT status, requested_by FROM friendships WHERE user_a = ? AND user_b = ?").bind(a, b).first<{ status: string; requested_by: string }>();
  if (!f) return "none";
  if (f.status === "accepted") return "friends";
  return f.requested_by === me ? "outgoing" : "incoming";
}

async function state(env: Env, me: string): Promise<FriendsState> {
  const u = await env.DB.prepare("SELECT username, friends_on, presence_default FROM users WHERE id = ?")
    .bind(me)
    .first<{ username: string | null; friends_on: number; presence_default: "friends" | "me" }>();
  const { results: rows } = await env.DB.prepare(
    `SELECT u.id, u.display_name, u.avatar_url, u.username, f.status, f.requested_by,
       EXISTS (SELECT 1 FROM presence_hidden h WHERE h.user_id = ?1 AND h.friend_id = u.id) AS hidden
     FROM friendships f JOIN users u ON u.id = CASE WHEN f.user_a = ?1 THEN f.user_b ELSE f.user_a END
     WHERE f.user_a = ?1 OR f.user_b = ?1
     ORDER BY lower(u.display_name)`,
  )
    .bind(me)
    .all<PersonRow & { status: string; requested_by: string; hidden: number }>();
  const { results: blocked } = await env.DB.prepare(
    "SELECT u.id, u.display_name, u.avatar_url, u.username FROM blocks b JOIN users u ON u.id = b.blocked_id WHERE b.blocker_id = ? ORDER BY lower(u.display_name)",
  )
    .bind(me)
    .all<PersonRow>();
  return {
    me: { username: u?.username ?? null, friendsOn: u?.friends_on === 1, presenceDefault: u?.presence_default ?? "friends" },
    friends: rows.filter((r) => r.status === "accepted").map((r) => ({ ...person(r), hidden: r.hidden === 1 })),
    incoming: rows.filter((r) => r.status === "pending" && r.requested_by !== me).map(person),
    outgoing: rows.filter((r) => r.status === "pending" && r.requested_by === me).map(person),
    blocked: blocked.map(person),
  };
}

/**
 * Friends at events between from and to, for this viewer. Here (checked in, not out, within two hours of the end)
 * beats going. Empty when the viewer hasn't turned friends on: seeing friends means sharing too.
 */
export async function friendsAtEvents(env: Env, me: string, from: string, to: string): Promise<Record<string, FriendAt[]>> {
  const out: Record<string, FriendAt[]> = {};
  try {
    const on = await env.DB.prepare("SELECT friends_on FROM users WHERE id = ?").bind(me).first<{ friends_on: number }>();
    if (on?.friends_on !== 1) return out;
    const now = new Date().toISOString();
    const hereSince = new Date(Date.now() - 2 * 3600e3).toISOString();
    const { results } = await env.DB.prepare(
      `WITH f AS (
         SELECT CASE WHEN user_a = ?1 THEN user_b ELSE user_a END AS fid FROM friendships
         WHERE status = 'accepted' AND (user_a = ?1 OR user_b = ?1)
       ),
       a AS (
         SELECT event_id, user_id, 'going' AS state FROM rsvps WHERE status = 'going' AND user_id IN (SELECT fid FROM f)
         UNION ALL
         SELECT event_id, user_id, 'here' AS state FROM checkins WHERE checked_out_at IS NULL AND user_id IN (SELECT fid FROM f)
       )
       SELECT a.event_id, a.state, u.id, u.display_name, u.avatar_url
       FROM a JOIN users u ON u.id = a.user_id AND u.friends_on = 1
       JOIN events e ON e.id = a.event_id AND e.status = 'live' AND e.starts_at < ?3
         AND e.ends_at > CASE WHEN a.state = 'here' THEN ?4 ELSE ?2 END
       LEFT JOIN event_presence ep ON ep.event_id = a.event_id AND ep.user_id = u.id
       WHERE coalesce(ep.visibility, u.presence_default) = 'friends'
         AND NOT EXISTS (SELECT 1 FROM presence_hidden h WHERE h.user_id = u.id AND h.friend_id = ?1)
         AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = u.id AND b.blocked_id = ?1) OR (b.blocker_id = ?1 AND b.blocked_id = u.id))
       LIMIT 2000`,
    )
      .bind(me, from < now ? now : from, to, hereSince)
      .all<{ event_id: string; state: "going" | "here"; id: string; display_name: string; avatar_url: string | null }>();
    for (const r of results) {
      const list = (out[r.event_id] ??= []);
      const existing = list.find((x) => x.id === r.id);
      if (existing) {
        if (r.state === "here") existing.state = "here";
      } else list.push({ id: r.id, displayName: r.display_name, avatarUrl: r.avatar_url, state: r.state });
    }
    for (const list of Object.values(out)) list.sort((x, y) => (x.state === y.state ? x.displayName.localeCompare(y.displayName) : x.state === "here" ? -1 : 1));
  } catch (err) {
    if (!notMigrated(err)) console.error("friends at events", err);
  }
  return out;
}

function guard(fn: (c: Context<AppContext>, me: string) => Promise<Response>) {
  return async (c: Context<AppContext>) => {
    const me = c.get("userId");
    if (!me) return c.json({ error: "Sign in first." }, 401);
    try {
      return await fn(c, me);
    } catch (err) {
      if (notMigrated(err)) return c.json({ error: "Friends aren't set up on this server yet." }, 503);
      throw err;
    }
  };
}
const noStore = (c: Context<AppContext>) => c.header("Cache-Control", "private, no-store");

export const friends = new Hono<AppContext>();

friends.get(
  "/",
  guard(async (c, me) => {
    noStore(c);
    return c.json(await state(c.env, me));
  }),
);

/** Turn friends on or off, and set what friends see by default. Off hides you from everyone at once. */
friends.put(
  "/settings",
  guard(async (c, me) => {
    const body = (await c.req.json().catch(() => ({}))) as { friendsOn?: boolean; presenceDefault?: string };
    const def = body.presenceDefault === "me" ? "me" : "friends";
    await c.env.DB.prepare("UPDATE users SET friends_on = ?, presence_default = ? WHERE id = ?").bind(body.friendsOn ? 1 : 0, def, me).run();
    return c.json(await state(c.env, me));
  }),
);

friends.put(
  "/username",
  guard(async (c, me) => {
    if (!(await rateLimit(c.env.SESSIONS, `username:${me}`, 10, 3600))) return c.json({ error: "Too many changes. Try again later." }, 429);
    const body = (await c.req.json().catch(() => ({}))) as { username?: string | null };
    if (body.username === null || body.username === "") {
      await c.env.DB.prepare("UPDATE users SET username = NULL WHERE id = ?").bind(me).run();
      return c.json(await state(c.env, me));
    }
    const v = validUsername(body.username);
    if (!v.ok) return c.json({ error: v.error }, 400);
    const taken = await c.env.DB.prepare("SELECT 1 FROM users WHERE lower(username) = ? AND id != ?").bind(v.value, me).first();
    if (taken) return c.json({ error: "That username is taken." }, 409);
    await c.env.DB.prepare("UPDATE users SET username = ? WHERE id = ?").bind(v.value, me).run();
    return c.json(await state(c.env, me));
  }),
);

/** Your invite link's token, made on first ask. POST makes a new one, which stops old links working. */
async function inviteToken(env: Env, me: string, rotate: boolean) {
  const row = await env.DB.prepare("SELECT invite_token FROM users WHERE id = ?").bind(me).first<{ invite_token: string | null }>();
  if (row?.invite_token && !rotate) return row.invite_token;
  const t = token();
  await env.DB.prepare("UPDATE users SET invite_token = ? WHERE id = ?").bind(t, me).run();
  return t;
}
friends.get(
  "/invite",
  guard(async (c, me) => {
    noStore(c);
    return c.json({ token: await inviteToken(c.env, me, false) });
  }),
);
friends.post(
  "/invite",
  guard(async (c, me) => c.json({ token: await inviteToken(c.env, me, true) })),
);

/** Who sent this invite link. Public, since its owner shared it; shows only name and photo. */
friends.get("/invite/:token", async (c) => {
  try {
    const u = await c.env.DB.prepare("SELECT id, display_name, avatar_url, username FROM users WHERE invite_token = ?").bind(c.req.param("token") ?? "").first<PersonRow>();
    if (!u) return c.json({ error: "This invite link doesn't work anymore. Ask for a new one." }, 404);
    const me = c.get("userId");
    noStore(c);
    return c.json({ person: person(u), relation: me ? await relation(c.env, me, u.id) : "none" });
  } catch (err) {
    if (notMigrated(err)) return c.json({ error: "Friends aren't set up on this server yet." }, 503);
    throw err;
  }
});

/** Accept someone's invite link: sharing the link was their yes, tapping Add is yours, so you're friends. */
friends.post(
  "/invite/:token",
  guard(async (c, me) => {
    const u = await c.env.DB.prepare("SELECT id FROM users WHERE invite_token = ?").bind(c.req.param("token") ?? "").first<{ id: string }>();
    if (!u || u.id === me || (await blockedEitherWay(c.env, me, u.id))) return c.json({ error: "This invite link doesn't work anymore. Ask for a new one." }, 404);
    const [a, b] = pair(me, u.id);
    await c.env.DB.prepare(
      `INSERT INTO friendships (user_a, user_b, status, requested_by, accepted_at) VALUES (?, ?, 'accepted', ?, ?)
       ON CONFLICT (user_a, user_b) DO UPDATE SET status = 'accepted', accepted_at = excluded.accepted_at`,
    )
      .bind(a, b, u.id, new Date().toISOString())
      .run();
    return c.json(await state(c.env, me));
  }),
);

/** Look someone up by exact @username, to send a request. No partial search: you need to know the name. */
friends.get(
  "/lookup/:username",
  guard(async (c, me) => {
    if (!(await rateLimit(c.env.SESSIONS, `lookup:${me}`, 60, 3600))) return c.json({ error: "Too many lookups. Try again later." }, 429);
    const name = (c.req.param("username") ?? "").replace(/^@/, "").toLowerCase();
    const u = await c.env.DB.prepare("SELECT id, display_name, avatar_url, username FROM users WHERE lower(username) = ?").bind(name).first<PersonRow>();
    // Someone who blocked you looks the same as nobody.
    if (!u || (await c.env.DB.prepare("SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?").bind(u.id, me).first()))
      return c.json({ error: `No one goes by @${name}.` }, 404);
    noStore(c);
    return c.json({ person: person(u), relation: await relation(c.env, me, u.id) });
  }),
);

/** Send a request. If they already asked you, this accepts. Blocks fail quietly, so a block can't be detected. */
friends.post(
  "/request/:id",
  guard(async (c, me) => {
    if (!(await rateLimit(c.env.SESSIONS, `friend-req:${me}`, 30, 3600))) return c.json({ error: "That's a lot of requests in an hour. Try again later." }, 429);
    const other = c.req.param("id") ?? "";
    if (other === me) return c.json({ error: "That's you." }, 400);
    if (!(await c.env.DB.prepare("SELECT 1 FROM users WHERE id = ?").bind(other).first())) return c.json({ error: "We couldn't find that person." }, 404);
    if (await blockedEitherWay(c.env, me, other)) return c.json(await state(c.env, me));
    const [a, b] = pair(me, other);
    const existing = await c.env.DB.prepare("SELECT status, requested_by FROM friendships WHERE user_a = ? AND user_b = ?").bind(a, b).first<{ status: string; requested_by: string }>();
    if (existing?.status === "pending" && existing.requested_by === other) {
      await c.env.DB.prepare("UPDATE friendships SET status = 'accepted', accepted_at = ? WHERE user_a = ? AND user_b = ?").bind(new Date().toISOString(), a, b).run();
    } else if (!existing) {
      await c.env.DB.prepare("INSERT INTO friendships (user_a, user_b, status, requested_by) VALUES (?, ?, 'pending', ?)").bind(a, b, me).run();
    }
    return c.json(await state(c.env, me));
  }),
);

friends.post(
  "/:id/accept",
  guard(async (c, me) => {
    const [a, b] = pair(me, c.req.param("id") ?? "");
    await c.env.DB.prepare("UPDATE friendships SET status = 'accepted', accepted_at = ? WHERE user_a = ? AND user_b = ? AND status = 'pending' AND requested_by != ?")
      .bind(new Date().toISOString(), a, b, me)
      .run();
    return c.json(await state(c.env, me));
  }),
);

/** Remove a friend, decline a request, or cancel your own. The other person isn't notified. */
friends.delete(
  "/:id",
  guard(async (c, me) => {
    const other = c.req.param("id") ?? "";
    const [a, b] = pair(me, other);
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM friendships WHERE user_a = ? AND user_b = ?").bind(a, b),
      c.env.DB.prepare("DELETE FROM presence_hidden WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)").bind(me, other, other, me),
    ]);
    return c.json(await state(c.env, me));
  }),
);

/** Keep someone as a friend but never show them where you're going. */
friends.put(
  "/:id/hidden",
  guard(async (c, me) => {
    const other = c.req.param("id") ?? "";
    const body = (await c.req.json().catch(() => ({}))) as { hidden?: boolean };
    await c.env.DB.prepare(body.hidden ? "INSERT OR IGNORE INTO presence_hidden (user_id, friend_id) VALUES (?, ?)" : "DELETE FROM presence_hidden WHERE user_id = ? AND friend_id = ?")
      .bind(me, other)
      .run();
    return c.json(await state(c.env, me));
  }),
);

/** Block: ends any friendship or request at once, both ways, and stops new ones. */
friends.post(
  "/:id/block",
  guard(async (c, me) => {
    const other = c.req.param("id") ?? "";
    if (other === me) return c.json({ error: "That's you." }, 400);
    const [a, b] = pair(me, other);
    await c.env.DB.batch([
      c.env.DB.prepare("INSERT OR IGNORE INTO blocks (blocker_id, blocked_id) VALUES (?, ?)").bind(me, other),
      c.env.DB.prepare("DELETE FROM friendships WHERE user_a = ? AND user_b = ?").bind(a, b),
      c.env.DB.prepare("DELETE FROM presence_hidden WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)").bind(me, other, other, me),
    ]);
    return c.json(await state(c.env, me));
  }),
);
friends.delete(
  "/:id/block",
  guard(async (c, me) => {
    await c.env.DB.prepare("DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?").bind(me, c.req.param("id") ?? "").run();
    return c.json(await state(c.env, me));
  }),
);

/** Friends at events in a time window: { eventId: FriendAt[] }. */
friends.get(
  "/at",
  guard(async (c, me) => {
    const now = Date.now();
    const isIso = (v?: string) => !!v && !Number.isNaN(Date.parse(v));
    const fromQ = c.req.query("from");
    const toQ = c.req.query("to");
    const from = isIso(fromQ) ? new Date(fromQ!).toISOString() : new Date(now).toISOString();
    const to = isIso(toQ) ? new Date(toQ!).toISOString() : new Date(now + 400 * 86400e3).toISOString();
    noStore(c);
    return c.json({ events: await friendsAtEvents(c.env, me, from, to) });
  }),
);

/** Your choice for one event: do friends see that you're going or here? */
export const eventFriendVisibility = new Hono<AppContext>();
eventFriendVisibility.get(
  "/:id/friend-visibility",
  guard(async (c, me) => {
    const row = await c.env.DB.prepare(
      `SELECT coalesce(ep.visibility, u.presence_default) AS visibility, u.friends_on FROM users u
       LEFT JOIN event_presence ep ON ep.user_id = u.id AND ep.event_id = ? WHERE u.id = ?`,
    )
      .bind(c.req.param("id"), me)
      .first<{ visibility: "friends" | "me"; friends_on: number }>();
    noStore(c);
    return c.json({ visibility: row?.visibility ?? "friends", friendsOn: row?.friends_on === 1 });
  }),
);
eventFriendVisibility.put(
  "/:id/friend-visibility",
  guard(async (c, me) => {
    const body = (await c.req.json().catch(() => ({}))) as { visibility?: string };
    const v = body.visibility === "me" ? "me" : "friends";
    const id = c.req.param("id") ?? "";
    if (!(await c.env.DB.prepare("SELECT 1 FROM events WHERE id = ?").bind(id).first())) return c.json({ error: "We couldn't find that event." }, 404);
    await c.env.DB.prepare(
      "INSERT INTO event_presence (event_id, user_id, visibility) VALUES (?, ?, ?) ON CONFLICT (event_id, user_id) DO UPDATE SET visibility = excluded.visibility",
    )
      .bind(id, me, v)
      .run();
    const on = await c.env.DB.prepare("SELECT friends_on FROM users WHERE id = ?").bind(me).first<{ friends_on: number }>();
    return c.json({ visibility: v, friendsOn: on?.friends_on === 1 });
  }),
);
