import { TERMS_VERSION } from "../shared/legal";
import type { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { AppContext } from "./env";

export const SESSION_COOKIE = "asm_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 60; // 60 days

function randomToken(bytes = 32): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...buf)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The site's own origin, taken from the request: works on localhost, previews, and assembly.rsvp alike. */
export function siteOrigin(c: Context<AppContext>) {
  return new URL(c.req.url).origin;
}

function isSecure(c: Context<AppContext>) {
  return new URL(c.req.url).protocol === "https:";
}

/**
 * Creates a session for a user and returns its token. Only the token's hash is stored. The site carries the
 * token in a cookie (startSession); the iOS app keeps it in the keychain and sends it as a Bearer token.
 */
export async function createSession(c: Context<AppContext>, userId: string): Promise<string> {
  // Signing in is agreeing to the Terms and Privacy policy ("By continuing you agree…"): record which version.
  await c.env.DB.prepare("UPDATE users SET terms_version = ?, terms_accepted_at = ? WHERE id = ? AND (terms_version IS NULL OR terms_version <> ?)")
    .bind(TERMS_VERSION, new Date().toISOString(), userId, TERMS_VERSION)
    .run()
    .catch((err: unknown) => {
      if (!(err instanceof Error && /no such column/i.test(err.message))) console.error("terms version", err);
    });
  const token = randomToken();
  const hash = await hashToken(token);
  await c.env.SESSIONS.put(`session:${hash}`, JSON.stringify({ userId }), {
    expirationTtl: SESSION_TTL_SECONDS,
  });
  // Index this user's sessions so deleting the account can sign out every device.
  const indexKey = `user-sessions:${userId}`;
  const prior = JSON.parse((await c.env.SESSIONS.get(indexKey)) ?? "[]") as string[];
  await c.env.SESSIONS.put(indexKey, JSON.stringify([hash, ...prior].slice(0, 25)), { expirationTtl: SESSION_TTL_SECONDS });
  return token;
}

/** Creates a session for a user and sets the cookie. */
export async function startSession(c: Context<AppContext>, userId: string) {
  const token = await createSession(c, userId);
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isSecure(c),
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

/** The session token on this request: the site's cookie, or the iOS app's Bearer token. */
function sessionToken(c: Context<AppContext>): string | null {
  const cookie = getCookie(c, SESSION_COOKIE);
  if (cookie) return cookie;
  const bearer = /^Bearer ([A-Za-z0-9_-]{20,100})$/.exec(c.req.header("Authorization") ?? "");
  return bearer ? bearer[1] : null;
}

export async function readSession(c: Context<AppContext>): Promise<string | null> {
  const token = sessionToken(c);
  if (!token) return null;
  const raw = await c.env.SESSIONS.get(`session:${await hashToken(token)}`);
  if (!raw) return null;
  try {
    return (JSON.parse(raw) as { userId: string }).userId;
  } catch {
    return null;
  }
}

export async function endSession(c: Context<AppContext>) {
  const token = sessionToken(c);
  if (token) await c.env.SESSIONS.delete(`session:${await hashToken(token)}`);
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

/** Signs a user out everywhere (used when an account is deleted). */
export async function endAllSessions(c: Context<AppContext>, userId: string) {
  const indexKey = `user-sessions:${userId}`;
  const hashes = JSON.parse((await c.env.SESSIONS.get(indexKey)) ?? "[]") as string[];
  await Promise.all([...hashes.map((h) => c.env.SESSIONS.delete(`session:${h}`)), c.env.SESSIONS.delete(indexKey)]);
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

export { randomToken };
