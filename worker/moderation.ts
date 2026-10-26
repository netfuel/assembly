import { Hono } from "hono";
import type { AppContext, Env } from "./env";
import type { ModItem } from "../shared/types";
import { notifyUsers } from "./push";

/** True when one of this user's sign-in emails is listed in MODERATORS. */
export async function isModerator(env: Env, userId: string | null): Promise<boolean> {
  if (!userId || !env.MODERATORS) return false;
  // Tolerate how people type lists: commas, spaces, or new lines, with stray quotes or brackets.
  const allowed = env.MODERATORS.split(/[\s,;]+/)
    .map((e) => e.replace(/["'<>\[\]]/g, "").trim().toLowerCase())
    .filter((e) => e.includes("@"));
  if (!allowed.length) return false;
  const { results } = await env.DB.prepare("SELECT email FROM identities WHERE user_id = ? AND email IS NOT NULL").bind(userId).all<{ email: string }>();
  return results.some((r) => allowed.includes(r.email.toLowerCase()));
}

const USER_REASONS = new Set(["unsafe", "hateful", "spam", "impersonation", "other"]);

export const moderation = new Hono<AppContext>();

/** Anyone signed in can report a person (an organizer, say). Goes to the review queue; nothing is hidden automatically. */
moderation.post("/users/:id/report", async (c) => {
  const userId = c.get("userId");
  if (!userId) return c.json({ error: "Sign in to report someone." }, 401);
  const target = c.req.param("id");
  if (target === userId) return c.json({ error: "You can't report yourself." }, 400);
  const body = (await c.req.json().catch(() => ({}))) as { reason?: string; note?: string };
  const reason = USER_REASONS.has(body.reason ?? "") ? body.reason! : "other";
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : "";
  const db = c.env.DB;
  if (!(await db.prepare("SELECT 1 FROM users WHERE id = ?").bind(target).first())) return c.json({ error: "We couldn't find that person." }, 404);
  const already = await db
    .prepare("SELECT 1 FROM reports WHERE target_type = 'user' AND target_id = ? AND reporter_id = ? AND status = 'open'")
    .bind(target, userId)
    .first();
  if (!already) {
    await db
      .prepare("INSERT INTO reports (id, target_type, target_id, reporter_id, reason) VALUES (?, 'user', ?, ?, ?)")
      .bind(crypto.randomUUID(), target, userId, note ? `${reason}: ${note}` : reason)
      .run();
  }
  return c.json({ ok: true });
});

// Everything below is for moderators only.
moderation.use("/mod/*", async (c, next) => {
  if (!(await isModerator(c.env, c.get("userId")))) return c.json({ error: "Moderators only." }, 403);
  c.header("Cache-Control", "private, no-store");
  await next();
});

/** Launch numbers from the PRD that the app can count itself (no tracking needed). */
moderation.get("/mod/stats", async (c) => {
  const now = Date.now();
  const ago = (days: number) => new Date(now - days * 86400e3).toISOString();
  const row = await c.env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM events WHERE is_sample = 0 AND created_at >= ?1) AS events_week,
       (SELECT COUNT(*) FROM events WHERE is_sample = 0 AND status = 'live' AND ends_at > ?3) AS upcoming,
       (SELECT COUNT(DISTINCT h.user_id) FROM event_hosts h JOIN events e ON e.id = h.event_id
          WHERE e.is_sample = 0 AND e.created_at >= ?2) AS organizers_month,
       (SELECT COUNT(*) FROM users WHERE created_at >= ?1) AS members_week,
       (SELECT COUNT(*) FROM users) AS members,
       (SELECT COUNT(*) FROM rsvps WHERE created_at >= ?1) AS rsvps_week,
       (SELECT COUNT(*) FROM events WHERE status = 'draft') AS in_review,
       (SELECT COUNT(*) FROM reports WHERE status = 'open') AS open_reports`,
  )
    .bind(ago(7), ago(30), new Date(now).toISOString())
    .first<Record<string, number>>();
  return c.json({ stats: row });
});

/** Open reports grouped by what was reported, plus hidden events even if their reports were cleared. */
moderation.get("/mod/queue", async (c) => {
  const db = c.env.DB;
  const { results: rows } = await db
    .prepare(
      `SELECT r.target_type, r.target_id, r.reason, r.created_at
       FROM reports r WHERE r.status = 'open' ORDER BY r.created_at DESC LIMIT 500`,
    )
    .all<{ target_type: "event" | "user" | "artist" | "venue"; target_id: string; reason: string; created_at: string }>();

  const groups = new Map<string, { type: "event" | "user" | "artist" | "venue"; id: string; reasons: string[]; latest: string }>();
  for (const r of rows) {
    const key = `${r.target_type}:${r.target_id}`;
    const g = groups.get(key) ?? { type: r.target_type, id: r.target_id, reasons: [], latest: r.created_at };
    g.reasons.push(r.reason);
    groups.set(key, g);
  }
  const { results: hidden } = await db.prepare("SELECT id FROM events WHERE status IN ('hidden', 'draft')").all<{ id: string }>();
  for (const h of hidden) if (!groups.has(`event:${h.id}`)) groups.set(`event:${h.id}`, { type: "event", id: h.id, reasons: [], latest: "" });

  const items: ModItem[] = [];
  for (const g of groups.values()) {
    if (g.type === "event") {
      const e = await db
        .prepare(
          `SELECT e.id, e.title, e.status, e.starts_at, u.id AS host_id, u.display_name AS host_name, u.is_verified_organizer AS verified
           FROM events e LEFT JOIN event_hosts h ON h.event_id = e.id AND h.role = 'owner' LEFT JOIN users u ON u.id = h.user_id
           WHERE e.id = ?`,
        )
        .bind(g.id)
        .first<{ id: string; title: string; status: string; starts_at: string; host_id: string | null; host_name: string | null; verified: number | null }>();
      if (!e) continue;
      items.push({
        type: "event",
        id: e.id,
        title: e.title,
        status: e.status,
        startsAt: e.starts_at,
        host: e.host_id ? { id: e.host_id, displayName: e.host_name ?? "", verified: e.verified === 1 } : null,
        reasons: g.reasons,
        latest: g.latest,
      });
    } else if (g.type === "artist" || g.type === "venue") {
      const p = await db
        .prepare(g.type === "artist" ? "SELECT name, slug, claimed_by FROM artists WHERE id = ?" : "SELECT name, COALESCE(slug, id) AS slug, claimed_by FROM venues WHERE id = ?")
        .bind(g.id)
        .first<{ name: string; slug: string; claimed_by: string | null }>();
      if (!p) continue;
      items.push({ type: "page", kind: g.type, id: g.id, slug: p.slug, title: p.name, claimed: !!p.claimed_by, reasons: g.reasons, latest: g.latest });
    } else {
      const u = await db
        .prepare(
          `SELECT u.id, u.display_name, u.is_verified_organizer AS verified,
             (SELECT COUNT(*) FROM event_hosts h WHERE h.user_id = u.id) AS hosted
           FROM users u WHERE u.id = ?`,
        )
        .bind(g.id)
        .first<{ id: string; display_name: string; verified: number; hosted: number }>();
      if (!u) continue;
      items.push({ type: "user", id: u.id, title: u.display_name, verified: u.verified === 1, hosted: u.hosted, reasons: g.reasons, latest: g.latest });
    }
  }
  // Most-reported first, then newest.
  // First posts waiting for review first, then most-reported, then newest.
  const waiting = (i: ModItem) => (i.type === "event" && i.status === "draft" ? 1 : 0);
  items.sort((a, b) => waiting(b) - waiting(a) || b.reasons.length - a.reasons.length || b.latest.localeCompare(a.latest));
  return c.json({ items });
});

/**
 * restore: put a hidden event back on the map and dismiss its reports.
 * remove: keep it hidden and mark its reports handled.
 * dismiss: close the reports without changing anything.
 */
moderation.post("/mod/events/:id", async (c) => {
  const id = c.req.param("id");
  const { action } = (await c.req.json().catch(() => ({}))) as { action?: string };
  const db = c.env.DB;
  if (action === "approve" || action === "reject") {
    const ev = await db
      .prepare(
        `SELECT e.title, e.status, h.user_id FROM events e LEFT JOIN event_hosts h ON h.event_id = e.id AND h.role = 'owner' WHERE e.id = ?`,
      )
      .bind(id)
      .first<{ title: string; status: string; user_id: string | null }>();
    if (!ev || ev.status !== "draft") return c.json({ error: "That event isn't waiting for review." }, 409);
    await db.prepare("UPDATE events SET status = ? WHERE id = ? AND status = 'draft'").bind(action === "approve" ? "live" : "hidden", id).run();
    if (ev.user_id) {
      const msg =
        action === "approve"
          ? { title: "You're on the map", body: `${ev.title} is live. Share it around.`, url: `/e/${id}`, tag: `review-${id}` }
          : { title: "Your event wasn't approved", body: `${ev.title} didn't go live. Reply to hello@assembly.rsvp if you have questions.`, url: `/e/${id}`, tag: `review-${id}` };
      c.executionCtx.waitUntil(notifyUsers(c.env, [ev.user_id], msg).catch((err) => console.error("review push", err)));
    }
    return c.json({ ok: true });
  }
  if (action === "restore") {
    await db.batch([
      db.prepare("UPDATE events SET status = 'live' WHERE id = ? AND status = 'hidden'").bind(id),
      db.prepare("UPDATE reports SET status = 'dismissed' WHERE target_type = 'event' AND target_id = ? AND status = 'open'").bind(id),
    ]);
  } else if (action === "remove") {
    await db.batch([
      db.prepare("UPDATE events SET status = 'hidden' WHERE id = ?").bind(id),
      db.prepare("UPDATE reports SET status = 'actioned' WHERE target_type = 'event' AND target_id = ? AND status = 'open'").bind(id),
    ]);
  } else if (action === "dismiss") {
    await db.prepare("UPDATE reports SET status = 'dismissed' WHERE target_type = 'event' AND target_id = ? AND status = 'open'").bind(id).run();
  } else return c.json({ error: "Unknown action." }, 400);
  return c.json({ ok: true });
});

/**
 * dismiss: close the reports. hide-events: take every event this person hosts off the map and mark reports handled.
 */
moderation.post("/mod/users/:id", async (c) => {
  const id = c.req.param("id");
  const { action } = (await c.req.json().catch(() => ({}))) as { action?: string };
  const db = c.env.DB;
  if (action === "dismiss") {
    await db.prepare("UPDATE reports SET status = 'dismissed' WHERE target_type = 'user' AND target_id = ? AND status = 'open'").bind(id).run();
  } else if (action === "hide-events") {
    await db.batch([
      db.prepare("UPDATE events SET status = 'hidden' WHERE status = 'live' AND id IN (SELECT event_id FROM event_hosts WHERE user_id = ?)").bind(id),
      db.prepare("UPDATE users SET is_verified_organizer = 0 WHERE id = ?").bind(id),
      db.prepare("UPDATE reports SET status = 'actioned' WHERE target_type = 'user' AND target_id = ? AND status = 'open'").bind(id),
    ]);
  } else return c.json({ error: "Unknown action." }, 400);
  return c.json({ ok: true });
});

/** dismiss: close the reports. clear: wipe the page's bio, photo and links (and its owner) and close them. */
moderation.post("/mod/pages/:kind/:id", async (c) => {
  const kind = c.req.param("kind");
  if (kind !== "artist" && kind !== "venue") return c.json({ error: "Unknown page type." }, 400);
  const id = c.req.param("id");
  const { action } = (await c.req.json().catch(() => ({}))) as { action?: string };
  const db = c.env.DB;
  const close = (status: string) => db.prepare(`UPDATE reports SET status = '${status}' WHERE target_type = ? AND target_id = ? AND status = 'open'`).bind(kind, id);
  if (action === "dismiss") await close("dismissed").run();
  else if (action === "clear") {
    const table = kind === "artist" ? "artists" : "venues";
    await db.batch([
      db.prepare(`UPDATE ${table} SET bio = NULL, photo_key = NULL, links = '{}', claimed_by = NULL, updated_at = ? WHERE id = ?`).bind(new Date().toISOString(), id),
      close("actioned"),
    ]);
  } else return c.json({ error: "Unknown action." }, 400);
  return c.json({ ok: true });
});

/**
 * Hand an event to an organizer: imported listings, or events a moderator posted for them.
 * The account with that sign-in email becomes the owner (replacing any current host) and can edit it.
 */
moderation.post("/mod/events/:id/host", async (c) => {
  const id = c.req.param("id");
  const { email } = (await c.req.json().catch(() => ({}))) as { email?: string };
  const address = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return c.json({ error: "Enter the organizer's sign-in email." }, 400);
  const db = c.env.DB;
  const ev = await db.prepare("SELECT title FROM events WHERE id = ?").bind(id).first<{ title: string }>();
  if (!ev) return c.json({ error: "We couldn't find that event." }, 404);
  const user = await db
    .prepare("SELECT u.id, u.display_name FROM identities i JOIN users u ON u.id = i.user_id WHERE lower(i.email) = ? ORDER BY i.email_verified DESC LIMIT 1")
    .bind(address)
    .first<{ id: string; display_name: string }>();
  if (!user) return c.json({ error: "No account uses that email yet. Ask them to sign up first, then try again." }, 404);
  await db.batch([
    db.prepare("DELETE FROM event_hosts WHERE event_id = ?").bind(id),
    db.prepare("INSERT INTO event_hosts (event_id, user_id, role) VALUES (?, ?, 'owner')").bind(id, user.id),
  ]);
  c.executionCtx.waitUntil(
    notifyUsers(c.env, [user.id], { title: "You're the host now", body: `${ev.title} is yours to edit on Assembly.`, url: `/e/${id}`, tag: `host-${id}` }).catch(() => 0),
  );
  return c.json({ ok: true, host: { id: user.id, displayName: user.display_name } });
});

/** Verified organizer badge: given by the Assembly team. */
moderation.put("/mod/users/:id/verified", async (c) => {
  const { verified } = (await c.req.json().catch(() => ({}))) as { verified?: boolean };
  const res = await c.env.DB.prepare("UPDATE users SET is_verified_organizer = ? WHERE id = ?").bind(verified ? 1 : 0, c.req.param("id")).run();
  if (!res.meta.changes) return c.json({ error: "We couldn't find that person." }, 404);
  return c.json({ ok: true, verified: !!verified });
});
