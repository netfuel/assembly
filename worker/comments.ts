// Comments on event pages. Anyone signed in can comment; flat, newest last, one level of replies.
// The author, the event's hosts and moderators can remove a comment; hosts can pin one. Three open reports
// hide a comment until a moderator looks (the same rule as events and wall posts).
import { Hono, type Context } from "hono";
import type { AppContext, Env } from "./env";
import { notMigrated } from "./checkins";
import { isModerator } from "./moderation";
import { rateLimit } from "./posting";
import { COMMENT_MAX, COMMENT_REPORT_REASONS, type CommentThread, type EventComment } from "../shared/types";

const REASONS = new Set<string>(COMMENT_REPORT_REASONS.map((r) => r.id));
export const HIDE_AT_REPORTS = 3;

interface Row {
  id: string;
  event_id: string;
  user_id: string;
  parent_id: string | null;
  body: string;
  status: EventComment["status"];
  pinned: number;
  created_at: string;
  display_name: string | null;
  avatar_url: string | null;
  verified: number | null;
  is_host: number;
}

/** Trim, collapse runs of blank lines, and cap the length. Returns null when nothing is left. */
export function cleanBody(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw
    .replace(/\r\n?/g, "\n")
    // Control characters other than newline and tab.
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return v ? v : null;
}

async function staffFor(env: Env, eventId: string, userId: string | null) {
  if (!userId) return { host: false, moderator: false };
  const [host, moderator] = await Promise.all([
    env.DB.prepare("SELECT 1 FROM event_hosts WHERE event_id = ? AND user_id = ?").bind(eventId, userId).first(),
    isModerator(env, userId),
  ]);
  return { host: !!host, moderator };
}

function toComment(r: Row, viewerId: string | null, staff: boolean): EventComment {
  const mine = r.user_id === viewerId;
  const removed = r.status === "removed";
  return {
    id: r.id,
    parentId: r.parent_id,
    body: removed ? "" : r.body,
    status: r.status,
    createdAt: r.created_at,
    author: removed ? null : { id: r.user_id, displayName: r.display_name ?? "Someone", avatarUrl: r.avatar_url },
    host: !removed && r.is_host === 1,
    verified: !removed && r.verified === 1,
    pinned: r.pinned === 1,
    mine: mine && !removed,
    canDelete: !removed && (mine || staff),
  };
}

export async function commentCount(env: Env, eventId: string): Promise<number> {
  try {
    const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM comments WHERE event_id = ? AND status = 'live'").bind(eventId).first<{ n: number }>();
    return r?.n ?? 0;
  } catch (err) {
    if (!notMigrated(err)) console.error("comment count", err);
    return 0;
  }
}

async function thread(env: Env, eventId: string, eventStatus: string, userId: string | null): Promise<CommentThread> {
  const s = await staffFor(env, eventId, userId);
  const staff = s.host || s.moderator;
  const { results } = await env.DB.prepare(
    `SELECT c.*, u.display_name, u.avatar_url, u.is_verified_organizer AS verified,
       EXISTS (SELECT 1 FROM event_hosts h WHERE h.event_id = c.event_id AND h.user_id = c.user_id) AS is_host
     FROM comments c JOIN users u ON u.id = c.user_id
     WHERE c.event_id = ?1 AND (c.status IN ('live', 'removed') OR (c.status = 'hidden' AND (?2 OR c.user_id = ?3)))
     ORDER BY c.created_at ASC LIMIT 500`,
  )
    .bind(eventId, staff ? 1 : 0, userId ?? "")
    .all<Row>();
  // A removed comment stays only as a placeholder above its replies.
  const parents = new Set(results.filter((r) => r.parent_id).map((r) => r.parent_id));
  const shown = results.filter((r) => r.status !== "removed" || parents.has(r.id));
  const note = !userId ? "Sign in to comment." : eventStatus === "cancelled" ? "This event was cancelled, so comments are closed." : null;
  return { comments: shown.map((r) => toComment(r, userId, staff)), canComment: note === null, note, canModerate: staff };
}

function guard(fn: (c: Context<AppContext>) => Promise<Response>) {
  return async (c: Context<AppContext>) => {
    try {
      return await fn(c);
    } catch (err) {
      if (notMigrated(err)) return c.json({ error: "Comments aren't set up on this server yet." }, 503);
      throw err;
    }
  };
}

const loadEvent = (env: Env, id: string) =>
  env.DB.prepare("SELECT id, status FROM events WHERE id = ? AND status IN ('live', 'cancelled')").bind(id).first<{ id: string; status: string }>();

/** Mounted at /events: the thread for one event, and posting to it. */
export const eventComments = new Hono<AppContext>();

eventComments.get(
  "/:id/comments",
  guard(async (c) => {
    const e = await loadEvent(c.env, (c.req.param("id") ?? ""));
    if (!e) return c.json({ error: "We couldn't find that event." }, 404);
    c.header("Cache-Control", "private, no-store");
    return c.json(await thread(c.env, e.id, e.status, c.get("userId")));
  }),
);

eventComments.post(
  "/:id/comments",
  guard(async (c) => {
    const userId = c.get("userId");
    if (!userId) return c.json({ error: "Sign in to comment." }, 401);
    const e = await loadEvent(c.env, (c.req.param("id") ?? ""));
    if (!e) return c.json({ error: "We couldn't find that event." }, 404);
    if (e.status !== "live") return c.json({ error: "This event was cancelled, so comments are closed." }, 409);
    const raw = (await c.req.json().catch(() => ({}))) as { body?: unknown; parentId?: unknown };
    const body = cleanBody(raw.body);
    if (!body) return c.json({ error: "Write something first." }, 400);
    if (body.length > COMMENT_MAX) return c.json({ error: `Keep it under ${COMMENT_MAX} characters.` }, 400);
    let parentId: string | null = null;
    if (typeof raw.parentId === "string" && raw.parentId) {
      const p = await c.env.DB.prepare("SELECT id, parent_id, status FROM comments WHERE id = ? AND event_id = ?").bind(raw.parentId, e.id).first<{ id: string; parent_id: string | null; status: string }>();
      if (!p || p.status !== "live") return c.json({ error: "That comment isn't there anymore." }, 404);
      // One level deep: a reply to a reply joins the same thread.
      parentId = p.parent_id ?? p.id;
    }
    if (!(await rateLimit(c.env.SESSIONS, `comment:${userId}`, 10, 3600))) return c.json({ error: "That's 10 comments this hour. Try again a little later." }, 429);
    if (!(await rateLimit(c.env.SESSIONS, `comment-event:${e.id}`, 600, 86400))) return c.json({ error: "This event has had a lot of comments today. Try again tomorrow." }, 429);
    const id = crypto.randomUUID();
    await c.env.DB.prepare("INSERT INTO comments (id, event_id, user_id, parent_id, body) VALUES (?, ?, ?, ?, ?)").bind(id, e.id, userId, parentId, body).run();
    const t = await thread(c.env, e.id, e.status, userId);
    return c.json({ comment: t.comments.find((x) => x.id === id), thread: t }, 201);
  }),
);

/** Mounted at /comments: actions on one comment. */
export const commentActions = new Hono<AppContext>();

async function loadComment(env: Env, id: string) {
  return env.DB.prepare("SELECT c.id, c.event_id, c.user_id, c.parent_id, c.status, e.status AS event_status FROM comments c JOIN events e ON e.id = c.event_id WHERE c.id = ?")
    .bind(id)
    .first<{ id: string; event_id: string; user_id: string; parent_id: string | null; status: string; event_status: string }>();
}

commentActions.delete(
  "/:id",
  guard(async (c) => {
    const userId = c.get("userId");
    if (!userId) return c.json({ error: "Sign in first." }, 401);
    const cm = await loadComment(c.env, (c.req.param("id") ?? ""));
    if (!cm || cm.status === "removed") return c.json({ error: "That comment isn't there anymore." }, 404);
    const s = await staffFor(c.env, cm.event_id, userId);
    if (cm.user_id !== userId && !s.host && !s.moderator) return c.json({ error: "Only the author, the host, or a moderator can remove this." }, 403);
    // Keep the row (and clear the words) so open reports keep their history and replies keep their place.
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE comments SET status = 'removed', body = '', pinned = 0 WHERE id = ?").bind(cm.id),
      c.env.DB.prepare("UPDATE comment_reports SET status = 'actioned' WHERE comment_id = ? AND status = 'open'").bind(cm.id),
    ]);
    return c.json(await thread(c.env, cm.event_id, cm.event_status, userId));
  }),
);

/** Hosts and moderators: pin one comment to the top (pinning another unpins the last). Body: { pinned }. */
commentActions.post(
  "/:id/pin",
  guard(async (c) => {
    const userId = c.get("userId");
    if (!userId) return c.json({ error: "Sign in first." }, 401);
    const cm = await loadComment(c.env, (c.req.param("id") ?? ""));
    if (!cm || cm.status !== "live") return c.json({ error: "That comment isn't there anymore." }, 404);
    if (cm.parent_id) return c.json({ error: "Only top-level comments can be pinned." }, 400);
    const s = await staffFor(c.env, cm.event_id, userId);
    if (!s.host && !s.moderator) return c.json({ error: "Only the host can pin a comment." }, 403);
    const { pinned } = (await c.req.json().catch(() => ({}))) as { pinned?: boolean };
    await c.env.DB.batch(
      pinned === false
        ? [c.env.DB.prepare("UPDATE comments SET pinned = 0 WHERE id = ?").bind(cm.id)]
        : [
            c.env.DB.prepare("UPDATE comments SET pinned = 0 WHERE event_id = ? AND pinned = 1").bind(cm.event_id),
            c.env.DB.prepare("UPDATE comments SET pinned = 1 WHERE id = ?").bind(cm.id),
          ],
    );
    return c.json(await thread(c.env, cm.event_id, cm.event_status, userId));
  }),
);

/** Report a comment. Three open reports hide it until a moderator reviews it. */
commentActions.post(
  "/:id/report",
  guard(async (c) => {
    const userId = c.get("userId");
    if (!userId) return c.json({ error: "Sign in to report a comment." }, 401);
    if (!(await rateLimit(c.env.SESSIONS, `comment-report:${userId}`, 20, 3600))) return c.json({ error: "Too many reports. Try again later." }, 429);
    const cm = await loadComment(c.env, (c.req.param("id") ?? ""));
    if (!cm || cm.status === "removed") return c.json({ error: "That comment isn't there anymore." }, 404);
    if (cm.user_id === userId) return c.json({ error: "You can remove your own comment instead." }, 400);
    const { reason, note } = (await c.req.json().catch(() => ({}))) as { reason?: string; note?: string };
    if (!reason || !REASONS.has(reason)) return c.json({ error: "Pick a reason." }, 400);
    await c.env.DB.prepare(
      `INSERT INTO comment_reports (id, comment_id, reporter_id, reason, note) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (comment_id, reporter_id) DO UPDATE SET reason = excluded.reason, note = excluded.note, status = 'open'`,
    )
      .bind(crypto.randomUUID(), cm.id, userId, reason, typeof note === "string" ? note.slice(0, 280) : null)
      .run();
    const open = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM comment_reports WHERE comment_id = ? AND status = 'open'").bind(cm.id).first<{ n: number }>();
    const hide = (open?.n ?? 0) >= HIDE_AT_REPORTS;
    if (hide && cm.status === "live") await c.env.DB.prepare("UPDATE comments SET status = 'hidden', pinned = 0 WHERE id = ?").bind(cm.id).run();
    return c.json({ ok: true, hidden: hide });
  }),
);
