// With every beta module switched off (E2E_FEATURES_OFF), their UI and routes are gone and nothing else breaks.
// Runs only in that mode: scripts/e2e-flags.mjs.
import { test, expect, noProblems, openEvent } from "./helpers";
import { EV } from "./roles";

test.skip(!process.env.E2E_FEATURES_OFF, "needs E2E_FEATURES_OFF: npm run test:e2e:flags");

test("config says every module is off", async ({ api }) => {
  const f = (await (await (await api(null)).get("/api/config")).json()).features;
  expect(f).toEqual({ wall: false, friends: false, checkin: false, reactions: false, comments: false, achievements: false });
});

test("module routes answer 404, other routes still work", async ({ api }) => {
  const a = await api("fanA");
  const off = [
    ["GET", `/api/events/${EV.live}/wall`],
    ["GET", `/api/events/${EV.live}/comments`],
    ["POST", `/api/events/${EV.live}/react`],
    ["POST", `/api/events/${EV.live}/checkin`],
    ["GET", "/api/friends"],
    ["GET", "/api/mod/comments"],
    ["GET", "/api/me/achievements"],
  ];
  for (const [method, path] of off) expect((await a.fetch(path, { method, data: {} })).status(), `${method} ${path}`).toBe(404);
  expect((await a.get(`/api/events/${EV.live}`)).status()).toBe(200);
  expect((await a.put(`/api/events/${EV.upcoming}/rsvp`, { data: { status: "going" } })).status()).toBe(200);
});

test("the event page shows no module sections or controls", async ({ as, problems }) => {
  const page = await as("fanA");
  await openEvent(page, EV.live);
  for (const id of ["ev-here", "ev-wall", "ev-comments", "ev-people"]) await expect(page.locator(`#${id}`), id).toHaveCount(0);
  await expect(page.locator(".reactions")).toHaveCount(0);
  await expect(page.locator(".ev-bar-primary")).not.toHaveText("Check in");
  noProblems(problems);
});

test("home and filters work without friends", async ({ as, problems }) => {
  const page = await as("fanA");
  await page.goto("/");
  await expect(page.locator(".card").first()).toBeVisible();
  await page.locator(".hs-filters").click();
  await expect(page.getByRole("button", { name: /Friends going/ })).toHaveCount(0);
  noProblems(problems);
});
