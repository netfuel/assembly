import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { apnsJwt, apnsPayload, isDeviceToken, resetApnsJwt, sendApns } from "./apns";
import { fromB64url, notifyUsers, push } from "./push";
import type { AppContext, Env } from "./env";

const enc = new TextEncoder();
const TOKEN = "a".repeat(64);
const msg = { title: "Updated: Night Shift", body: "Now starts at 11 pm.", url: "/e/night-shift", tag: "update-night-shift" };

let publicKey: CryptoKey;
let pem: string;
beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  publicKey = pair.publicKey;
  const der = new Uint8Array((await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer);
  const b64 = btoa(String.fromCharCode(...der));
  pem = `-----BEGIN PRIVATE KEY-----\n${b64.match(/.{1,64}/g)!.join("\n")}\n-----END PRIVATE KEY-----`;
});

function kv() {
  const m = new Map<string, string>();
  return {
    map: m,
    get: async (k: string) => m.get(k) ?? null,
    put: async (k: string, v: string) => void m.set(k, v),
    delete: async (k: string) => void m.delete(k),
  };
}
function env(store = kv()): Env {
  return { APPLE_TEAM_ID: "8F569K6WBX", APNS_KEY_ID: "MUDH3P745C", APNS_PRIVATE_KEY: pem, SESSIONS: store } as unknown as Env;
}

type Call = { url: string; headers: Record<string, string>; body: unknown };
let calls: Call[];
/** Apple's answer per host: sandbox or production. */
let answer: Record<string, [number, string?]>;
beforeEach(() => {
  resetApnsJwt();
  calls = [];
  answer = { production: [200], sandbox: [200] };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string) });
      const [status, reason] = answer[url.includes("sandbox") ? "sandbox" : "production"];
      return new Response(reason ? JSON.stringify({ reason }) : null, { status });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("APNs provider token", () => {
  it("is an ES256 JWT for the team and key that the key's public half verifies", async () => {
    const jwt = await apnsJwt(env(), Date.UTC(2026, 10, 27));
    const [h, c, s] = jwt.split(".");
    expect(JSON.parse(new TextDecoder().decode(fromB64url(h)))).toEqual({ alg: "ES256", kid: "MUDH3P745C" });
    expect(JSON.parse(new TextDecoder().decode(fromB64url(c)))).toEqual({ iss: "8F569K6WBX", iat: Date.UTC(2026, 10, 27) / 1000 });
    const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, fromB64url(s), enc.encode(`${h}.${c}`));
    expect(ok).toBe(true);
  });

  it("is reused for 40 minutes, then renewed", async () => {
    const t = Date.UTC(2026, 10, 27);
    const a = await apnsJwt(env(), t);
    expect(await apnsJwt(env(), t + 39 * 60e3)).toBe(a);
    expect(await apnsJwt(env(), t + 41 * 60e3)).not.toBe(a);
  });
});

describe("sending to an iPhone", () => {
  it("posts an alert for the app with the event to open", async () => {
    const r = await sendApns(env(), { token: TOKEN, env: "production" }, msg, 3600, Date.UTC(2026, 10, 27));
    expect(r).toEqual({ keep: { token: TOKEN, env: "production" }, sent: true });
    expect(calls[0].url).toBe(`https://api.push.apple.com/3/device/${TOKEN}`);
    expect(calls[0].headers).toMatchObject({
      "apns-topic": "rsvp.assembly.app",
      "apns-push-type": "alert",
      "apns-collapse-id": "update-night-shift",
      "apns-expiration": String(Date.UTC(2026, 10, 27) / 1000 + 3600),
    });
    expect(calls[0].headers.authorization).toMatch(/^bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    expect(calls[0].body).toEqual(apnsPayload(msg));
    expect(apnsPayload(msg)).toMatchObject({ aps: { alert: { title: msg.title, body: msg.body }, sound: "default" }, url: "/e/night-shift" });
  });

  it("moves an Xcode build's token to the sandbox, and remembers", async () => {
    answer.production = [400, "BadDeviceToken"];
    const r = await sendApns(env(), { token: TOKEN, env: "production" }, msg);
    expect(r).toEqual({ keep: { token: TOKEN, env: "sandbox" }, sent: true });
    expect(calls.map((c) => new URL(c.url).hostname)).toEqual(["api.push.apple.com", "api.sandbox.push.apple.com"]);
  });

  it("drops a token Apple says is gone, or that neither environment knows", async () => {
    answer.production = [410, "Unregistered"];
    expect((await sendApns(env(), { token: TOKEN, env: "production" }, msg)).keep).toBeNull();
    answer.production = [400, "BadDeviceToken"];
    answer.sandbox = [400, "BadDeviceToken"];
    expect((await sendApns(env(), { token: TOKEN, env: "production" }, msg)).keep).toBeNull();
  });

  it("keeps the token through Apple's own errors", async () => {
    answer.production = [503, "ServiceUnavailable"];
    expect(await sendApns(env(), { token: TOKEN, env: "production" }, msg)).toEqual({ keep: { token: TOKEN, env: "production" }, sent: false });
  });
});

describe("registering and notifying", () => {
  function app(store: ReturnType<typeof kv>, userId: string | null = "u1") {
    const a = new Hono<AppContext>();
    a.use("*", async (c, next) => {
      c.set("userId", userId);
      await next();
    });
    a.route("/push", push);
    const e = env(store);
    return (path: string, body: unknown) =>
      a.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, e);
  }

  it("checks device tokens", () => {
    expect(isDeviceToken(TOKEN)).toBe(true);
    expect(isDeviceToken("b".repeat(160))).toBe(true);
    expect(isDeviceToken("xyz")).toBe(false);
    expect(isDeviceToken("https://evil.example/")).toBe(false);
  });

  it("registers a phone, sends to it alongside web push, and forgets it on removal", async () => {
    const store = kv();
    const post = app(store);
    expect((await post("/push/apns", { token: TOKEN.toUpperCase() })).status).toBe(200);
    expect(JSON.parse(store.map.get("apns:u1")!)).toEqual([{ token: TOKEN, env: "production" }]);

    expect(await notifyUsers(env(store), ["u1", "u1", "u2"], msg)).toBe(1);
    expect(calls).toHaveLength(1);

    await post("/push/apns/remove", { token: TOKEN });
    expect(JSON.parse(store.map.get("apns:u1")!)).toEqual([]);
  });

  it("keeps a phone's known environment when it registers again", async () => {
    const store = kv();
    store.map.set("apns:u1", JSON.stringify([{ token: TOKEN, env: "sandbox" }]));
    await app(store)("/push/apns", { token: TOKEN });
    expect(JSON.parse(store.map.get("apns:u1")!)).toEqual([{ token: TOKEN, env: "sandbox" }]);
  });

  it("needs sign-in and a real token", async () => {
    expect((await app(kv(), null)("/push/apns", { token: TOKEN })).status).toBe(401);
    expect((await app(kv())("/push/apns", { token: "nope" })).status).toBe(400);
  });
});
