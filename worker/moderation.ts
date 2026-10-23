import { Hono } from "hono";
import type { AppContext, Env } from "./env";
import type { ModItem } from "../shared/types";

/** True when one of this user's sign-in emails is listed in MODERATORS. */
export async function isModerator(env: Env, userId: string | null): Promise<boolean> {
  if (!userId || !env.MODERATORS) return false;
  const allowed = env.MODERATORS.split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
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

/** Open reports grouped by what was reported, plus hidden events even if their reports were cleared. */
moderation.get("/mod/queue", async (c) => {
  const db = c.env.DB;
  const { results: rows } = await db
    .prepare(
      `SELECT r.target_type, r.target_id, r.reason, r.created_at
       FROM reports r WHERE r.status = 'open' ORDER BY r.created_at DESC LIMIT 500`,
    )
    .all<{ target_type: "event" | "user"; target_id: string; reason: string; created_at: string }>();

  const groups = new Map<string, { type: "event" | "user"; id: string; reasons: string[]; latest: string }>();
  for (const r of rows) {
    const key = `${r.target_type}:${r.target_id}`;
    const g = groups.get(key) ?? { type: r.target_type, id: r.target_id, reasons: [], latest: r.created_at };
    g.reasons.push(r.reason);
    groups.set(key, g);
  }
  const { results: hidden } = await db.prepare("SELECT id FROM events WHERE status = 'hidden'").all<{ id: string }>();
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
  items.sort((a, b) => b.reasons.length - a.reasons.length || b.latest.localeCompare(a.latest));
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

/** Verified organizer badge: given by the Assembly team. */
moderation.put("/mod/users/:id/verified", async (c) => {
  const { verified } = (await c.req.json().catch(() => ({}))) as { verified?: boolean };
  const res = await c.env.DB.prepare("UPDATE users SET is_verified_organizer = ? WHERE id = ?").bind(verified ? 1 : 0, c.req.param("id")).run();
  if (!res.meta.changes) return c.json({ error: "We couldn't find that person." }, 404);
  return c.json({ ok: true, verified: !!verified });
});
