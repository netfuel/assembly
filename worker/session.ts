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

/** Creates a session for a user and sets the cookie. Only the token's hash is stored. */
export async function startSession(c: Context<AppContext>, userId: string) {
  const token = randomToken();
  await c.env.SESSIONS.put(`session:${await hashToken(token)}`, JSON.stringify({ userId }), {
    expirationTtl: SESSION_TTL_SECONDS,
  });
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isSecure(c),
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function readSession(c: Context<AppContext>): Promise<string | null> {
  const token = getCookie(c, SESSION_COOKIE);
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
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await c.env.SESSIONS.delete(`session:${await hashToken(token)}`);
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

export { randomToken };
