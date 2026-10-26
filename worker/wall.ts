// The event wall: photos from people who checked in (and the host), from doors until 7 days after the event.
// People who RSVP'd, checked in, or host see every post; everyone else sees only the host's public highlights.
// Photos are re-encoded on the phone before upload (that strips location and camera data) and served
// through this Worker, never as public files, so the visibility rules hold for the images too.
import { Hono, type Context } from "hono";
import type { AppContext, Env } from "./env";
import { canHost, notMigrated } from "./checkins";
import { isModerator } from "./moderation";
import { rateLimit } from "./posting";
import { sniffImage } from "./validate";
import type { WallPost, WallState } from "../shared/types";

export const WALL_MAX_BYTES = 8 * 1024 * 1024;
const THUMB_MAX_BYTES = 300 * 1024;
const CAPTION_MAX = 200;
const OPEN_BEFORE_MS = 30 * 60e3;
export const POST_AFTER_MS = 7 * 86400e3;
const CONTENT_TYPES = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" } as const;
export const WALL_REPORT_REASONS = new Set(["remove-me", "nudity", "drugs", "minor", "private-area", "harassment", "other"]);

interface EventRow {
  id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  policy_tags: string;
  wall_enabled: number;
}

interface PostRow {
  id: string;
  event_id: string;
  user_id: string;
  media_key: string;
  thumb_key: string | null;
  width: number | null;
  height: number | null;
  caption: string | null;
  anonymous: number;
  highlight: number;
  status: "live" | "hidden" | "removed";
  created_at: string;
  display_name: string | null;
  avatar_url: string | null;
}

const photoFree = (e: EventRow) => {
  try {
    return (JSON.parse(e.policy_tags || "[]") as string[]).includes("no-photos");
  } catch {
    return false;
  }
};

async function loadEvent(env: Env, id: string) {
  return env.DB.prepare("SELECT id, starts_at, ends_at, status, policy_tags, wall_enabled FROM events WHERE id = ? AND status IN ('live', 'cancelled')")
    .bind(id)
    .first<EventRow>();
}

interface Access {
  host: boolean;
  moderator: boolean;
  /** RSVP'd, checked in, host, or moderator: sees the whole wall. */
  full: boolean;
  checkedIn: boolean;
}

async function access(env: Env, eventId: string, userId: string | null): Promise<Access> {
  if (!userId) return { host: false, moderator: false, full: false, checkedIn: false };
  const [host, moderator, rsvp, checkin] = await Promise.all([
    env.DB.prepare("SELECT 1 FROM event_hosts WHERE event_id = ? AND user_id = ?").bind(eventId, userId).first(),
    isModerator(env, userId),
    env.DB.prepare("SELECT 1 FROM rsvps WHERE event_id = ? AND user_id = ?").bind(eventId, userId).first(),
    env.DB.prepare("SELECT 1 FROM checkins WHERE event_id = ? AND user_id = ?").bind(eventId, userId).first(),
  ]);
  return { host: !!host, moderator, full: !!(host || moderator || rsvp || checkin), checkedIn: !!checkin };
}

/** Whether this person can post now, and if not, why, in words for the wall. */
function postRule(e: EventRow, a: Access): string | null {
  if (photoFree(e)) return "This night is photo-free, so there's no wall.";
  if (!e.wall_enabled) return "The host turned the wall off.";
  if (e.status !== "live") return "This event was cancelled.";
  const now = Date.now();
  if (now < Date.parse(e.starts_at) - OPEN_BEFORE_MS) return "The wall opens at doors.";
  if (now > Date.parse(e.ends_at) + POST_AFTER_MS) return "The wall closed a week after the event.";
  if (!(a.host || a.moderator || a.checkedIn)) return "Check in at the event to post.";
  return null;
}

function toPost(r: PostRow, viewerId: string | null): WallPost {
  const mine = r.user_id === viewerId;
  return {
    id: r.id,
    url: `/api/wall/media/${encodeURIComponent(r.id)}/full`,
    thumbUrl: `/api/wall/media/${encodeURIComponent(r.id)}/${r.thumb_key ? "thumb" : "full"}`,
    width: r.width,
    height: r.height,
    caption: r.caption,
    // Anonymous posts don't name anyone, the host included. Your own still shows as yours.
    author: r.anonymous && !mine ? null : { id: r.user_id, displayName: r.display_name ?? "Someone", avatarUrl: r.avatar_url },
    anonymous: r.anonymous === 1,
    mine,
    highlight: r.highlight === 1,
    status: r.status === "hidden" ? "hidden" : "live",
    createdAt: r.created_at,
  };
}

async function state(env: Env, e: EventRow, userId: string | null): Promise<WallState> {
  const a = await access(env, e.id, userId);
  const staff = a.host || a.moderator;
  const { results } = await env.DB.prepare(
    `SELECT p.*, u.display_name, u.avatar_url FROM wall_posts p JOIN users u ON u.id = p.user_id
     WHERE p.event_id = ? AND (p.status = 'live' OR (p.status = 'hidden' AND (? OR p.user_id = ?)))
     ORDER BY p.created_at DESC LIMIT 300`,
  )
    .bind(e.id, staff ? 1 : 0, userId ?? "")
    .all<PostRow>();
  const visible = a.full ? results : results.filter((r) => r.highlight === 1 && r.status === "live");
  const note = postRule(e, a);
  return {
    enabled: e.wall_enabled === 1,
    photoFree: photoFree(e),
    view: a.full ? "all" : "highlights",
    canPost: note === null,
    postNote: note,
    closesAt: new Date(Date.parse(e.ends_at) + POST_AFTER_MS).toISOString(),
    viewerIsHost: staff,
    posts: visible.map((r) => toPost(r, userId)),
    hiddenCount: a.full ? 0 : results.filter((r) => r.status === "live").length - visible.length,
  };
}

function guard(fn: (c: Context<AppContext>) => Promise<Response>) {
  return async (c: Context<AppContext>) => {
    try {
      return await fn(c);
    } catch (err) {
      if (notMigrated(err)) return c.json({ error: "The wall isn't set up on this server yet." }, 503);
      throw err;
    }
  };
}

/** Routes under /api/events/:id/wall */
export const eventWall = new Hono<AppContext>();

eventWall.get(
  "/:id/wall",
  guard(async (c) => {
    const e = await loadEvent(c.env, c.req.param("id") ?? "");
    if (!e) return c.json({ error: "We couldn't find that event." }, 404);
    c.header("Cache-Control", "private, no-store");
    return c.json(await state(c.env, e, c.get("userId")));
  }),
);

/** Multipart: photo, thumb (optional), caption, anonymous ("1"), width, height. */
eventWall.post(
  "/:id/wall",
  guard(async (c) => {
    const userId = c.get("userId");
    if (!userId) return c.json({ error: "Sign in to post." }, 401);
    const e = await loadEvent(c.env, c.req.param("id") ?? "");
    if (!e) return c.json({ error: "We couldn't find that event." }, 404);
    const note = postRule(e, await access(c.env, e.id, userId));
    if (note) return c.json({ error: note }, 403);
    if (!(await rateLimit(c.env.SESSIONS, `wall:${userId}`, 15, 3600))) return c.json({ error: "That's a lot of photos in an hour. Try again a little later." }, 429);
    if (!(await rateLimit(c.env.SESSIONS, `wall-event:${e.id}`, 400, 86400))) return c.json({ error: "This wall is full for today." }, 429);

    if (Number(c.req.header("Content-Length") ?? 0) > WALL_MAX_BYTES + THUMB_MAX_BYTES + 64 * 1024) return c.json({ error: "Photos can be up to 8 MB." }, 413);
    const form = await c.req.formData().catch(() => null);
    const photo = form?.get("photo");
    if (!form || !(photo instanceof File)) return c.json({ error: "Add a photo." }, 400);
    const bytes = new Uint8Array(await photo.arrayBuffer());
    if (bytes.byteLength > WALL_MAX_BYTES) return c.json({ error: "Photos can be up to 8 MB." }, 413);
    const type = sniffImage(bytes);
    if (!type) return c.json({ error: "Use a JPG, PNG, or WebP photo." }, 415);
    const thumbFile = form.get("thumb");
    const thumbBytes = thumbFile instanceof File ? new Uint8Array(await thumbFile.arrayBuffer()) : null;
    const thumbType = thumbBytes && thumbBytes.byteLength <= THUMB_MAX_BYTES ? sniffImage(thumbBytes) : null;

    const caption = String(form.get("caption") ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, CAPTION_MAX);
    const anonymous = form.get("anonymous") === "1" ? 1 : 0;
    const dim = (k: string) => {
      const n = Math.round(Number(form.get(k)));
      return Number.isFinite(n) && n > 0 && n < 20000 ? n : null;
    };

    const id = crypto.randomUUID();
    const key = `wall/${userId}/${e.id}/${id}.${type}`;
    const meta = (t: keyof typeof CONTENT_TYPES) => ({ httpMetadata: { contentType: CONTENT_TYPES[t] } });
    await c.env.MEDIA.put(key, bytes, meta(type));
    let thumbKey: string | null = null;
    if (thumbBytes && thumbType) {
      thumbKey = `${key}.thumb`;
      await c.env.MEDIA.put(thumbKey, thumbBytes, meta(thumbType));
    }
    await c.env.DB.prepare(
      `INSERT INTO wall_posts (id, event_id, user_id, media_key, thumb_key, width, height, caption, anonymous) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(id, e.id, userId, key, thumbKey, dim("width"), dim("height"), caption || null, anonymous)
      .run();
    return c.json(await state(c.env, e, userId), 201);
  }),
);

/** Host: turn the wall on or off for this event. */
eventWall.patch(
  "/:id/wall",
  guard(async (c) => {
    const e = await loadEvent(c.env, c.req.param("id") ?? "");
    if (!e) return c.json({ error: "We couldn't find that event." }, 404);
    if (!(await canHost(c.env, e.id, c.get("userId")))) return c.json({ error: "Only the host can change the wall." }, 403);
    const body = (await c.req.json().catch(() => ({}))) as { enabled?: boolean };
    await c.env.DB.prepare("UPDATE events SET wall_enabled = ? WHERE id = ?").bind(body.enabled ? 1 : 0, e.id).run();
    return c.json(await state(c.env, { ...e, wall_enabled: body.enabled ? 1 : 0 }, c.get("userId")));
  }),
);

/** Routes under /api/wall */
export const wallPosts = new Hono<AppContext>();

async function loadPost(env: Env, id: string) {
  return env.DB.prepare(
    `SELECT p.*, u.display_name, u.avatar_url FROM wall_posts p JOIN users u ON u.id = p.user_id WHERE p.id = ?`,
  )
    .bind(id)
    .first<PostRow>();
}

/** The image itself, only to people who can see the post. */
wallPosts.get(
  "/media/:id/:size",
  guard(async (c) => {
    const p = await loadPost(c.env, c.req.param("id") ?? "");
    if (!p || p.status === "removed") return c.notFound();
    const userId = c.get("userId");
    const a = await access(c.env, p.event_id, userId);
    const staff = a.host || a.moderator;
    const allowed = p.status === "hidden" ? staff || p.user_id === userId : a.full || p.highlight === 1;
    if (!allowed) return c.json({ error: "RSVP to see this wall." }, 403);
    const key = c.req.param("size") === "thumb" && p.thumb_key ? p.thumb_key : p.media_key;
    const obj = await c.env.MEDIA.get(key);
    if (!obj) return c.notFound();
    const headers = new Headers();
    obj.writeHttpMetadata(headers);
    headers.set("etag", obj.httpEtag);
    // Public highlights can be cached anywhere; everything else only in the viewer's browser.
    headers.set("Cache-Control", p.highlight === 1 && p.status === "live" ? "public, max-age=3600" : "private, max-age=3600");
    return new Response(obj.body, { headers });
  }),
);

/** Host: pick or unpick a post as a public highlight. */
wallPosts.patch(
  "/:id",
  guard(async (c) => {
    const p = await loadPost(c.env, c.req.param("id") ?? "");
    if (!p || p.status === "removed") return c.json({ error: "That post is gone." }, 404);
    if (!(await canHost(c.env, p.event_id, c.get("userId")))) return c.json({ error: "Only the host can pick highlights." }, 403);
    const body = (await c.req.json().catch(() => ({}))) as { highlight?: boolean };
    await c.env.DB.prepare("UPDATE wall_posts SET highlight = ? WHERE id = ?").bind(body.highlight ? 1 : 0, p.id).run();
    return c.json({ ok: true, highlight: !!body.highlight });
  }),
);

async function removePost(env: Env, p: PostRow, by: "author" | "host" | "moderator") {
  await env.DB.prepare("UPDATE wall_posts SET status = 'removed', removed_by = ?, highlight = 0 WHERE id = ?").bind(by, p.id).run();
  await env.DB.prepare("UPDATE wall_reports SET status = 'actioned' WHERE post_id = ? AND status = 'open'").bind(p.id).run();
  // The images go right away; the row stays so reports keep their history.
  await env.MEDIA.delete([p.media_key, ...(p.thumb_key ? [p.thumb_key] : [])]);
}

/** The person who posted it, the host, or a moderator can remove a post. */
wallPosts.delete(
  "/:id",
  guard(async (c) => {
    const userId = c.get("userId");
    if (!userId) return c.json({ error: "Sign in first." }, 401);
    const p = await loadPost(c.env, c.req.param("id") ?? "");
    if (!p || p.status === "removed") return c.json({ ok: true });
    const by = p.user_id === userId ? "author" : (await c.env.DB.prepare("SELECT 1 FROM event_hosts WHERE event_id = ? AND user_id = ?").bind(p.event_id, userId).first()) ? "host" : (await isModerator(c.env, userId)) ? "moderator" : null;
    if (!by) return c.json({ error: "You can't remove this post." }, 403);
    await removePost(c.env, p, by);
    return c.json({ ok: true });
  }),
);

/**
 * Report a post. "remove-me" is for someone shown in the photo: it comes down right away, pending review.
 * Any three reports hide it the same way.
 */
wallPosts.post(
  "/:id/report",
  guard(async (c) => {
    const userId = c.get("userId");
    if (!userId) return c.json({ error: "Sign in to report a post." }, 401);
    if (!(await rateLimit(c.env.SESSIONS, `wall-report:${userId}`, 20, 3600))) return c.json({ error: "Too many reports. Try again later." }, 429);
    const p = await loadPost(c.env, c.req.param("id") ?? "");
    if (!p || p.status === "removed") return c.json({ ok: true });
    if (p.user_id === userId) return c.json({ error: "You can remove your own post instead." }, 400);
    const body = (await c.req.json().catch(() => ({}))) as { reason?: string; note?: string };
    const reason = WALL_REPORT_REASONS.has(body.reason ?? "") ? body.reason! : "other";
    const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : null;
    await c.env.DB.prepare(
      `INSERT INTO wall_reports (id, post_id, reporter_id, reason, note) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (post_id, reporter_id) DO UPDATE SET reason = excluded.reason, note = excluded.note, status = 'open'`,
    )
      .bind(crypto.randomUUID(), p.id, userId, reason, note)
      .run();
    const open = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM wall_reports WHERE post_id = ? AND status = 'open'").bind(p.id).first<{ n: number }>();
    const hide = reason === "remove-me" || (open?.n ?? 0) >= 3;
    if (hide && p.status === "live") await c.env.DB.prepare("UPDATE wall_posts SET status = 'hidden', highlight = 0 WHERE id = ?").bind(p.id).run();
    return c.json({ ok: true, hidden: hide });
  }),
);

/** Moderators: hidden or reported wall posts, newest first. */
export const wallModeration = new Hono<AppContext>();

wallModeration.get(
  "/mod/wall",
  guard(async (c) => {
    if (!(await isModerator(c.env, c.get("userId")))) return c.json({ error: "Moderators only." }, 403);
    const { results } = await c.env.DB.prepare(
      `SELECT p.id, p.event_id, p.status, p.caption, p.anonymous, p.created_at, u.display_name AS author, e.title AS event_title,
         (SELECT group_concat(reason, ',') FROM wall_reports r WHERE r.post_id = p.id AND r.status = 'open') AS reasons
       FROM wall_posts p JOIN users u ON u.id = p.user_id JOIN events e ON e.id = p.event_id
       WHERE p.status = 'hidden' OR EXISTS (SELECT 1 FROM wall_reports r WHERE r.post_id = p.id AND r.status = 'open')
       ORDER BY p.created_at DESC LIMIT 200`,
    ).all<{ id: string; event_id: string; status: string; caption: string | null; anonymous: number; created_at: string; author: string; event_title: string; reasons: string | null }>();
    return c.json({
      items: results.map((r) => ({
        id: r.id,
        eventId: r.event_id,
        eventTitle: r.event_title,
        status: r.status,
        caption: r.caption,
        // Moderators see who posted, even anonymously, to handle repeat problems.
        author: r.author,
        anonymous: r.anonymous === 1,
        createdAt: r.created_at,
        thumbUrl: `/api/wall/media/${encodeURIComponent(r.id)}/thumb`,
        reasons: r.reasons ? r.reasons.split(",") : [],
      })),
    });
  }),
);

wallModeration.post(
  "/mod/wall/:id",
  guard(async (c) => {
    if (!(await isModerator(c.env, c.get("userId")))) return c.json({ error: "Moderators only." }, 403);
    const p = await loadPost(c.env, c.req.param("id") ?? "");
    if (!p) return c.json({ error: "That post is gone." }, 404);
    const body = (await c.req.json().catch(() => ({}))) as { action?: string };
    if (body.action === "remove") await removePost(c.env, p, "moderator");
    else if (body.action === "restore" || body.action === "dismiss") {
      await c.env.DB.batch([
        c.env.DB.prepare("UPDATE wall_posts SET status = 'live' WHERE id = ? AND status = 'hidden'").bind(p.id),
        c.env.DB.prepare("UPDATE wall_reports SET status = 'dismissed' WHERE post_id = ? AND status = 'open'").bind(p.id),
      ]);
    } else return c.json({ error: "Unknown action." }, 400);
    return c.json({ ok: true });
  }),
);
