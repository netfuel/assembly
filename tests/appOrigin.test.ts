import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { appCors, blockCrossSiteWrites, isAppOrigin } from "../worker/appOrigin";
import { fonts } from "../worker/fonts";

// The iOS app runs at capacitor://localhost and calls the Worker across origins (docs/ios.md).
const APP = "capacitor://localhost";
const SITE = "https://assembly.rsvp";

function api() {
  const a = new Hono().basePath("/api");
  a.use("*", appCors);
  a.use("*", blockCrossSiteWrites);
  a.get("/thing", (c) => c.json({ ok: true }));
  a.post("/thing", (c) => c.json({ ok: true }));
  a.post("/auth/apple/callback", (c) => c.json({ ok: true }));
  // A route whose response headers are read-only, like static assets or a fetched response.
  a.get("/frozen", async () => fetch(new Request("data:application/json,{}")));
  return a;
}
const call = (method: string, path: string, origin?: string) =>
  api().request(`${SITE}${path}`, { method, headers: origin ? { Origin: origin } : {} });

describe("app origin", () => {
  it("recognises only the app", () => {
    expect(isAppOrigin(APP)).toBe(true);
    for (const o of [SITE, "capacitor://evil", "http://localhost", "null", "", null, undefined]) expect(isAppOrigin(o)).toBe(false);
  });

  it("answers the app's preflight before anything else runs", async () => {
    const res = await call("OPTIONS", "/api/thing", APP);
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(APP);
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBe("true");
    expect(res.headers.get("Access-Control-Allow-Headers")).toContain("Authorization");
  });

  it("adds CORS headers for the app, and none for anyone else", async () => {
    const app = await call("GET", "/api/thing", APP);
    expect(app.headers.get("Access-Control-Allow-Origin")).toBe(APP);
    expect(app.headers.get("Vary")).toContain("Origin");
    for (const origin of [undefined, SITE, "https://evil.example"]) {
      const res = await call("GET", "/api/thing", origin);
      expect(res.status).toBe(200);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    }
  });

  it("copes with read-only response headers", async () => {
    const res = await call("GET", "/api/frozen", APP);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(APP);
  });

  it("lets the site and the app write, and blocks other sites", async () => {
    expect((await call("POST", "/api/thing")).status).toBe(200);
    expect((await call("POST", "/api/thing", SITE)).status).toBe(200);
    expect((await call("POST", "/api/thing", APP)).status).toBe(200);
    expect((await call("POST", "/api/thing", "https://evil.example")).status).toBe(403);
    expect((await call("POST", "/api/thing", "capacitor://evil")).status).toBe(403);
    expect((await call("POST", "/api/auth/apple/callback", "https://appleid.apple.com")).status).toBe(200);
  });

  it("serves fonts to the app, and still not to other sites", async () => {
    const font = new Uint8Array([0x77, 0x4f, 0x46, 0x32]);
    const env = { MEDIA: { get: async () => ({ body: font, httpEtag: '"f"' }) } };
    const f = new Hono().basePath("/fonts");
    f.use("*", appCors);
    f.route("/", fonts);
    const get = (headers: Record<string, string>) => f.request(`${SITE}/fonts/timeless/TimelessSansVF.woff2`, { headers }, env);

    const app = await get({ Origin: APP, "Sec-Fetch-Site": "cross-site" });
    expect(app.status).toBe(200);
    expect(app.headers.get("Access-Control-Allow-Origin")).toBe(APP);
    expect((await get({ "Sec-Fetch-Site": "same-origin" })).status).toBe(200);
    expect((await get({ Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site" })).status).toBe(403);
  });
});
