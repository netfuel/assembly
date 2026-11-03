import { Hono } from "hono";
import type { AppContext } from "./env";
import { normalizeEmail } from "./emailAuth";
import { isModerator } from "./moderation";
import { rateLimit } from "./posting";

/**
 * The launch interest list (db/migrations/0013_interest.sql). The gate screen posts an address here;
 * the answer is 200 whether or not it was already on the list, so the list can't be probed. Moderators
 * can export it as CSV for the launch email. Nothing is sent from here.
 */
export const interest = new Hono<AppContext>();

export async function emailHash(email: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Coarse device family from the user agent: enough to know what people will install on, nothing finer. */
export function deviceFamily(ua: string | undefined): string | null {
  if (!ua) return null;
  if (/iPhone|iPad|iPod/.test(ua)) return "ios";
  if (/Android/.test(ua)) return "android";
  return "desktop";
}

/** A source label from the form or the URL: short, lower-case, letters and dashes only. */
export function cleanSource(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40);
  return s || null;
}

interest.post("/", async (c) => {
  const ip = c.req.header("CF-Connecting-IP") ?? "local";
  if (!(await rateLimit(c.env.SESSIONS, `interest:${ip}`, 5, 600))) {
    return c.json({ error: "Too many tries. Wait a minute." }, 429);
  }
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const email = normalizeEmail(body.email);
  if (!email) return c.json({ error: "That address didn't go through. Try again." }, 400);
  const hash = await emailHash(email);
  const referrer = typeof body.referrer === "string" ? body.referrer.slice(0, 300) : (c.req.header("Referer") ?? null)?.slice(0, 300) ?? null;
  await c.env.DB.prepare(
    "INSERT INTO interest (id, email, email_hash, source, referrer, device) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(email_hash) DO NOTHING",
  )
    .bind(crypto.randomUUID(), email, hash, cleanSource(body.source) ?? "gate", referrer, deviceFamily(c.req.header("User-Agent")))
    .run();
  return c.json({ ok: true });
});

/** CSV of the list, newest first. Moderators only. */
interest.get("/export", async (c) => {
  if (!(await isModerator(c.env, c.get("userId")))) return c.json({ error: "Not found." }, 404);
  const { results } = await c.env.DB.prepare(
    "SELECT email, source, device, created_at, converted_at FROM interest ORDER BY created_at DESC",
  ).all<{ email: string; source: string | null; device: string | null; created_at: string; converted_at: string | null }>();
  const cell = (v: string | null) => (v == null ? "" : /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = ["email,source,device,signed_up_at,signed_in_at", ...results.map((r) => [r.email, r.source, r.device, r.created_at, r.converted_at].map(cell).join(","))];
  c.header("Content-Type", "text/csv; charset=utf-8");
  c.header("Content-Disposition", `attachment; filename="assembly-interest-${new Date().toISOString().slice(0, 10)}.csv"`);
  c.header("Cache-Control", "no-store");
  return c.body(lines.join("\n") + "\n");
});

/** Called after a sign-in with a verified email: marks the address as converted if it's on the list. */
export async function markConverted(db: D1Database, email: string | null, userId: string) {
  const normalized = email ? normalizeEmail(email) : null;
  if (!normalized) return;
  await db
    .prepare("UPDATE interest SET converted_user_id = ?, converted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE email_hash = ? AND converted_user_id IS NULL")
    .bind(userId, await emailHash(normalized))
    .run();
}
