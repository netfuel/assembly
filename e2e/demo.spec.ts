// The demo site (demo.assembly.rsvp, DEMO=1): a visitor becomes a guest without signing in, guests have
// four invented friends whose faces show on the map, and the nightly reset puts the content back.
// Runs only in that mode: npm run test:e2e:demo (it loads db/demo/seed.sql instead of the sample data).
import { test, expect, noProblems } from "./helpers";
import type { APIRequestContext } from "@playwright/test";

test.skip(!process.env.E2E_DEMO, "needs E2E_DEMO=1: npm run test:e2e:demo");

const FRIENDS = ["demo-friend-ari", "demo-friend-dev", "demo-friend-sky", "demo-friend-nina"];
// Wet Paint: tonight, in the demo seed, with comments.
const EVENT = "demo-wet-paint";

/** The nightly cron, run on demand (the Vite plugin's scheduled handler). */
async function nightlyReset(ctx: APIRequestContext) {
  expect((await ctx.get("/cdn-cgi/handler/scheduled?cron=0+9+*+*+*")).status()).toBe(200);
}

test("the app's first call makes a guest; nothing else does", async ({ api }) => {
  const crawler = await api(null);
  for (const path of ["/api/events?city=memphis", `/api/events/${EVENT}`, `/e/${EVENT}`]) {
    const r = await crawler.get(path);
    expect(r.status(), path).toBe(200);
    expect(r.headers()["set-cookie"] ?? "", `${path} sets no session`).not.toContain("asm_session");
  }
  expect((await (await crawler.get("/api/me")).json()).user ?? null, "still signed out").toBeNull();

  const visitor = await api(null);
  const config = await visitor.get("/api/config");
  expect(config.headers()["set-cookie"]).toContain("asm_session");
  const me = (await (await visitor.get("/api/me")).json()).user;
  expect(me.id).toMatch(/^guest-/);
  expect(me.displayName).toBe("Demo guest");

  // A second config call keeps the same guest instead of making another.
  await visitor.get("/api/config");
  expect((await (await visitor.get("/api/me")).json()).user.id).toBe(me.id);
});

test("the demo stays out of search engines", async ({ api }) => {
  const anon = await api(null);
  for (const path of ["/api/config", `/e/${EVENT}`]) {
    expect((await anon.get(path)).headers()["x-robots-tag"], path).toBe("noindex, nofollow");
  }
  // The app shell is a static file the Worker never sees, so robots.txt keeps crawlers off it.
  const robots = await anon.get("/robots.txt");
  expect(robots.status()).toBe(200);
  expect(await robots.text()).toMatch(/^User-agent: \*\nDisallow: \/$/m);
});

test("a guest has the four friends, and sees them at events", async ({ api }) => {
  const guest = await api(null);
  await guest.get("/api/config");
  const friends = (await (await guest.get("/api/friends")).json()).friends.map((f: { id: string }) => f.id).sort();
  expect(friends).toEqual([...FRIENDS].sort());
  const at = (await (await guest.get("/api/friends/at")).json()).events as Record<string, { id: string }[]>;
  const seen = new Set(Object.values(at).flat().map((p) => p.id));
  expect([...seen].sort(), "every friend is going to something").toEqual([...FRIENDS].sort());
});

test("the nightly reset clears what a guest did but keeps the guest and their friends", async ({ api }) => {
  const guest = await api(null);
  await guest.get("/api/config");
  const me = (await (await guest.get("/api/me")).json()).user;

  expect((await guest.put(`/api/events/${EVENT}/rsvp`, { data: { status: "going" } })).status()).toBe(200);
  const body = `Guest comment ${Date.now()}`;
  expect((await guest.post(`/api/events/${EVENT}/comments`, { data: { body } })).status()).toBeLessThan(300);
  const comments = async () => ((await (await guest.get(`/api/events/${EVENT}/comments`)).json()).comments as { body: string }[]).map((c) => c.body);
  expect(await comments()).toContain(body);

  await nightlyReset(guest);

  expect(await comments(), "the guest's comment is gone").not.toContain(body);
  const ev = await (await guest.get(`/api/events/${EVENT}`)).json();
  expect(ev.event?.title ?? ev.title, "the seeded event is back").toBe("Wet Paint");
  const after = (await (await guest.get("/api/me")).json()).user;
  expect(after?.id, "a guest from today stays signed in").toBe(me.id);
  const friends = (await (await guest.get("/api/friends")).json()).friends.map((f: { id: string }) => f.id).sort();
  expect(friends, "and keeps their friends").toEqual([...FRIENDS].sort());
});

test("a first visit opens the app with no sign-in, and friends' faces are drawn on the map", async ({ as, problems }) => {
  const page = await as(null);
  await page.goto("/");
  await expect(page.locator(".card").first()).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole("button", { name: /^sign in$/i })).toHaveCount(0);

  // Faces sit beside pins from zoom 12 up; the demo city opens at 12.2.
  const faces = await page.waitForFunction(
    () => {
      const map = (window as unknown as { __assemblyMap?: import("maplibre-gl").Map }).__assemblyMap;
      if (!map?.getLayer("event-friends")) return null;
      const n = map.querySourceFeatures("event-friends").length;
      return n > 0 ? n : null;
    },
    undefined,
    { timeout: 20000 },
  );
  expect(await faces.jsonValue()).toBeGreaterThan(0);

  // The faces sit right beside their event's pin at every zoom and stay there while the map moves
  // (an earlier version drew them as page elements that drifted hundreds of pixels away).
  for (const zoom of [12.5, 14, 15.5, 17]) {
    const where = await page.evaluate(async (z) => {
      const map = (window as unknown as { __assemblyMap: import("maplibre-gl").Map }).__assemblyMap;
      map.jumpTo({ center: [-90.0128, 35.1523], zoom: z }); // Pulp Warehouse, where friends are going
      // Not "idle": map tiles can't load in CI, so the map never settles. A few frames is enough to redraw.
      await new Promise((r) => setTimeout(r, 400));
      const pin = map.project([-90.0128, 35.1523]);
      // Look for the faces only in a small box below and to the right of the pin.
      const near = map.queryRenderedFeatures([[pin.x - 4, pin.y - 4], [pin.x + 70, pin.y + 50]], { layers: ["event-friends"] });
      return near.map((f) => f.properties?.id as string);
    }, zoom);
    expect(where, `faces beside the Pulp pin at zoom ${zoom}`).toContain("demo-pulp-costume");
  }
  noProblems(problems);
});
