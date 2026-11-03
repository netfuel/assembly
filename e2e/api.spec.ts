// API contract sweep: every route answers JSON with the right status for each role, private data isn't cached,
// and bad input is a 4xx, never a 500. No browser.
import { execFileSync } from "node:child_process";
import { test, expect, ids } from "./helpers";
import { EV } from "./roles";

const J = { "content-type": "application/json" };

/** Writes that need a signed-in person. [method, path, body] */
const SIGNED_IN_WRITES: [string, string, unknown?][] = [
  ["PUT", `/api/events/${EV.upcoming}/rsvp`, { status: "going" }],
  ["DELETE", `/api/events/${EV.upcoming}/rsvp`],
  ["POST", `/api/events/${EV.live}/checkin`, { method: "gps", near: true }],
  ["POST", `/api/events/${EV.live}/react`, { kind: "fire" }],
  ["POST", `/api/events/${EV.live}/comments`, { body: "hi" }],
  ["PUT", `/api/events/${EV.live}/comments-mode`, { mode: "on" }],
  ["POST", `/api/events/${EV.live}/live`, { action: "extend" }],
  ["POST", "/api/events", {}],
  ["PATCH", `/api/events/${EV.upcoming}`, {}],
  ["POST", `/api/events/${EV.upcoming}/cancel`],
  ["POST", `/api/events/${EV.upcoming}/report`, { reason: "spam" }],
  ["PATCH", "/api/me", { displayName: "x" }],
  ["DELETE", "/api/me", { confirm: "delete" }],
  ["PUT", "/api/me/blocks/someone", { kind: "mute" }],
  ["POST", "/api/me/inbox/seen"],
  ["POST", "/api/pages/artists/juno-ray/claim", { message: "it's me" }],
  ["PUT", "/api/pages/artists/juno-ray", { bio: "x" }],
  ["POST", "/api/friends/request/someone"],
  ["POST", `/api/events/${EV.live}/invite`, {}],
  ["POST", "/api/uploads/flyer"],
];

/** Moderator-only routes. */
const MOD_ROUTES: [string, string, unknown?][] = [
  ["GET", "/api/mod/stats"],
  ["GET", "/api/mod/queue"],
  ["GET", "/api/mod/claims"],
  ["GET", "/api/mod/wall"],
  ["GET", "/api/mod/comments"],
  ["POST", `/api/mod/events/${EV.upcoming}`, { action: "dismiss" }],
  ["PUT", `/api/mod/users/x/verified`, { verified: true }],
];

/** Routes whose answer is about the signed-in person, so must never be cached by a shared cache. */
const PRIVATE_GETS = ["/api/me", "/api/me/inbox", "/api/me/events", "/api/me/blocks", `/api/events/${EV.live}`, `/api/events/${EV.live}/comments`, `/api/events/${EV.live}/presence`, "/api/friends"];

/** Public reads anyone can make. */
const PUBLIC_GETS = [
  "/api/health",
  "/api/config",
  "/api/cities/memphis",
  "/api/events",
  `/api/events/${EV.live}`,
  `/api/events/${EV.live}/comments`,
  `/api/events/${EV.live}/presence`,
  `/api/events/${EV.live}/wall`,
  "/api/search?q=juno",
  "/api/pages/artists/juno-ray",
  "/api/pages/artists/juno-ray/events",
  "/api/pages/venues/pulp",
  "/api/auth/providers",
  "/api/venues",
];

test.describe("API contract", () => {
  test("public reads answer 200 JSON signed out", async ({ api }) => {
    const anon = await api(null);
    const bad: string[] = [];
    for (const path of PUBLIC_GETS) {
      const r = await anon.get(path);
      const type = r.headers()["content-type"] ?? "";
      if (r.status() !== 200 || !type.includes("application/json")) bad.push(`${path}: ${r.status()} ${type}`);
    }
    expect(bad, bad.join("\n")).toEqual([]);
  });

  test("unknown API paths answer JSON 404, not the app's HTML", async ({ api }) => {
    const anon = await api(null);
    for (const path of ["/api/nope", "/api/events/does-not-exist", "/api/pages/artists/nobody", "/api/a/b/c"]) {
      const r = await anon.get(path);
      expect(r.status(), path).toBe(404);
      expect(r.headers()["content-type"], path).toContain("application/json");
    }
  });

  test("writes signed out answer 401 (or 403/404), never 2xx or 5xx", async ({ api }) => {
    const anon = await api(null);
    const bad: string[] = [];
    for (const [method, path, body] of SIGNED_IN_WRITES) {
      const r = await anon.fetch(path, { method, data: body, headers: J });
      if (r.status() < 400 || r.status() >= 500) bad.push(`${method} ${path}: ${r.status()}`);
    }
    expect(bad, bad.join("\n")).toEqual([]);
  });

  test("moderator routes refuse fans and signed-out visitors, and work for moderators", async ({ api }) => {
    const [anon, fan, mod] = [await api(null), await api("fanA"), await api("mod")];
    const bad: string[] = [];
    for (const [method, path, body] of MOD_ROUTES) {
      for (const [who, ctx] of [["signed out", anon], ["fan", fan]] as const) {
        const r = await ctx.fetch(path, { method, data: body, headers: J });
        if (r.status() !== 401 && r.status() !== 403) bad.push(`${who} ${method} ${path}: ${r.status()}`);
      }
      if (method === "GET") {
        const r = await mod.get(path);
        if (r.status() !== 200) bad.push(`mod GET ${path}: ${r.status()}`);
      }
    }
    expect(bad, bad.join("\n")).toEqual([]);
  });

  test("host-only actions refuse other fans", async ({ api }) => {
    const fan = await api("fanB");
    const cases: [string, string, unknown][] = [
      ["POST", `/api/events/${EV.live}/live`, { action: "end" }],
      ["PUT", `/api/events/${EV.live}/comments-mode`, { mode: "off" }],
      ["PATCH", `/api/events/${EV.live}/wall`, { enabled: false }],
      ["POST", `/api/events/${EV.upcoming}/cancel`, {}],
      ["PATCH", `/api/events/${EV.upcoming}`, { title: "Hijacked" }],
    ];
    const bad: string[] = [];
    for (const [method, path, body] of cases) {
      const r = await fan.fetch(path, { method, data: body, headers: J });
      if (r.status() !== 403 && r.status() !== 404) bad.push(`${method} ${path}: ${r.status()}`);
    }
    expect(bad, bad.join("\n")).toEqual([]);
    // Nothing changed.
    const e = await (await fan.get(`/api/events/${EV.upcoming}`)).json();
    expect(e.title).toBe("E2E Upcoming Night");
    expect(e.status).toBe("live");
  });

  test("bad input is a 4xx with a message, never a 500", async ({ api }) => {
    const fan = await api("fanA");
    const cases: [string, string, unknown][] = [
      ["PUT", `/api/events/${EV.upcoming}/rsvp`, { status: "maybe" }],
      ["POST", `/api/events/${EV.live}/react`, { kind: "lol" }],
      ["POST", `/api/events/${EV.live}/comments`, { body: "" }],
      ["POST", `/api/events/${EV.live}/comments`, { body: "a".repeat(501) }],
      ["POST", `/api/events/${EV.live}/comments`, { body: 42 }],
      ["POST", `/api/events/${EV.live}/checkin`, { method: "teleport" }],
      ["POST", `/api/events/${EV.live}/checkin`, { method: "gps", near: false }],
      ["POST", "/api/events", { title: "" }],
      ["PATCH", "/api/me", { displayName: "" }],
      ["PATCH", "/api/me", { links: { instagram: "javascript:alert(1)" } }],
      ["DELETE", "/api/me", { confirm: "nope" }],
      ["PUT", "/api/me/blocks/nobody-at-all", { kind: "mute" }],
    ];
    const bad: string[] = [];
    for (const [method, path, body] of cases) {
      const r = await fan.fetch(path, { method, data: body, headers: J });
      const text = await r.text();
      let message = "";
      try {
        message = JSON.parse(text).error ?? "";
      } catch {}
      if (method === "GET") {
        if (r.status() >= 500) bad.push(`${method} ${path.slice(0, 40)}: ${r.status()}`);
        continue;
      }
      if (r.status() < 400 || r.status() >= 500 || !message) bad.push(`${method} ${path} ${JSON.stringify(body).slice(0, 50)}: ${r.status()} ${text.slice(0, 80)}`);
    }
    expect(bad, bad.join("\n")).toEqual([]);
  });

  test("a long search answers 200", async ({ api }) => {
    const anon = await api(null);
    expect((await anon.get("/api/search?q=" + "x".repeat(60))).status(), "60-character query").toBe(200);
  });

  test("a word that matches 100+ events answers 200", async ({ api }) => {
    const rows = Array.from({ length: 110 }, (_, i) => `('e2e-many-${i}','memphis','Zebra party ${i}',strftime('%Y-%m-%dT%H:%M:%SZ','now','+1 day'),strftime('%Y-%m-%dT%H:%M:%SZ','now','+2 day'),'x',35.1,-90.0,'live',0)`).join(",");
    const sql = (q: string) => execFileSync("npx", ["wrangler", "d1", "execute", "assembly", "--local", "--persist-to", ".wrangler/e2e", "--command", q], { stdio: "pipe" });
    sql(`INSERT INTO events (id, city_id, title, starts_at, ends_at, address, lat, lng, status, is_sample) VALUES ${rows}`);
    try {
      expect((await (await api(null)).get("/api/search?q=zebra")).status()).toBe(200);
    } finally {
      sql("DELETE FROM events WHERE id LIKE 'e2e-many-%'");
    }
  });

  test("malformed JSON bodies are a 4xx, never a 500", async ({ api }) => {
    const fan = await api("fanA");
    const bad: string[] = [];
    for (const [method, path] of [
      ["PUT", `/api/events/${EV.upcoming}/rsvp`],
      ["POST", `/api/events/${EV.live}/react`],
      ["POST", `/api/events/${EV.live}/comments`],
      ["POST", "/api/events"],
      ["PATCH", "/api/me"],
      ["POST", `/api/events/${EV.live}/checkin`],
    ]) {
      const r = await fan.fetch(path, { method, data: "{not json", headers: J });
      if (r.status() >= 500 || r.status() < 400) bad.push(`${method} ${path}: ${r.status()}`);
    }
    expect(bad, bad.join("\n")).toEqual([]);
  });

  test("cross-site writes are blocked", async ({ api }) => {
    const fan = await api("fanA");
    const r = await fan.put(`/api/events/${EV.upcoming}/rsvp`, { data: { status: "going" }, headers: { ...J, Origin: "https://evil.example" } });
    expect(r.status()).toBe(403);
  });

  test("personal responses are never publicly cacheable", async ({ api }) => {
    const fan = await api("fanA");
    const bad: string[] = [];
    for (const path of PRIVATE_GETS) {
      const r = await fan.get(path);
      const cc = r.headers()["cache-control"] ?? "(none)";
      if (r.status() === 200 && !/private|no-store/.test(cc)) bad.push(`${path}: ${cc}`);
    }
    expect(bad, bad.join("\n")).toEqual([]);
  });

  test("security headers on the app and the API", async ({ api }) => {
    const anon = await api(null);
    // The app shell's headers come from public/_headers, which only applies on Cloudflare: checked in the production smoke pass.
    for (const path of ["/api/health", `/e/${EV.live}`]) {
      const h = (await anon.get(path)).headers();
      expect(h["x-content-type-options"], path).toBe("nosniff");
      expect(h["referrer-policy"], path).toBeTruthy();
    }
  });

  test("dev sign-in is refused on a non-localhost host", async ({ api }) => {
    const anon = await api(null);
    const r = await anon.get("/api/auth/dev?name=Intruder", { headers: { Host: "assembly.rsvp" }, maxRedirects: 0 });
    // Vite itself refuses the foreign host (403); the Worker would answer 404. Either way, no session.
    expect(r.status()).toBeGreaterThanOrEqual(400);
    expect(r.headers()["set-cookie"] ?? "").not.toContain("asm_session");
  });

  test("comment rate limit: the 11th comment in an hour is refused", async ({ api }) => {
    const fan = await api("fanC");
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await fan.post(`/api/events/${EV.past}/comments`, { data: { body: `rate test ${i}` }, headers: J })).status());
    expect(statuses.slice(0, 10).every((s) => s === 201), statuses.join(",")).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  test("a fan can't edit, pin or remove someone else's comment; moderators can remove", async ({ api }) => {
    const [a, b, mod] = [await api("fanA"), await api("fanB"), await api("mod")];
    const made = await (await a.post(`/api/events/${EV.upcoming}/comments`, { data: { body: "mine" }, headers: J })).json();
    const id = made.comment.id;
    expect((await b.patch(`/api/comments/${id}`, { data: { body: "edited by B" }, headers: J })).status()).toBe(403);
    expect((await b.post(`/api/comments/${id}/pin`, { data: { pinned: true }, headers: J })).status()).toBe(403);
    expect((await b.delete(`/api/comments/${id}`)).status()).toBe(403);
    expect((await mod.delete(`/api/comments/${id}`)).status()).toBe(200);
  });

  test("RSVP round trip and counts", async ({ api }) => {
    const [a, b, anon] = [await api("fanA"), await api("fanB"), await api(null)];
    const before = (await (await anon.get(`/api/events/${EV.upcoming}`)).json()).goingCount;
    expect((await a.put(`/api/events/${EV.upcoming}/rsvp`, { data: { status: "going" }, headers: J })).status()).toBe(200);
    expect((await b.put(`/api/events/${EV.upcoming}/rsvp`, { data: { status: "going" }, headers: J })).status()).toBe(200);
    expect((await (await anon.get(`/api/events/${EV.upcoming}`)).json()).goingCount).toBe(before + 2);
    await b.delete(`/api/events/${EV.upcoming}/rsvp`);
    expect((await (await anon.get(`/api/events/${EV.upcoming}`)).json()).goingCount).toBe(before + 1);
    const mine = await (await a.get("/api/me/events")).json();
    expect(JSON.stringify(mine)).toContain(EV.upcoming);
  });

  test("check-in window: refused before doors and after the night", async ({ api }) => {
    const a = await api("fanA");
    expect((await a.post(`/api/events/${EV.upcoming}/checkin`, { data: { method: "gps", near: true }, headers: J })).status()).toBe(409);
    const past = await a.post(`/api/events/${EV.cancelled}/checkin`, { data: { method: "gps", near: true }, headers: J });
    expect(past.status()).toBe(409);
  });

  test("the old door-code route is gone", async ({ api }) => {
    const host = await api("host");
    expect((await host.get(`/api/events/${EV.live}/door-code`)).status()).toBe(404);
  });

  test("reactions: one of each per person, counts add up", async ({ api }) => {
    const [a, b] = [await api("fanA"), await api("fanB")];
    await a.post(`/api/events/${EV.upcoming}/react`, { data: { kind: "heart" }, headers: J });
    await a.post(`/api/events/${EV.upcoming}/react`, { data: { kind: "heart" }, headers: J });
    const r = await (await b.post(`/api/events/${EV.upcoming}/react`, { data: { kind: "heart" }, headers: J })).json();
    expect(r.counts.heart).toBe(2);
    expect(r.mine).toEqual(["heart"]);
    const off = await (await a.post(`/api/events/${EV.upcoming}/react`, { data: { kind: "heart", on: false }, headers: J })).json();
    expect(off.counts.heart).toBe(1);
  });

  test("feeds and the sitemap answer", async ({ api }) => {
    const anon = await api(null);
    for (const path of ["/feeds/memphis.xml", "/feeds/memphis.json", "/feeds/memphis.ics", "/feeds/a/juno-ray.xml", "/sitemap.xml"]) {
      const r = await anon.get(path);
      expect(r.status(), path).toBe(200);
    }
  });

  test("user ids in fixtures exist", async () => {
    expect(Object.keys(ids()).length).toBeGreaterThanOrEqual(6);
  });
});
