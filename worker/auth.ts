import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { Apple, Google, decodeIdToken, generateCodeVerifier, generateState } from "arctic";
import type { AppContext, Env } from "./env";
import { endSession, siteOrigin, startSession } from "./session";
import type { AuthProviders } from "../shared/types";

const STATE_TTL = 60 * 10;

function redirectUri(origin: string, provider: "google" | "apple") {
  return `${origin}/api/auth/${provider}/callback`;
}

function google(env: Env, origin: string) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return null;
  return new Google(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, redirectUri(origin, "google"));
}

function pemToPkcs8(pem: string): Uint8Array {
  const body = pem
    .replace(/\\n/g, "\n")
    .replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  return Uint8Array.from(atob(body), (ch) => ch.charCodeAt(0));
}

function apple(env: Env, origin: string) {
  if (!env.APPLE_CLIENT_ID || !env.APPLE_TEAM_ID || !env.APPLE_KEY_ID || !env.APPLE_PRIVATE_KEY) return null;
  return new Apple(env.APPLE_CLIENT_ID, env.APPLE_TEAM_ID, env.APPLE_KEY_ID, pemToPkcs8(env.APPLE_PRIVATE_KEY), redirectUri(origin, "apple"));
}

/** Only same-site paths are allowed as a post-sign-in destination. */
function safeReturnTo(value: string | undefined | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

/** Finds the user linked to this identity, or creates one. Returns the user id. */
async function upsertUser(
  db: D1Database,
  provider: "google" | "apple",
  subject: string,
  email: string | null,
  name: string | null,
  avatarUrl: string | null,
): Promise<string> {
  const existing = await db
    .prepare("SELECT user_id FROM identities WHERE provider = ? AND provider_subject = ?")
    .bind(provider, subject)
    .first<{ user_id: string }>();
  if (existing) return existing.user_id;

  const userId = crypto.randomUUID();
  const displayName = name?.trim() || email?.split("@")[0] || "New member";
  await db.batch([
    db.prepare("INSERT INTO users (id, display_name, avatar_url) VALUES (?, ?, ?)").bind(userId, displayName, avatarUrl),
    db
      .prepare("INSERT INTO identities (user_id, provider, provider_subject, email) VALUES (?, ?, ?, ?)")
      .bind(userId, provider, subject, email),
  ]);
  return userId;
}

export const auth = new Hono<AppContext>();

auth.get("/providers", (c) => {
  const providers: AuthProviders = { google: !!google(c.env, siteOrigin(c)), apple: !!apple(c.env, siteOrigin(c)) };
  return c.json(providers);
});

auth.get("/google", (c) => {
  const client = google(c.env, siteOrigin(c));
  if (!client) return c.json({ error: "Google sign-in isn't configured on this server." }, 503);
  const state = generateState();
  const verifier = generateCodeVerifier();
  const url = client.createAuthorizationURL(state, verifier, ["openid", "profile", "email"]);
  url.searchParams.set("prompt", "select_account");
  const opts = { httpOnly: true, secure: siteOrigin(c).startsWith("https://"), sameSite: "Lax" as const, path: "/", maxAge: STATE_TTL };
  setCookie(c, "asm_oauth_state", state, opts);
  setCookie(c, "asm_oauth_verifier", verifier, opts);
  setCookie(c, "asm_return_to", safeReturnTo(c.req.query("return_to")), opts);
  return c.redirect(url.toString());
});

auth.get("/google/callback", async (c) => {
  const client = google(c.env, siteOrigin(c));
  const code = c.req.query("code");
  const state = c.req.query("state");
  const storedState = getCookie(c, "asm_oauth_state");
  const verifier = getCookie(c, "asm_oauth_verifier");
  const returnTo = safeReturnTo(getCookie(c, "asm_return_to"));
  for (const name of ["asm_oauth_state", "asm_oauth_verifier", "asm_return_to"]) deleteCookie(c, name, { path: "/" });
  if (!client || !code || !state || !verifier || state !== storedState) {
    return c.redirect(`${returnTo}?signin=failed`);
  }
  try {
    const tokens = await client.validateAuthorizationCode(code, verifier);
    const claims = decodeIdToken(tokens.idToken()) as { sub: string; email?: string; name?: string; picture?: string };
    const userId = await upsertUser(c.env.DB, "google", claims.sub, claims.email ?? null, claims.name ?? null, claims.picture ?? null);
    await startSession(c, userId);
    return c.redirect(`${returnTo}?signin=ok`);
  } catch (err) {
    console.error("google callback failed", err);
    return c.redirect(`${returnTo}?signin=failed`);
  }
});

auth.get("/apple", (c) => {
  const client = apple(c.env, siteOrigin(c));
  if (!client) return c.json({ error: "Apple sign-in isn't configured on this server." }, 503);
  const state = generateState();
  const url = client.createAuthorizationURL(state, ["name", "email"]);
  // Apple only returns name and email with a form POST back to us.
  url.searchParams.set("response_mode", "form_post");
  // Apple posts cross-site, so these cookies must be SameSite=None (requires HTTPS).
  const opts = { httpOnly: true, secure: true, sameSite: "None" as const, path: "/api/auth/apple", maxAge: STATE_TTL };
  setCookie(c, "asm_oauth_state", state, opts);
  setCookie(c, "asm_return_to", safeReturnTo(c.req.query("return_to")), opts);
  return c.redirect(url.toString());
});

auth.post("/apple/callback", async (c) => {
  const client = apple(c.env, siteOrigin(c));
  const form = await c.req.parseBody();
  const code = typeof form.code === "string" ? form.code : null;
  const state = typeof form.state === "string" ? form.state : null;
  const storedState = getCookie(c, "asm_oauth_state");
  const returnTo = safeReturnTo(getCookie(c, "asm_return_to"));
  for (const name of ["asm_oauth_state", "asm_return_to"]) deleteCookie(c, name, { path: "/api/auth/apple" });
  if (!client || !code || !state || state !== storedState) {
    return c.redirect(`${returnTo}?signin=failed`, 303);
  }
  try {
    const tokens = await client.validateAuthorizationCode(code);
    const claims = decodeIdToken(tokens.idToken()) as { sub: string; email?: string };
    // Apple sends the user's name only on the very first sign-in.
    let name: string | null = null;
    if (typeof form.user === "string") {
      try {
        const u = JSON.parse(form.user) as { name?: { firstName?: string; lastName?: string } };
        name = [u.name?.firstName, u.name?.lastName].filter(Boolean).join(" ") || null;
      } catch {
        name = null;
      }
    }
    const userId = await upsertUser(c.env.DB, "apple", claims.sub, claims.email ?? null, name, null);
    await startSession(c, userId);
    return c.redirect(`${returnTo}?signin=ok`, 303);
  } catch (err) {
    console.error("apple callback failed", err);
    return c.redirect(`${returnTo}?signin=failed`, 303);
  }
});

auth.post("/logout", async (c) => {
  await endSession(c);
  return c.json({ ok: true });
});

export { safeReturnTo };
