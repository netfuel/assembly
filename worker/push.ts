// Web Push for Assembly, on Web Crypto only (no Node APIs, no dependencies).
// - Payload encryption: RFC 8291 (aes128gcm content coding, RFC 8188), one record.
// - Sender identification: VAPID, RFC 8292 (ES256 JWT).
import { Hono } from "hono";
import type { AppContext, Env } from "./env";

const enc = new TextEncoder();

export function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}

/** P-256 private key from its raw 32-byte scalar and 65-byte uncompressed public point. */
function privateJwk(d: Uint8Array, pub: Uint8Array): JsonWebKey {
  return { kty: "EC", crv: "P-256", d: b64url(d), x: b64url(pub.slice(1, 33)), y: b64url(pub.slice(33, 65)), ext: true };
}

export interface PushSubscriptionKeys {
  endpoint: string;
  p256dh: string; // user agent public key, base64url
  auth: string; // auth secret, base64url
}

/**
 * Encrypts a push payload for one subscription. `salt` and `sender` are only passed by tests
 * (RFC 8291 section 5); normally both are random per message.
 */
export async function encryptPayload(
  plaintext: Uint8Array,
  sub: Pick<PushSubscriptionKeys, "p256dh" | "auth">,
  opts: { salt?: Uint8Array; sender?: { privateKey: Uint8Array; publicKey: Uint8Array } } = {},
): Promise<{ body: Uint8Array; intermediate: { cek: Uint8Array; nonce: Uint8Array } }> {
  const uaPublic = fromB64url(sub.p256dh);
  const authSecret = fromB64url(sub.auth);
  const salt = opts.salt ?? crypto.getRandomValues(new Uint8Array(16));

  let asPrivate: CryptoKey;
  let asPublic: Uint8Array;
  if (opts.sender) {
    asPrivate = await crypto.subtle.importKey("jwk", privateJwk(opts.sender.privateKey, opts.sender.publicKey), { name: "ECDH", namedCurve: "P-256" }, false, [
      "deriveBits",
    ]);
    asPublic = opts.sender.publicKey;
  } else {
    const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
    asPrivate = pair.privateKey;
    asPublic = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
  }

  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  // Spec name is `public`; Workers' type definitions call it `$public`, so cast.
  const ecdhParams = { name: "ECDH", public: uaKey } as unknown as Parameters<typeof crypto.subtle.deriveBits>[0];
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits(ecdhParams, asPrivate, 256));

  // RFC 8291 section 3.4
  const prkKey = await hmac(authSecret, ecdhSecret);
  const keyInfo = concat(enc.encode("WebPush: info\0"), uaPublic, asPublic);
  const ikm = await hmac(prkKey, concat(keyInfo, new Uint8Array([1])));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(enc.encode("Content-Encoding: aes128gcm\0"), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, concat(enc.encode("Content-Encoding: nonce\0"), new Uint8Array([1])))).slice(0, 12);

  // One record: plaintext followed by the last-record delimiter 0x02.
  const padded = concat(plaintext, new Uint8Array([2]));
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, padded));

  const rs = 4096;
  const header = concat(salt, new Uint8Array([(rs >>> 24) & 255, (rs >>> 16) & 255, (rs >>> 8) & 255, rs & 255]), new Uint8Array([asPublic.length]), asPublic);
  return { body: concat(header, ciphertext), intermediate: { cek, nonce } };
}

/** VAPID Authorization header value for a push service origin (RFC 8292). */
export async function vapidAuthorization(endpoint: string, keys: { publicKey: string; privateKey: string; subject: string }, now = Date.now()) {
  const aud = new URL(endpoint).origin;
  const header = b64url(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64url(enc.encode(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: keys.subject })));
  const unsigned = `${header}.${claims}`;
  const signingKey = await crypto.subtle.importKey("jwk", privateJwk(fromB64url(keys.privateKey), fromB64url(keys.publicKey)), { name: "ECDSA", namedCurve: "P-256" }, false, [
    "sign",
  ]);
  // Web Crypto returns the raw r||s signature, which is what JWS ES256 uses.
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signingKey, enc.encode(unsigned)));
  return `vapid t=${unsigned}.${b64url(sig)}, k=${keys.publicKey}`;
}

/** Only real browser push services, so the Worker can't be pointed at arbitrary URLs. */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /\.push\.apple\.com$/, /\.notify\.windows\.com$/];
export function isPushEndpoint(endpoint: string, allowLocal = false): boolean {
  try {
    const u = new URL(endpoint);
    // Local testing only (DEV_LOGIN on localhost): a receiver on this machine stands in for a push service.
    if (allowLocal && u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1")) return true;
    return u.protocol === "https:" && PUSH_HOSTS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

export function pushConfigured(env: Env) {
  return !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
}

export interface PushMessage {
  title: string;
  body: string;
  /** Path to open when tapped, like /e/night-shift-abc. */
  url: string;
  /** Replaces an earlier notification with the same tag (one per event and kind). */
  tag: string;
}

const MAX_DEVICES = 10;
const subsKey = (userId: string) => `push:${userId}`;

async function loadSubs(env: Env, userId: string): Promise<PushSubscriptionKeys[]> {
  return JSON.parse((await env.SESSIONS.get(subsKey(userId))) ?? "[]") as PushSubscriptionKeys[];
}

/** Sends to one subscription. Returns false when the push service says it's gone. */
async function sendOne(env: Env, sub: PushSubscriptionKeys, msg: PushMessage, ttl: number): Promise<boolean> {
  const { body } = await encryptPayload(enc.encode(JSON.stringify(msg)), sub);
  const res = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      Authorization: await vapidAuthorization(sub.endpoint, {
        publicKey: env.VAPID_PUBLIC_KEY!,
        privateKey: env.VAPID_PRIVATE_KEY!,
        subject: env.VAPID_SUBJECT || "mailto:hello@assembly.rsvp",
      }),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(ttl),
      Urgency: "normal",
      Topic: msg.tag.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32),
    },
    body,
  });
  if (res.status === 404 || res.status === 410) return false;
  if (!res.ok) console.error("push failed", res.status, new URL(sub.endpoint).hostname, await res.text().catch(() => ""));
  return true;
}

/** Sends a message to every device of each user. Drops subscriptions the push service has expired. */
export async function notifyUsers(env: Env, userIds: string[], msg: PushMessage, ttl = 6 * 3600) {
  if (!pushConfigured(env)) return 0;
  let sent = 0;
  for (const userId of new Set(userIds)) {
    const subs = await loadSubs(env, userId);
    if (!subs.length) continue;
    const alive: PushSubscriptionKeys[] = [];
    for (const sub of subs) {
      try {
        if (await sendOne(env, sub, msg, ttl)) {
          alive.push(sub);
          sent++;
        }
      } catch (err) {
        console.error("push error", err);
        alive.push(sub);
      }
    }
    if (alive.length !== subs.length) await env.SESSIONS.put(subsKey(userId), JSON.stringify(alive));
  }
  return sent;
}

/** Everyone who RSVP'd (going or interested), minus the hosts themselves. */
export async function rsvpUserIds(env: Env, eventId: string): Promise<string[]> {
  const { results } = await env.DB.prepare(
    `SELECT r.user_id FROM rsvps r WHERE r.event_id = ?
     AND r.user_id NOT IN (SELECT user_id FROM event_hosts WHERE event_id = ?)`,
  )
    .bind(eventId, eventId)
    .all<{ user_id: string }>();
  return results.map((r) => r.user_id);
}

export const push = new Hono<AppContext>();

push.post("/subscribe", async (c) => {
  const userId = c.get("userId");
  if (!userId) return c.json({ error: "Sign in to turn on notifications." }, 401);
  if (!pushConfigured(c.env)) return c.json({ error: "Notifications aren't set up on this server yet." }, 503);
  const body = (await c.req.json().catch(() => ({}))) as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  const endpoint = body.endpoint ?? "";
  const p256dh = body.keys?.p256dh ?? "";
  const auth = body.keys?.auth ?? "";
  const host = new URL(c.req.url).hostname;
  const allowLocal = c.env.DEV_LOGIN === "1" && (host === "localhost" || host === "127.0.0.1");
  if (!isPushEndpoint(endpoint, allowLocal) || !/^[A-Za-z0-9_-]{80,100}$/.test(p256dh) || !/^[A-Za-z0-9_-]{16,32}$/.test(auth)) {
    return c.json({ error: "That browser subscription doesn't look right." }, 400);
  }
  const subs = (await loadSubs(c.env, userId)).filter((s) => s.endpoint !== endpoint);
  subs.unshift({ endpoint, p256dh, auth });
  await c.env.SESSIONS.put(subsKey(userId), JSON.stringify(subs.slice(0, MAX_DEVICES)));
  return c.json({ ok: true });
});

push.post("/unsubscribe", async (c) => {
  const userId = c.get("userId");
  if (!userId) return c.json({ ok: true });
  const { endpoint } = (await c.req.json().catch(() => ({}))) as { endpoint?: string };
  const subs = (await loadSubs(c.env, userId)).filter((s) => s.endpoint !== endpoint);
  await c.env.SESSIONS.put(subsKey(userId), JSON.stringify(subs));
  return c.json({ ok: true });
});

/** Sends a test notification to your own devices. */
push.post("/test", async (c) => {
  const userId = c.get("userId");
  if (!userId) return c.json({ error: "Sign in first." }, 401);
  const n = await notifyUsers(c.env, [userId], { title: "Assembly", body: "Notifications are on. We'll tell you when a night you saved changes.", url: "/", tag: "test" }, 600);
  return c.json({ sent: n });
});

/** Removes all of a user's subscriptions (account deletion). */
export async function forgetPush(env: Env, userId: string) {
  await env.SESSIONS.delete(subsKey(userId));
}
