// Reactions on events: tap to add or take back one of five. Counts are public; who reacted is not shown.
import { Hono } from "hono";
import type { AppContext, Env } from "./env";
import { notMigrated } from "./checkins";
import { rateLimit } from "./posting";
import { REACTIONS, type ReactionKind, type Reactions } from "../shared/types";

const KINDS = new Set<string>(REACTIONS.map((r) => r.id));

export async function reactionsFor(env: Env, eventId: string, userId: string | null): Promise<Reactions> {
  try {
    const { results } = await env.DB.prepare(
      `SELECT kind, COUNT(*) AS n, MAX(CASE WHEN user_id = ?2 THEN 1 ELSE 0 END) AS mine
       FROM reactions WHERE target_type = 'event' AND target_id = ?1 GROUP BY kind`,
    )
      .bind(eventId, userId ?? "")
      .all<{ kind: ReactionKind; n: number; mine: number }>();
    return { counts: Object.fromEntries(results.map((r) => [r.kind, r.n])), mine: results.filter((r) => r.mine).map((r) => r.kind) };
  } catch (err) {
    if (!notMigrated(err)) console.error("reactions", err);
    return { counts: {}, mine: [] };
  }
}

export const reactions = new Hono<AppContext>();

/** Toggle one reaction. Body: { kind, on } (on: true adds, false removes). Answers with the new counts. */
reactions.post("/:id/react", async (c) => {
  const userId = c.get("userId");
  if (!userId) return c.json({ error: "Sign in to react." }, 401);
  const id = c.req.param("id");
  const body = (await c.req.json().catch(() => ({}))) as { kind?: string; on?: boolean };
  if (!body.kind || !KINDS.has(body.kind)) return c.json({ error: "Pick one of the reactions." }, 400);
  if (!(await rateLimit(c.env.SESSIONS, `react:${userId}`, 120, 3600))) return c.json({ error: "That's a lot of reactions. Take a breather." }, 429);
  const ev = await c.env.DB.prepare("SELECT 1 FROM events WHERE id = ? AND status IN ('live', 'cancelled')").bind(id).first();
  if (!ev) return c.json({ error: "We couldn't find that event." }, 404);
  try {
    if (body.on === false) {
      await c.env.DB.prepare("DELETE FROM reactions WHERE target_type = 'event' AND target_id = ? AND user_id = ? AND kind = ?").bind(id, userId, body.kind).run();
    } else {
      await c.env.DB.prepare("INSERT OR IGNORE INTO reactions (target_type, target_id, user_id, kind) VALUES ('event', ?, ?, ?)").bind(id, userId, body.kind).run();
    }
  } catch (err) {
    if (notMigrated(err)) return c.json({ error: "Reactions aren't set up on this server yet." }, 503);
    throw err;
  }
  return c.json(await reactionsFor(c.env, id, userId));
});
