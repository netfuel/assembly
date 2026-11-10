import type { MiddlewareHandler } from "hono";
import type { AppContext, Env } from "./env";
import { startSession } from "./session";
import seedSql from "../db/demo/seed.sql?raw";

/**
 * Demo mode (demo.assembly.rsvp). DEMO=1 turns it on; production never sets it.
 *
 * - No login: a visitor without a session gets their own guest account the first time the app loads
 *   (GET /api/config), so RSVPs, comments, posting and the profile all work without Google, Apple or email.
 * - Guests are verified organizers, so a post goes straight to the map instead of the review queue.
 * - Each guest is friends with four invented people, so friends on the map has something to show.
 * - The content is invented (db/demo/seed.sql) and goes back to its starting state every night at 3 am
 *   Memphis, with fresh dates, so "tonight" always has something on.
 * - The demo env has no email or push bindings and no OAuth secrets, so nothing leaves the Worker.
 */
export function demoOn(env: Pick<Env, "DEMO">): boolean {
  return env.DEMO === "1";
}

const DEMO_FRIENDS = ["demo-friend-ari", "demo-friend-dev", "demo-friend-sky", "demo-friend-nina"];

/** Statements of the seed file, one per entry. Every statement in it ends a line with a semicolon. */
export function seedStatements(sql: string): string[] {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Puts the demo back to its starting state. Guest accounts younger than a day keep their sessions. */
export async function resetDemo(env: Env): Promise<number> {
  const statements = seedStatements(seedSql).map((s) => env.DB.prepare(s));
  // One batch is one transaction: the demo is never half reset. The seed's last statement re-friends live guests.
  await env.DB.batch(statements);
  return statements.length;
}

async function befriend(db: D1Database, guestId: string) {
  const now = new Date().toISOString();
  await db.batch(
    DEMO_FRIENDS.map((f) => {
      const [a, b] = guestId < f ? [guestId, f] : [f, guestId];
      return db
        .prepare("INSERT OR IGNORE INTO friendships (user_a, user_b, status, requested_by, created_at, accepted_at) VALUES (?, ?, 'accepted', ?, ?, ?)")
        .bind(a, b, f, now, now);
    }),
  );
}

/** Creates a guest account with friends and a session. */
async function newGuest(env: Env): Promise<string> {
  const id = `guest-${crypto.randomUUID()}`;
  const handle = `guest${id.slice(6, 12)}`;
  await env.DB.prepare(
    `INSERT INTO users (id, display_name, pronouns, bio, scenes, is_verified_organizer, username, friends_on)
     VALUES (?, 'Demo guest', NULL, 'Trying out Assembly.', '["queer","house","rave"]', 1, ?, 1)`,
  )
    .bind(id, handle)
    .run();
  await befriend(env.DB, id);
  return id;
}

/** Signs in a visitor without a session as a fresh guest, when the app loads. */
export const demoGuest: MiddlewareHandler<AppContext> = async (c, next) => {
  if (!demoOn(c.env) || c.get("userId")) return next();
  const path = new URL(c.req.url).pathname;
  // Only the app's first call makes an account, so crawlers and link previews never create one.
  if (c.req.method === "GET" && path === "/api/config") {
    const id = await newGuest(c.env);
    await startSession(c, id);
    c.set("userId", id);
  }
  return next();
};
