import { Hono, type Context } from "hono";
import type { AppContext } from "./env";
import { createSession, randomToken } from "./session";

/**
 * Signing in from the iOS app (docs/ios.md). The app can't use the site's cookie, so Google and Apple sign-in
 * run in the system sign-in sheet and end with a hand-off:
 *
 * 1. The app makes a random verifier and opens /api/auth/{google,apple}?app=<SHA-256 of it, base64url>.
 * 2. The usual OAuth round-trip runs in the sheet. At the end, instead of a cookie, the server stores a
 *    one-time code for that user, tied to the challenge, and sends the sheet to rsvp.assembly.app://auth.
 * 3. The app posts the code and its verifier to /api/auth/app/exchange and gets a session token back,
 *    which it keeps in the keychain and sends as a Bearer token.
 *
 * The verifier never leaves the app until step 3, so a code intercepted on the way is useless on its own
 * (the same idea as PKCE, RFC 7636). Codes last two minutes and work once.
 */
export const APP_SCHEME = "rsvp.assembly.app";
export const APP_CHALLENGE_COOKIE = "asm_app_challenge";
const HANDOFF_TTL_SECONDS = 120; // KV's minimum is 60
const B64URL_256 = /^[A-Za-z0-9_-]{43}$/; // a SHA-256 digest, base64url without padding
const VERIFIER = /^[A-Za-z0-9_-]{43,128}$/; // RFC 7636: 43 to 128 characters

/** The ?app= challenge, if it's well-formed; anything else means an ordinary web sign-in. */
export function appChallenge(value: string | null | undefined): string | null {
  return value && B64URL_256.test(value) ? value : null;
}

export async function s256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Where the sign-in sheet goes when it's done: back into the app, with the result and, on success, a code. */
export function appRedirectUrl(result: "ok" | "failed" | "waitlist", code?: string, returnTo?: string): string {
  const url = new URL(`${APP_SCHEME}://auth`);
  url.searchParams.set("signin", result);
  if (code) url.searchParams.set("code", code);
  if (returnTo && returnTo !== "/") url.searchParams.set("return_to", returnTo);
  return url.toString();
}

/** Stores a one-time code for a user who signed in from the app. The session is made only at exchange. */
export async function issueHandoff(c: Context<AppContext>, userId: string, challenge: string): Promise<string> {
  const code = randomToken(24);
  await c.env.SESSIONS.put(`handoff:${code}`, JSON.stringify({ userId, challenge }), { expirationTtl: HANDOFF_TTL_SECONDS });
  return code;
}

export const appAuth = new Hono<AppContext>();

/** Step 3: the app trades its one-time code and verifier for a session token. */
appAuth.post("/exchange", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { code?: unknown; verifier?: unknown };
  const code = typeof body.code === "string" && /^[A-Za-z0-9_-]{20,64}$/.test(body.code) ? body.code : null;
  const verifier = typeof body.verifier === "string" && VERIFIER.test(body.verifier) ? body.verifier : null;
  if (!code || !verifier) return c.json({ error: "Sign-in didn't finish. Try again." }, 400);

  const key = `handoff:${code}`;
  const stored = (await c.env.SESSIONS.get(key, "json")) as { userId: string; challenge: string } | null;
  // One use, whatever happens next.
  if (stored) await c.env.SESSIONS.delete(key);
  if (!stored || stored.challenge !== (await s256(verifier))) {
    return c.json({ error: "That sign-in expired. Try again." }, 400);
  }
  return c.json({ token: await createSession(c, stored.userId) });
});
