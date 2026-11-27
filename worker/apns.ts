// iOS push through Apple Push Notification service (APNs), beside web push in worker/push.ts.
// - Auth: a token-based provider JWT (ES256), signed with the APNs key's .p8, reused for up to 40 minutes
//   (Apple wants a new one at most every 20 minutes and rejects any older than an hour).
// - Each device token belongs to one APNs environment: sandbox for apps run from Xcode, production for TestFlight
//   and the App Store. The app can't tell which, so a send tries the device's last known environment, switches on
//   BadDeviceToken, and remembers what worked.
import type { Env } from "./env";
import { pemToPkcs8 } from "./auth";
import { b64url } from "./push";

export type ApnsEnvironment = "production" | "sandbox";

export interface ApnsDevice {
  token: string;
  env: ApnsEnvironment;
}

export interface ApnsMessage {
  title: string;
  body: string;
  /** Path to open when tapped, like /e/night-shift-abc. */
  url: string;
  /** Replaces an earlier notification with the same tag (one per event and kind). */
  tag: string;
}

const HOSTS: Record<ApnsEnvironment, string> = {
  production: "https://api.push.apple.com",
  sandbox: "https://api.sandbox.push.apple.com",
};
const enc = new TextEncoder();

export function apnsConfigured(env: Env) {
  return !!(env.APPLE_TEAM_ID && env.APNS_KEY_ID && env.APNS_PRIVATE_KEY);
}

/** Device tokens are hex (32 bytes today); allow some room in case Apple lengthens them. */
export function isDeviceToken(token: unknown): token is string {
  return typeof token === "string" && /^[0-9a-fA-F]{64,200}$/.test(token);
}

let cached: { keyId: string; jwt: string; issuedAt: number } | null = null;

/** The provider token for the Authorization header. */
export async function apnsJwt(env: Env, now = Date.now()): Promise<string> {
  const keyId = env.APNS_KEY_ID!;
  if (cached && cached.keyId === keyId && now - cached.issuedAt < 40 * 60e3) return cached.jwt;
  const header = b64url(enc.encode(JSON.stringify({ alg: "ES256", kid: keyId })));
  const claims = b64url(enc.encode(JSON.stringify({ iss: env.APPLE_TEAM_ID, iat: Math.floor(now / 1000) })));
  const unsigned = `${header}.${claims}`;
  const key = await crypto.subtle.importKey("pkcs8", pemToPkcs8(env.APNS_PRIVATE_KEY!), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  // Web Crypto returns the raw r||s signature, which is what JWS ES256 uses.
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(unsigned)));
  cached = { keyId, jwt: `${unsigned}.${b64url(sig)}`, issuedAt: now };
  return cached.jwt;
}

/** Test hook: forget the cached provider token. */
export function resetApnsJwt() {
  cached = null;
}

/** The JSON Apple delivers. `url` sits beside `aps` so a tap can open the event. */
export function apnsPayload(msg: ApnsMessage) {
  return {
    aps: { alert: { title: msg.title, body: msg.body }, sound: "default", "thread-id": msg.tag.slice(0, 64) },
    url: msg.url,
  };
}

type Outcome = "sent" | "gone" | "wrong-env" | "error";

async function post(env: Env, where: ApnsEnvironment, token: string, msg: ApnsMessage, ttl: number, now: number): Promise<Outcome> {
  const res = await fetch(`${HOSTS[where]}/3/device/${token}`, {
    method: "POST",
    headers: {
      authorization: `bearer ${await apnsJwt(env, now)}`,
      "apns-topic": env.APNS_TOPIC || "rsvp.assembly.app",
      "apns-push-type": "alert",
      "apns-priority": "10",
      "apns-expiration": String(Math.floor(now / 1000) + ttl),
      "apns-collapse-id": msg.tag.slice(0, 64),
      "content-type": "application/json",
    },
    body: JSON.stringify(apnsPayload(msg)),
  });
  if (res.ok) return "sent";
  const reason = ((await res.json().catch(() => ({}))) as { reason?: string }).reason ?? "";
  if (res.status === 410 || reason === "Unregistered") return "gone";
  // A token from the other environment, or one Apple doesn't recognize at all (checked against both below).
  if (res.status === 400 && (reason === "BadDeviceToken" || reason === "DeviceTokenNotForTopic")) return "wrong-env";
  if (res.status === 403 && reason === "ExpiredProviderToken") resetApnsJwt();
  console.error("apns failed", res.status, reason, where);
  return "error";
}

/**
 * Sends to one device. Returns the device to keep (with its environment updated if it moved), or null when Apple
 * says the token is gone or belongs to neither environment.
 */
export async function sendApns(env: Env, device: ApnsDevice, msg: ApnsMessage, ttl = 6 * 3600, now = Date.now()): Promise<{ keep: ApnsDevice | null; sent: boolean }> {
  const first = await post(env, device.env, device.token, msg, ttl, now);
  if (first === "sent") return { keep: device, sent: true };
  if (first === "gone") return { keep: null, sent: false };
  if (first === "error") return { keep: device, sent: false };
  const other: ApnsEnvironment = device.env === "production" ? "sandbox" : "production";
  const second = await post(env, other, device.token, msg, ttl, now);
  if (second === "sent") return { keep: { token: device.token, env: other }, sent: true };
  if (second === "error") return { keep: device, sent: false };
  return { keep: null, sent: false };
}
