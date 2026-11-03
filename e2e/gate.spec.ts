// The launch gate (GATE=on): visitors without a session see the sign-up screen and nothing of the app; anyone
// signed in gets the app as usual. Runs only in that mode: npm run test:e2e:gate.
import { test, expect, noProblems } from "./helpers";
import { EV } from "./roles";

test.skip(process.env.E2E_GATE !== "on", "needs E2E_GATE=on: npm run test:e2e:gate");

test("the API is closed without a session, open with one", async ({ api }) => {
  const anon = await api(null);
  for (const path of ["/api/events", `/api/events/${EV.live}`, "/api/me", "/api/cities/memphis", "/api/search?q=a"]) {
    expect((await anon.get(path)).status(), path).toBe(401);
  }
  for (const path of ["/api/config", "/api/health", "/api/auth/providers"]) expect((await anon.get(path)).status(), path).toBe(200);
  expect((await (await anon.get("/api/config")).json()).gate).toBe("on");
  expect((await anon.get(`/e/${EV.live}`)).status(), "link preview page").toBe(200);
  const fan = await api("fanA");
  expect((await fan.get("/api/events")).status()).toBe(200);
  expect((await (await fan.get("/api/config")).json()).gate).toBe("off-for-you");
});

test("a visitor sees the gate, no map, no service worker", async ({ as, problems }) => {
  const page = await as(null);
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  await page.goto("/");
  await expect(page.locator(".gate-panel")).toBeVisible();
  await expect(page.locator("h1")).toHaveText("Assembly");
  await expect(page.locator(".maplibregl-map")).toHaveCount(0);
  expect(requests.filter((u) => /\/api\/events/.test(u))).toEqual([]);
  expect(await page.evaluate(() => navigator.serviceWorker.getRegistrations().then((r) => r.length))).toBe(0);
  // Policy pages stay reachable from the gate.
  await page.click(".gate-footer >> text=Privacy");
  await expect(page).toHaveURL(/\/privacy/);
  noProblems(problems);
});

test("leaving an email lands on the list and is remembered", async ({ as, api, problems }) => {
  const page = await as(null);
  await page.goto("/");
  const email = `gate-${Date.now()}@example.com`;
  await expect(page.locator(".gate-submit")).toBeDisabled();
  await page.fill("#gate-email", email);
  await expect(page.locator(".gate-submit")).toBeEnabled();
  await page.click(".gate-submit");
  await expect(page.locator(".gate-done")).toContainText("on the list");
  await page.reload();
  await expect(page.locator(".gate-done")).toBeVisible();
  await expect(page.locator("#gate-email")).toHaveCount(0);
  const csv = await (await (await api("mod")).get("/api/interest/export")).text();
  expect(csv).toContain(email);
  noProblems(problems);
});

test("a bad address is refused in place", async ({ as, problems }) => {
  const page = await as(null);
  await page.goto("/");
  await page.fill("#gate-email", "not-an-address");
  await expect(page.locator(".gate-submit")).toBeDisabled();
  noProblems(problems);
});

test("signed in, the app appears as usual", async ({ as, problems }) => {
  const page = await as("fanA");
  await page.goto("/");
  await expect(page.locator(".gate-panel")).toHaveCount(0);
  await expect(page.locator(".card").first()).toBeVisible();
  noProblems(problems);
});
