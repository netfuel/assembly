import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { appAuth, appChallenge, appRedirectUrl, issueHandoff, s256 } from "../worker/appAuth";
import { createSession, readSession } from "../worker/session";
import { auth } from "../worker/auth";
import type { AppContext } from "../worker/env";

// Signing in from the iOS app: a one-time code, bound to a verifier the app keeps (worker/appAuth.ts).

function fakeEnv() {
  const kv = new Map<string, string>();
  const SESSIONS = {
    get: async (k: string, type?: string) => {
      const v = kv.get(k);
      return v === undefined ? null : type === "json" ? JSON.parse(v) : v;
    },
    put: async (k: string, v: string) => void kv.set(k, v),
    delete: async (k: string) => void kv.delete(k),
  };
  const DB = { prepare: () => ({ bind: () => ({ run: async () => ({}) }) }) };
  return { kv, env: { SESSIONS, DB, GOOGLE_CLIENT_ID: "test-client", GOOGLE_CLIENT_SECRET: "test-secret" } };
}

function server(env: ReturnType<typeof fakeEnv>["env"]) {
  const a = new Hono<AppContext>().basePath("/api");
  a.use("*", async (c, next) => {
    c.set("userId", await readSession(c));
    await next();
  });
  a.route("/auth/app", appAuth);
  a.route("/auth", auth);
  a.get("/whoami", (c) => c.json({ userId: c.get("userId") }));
  // A way to run session and hand-off helpers with a real Hono context.
  a.post("/test/session/:user", async (c) => c.json({ token: await createSession(c, c.req.param("user")) }));
  a.post("/test/handoff/:user", async (c) => c.json({ code: await issueHandoff(c, c.req.param("user"), c.req.query("challenge")!) }));
  return (path: string, init?: RequestInit) => a.request(`https://assembly.rsvp${path}`, init, env);
}

type Body = { token: string; code: string; userId: string | null };
const j = async (r: Response | Promise<Response>): Promise<Body> => (await (await r).json()) as Body;

// RFC 7636, appendix B.
const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

describe("app sign-in hand-off", () => {
  it("hashes the verifier as PKCE S256 does", async () => {
    expect(await s256(VERIFIER)).toBe(CHALLENGE);
  });

  it("accepts only a well-formed challenge", () => {
    expect(appChallenge(CHALLENGE)).toBe(CHALLENGE);
    for (const bad of [null, undefined, "", "short", `${CHALLENGE}x`, CHALLENGE.replace("-", "+"), "../../etc"]) expect(appChallenge(bad)).toBeNull();
  });

  it("sends the sign-in sheet back into the app", () => {
    expect(appRedirectUrl("ok", "abc", "/e/x")).toBe("rsvp.assembly.app://auth?signin=ok&code=abc&return_to=%2Fe%2Fx");
    expect(appRedirectUrl("waitlist")).toBe("rsvp.assembly.app://auth?signin=waitlist");
    expect(appRedirectUrl("failed", undefined, "/")).toBe("rsvp.assembly.app://auth?signin=failed");
  });

  it("trades a code and the right verifier for a working token, once", async () => {
    const { env } = fakeEnv();
    const call = server(env);
    const { code } = await j(call(`/api/test/handoff/user-1?challenge=${CHALLENGE}`, { method: "POST" }));
    const swap = () => call("/api/auth/app/exchange", { method: "POST", body: JSON.stringify({ code, verifier: VERIFIER }) });

    const first = await swap();
    expect(first.status).toBe(200);
    const { token } = await j(first);
    expect((await j(call("/api/whoami", { headers: { Authorization: `Bearer ${token}` } }))).userId).toBe("user-1");
    expect((await swap()).status).toBe(400);
  });

  it("refuses the wrong verifier, and the code is spent anyway", async () => {
    const { env } = fakeEnv();
    const call = server(env);
    const { code } = await j(call(`/api/test/handoff/user-1?challenge=${CHALLENGE}`, { method: "POST" }));
    const wrong = "x".repeat(43);
    expect((await call("/api/auth/app/exchange", { method: "POST", body: JSON.stringify({ code, verifier: wrong }) })).status).toBe(400);
    expect((await call("/api/auth/app/exchange", { method: "POST", body: JSON.stringify({ code, verifier: VERIFIER }) })).status).toBe(400);
  });

  it("refuses malformed exchanges", async () => {
    const { env } = fakeEnv();
    const call = server(env);
    for (const body of ["{}", "not json", JSON.stringify({ code: "a", verifier: VERIFIER }), JSON.stringify({ code: "x".repeat(30), verifier: "short" })]) {
      expect((await call("/api/auth/app/exchange", { method: "POST", body })).status).toBe(400);
    }
  });
});

describe("Bearer sessions", () => {
  it("knows the user by a Bearer token, and by nothing else", async () => {
    const { env } = fakeEnv();
    const call = server(env);
    const { token } = await j(call("/api/test/session/user-2", { method: "POST" }));
    const who = async (headers: Record<string, string>) => (await j(call("/api/whoami", { headers }))).userId;
    expect(await who({ Authorization: `Bearer ${token}` })).toBe("user-2");
    expect(await who({ Cookie: `asm_session=${token}` })).toBe("user-2");
    const bad: Record<string, string>[] = [{}, { Authorization: `Bearer ${token}x` }, { Authorization: token }, { Authorization: `Basic ${token}` }];
    for (const h of bad) expect(await who(h)).toBeNull();
  });

  it("signs a Bearer token out", async () => {
    const { env } = fakeEnv();
    const call = server(env);
    const { token } = await j(call("/api/test/session/user-3", { method: "POST" }));
    const headers = { Authorization: `Bearer ${token}` };
    expect((await call("/api/auth/logout", { method: "POST", headers })).status).toBe(200);
    expect((await j(call("/api/whoami", { headers }))).userId).toBeNull();
  });
});

describe("Google sign-in started from the app", () => {
  it("remembers the challenge, and forgets a stale one on a web sign-in", async () => {
    const { env } = fakeEnv();
    const call = server(env);
    const fromApp = await call(`/api/auth/google?app=${CHALLENGE}`);
    expect(fromApp.status).toBe(302);
    expect(fromApp.headers.get("Set-Cookie")).toContain(`asm_app_challenge=${CHALLENGE}`);
    const fromWeb = await call("/api/auth/google");
    expect(fromWeb.headers.get("Set-Cookie")).toMatch(/asm_app_challenge=;.*Max-Age=0/);
  });

  it("ends a failed round-trip in the app when it started there, and on the site otherwise", async () => {
    const { env } = fakeEnv();
    const call = server(env);
    const app = await call("/api/auth/google/callback", { headers: { Cookie: `asm_app_challenge=${CHALLENGE}` } });
    expect(app.headers.get("Location")).toBe("rsvp.assembly.app://auth?signin=failed");
    const web = await call("/api/auth/google/callback");
    expect(web.headers.get("Location")).toBe("/?signin=failed");
  });
});
