import { Hono, type Context } from "hono";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import type { AppContext } from "./env";
import { createSession, randomToken, siteOrigin, startSession } from "./session";
import { gatePasses } from "./gate";
import { isAppOrigin } from "./appOrigin";
import { rateLimit } from "./posting";

/**
 * Passkeys (WebAuthn): sign in with Face ID, Touch ID or a phone; the passkey is synced by iCloud Keychain
 * or another password manager. An addition to Google, Apple and email code, never a replacement: you add one
 * from Profile once signed in, then use it to sign in next time.
 *
 * The relying party is the site's host (assembly.rsvp), so a passkey made on the site works in the iOS app
 * and the other way round: the app is tied to the domain by the webcredentials entry in
 * /.well-known/apple-app-site-association, and iOS reports the site's origin for it.
 *
 * Challenges live in KV for five minutes and are used once.
 */

const CHALLENGE_TTL_SECONDS = 300;
const MAX_PASSKEYS = 10;

/** Known passkey providers by AAGUID, for the Profile list. Anything else is just "Passkey". */
const PROVIDERS: Record<string, string> = {
  "fbfc3007-154e-4ecc-8c0b-6e020557d7bd": "iCloud Keychain",
  "dd4ec289-e01d-41c9-bb89-70fa845d4bf2": "iCloud Keychain",
  "ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4": "Google Password Manager",
  "adce0002-35bc-c60a-648b-0b25f1f05503": "Chrome on Mac",
  "08987058-cadc-4b81-b6e1-30de50dcbe96": "Windows Hello",
  "9ddd1817-af5a-4672-a2b9-3e3dd95000a9": "Windows Hello",
  "6028b017-b1d4-4c02-b4b3-afcdafc96bb2": "Windows Hello",
  "bada5566-a7aa-401f-bd96-45619a55120d": "1Password",
  "d548826e-79b4-db40-a3d8-11116f7e8349": "Bitwarden",
  "531126d6-e717-415c-9320-3d9aa6981239": "Dashlane",
  "53414d53-554e-4700-0000-000000000000": "Samsung Pass",
};

/** The relying party: the site's host, and the one origin passkeys for it are made on. */
function relyingParty(c: Context<AppContext>) {
  const origin = siteOrigin(c);
  return { rpID: new URL(origin).hostname, origin };
}

const b64url = {
  encode: (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
  decode: (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (ch) => ch.charCodeAt(0)),
};

interface PasskeyRow {
  id: string;
  user_id: string;
  public_key: string;
  counter: number;
  transports: string | null;
  label: string;
  backed_up: number;
  created_at: string;
  last_used_at: string | null;
}

const parseTransports = (t: string | null) => {
  try {
    return t ? (JSON.parse(t) as AuthenticatorTransportFuture[]) : undefined;
  } catch {
    return undefined;
  }
};
type AuthenticatorTransportFuture = "ble" | "cable" | "hybrid" | "internal" | "nfc" | "smart-card" | "usb";

// ---------------------------------------------------------------------------------------------------------
// Signing in with a passkey: mounted at /api/auth/passkey (open while the gate is on, like the other sign-ins).

export const passkeyAuth = new Hono<AppContext>();

/** Step 1: a challenge for any passkey this site knows (discoverable credentials: no username needed). */
passkeyAuth.post("/options", async (c) => {
  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
  if (!(await rateLimit(c.env.SESSIONS, `passkey-options:${ip}`, 60, 3600))) return c.json({ error: "Too many tries. Wait a bit." }, 429);
  const { rpID } = relyingParty(c);
  const options = await generateAuthenticationOptions({ rpID, userVerification: "preferred" });
  const flow = randomToken(18);
  await c.env.SESSIONS.put(`passkey:auth:${flow}`, options.challenge, { expirationTtl: CHALLENGE_TTL_SECONDS });
  return c.json({ options, flow });
});

/** Step 2: check the signed challenge, then sign in as the passkey's owner (the gate still applies). */
passkeyAuth.post("/verify", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { flow?: unknown; response?: AuthenticationResponseJSON };
  const flow = typeof body.flow === "string" && /^[A-Za-z0-9_-]{20,40}$/.test(body.flow) ? body.flow : null;
  const response = body.response;
  if (!flow || !response || typeof response.id !== "string") return c.json({ error: "That passkey didn't work. Try again." }, 400);

  const key = `passkey:auth:${flow}`;
  const expectedChallenge = await c.env.SESSIONS.get(key);
  if (expectedChallenge) await c.env.SESSIONS.delete(key);
  if (!expectedChallenge) return c.json({ error: "That took too long. Try again." }, 400);

  const row = await c.env.DB.prepare("SELECT * FROM passkeys WHERE id = ?").bind(response.id).first<PasskeyRow>();
  if (!row) return c.json({ error: "This passkey isn't linked to an Assembly account. Sign in another way, then add it from your profile." }, 404);

  const { rpID, origin } = relyingParty(c);
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: { id: row.id, publicKey: b64url.decode(row.public_key), counter: row.counter, transports: parseTransports(row.transports) },
      requireUserVerification: false,
    });
  } catch (err) {
    console.error("passkey verify failed", err);
    return c.json({ error: "That passkey didn't work. Try again." }, 400);
  }
  if (!verification.verified) return c.json({ error: "That passkey didn't work. Try again." }, 400);

  await c.env.DB.prepare("UPDATE passkeys SET counter = ?, last_used_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?")
    .bind(verification.authenticationInfo.newCounter, row.id)
    .run();

  if (!(await gatePasses(c.env, row.user_id))) return c.json({ result: "waitlist" as const });
  // The iOS app keeps the token itself (worker/appAuth.ts); the site gets the cookie.
  if (isAppOrigin(c.req.header("Origin"))) return c.json({ result: "ok" as const, token: await createSession(c, row.user_id) });
  await startSession(c, row.user_id);
  return c.json({ result: "ok" as const });
});

// ---------------------------------------------------------------------------------------------------------
// Your passkeys: mounted at /api/me/passkeys. Signed in only.

export const passkeyMe = new Hono<AppContext>();

passkeyMe.use("*", async (c, next) => {
  if (!c.get("userId")) return c.json({ error: "Sign in first." }, 401);
  await next();
});

const listFor = async (c: Context<AppContext>, userId: string) => {
  const { results } = await c.env.DB.prepare(
    "SELECT id, label, backed_up, created_at, last_used_at FROM passkeys WHERE user_id = ? ORDER BY created_at DESC",
  )
    .bind(userId)
    .all<Pick<PasskeyRow, "id" | "label" | "backed_up" | "created_at" | "last_used_at">>();
  return results.map((r) => ({ id: r.id, label: r.label, synced: r.backed_up === 1, createdAt: r.created_at, lastUsedAt: r.last_used_at }));
};

passkeyMe.get("/", async (c) => c.json({ passkeys: await listFor(c, c.get("userId")!) }));

/** Step 1 of adding one: a challenge, and the passkeys you already have so the same one isn't added twice. */
passkeyMe.post("/options", async (c) => {
  const userId = c.get("userId")!;
  const user = await c.env.DB.prepare("SELECT display_name FROM users WHERE id = ?").bind(userId).first<{ display_name: string }>();
  const email = await c.env.DB.prepare("SELECT email FROM identities WHERE user_id = ? AND email IS NOT NULL ORDER BY email_verified DESC LIMIT 1")
    .bind(userId)
    .first<{ email: string }>();
  const { results: existing } = await c.env.DB.prepare("SELECT id, transports FROM passkeys WHERE user_id = ?").bind(userId).all<{ id: string; transports: string | null }>();
  if (existing.length >= MAX_PASSKEYS) return c.json({ error: `You have ${MAX_PASSKEYS} passkeys. Remove one first.` }, 400);

  const { rpID } = relyingParty(c);
  const options = await generateRegistrationOptions({
    rpName: "Assembly",
    rpID,
    userID: new Uint8Array(new TextEncoder().encode(userId)),
    // What the password manager shows next to the passkey.
    userName: email?.email ?? user?.display_name ?? "Assembly",
    userDisplayName: user?.display_name ?? "",
    attestationType: "none",
    excludeCredentials: existing.map((p) => ({ id: p.id, transports: parseTransports(p.transports) })),
    authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
  });
  await c.env.SESSIONS.put(`passkey:reg:${userId}`, options.challenge, { expirationTtl: CHALLENGE_TTL_SECONDS });
  return c.json({ options });
});

/** Step 2 of adding one: check what the authenticator made, and keep its public key. */
passkeyMe.post("/", async (c) => {
  const userId = c.get("userId")!;
  const body = (await c.req.json().catch(() => ({}))) as { response?: RegistrationResponseJSON };
  if (!body.response || typeof body.response.id !== "string") return c.json({ error: "Adding the passkey didn't finish. Try again." }, 400);

  const key = `passkey:reg:${userId}`;
  const expectedChallenge = await c.env.SESSIONS.get(key);
  if (expectedChallenge) await c.env.SESSIONS.delete(key);
  if (!expectedChallenge) return c.json({ error: "That took too long. Try again." }, 400);

  const { rpID, origin } = relyingParty(c);
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: body.response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
    });
  } catch (err) {
    console.error("passkey registration failed", err);
    return c.json({ error: "Adding the passkey didn't finish. Try again." }, 400);
  }
  if (!verification.verified) return c.json({ error: "Adding the passkey didn't finish. Try again." }, 400);

  const { credential, aaguid, credentialBackedUp } = verification.registrationInfo;
  const taken = await c.env.DB.prepare("SELECT user_id FROM passkeys WHERE id = ?").bind(credential.id).first<{ user_id: string }>();
  if (taken && taken.user_id !== userId) return c.json({ error: "That passkey belongs to another account." }, 409);
  await c.env.DB.prepare(
    "INSERT OR REPLACE INTO passkeys (id, user_id, public_key, counter, transports, label, backed_up) VALUES (?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      credential.id,
      userId,
      b64url.encode(credential.publicKey),
      credential.counter,
      credential.transports ? JSON.stringify(credential.transports) : null,
      PROVIDERS[aaguid] ?? "Passkey",
      credentialBackedUp ? 1 : 0,
    )
    .run();
  return c.json({ passkeys: await listFor(c, userId) });
});

passkeyMe.delete("/:id", async (c) => {
  const userId = c.get("userId")!;
  await c.env.DB.prepare("DELETE FROM passkeys WHERE id = ? AND user_id = ?").bind(c.req.param("id"), userId).run();
  return c.json({ passkeys: await listFor(c, userId) });
});

// ---------------------------------------------------------------------------------------------------------
// Apple's domain-association file. webcredentials lets the iOS app use the site's passkeys; universal links
// (applinks) come with that feature.

export const APPLE_APP_ID = "8F569K6WBX.rsvp.assembly.app";

export function appleAppSiteAssociation() {
  return { webcredentials: { apps: [APPLE_APP_ID] } };
}
