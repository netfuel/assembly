// Comments on event pages. Anyone signed in can comment; flat, oldest first, one level of replies.
// The author, the event's hosts and moderators can remove a comment; hosts can pin one and switch comments
// on, to read only, or off. Three open reports hide a comment until a moderator restores or removes it.
// Mute hides someone's comments for you; block hides them both ways and stops them replying to you or
// commenting on events you host.
import { Hono, type Context } from "hono";
import type { AppContext, Env } from "./env";
import { notMigrated } from "./checkins";
import { isModerator } from "./moderation";
import { rateLimit } from "./posting";
import { COMMENT_MAX, COMMENT_REPORT_REASONS, type CommentMode, type CommentThread, type EventComment, type ModCommentItem } from "../shared/types";

const REASONS = new Set<string>(COMMENT_REPORT_REASONS.map((r) => r.id));
const MODES = new Set<CommentMode>(["on", "locked", "off"]);
export const HIDE_AT_REPORTS = 3;

interface Row {
  id: string;
  event_id: string;
  user_id: string;
  parent_id: string | null;
  body: string;
  status: "live" | "hidden" | "removed";
  pinned: number;
  created_at: string;
  edited_at: string | null;
  display_name: string | null;
  avatar_url: string | null;
  verified: number | null;
  is_host: number;
  /** 'mute' or 'block' when the viewer muted or blocked the author, or 'blocked-by' when the author blocked the viewer. */
  relation: string | null;
}

/** Trim, collapse runs of blank lines, and drop control characters. Returns null when nothing is left. */
export function cleanBody(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return v ? v : null;
}

/**
 * What the viewer sees for each row, given removals and mutes. A removed or muted comment stays only as a
 * placeholder above replies that are still shown; otherwise it drops out. Exported for tests.
 */
export function visibleRows<T extends { id: string; parent_id: string | null; status: string; relation: string | null }>(rows: T[]): (T & { placeholder: "removed" | "muted" | null })[] {
  const quiet = (r: T) => r.relation !== null;
  const kept = rows.filter((r) => r.parent_id === null || (r.status !== "removed" && !quiet(r)));
  const parentsWithReplies = new Set(kept.filter((r) => r.parent_id).map((r) => r.parent_id));
  return kept
    .filter((r) => r.parent_id !== null || (r.status !== "removed" && !quiet(r)) || parentsWithReplies.has(r.id))
    .map((r) => ({ ...r, placeholder: r.status === "removed" ? "removed" : quiet(r) ? "muted" : null }));
}

async function staffFor(env: Env, eventId: string, userId: string | null) {
  if (!userId) return { host: false, moderator: false };
  const [host, moderator] = await Promise.all([
    env.DB.prepare("SELECT 1 FROM event_hosts WHERE event_id = ? AND user_id = ?").bind(eventId, userId).first(),
    isModerator(env, userId),
  ]);
  return { host: !!host, moderator };
}

function toComment(r: Row & { placeholder: "removed" | "muted" | null }, viewerId: string | null, staff: boolean): EventComment {
  const mine = r.user_id === viewerId;
  if (r.placeholder)
    return {
      id: r.id,
      parentId: r.parent_id,
      body: "",
      status: r.placeholder,
      createdAt: r.created_at,
      edited: false,
      author: null,
      host: false,
      verified: false,
      pinned: false,
      mine: false,
      canDelete: false,
    };
  return {
    id: r.id,
    parentId: r.parent_id,
    body: r.body,
    status: r.status === "hidden" ? "hidden" : "live",
    createdAt: r.created_at,
    edited: !!r.edited_at,
    author: { id: r.user_id, displayName: r.display_name ?? "Someone", avatarUrl: r.avatar_url },
    host: r.is_host === 1,
    verified: r.verified === 1,
    pinned: r.pinned === 1,
    mine,
    canDelete: mine || staff,
  };
}

/** Live comment count and the host's setting, for the event page's summary row. */
export async function commentSummary(env: Env, eventId: string): Promise<{ count: number; mode: CommentMode }> {
  try {
    const r = await env.DB.prepare(
      "SELECT e.comments_mode AS mode, (SELECT COUNT(*) FROM comments c WHERE c.event_id = e.id AND c.status = 'live') AS n FROM events e WHERE e.id = ?",
    )
      .bind(eventId)
      .first<{ n: number; mode: CommentMode }>();
    return { count: r?.n ?? 0, mode: r?.mode ?? "on" };
  } catch (err) {
    if (!notMigrated(err)) console.error("comment summary", err);
    return { count: 0, mode: "on" };
  }
}

/** Has either person blocked the other? */
async function blockedBetween(env: Env, a: string, b: string): Promise<boolean> {
  const r = await env.DB.prepare("SELECT 1 FROM user_blocks WHERE kind = 'block' AND ((user_id = ?1 AND blocked_id = ?2) OR (user_id = ?2 AND blocked_id = ?1))").bind(a, b).first();
  return !!r;
}

interface EventRow {
  id: string;
  status: string;
  comments_mode: CommentMode;
}

const loadEvent = (env: Env, id: string) =>
  env.DB.prepare("SELECT id, status, comments_mode FROM events WHERE id = ? AND status IN ('live', 'cancelled')").bind(id).first<EventRow>();

function postNote(e: EventRow, userId: string | null): string | null {
  if (!userId) return "Sign in to comment.";
  if (e.status === "cancelled") return "This event was cancelled, so comments are closed.";
  if (e.comments_mode === "locked") return "The host closed comments. You can still read them.";
  if (e.comments_mode === "off") return "The host turned comments off.";
  return null;
}

async function thread(env: Env, e: EventRow, userId: string | null): Promise<CommentThread> {
  const s = await staffFor(env, e.id, userId);
  const staff = s.host || s.moderator;
  const mode = e.comments_mode;
  // Off: only staff see the thread (so they can turn it back on without losing anything).
  if (mode === "off" && !staff) return { comments: [], canComment: false, note: postNote(e, userId), canModerate: false, mode };
  const { results } = await env.DB.prepare(
    `SELECT c.*, u.display_name, u.avatar_url, u.is_verified_organizer AS verified,
       EXISTS (SELECT 1 FROM event_hosts h WHERE h.event_id = c.event_id AND h.user_id = c.user_id) AS is_host,
       COALESCE(
         (SELECT b.kind FROM user_blocks b WHERE b.user_id = ?3 AND b.blocked_id = c.user_id),
         (SELECT 'blocked-by' FROM user_blocks b WHERE b.user_id = c.user_id AND b.blocked_id = ?3 AND b.kind = 'block')
       ) AS relation
     FROM comments c JOIN users u ON u.id = c.user_id
     WHERE c.event_id = ?1 AND (c.status IN ('live', 'removed') OR (c.status = 'hidden' AND (?2 OR c.user_id = ?3)))
     ORDER BY c.created_at ASC LIMIT 500`,
  )
    .bind(e.id, staff ? 1 : 0, userId ?? "")
    .all<Row>();
  const note = postNote(e, userId);
  return { comments: visibleRows(results).map((r) => toComment(r, userId, staff)), canComment: note === null, note, canModerate: staff, mode };
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

const param = (c: Context<AppContext>) => c.req.param("id") ?? "";

/** Mounted at /events: the thread for one event, posting to it, and the host's on / read only / off switch. */
export const eventComments = new Hono<AppContext>();

eventComments.get(
  "/:id/comments",
  guard(async (c) => {
    const e = await loadEvent(c.env, param(c));
    if (!e) return c.json({ error: "We couldn't find that event." }, 404);
    c.header("Cache-Control", "private, no-store");
    return c.json(await thread(c.env, e, c.get("userId")));
  }),
);

eventComments.post(
  "/:id/comments",
  guard(async (c) => {
    const userId = c.get("userId");
    if (!userId) return c.json({ error: "Sign in to comment." }, 401);
    const e = await loadEvent(c.env, param(c));
    if (!e) return c.json({ error: "We couldn't find that event." }, 404);
    const closed = postNote(e, userId);
    if (closed) return c.json({ error: closed }, 409);
    const raw = (await c.req.json().catch(() => ({}))) as { body?: unknown; parentId?: unknown };
    const body = cleanBody(raw.body);
    if (!body) return c.json({ error: "Write something first." }, 400);
    if (body.length > COMMENT_MAX) return c.json({ error: `Keep it under ${COMMENT_MAX} characters.` }, 400);
    // Blocked by a host: no commenting on their events.
    const hostBlock = await c.env.DB.prepare(
      "SELECT 1 FROM event_hosts h JOIN user_blocks b ON b.user_id = h.user_id AND b.blocked_id = ? AND b.kind = 'block' WHERE h.event_id = ?",
    )
      .bind(userId, e.id)
      .first();
    if (hostBlock) return c.json({ error: "You can't comment on this event." }, 403);
    let parentId: string | null = null;
    if (typeof raw.parentId === "string" && raw.parentId) {
      const p = await c.env.DB.prepare("SELECT id, parent_id, status, user_id FROM comments WHERE id = ? AND event_id = ?")
        .bind(raw.parentId, e.id)
        .first<{ id: string; parent_id: string | null; status: string; user_id: string }>();
      if (!p || p.status !== "live") return c.json({ error: "That comment isn't there anymore." }, 404);
      if (await blockedBetween(c.env, userId, p.user_id)) return c.json({ error: "You can't reply to this comment." }, 403);
      // One level deep: a reply to a reply joins the same thread.
      parentId = p.parent_id ?? p.id;
    }
    if (!(await rateLimit(c.env.SESSIONS, `comment:${userId}`, 10, 3600))) return c.json({ error: "That's 10 comments this hour. Try again a little later." }, 429);
    if (!(await rateLimit(c.env.SESSIONS, `comment-event:${e.id}`, 600, 86400))) return c.json({ error: "This event has had a lot of comments today. Try again tomorrow." }, 429);
    const id = crypto.randomUUID();
    await c.env.DB.prepare("INSERT INTO comments (id, event_id, user_id, parent_id, body) VALUES (?, ?, ?, ?, ?)").bind(id, e.id, userId, parentId, body).run();
    const t = await thread(c.env, e, userId);
    return c.json({ comment: t.comments.find((x) => x.id === id), thread: t }, 201);
  }),
);

/** Host or moderator: comments on, locked (read only), or off. Body: { mode }. */
eventComments.put(
  "/:id/comments-mode",
  guard(async (c) => {
    const userId = c.get("userId");
    if (!userId) return c.json({ error: "Sign in first." }, 401);
    const e = await loadEvent(c.env, param(c));
    if (!e) return c.json({ error: "We couldn't find that event." }, 404);
    const s = await staffFor(c.env, e.id, userId);
    if (!s.host && !s.moderator) return c.json({ error: "Only the host can change comments." }, 403);
    const { mode } = (await c.req.json().catch(() => ({}))) as { mode?: CommentMode };
    if (!mode || !MODES.has(mode)) return c.json({ error: "Pick on, read only, or off." }, 400);
    await c.env.DB.prepare("UPDATE events SET comments_mode = ? WHERE id = ?").bind(mode, e.id).run();
    return c.json(await thread(c.env, { ...e, comments_mode: mode }, userId));
  }),
);

/** Mounted at /comments: actions on one comment. */
export const commentActions = new Hono<AppContext>();

async function loadComment(env: Env, id: string) {
  return env.DB.prepare(
    `SELECT c.id, c.event_id, c.user_id, c.parent_id, c.status, c.created_at, e.status AS event_status, e.comments_mode
     FROM comments c JOIN events e ON e.id = c.event_id WHERE c.id = ?`,
  )
    .bind(id)
    .first<{ id: string; event_id: string; user_id: string; parent_id: string | null; status: string; created_at: string; event_status: string; comments_mode: CommentMode }>();
}
const eventOf = (cm: { event_id: string; event_status: string; comments_mode: CommentMode }): EventRow => ({ id: cm.event_id, status: cm.event_status, comments_mode: cm.comments_mode });

/** Edit your own comment while comments are open. It shows as edited. Body: { body }. */
commentActions.patch(
  "/:id",
  guard(async (c) => {
    const userId = c.get("userId");
    if (!userId) return c.json({ error: "Sign in first." }, 401);
    const cm = await loadComment(c.env, param(c));
    if (!cm || cm.status === "removed") return c.json({ error: "That comment isn't there anymore." }, 404);
    if (cm.user_id !== userId) return c.json({ error: "You can only edit your own comments." }, 403);
    if (cm.status === "hidden") return c.json({ error: "This comment is under review, so it can't be edited." }, 409);
    const closed = postNote(eventOf(cm), userId);
    if (closed) return c.json({ error: closed }, 409);
    const raw = (await c.req.json().catch(() => ({}))) as { body?: unknown };
    const body = cleanBody(raw.body);
    if (!body) return c.json({ error: "Write something first, or remove the comment." }, 400);
    if (body.length > COMMENT_MAX) return c.json({ error: `Keep it under ${COMMENT_MAX} characters.` }, 400);
    if (!(await rateLimit(c.env.SESSIONS, `comment-edit:${userId}`, 30, 3600))) return c.json({ error: "Too many edits. Try again later." }, 429);
    await c.env.DB.prepare("UPDATE comments SET body = ?, edited_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").bind(body, cm.id).run();
    return c.json(await thread(c.env, eventOf(cm), userId));
  }),
);

commentActions.delete(
  "/:id",
  guard(async (c) => {
    const userId = c.get("userId");
    if (!userId) return c.json({ error: "Sign in first." }, 401);
    const cm = await loadComment(c.env, param(c));
    if (!cm || cm.status === "removed") return c.json({ error: "That comment isn't there anymore." }, 404);
    const s = await staffFor(c.env, cm.event_id, userId);
    if (cm.user_id !== userId && !s.host && !s.moderator) return c.json({ error: "Only the author, the host, or a moderator can remove this." }, 403);
    await removeComment(c.env, cm.id);
    return c.json(await thread(c.env, eventOf(cm), userId));
  }),
);

/** Keep the row (and clear the words) so reports keep their history and replies keep their place. */
async function removeComment(env: Env, id: string) {
  await env.DB.batch([
    env.DB.prepare("UPDATE comments SET status = 'removed', body = '', pinned = 0 WHERE id = ?").bind(id),
    env.DB.prepare("UPDATE comment_reports SET status = 'actioned' WHERE comment_id = ? AND status = 'open'").bind(id),
  ]);
}

/** Hosts and moderators: pin one comment to the top (pinning another unpins the last). Body: { pinned }. */
commentActions.post(
  "/:id/pin",
  guard(async (c) => {
    const userId = c.get("userId");
    if (!userId) return c.json({ error: "Sign in first." }, 401);
    const cm = await loadComment(c.env, param(c));
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
    return c.json(await thread(c.env, eventOf(cm), userId));
  }),
);

/** Report a comment. Three open reports hide it until a moderator reviews it. */
commentActions.post(
  "/:id/report",
  guard(async (c) => {
    const userId = c.get("userId");
    if (!userId) return c.json({ error: "Sign in to report a comment." }, 401);
    if (!(await rateLimit(c.env.SESSIONS, `comment-report:${userId}`, 20, 3600))) return c.json({ error: "Too many reports. Try again later." }, 429);
    const cm = await loadComment(c.env, param(c));
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

/** Mounted at /: the moderators' comment queue. */
export const commentModeration = new Hono<AppContext>();

/** Hidden comments and comments with open reports, oldest report first so nothing waits too long. */
commentModeration.get(
  "/mod/comments",
  guard(async (c) => {
    if (!(await isModerator(c.env, c.get("userId")))) return c.json({ error: "Moderators only." }, 403);
    c.header("Cache-Control", "private, no-store");
    const { results } = await c.env.DB.prepare(
      `SELECT c.id, c.event_id, c.body, c.status, c.created_at, c.user_id, u.display_name AS author, e.title AS event_title,
         (SELECT group_concat(reason, ',') FROM comment_reports r WHERE r.comment_id = c.id AND r.status = 'open') AS reasons,
         (SELECT group_concat(note, ' / ') FROM comment_reports r WHERE r.comment_id = c.id AND r.status = 'open' AND note <> '') AS notes,
         (SELECT MIN(created_at) FROM comment_reports r WHERE r.comment_id = c.id AND r.status = 'open') AS first_report,
         (SELECT COUNT(*) FROM comments x WHERE x.user_id = c.user_id AND x.status IN ('hidden', 'removed')) AS strikes
       FROM comments c JOIN users u ON u.id = c.user_id JOIN events e ON e.id = c.event_id
       WHERE c.status = 'hidden' OR EXISTS (SELECT 1 FROM comment_reports r WHERE r.comment_id = c.id AND r.status = 'open')
       ORDER BY COALESCE(first_report, c.created_at) ASC LIMIT 200`,
    ).all<{
      id: string;
      event_id: string;
      body: string;
      status: string;
      created_at: string;
      user_id: string;
      author: string;
      event_title: string;
      reasons: string | null;
      notes: string | null;
      first_report: string | null;
      strikes: number;
    }>();
    const items: ModCommentItem[] = results.map((r) => ({
      id: r.id,
      eventId: r.event_id,
      eventTitle: r.event_title,
      body: r.body,
      status: r.status === "hidden" ? "hidden" : "live",
      createdAt: r.created_at,
      author: { id: r.user_id, displayName: r.author },
      reasons: r.reasons ? r.reasons.split(",") : [],
      notes: r.notes,
      firstReportAt: r.first_report,
      strikes: r.strikes,
    }));
    return c.json({ items });
  }),
);

/** restore: back to live, reports dismissed. remove: gone, reports closed as actioned. */
commentModeration.post(
  "/mod/comments/:id",
  guard(async (c) => {
    if (!(await isModerator(c.env, c.get("userId")))) return c.json({ error: "Moderators only." }, 403);
    const cm = await loadComment(c.env, param(c));
    if (!cm) return c.json({ error: "That comment is gone." }, 404);
    const { action } = (await c.req.json().catch(() => ({}))) as { action?: string };
    if (action === "remove") await removeComment(c.env, cm.id);
    else if (action === "restore") {
      await c.env.DB.batch([
        c.env.DB.prepare("UPDATE comments SET status = 'live' WHERE id = ? AND status = 'hidden'").bind(cm.id),
        c.env.DB.prepare("UPDATE comment_reports SET status = 'dismissed' WHERE comment_id = ? AND status = 'open'").bind(cm.id),
      ]);
    } else return c.json({ error: "Unknown action." }, 400);
    return c.json({ ok: true });
  }),
);

/** Mounted at /me/blocks: the people you've muted or blocked. */
export const blocks = new Hono<AppContext>();

blocks.get(
  "/",
  guard(async (c) => {
    const userId = c.get("userId");
    if (!userId) return c.json({ error: "Sign in first." }, 401);
    c.header("Cache-Control", "private, no-store");
    const { results } = await c.env.DB.prepare(
      `SELECT b.blocked_id AS id, b.kind, b.created_at, u.display_name, u.avatar_url FROM user_blocks b JOIN users u ON u.id = b.blocked_id
       WHERE b.user_id = ? ORDER BY b.created_at DESC`,
    )
      .bind(userId)
      .all<{ id: string; kind: "mute" | "block"; created_at: string; display_name: string; avatar_url: string | null }>();
    return c.json({ people: results.map((r) => ({ id: r.id, kind: r.kind, displayName: r.display_name, avatarUrl: r.avatar_url })) });
  }),
);

/** Mute or block someone. Body: { kind }. */
blocks.put(
  "/:id",
  guard(async (c) => {
    const userId = c.get("userId");
    if (!userId) return c.json({ error: "Sign in first." }, 401);
    const other = param(c);
    if (other === userId) return c.json({ error: "That's you." }, 400);
    const { kind } = (await c.req.json().catch(() => ({}))) as { kind?: string };
    if (kind !== "mute" && kind !== "block") return c.json({ error: "Mute or block?" }, 400);
    const exists = await c.env.DB.prepare("SELECT 1 FROM users WHERE id = ?").bind(other).first();
    if (!exists) return c.json({ error: "We couldn't find that person." }, 404);
    if (!(await rateLimit(c.env.SESSIONS, `block:${userId}`, 60, 3600))) return c.json({ error: "Too many changes. Try again later." }, 429);
    await c.env.DB.prepare(
      "INSERT INTO user_blocks (user_id, blocked_id, kind) VALUES (?, ?, ?) ON CONFLICT (user_id, blocked_id) DO UPDATE SET kind = excluded.kind",
    )
      .bind(userId, other, kind)
      .run();
    return c.json({ ok: true });
  }),
);

blocks.delete(
  "/:id",
  guard(async (c) => {
    const userId = c.get("userId");
    if (!userId) return c.json({ error: "Sign in first." }, 401);
    await c.env.DB.prepare("DELETE FROM user_blocks WHERE user_id = ? AND blocked_id = ?").bind(userId, param(c)).run();
    return c.json({ ok: true });
  }),
);
