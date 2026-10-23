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
  // Browsers read "/\\host" as "//host", so backslashes and control characters are refused too.
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001f]/.test(value)) return "/";
  return value;
}

/** Adds ?signin=ok or ?signin=failed to a return path that may already have a query. */
function withResult(path: string, result: "ok" | "failed"): string {
  return `${path}${path.includes("?") ? "&" : "?"}signin=${result}`;
}

/**
 * Finds the user linked to this identity, or creates one. Returns the user id and whether it's new.
 * A verified email links sign-ins: someone who used Google and later signs in by email code with the
 * same address (or the reverse) lands in the same account. Unverified emails never link.
 */
export async function upsertUser(
  db: D1Database,
  provider: "google" | "apple" | "email",
  subject: string,
  email: string | null,
  name: string | null,
  avatarUrl: string | null,
  emailVerified = false,
): Promise<{ userId: string; isNew: boolean }> {
  const normalized = email?.trim().toLowerCase() || null;
  const existing = await db
    .prepare("SELECT user_id FROM identities WHERE provider = ? AND provider_subject = ?")
    .bind(provider, subject)
    .first<{ user_id: string }>();
  if (existing) {
    // Keep the email current (Google can change it; Apple only sends it the first time).
    if (normalized) {
      await db
        .prepare("UPDATE identities SET email = ?, email_verified = ? WHERE provider = ? AND provider_subject = ?")
        .bind(normalized, emailVerified ? 1 : 0, provider, subject)
        .run();
    }
    return { userId: existing.user_id, isNew: false };
  }

  // Same verified address on another sign-in method: add this method to that account.
  if (normalized && emailVerified) {
    const match = await db
      .prepare("SELECT user_id FROM identities WHERE lower(email) = ? AND email_verified = 1 LIMIT 1")
      .bind(normalized)
      .first<{ user_id: string }>();
    if (match) {
      await db
        .prepare("INSERT INTO identities (user_id, provider, provider_subject, email, email_verified) VALUES (?, ?, ?, ?, 1)")
        .bind(match.user_id, provider, subject, normalized)
        .run();
      if (avatarUrl) await db.prepare("UPDATE users SET avatar_url = COALESCE(avatar_url, ?) WHERE id = ?").bind(avatarUrl, match.user_id).run();
      return { userId: match.user_id, isNew: false };
    }
  }

  const userId = crypto.randomUUID();
  const displayName = name?.trim() || normalized?.split("@")[0] || "New member";
  await db.batch([
    db.prepare("INSERT INTO users (id, display_name, avatar_url) VALUES (?, ?, ?)").bind(userId, displayName, avatarUrl),
    db
      .prepare("INSERT INTO identities (user_id, provider, provider_subject, email, email_verified) VALUES (?, ?, ?, ?, ?)")
      .bind(userId, provider, subject, normalized, emailVerified ? 1 : 0),
  ]);
  return { userId, isNew: true };
}

export const auth = new Hono<AppContext>();

auth.get("/providers", (c) => {
  const host = new URL(c.req.url).hostname;
  const providers: AuthProviders = {
    google: !!google(c.env, siteOrigin(c)),
    apple: !!apple(c.env, siteOrigin(c)),
    dev: c.env.DEV_LOGIN === "1" && ["localhost", "127.0.0.1"].includes(host),
    // Email codes work wherever mail can be sent, and locally in test mode (the code shows on screen).
    email: !!(c.env.EMAIL && c.env.EMAIL_FROM) || (c.env.DEV_LOGIN === "1" && ["localhost", "127.0.0.1"].includes(host)),
  };
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
    return c.redirect(withResult(returnTo, "failed"));
  }
  try {
    const tokens = await client.validateAuthorizationCode(code, verifier);
    const claims = decodeIdToken(tokens.idToken()) as { sub: string; email?: string; email_verified?: boolean; name?: string; picture?: string };
    const { userId } = await upsertUser(c.env.DB, "google", claims.sub, claims.email ?? null, claims.name ?? null, claims.picture ?? null, claims.email_verified === true);
    await startSession(c, userId);
    return c.redirect(withResult(returnTo, "ok"));
  } catch (err) {
    console.error("google callback failed", err);
    return c.redirect(withResult(returnTo, "failed"));
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
    return c.redirect(withResult(returnTo, "failed"), 303);
  }
  try {
    const tokens = await client.validateAuthorizationCode(code);
    const claims = decodeIdToken(tokens.idToken()) as { sub: string; email?: string; email_verified?: boolean | string };
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
    // Apple sends email_verified as a boolean or the string "true".
    const verified = claims.email_verified === true || claims.email_verified === "true";
    const { userId } = await upsertUser(c.env.DB, "apple", claims.sub, claims.email ?? null, name, null, verified);
    await startSession(c, userId);
    return c.redirect(withResult(returnTo, "ok"), 303);
  } catch (err) {
    console.error("apple callback failed", err);
    return c.redirect(withResult(returnTo, "failed"), 303);
  }
});

/**
 * Local testing only: signs in as a named test user without Google or Apple.
 * Requires DEV_LOGIN=1 in .dev.vars AND a localhost request, so it can't run in production.
 */
auth.get("/dev", async (c) => {
  const host = new URL(c.req.url).hostname;
  if (c.env.DEV_LOGIN !== "1" || !["localhost", "127.0.0.1"].includes(host)) return c.notFound();
  const name = (c.req.query("name") ?? "Test Organizer").slice(0, 40);
  // Test accounts get a fake address, so MODERATORS in .dev.vars can name one (e.g. test-moderator@dev.localhost).
  const slug = slugifyName(name);
  const { userId } = await upsertUser(c.env.DB, "google", `dev-${slug}`, `${slug}@dev.localhost`, name, null);
  await startSession(c, userId);
  return c.redirect(withResult(safeReturnTo(c.req.query("return_to")), "ok"));
});

function slugifyName(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "user";
}

auth.post("/logout", async (c) => {
  await endSession(c);
  return c.json({ ok: true });
});

export { safeReturnTo, withResult };
