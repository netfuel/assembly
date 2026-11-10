// Check-in achievements. Marks are computed here, from the check-ins table and the events they point at, and from
// nothing a client sends: the check-in route has already applied its own rules (event is live, inside the door
// window, near the venue or the host) before anything in this file runs.
//
// The rules are pure functions over a person's nights, so they are easy to test and always give the same answer.
// syncMarks() recomputes from the stored check-ins and reconciles the achievements table: it adds what is newly
// earned, and drops marks whose check-in is gone. Running it twice changes nothing.
import { Hono } from "hono";
import type { AppContext, Env } from "./env";
import { features } from "./features";
import { areFriends, blockedEitherWay } from "./friends";
import { ACHIEVEMENTS, achievementDef, type EarnedNow, type FriendMark, type MyAchievements } from "../shared/achievements";

/** Check-ins at different venues closer together than this don't both count: travel can't farm marks. */
export const MIN_GAP_MS = 90 * 60e3;
/** "Last call": checking in during the final hour of a night. */
const LAST_CALL_MS = 60 * 60e3;
/** A night runs until 6 am, so a 1 am check-in belongs to the evening before. */
const NIGHT_SHIFT_MS = 6 * 3600e3;
const DAY_MS = 86400e3;
const HISTORY_MAX = 500;

/** One check-in, as far as the rules are concerned. Built from database rows only. */
export interface Night {
  eventId: string;
  /** Epoch ms of the check-in. */
  at: number;
  endsAt: number;
  /** The venue, or the place when the event has no venue record. */
  venueKey: string;
  queer: boolean;
  /** Hosts are let in without a location check, so their check-ins don't count. */
  method: "gps" | "code" | "host";
}

const nightDay = (n: Night) => Math.floor((n.at - NIGHT_SHIFT_MS) / DAY_MS);

/**
 * The check-ins that count, oldest first: not a host's, and not one made within MIN_GAP_MS of the last counted
 * check-in at a different venue. Re-checking in at the same venue is fine (a second event in the same room).
 */
export function countedNights(history: readonly Night[]): Night[] {
  const out: Night[] = [];
  for (const n of [...history].sort((a, b) => a.at - b.at || a.eventId.localeCompare(b.eventId))) {
    if (n.method === "host") continue;
    const prev = out[out.length - 1];
    if (prev && prev.venueKey !== n.venueKey && n.at - prev.at < MIN_GAP_MS) continue;
    out.push(n);
  }
  return out;
}

type Rule = (nights: readonly Night[]) => boolean;

/** Each rule reads counted nights, oldest first, and says whether the mark is earned by the last of them. */
export const RULES: Record<string, Rule> = {
  "first-night": (n) => n.length >= 1,
  "three-nights": (n) => new Set(n.map(nightDay)).size >= 3,
  "five-venues": (n) => new Set(n.map((x) => x.venueKey)).size >= 5,
  "week-streak": (n) => {
    const days = [...new Set(n.map(nightDay))].sort((a, b) => a - b);
    return days.some((d, i) => i + 2 < days.length && days[i + 2] - d <= 6);
  },
  "queer-night": (n) => n.some((x) => x.queer),
  "last-call": (n) => n.some((x) => x.at >= x.endsAt - LAST_CALL_MS),
};

/** Every mark this history earns, each with the check-in that completed it. A mark is earned once, ever. */
export function earnedFrom(history: readonly Night[]): Map<string, Night> {
  const nights = countedNights(history);
  const out = new Map<string, Night>();
  for (const a of ACHIEVEMENTS) {
    const rule = RULES[a.id];
    for (let i = 1; i <= nights.length; i++) {
      if (rule(nights.slice(0, i))) {
        out.set(a.id, nights[i - 1]);
        break;
      }
    }
  }
  return out;
}

function missingTable(err: unknown) {
  return err instanceof Error && /no such (table|column)/i.test(err.message);
}

interface NightRow {
  event_id: string;
  method: "gps" | "code" | "host";
  created_at: string;
  ends_at: string;
  policy_tags: string;
  scenes: string;
  venue_id: string | null;
  lat: number;
  lng: number;
}

function list(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

export async function loadHistory(env: Env, userId: string): Promise<Night[]> {
  const { results } = await env.DB.prepare(
    `SELECT ck.event_id, ck.method, ck.created_at, e.ends_at, e.policy_tags, e.scenes, e.venue_id, e.lat, e.lng
     FROM checkins ck JOIN events e ON e.id = ck.event_id
     WHERE ck.user_id = ? AND e.status IN ('live', 'cancelled')
     ORDER BY ck.created_at DESC LIMIT ?`,
  )
    .bind(userId, HISTORY_MAX)
    .all<NightRow>();
  return results.map((r) => ({
    eventId: r.event_id,
    at: Date.parse(r.created_at),
    endsAt: Date.parse(r.ends_at),
    venueKey: r.venue_id ?? `loc:${r.lat.toFixed(3)},${r.lng.toFixed(3)}`,
    queer: list(r.policy_tags).includes("queer-centered") || list(r.scenes).includes("queer"),
    method: r.method,
  }));
}

/**
 * Bring the stored marks in line with the check-ins: add what is newly earned, drop what isn't earned (or isn't
 * earned by the same check-in) any more. Returns the marks added by this call. Never throws: a check-in is never
 * blocked by marks, and a database without the table yet just has none.
 */
export async function syncMarks(env: Env, userId: string): Promise<EarnedNow[]> {
  try {
    const want = earnedFrom(await loadHistory(env, userId));
    const { results: have } = await env.DB.prepare("SELECT achievement_id, event_id FROM achievements WHERE user_id = ?")
      .bind(userId)
      .all<{ achievement_id: string; event_id: string }>();
    const stmts: D1PreparedStatement[] = [];
    const kept = new Set<string>();
    for (const row of have) {
      if (want.get(row.achievement_id)?.eventId === row.event_id) kept.add(row.achievement_id);
      else stmts.push(env.DB.prepare("DELETE FROM achievements WHERE user_id = ? AND achievement_id = ? AND event_id = ?").bind(userId, row.achievement_id, row.event_id));
    }
    const added: EarnedNow[] = [];
    for (const [id, night] of want) {
      if (kept.has(id)) continue;
      stmts.push(
        env.DB.prepare("INSERT OR IGNORE INTO achievements (user_id, achievement_id, event_id, earned_at) VALUES (?, ?, ?, ?)").bind(
          userId,
          id,
          night.eventId,
          new Date(night.at).toISOString(),
        ),
      );
      const def = achievementDef(id);
      if (def) added.push({ id, name: def.name, glyph: def.glyph });
    }
    if (stmts.length) await env.DB.batch(stmts);
    return added;
  } catch (err) {
    if (!missingTable(err)) console.error("achievements", err);
    return [];
  }
}

export const achievements = new Hono<AppContext>();

async function mine(env: Env, userId: string): Promise<MyAchievements> {
  const { results } = await env.DB.prepare(
    `SELECT a.achievement_id, a.event_id, a.earned_at, a.hidden, e.title, v.name AS venue_name
     FROM achievements a JOIN events e ON e.id = a.event_id LEFT JOIN venues v ON v.id = e.venue_id
     WHERE a.user_id = ? ORDER BY a.earned_at`,
  )
    .bind(userId)
    .all<{ achievement_id: string; event_id: string; earned_at: string; hidden: number; title: string; venue_name: string | null }>();
  const u = await env.DB.prepare("SELECT marks_hidden, marks_share_detail FROM users WHERE id = ?")
    .bind(userId)
    .first<{ marks_hidden: number; marks_share_detail: number }>();
  const marks = results.flatMap((r) => {
    const def = achievementDef(r.achievement_id);
    return def
      ? [{ id: def.id, name: def.name, glyph: def.glyph, earnedAt: r.earned_at, eventId: r.event_id, eventTitle: r.title, venueName: r.venue_name, hidden: r.hidden === 1 }]
      : [];
  });
  const have = new Set(marks.map((m) => m.id));
  return {
    marks,
    locked: ACHIEVEMENTS.filter((a) => !have.has(a.id)).map((a) => ({ id: a.id, name: a.name, hint: a.hint })),
    hideAll: u?.marks_hidden === 1,
    shareDetail: u?.marks_share_detail === 1,
  };
}

achievements.get("/", async (c) => {
  const userId = c.get("userId");
  if (!userId) return c.json({ error: "Sign in to see your marks." }, 401);
  c.header("Cache-Control", "private, no-store");
  try {
    return c.json(await mine(c.env, userId));
  } catch (err) {
    if (missingTable(err)) return c.json({ error: "Marks aren't set up on this server yet." }, 503);
    throw err;
  }
});

/** Hide or show all of your marks to friends. Body: { hidden: boolean }. */
achievements.put("/hidden", async (c) => {
  const userId = c.get("userId");
  if (!userId) return c.json({ error: "Sign in first." }, 401);
  const body = (await c.req.json().catch(() => ({}))) as { hidden?: unknown };
  if (typeof body.hidden !== "boolean") return c.json({ error: "Say whether to hide them." }, 400);
  await c.env.DB.prepare("UPDATE users SET marks_hidden = ? WHERE id = ?").bind(body.hidden ? 1 : 0, userId).run();
  return c.json(await mine(c.env, userId));
});

/** Let friends see the venue and time of day too. Body: { on: boolean }. Off by default. */
achievements.put("/share-detail", async (c) => {
  const userId = c.get("userId");
  if (!userId) return c.json({ error: "Sign in first." }, 401);
  const body = (await c.req.json().catch(() => ({}))) as { on?: unknown };
  if (typeof body.on !== "boolean") return c.json({ error: "Say whether to share." }, 400);
  await c.env.DB.prepare("UPDATE users SET marks_share_detail = ? WHERE id = ?").bind(body.on ? 1 : 0, userId).run();
  return c.json(await mine(c.env, userId));
});

/** Hide or show one mark. Body: { hidden: boolean }. */
achievements.put("/:id/hidden", async (c) => {
  const userId = c.get("userId");
  if (!userId) return c.json({ error: "Sign in first." }, 401);
  const id = c.req.param("id");
  if (!achievementDef(id)) return c.json({ error: "We don't know that mark." }, 404);
  const body = (await c.req.json().catch(() => ({}))) as { hidden?: unknown };
  if (typeof body.hidden !== "boolean") return c.json({ error: "Say whether to hide it." }, 400);
  await c.env.DB.prepare("UPDATE achievements SET hidden = ? WHERE user_id = ? AND achievement_id = ?").bind(body.hidden ? 1 : 0, userId, id).run();
  return c.json(await mine(c.env, userId));
});

/**
 * A friend's marks: name and date only. The venue and time of day appear only when they chose to share them.
 * Hidden marks, and everything when they hid all, are not in the answer. Friends only; blocks count.
 */
export const friendMarks = new Hono<AppContext>();
friendMarks.get("/:id/achievements", async (c) => {
  const me = c.get("userId");
  if (!me) return c.json({ error: "Sign in first." }, 401);
  const other = c.req.param("id");
  if (!features(c.env).friends) return c.json({ error: "This feature is turned off." }, 404);
  if (other === me || !(await areFriends(c.env, me, other)) || (await blockedEitherWay(c.env, me, other))) return c.json({ error: "Only for friends." }, 403);
  c.header("Cache-Control", "private, no-store");
  const u = await c.env.DB.prepare("SELECT marks_hidden, marks_share_detail FROM users WHERE id = ?")
    .bind(other)
    .first<{ marks_hidden: number; marks_share_detail: number }>();
  if (!u || u.marks_hidden === 1) return c.json({ marks: [] as FriendMark[] });
  const { results } = await c.env.DB.prepare(
    `SELECT a.achievement_id, a.earned_at, v.name AS venue_name
     FROM achievements a JOIN events e ON e.id = a.event_id LEFT JOIN venues v ON v.id = e.venue_id
     WHERE a.user_id = ? AND a.hidden = 0 ORDER BY a.earned_at`,
  )
    .bind(other)
    .all<{ achievement_id: string; earned_at: string; venue_name: string | null }>();
  const marks: FriendMark[] = results.flatMap((r) => {
    const def = achievementDef(r.achievement_id);
    if (!def) return [];
    const m: FriendMark = { name: def.name, glyph: def.glyph, date: r.earned_at.slice(0, 10) };
    if (u.marks_share_detail === 1) {
      m.venue = r.venue_name;
      m.time = r.earned_at;
    }
    return [m];
  });
  return c.json({ marks });
});
