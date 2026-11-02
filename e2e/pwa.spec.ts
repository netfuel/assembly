// Service worker, offline, self-heal and splash: these need the built app (npm run build + vite preview),
// so they run only when E2E_BUILT is set (scripts/e2e-built.mjs). Dev mode has no service worker.
import { test, expect, openEvent } from "./helpers";
import { EV } from "./roles";

test.skip(!process.env.E2E_BUILT, "needs the built app: npm run test:e2e:built");

test("the service worker installs and a going event opens offline", async ({ as }) => {
  const page = await as("fanA");
  await page.request.put(`/api/events/${EV.upcoming}/rsvp`, { data: { status: "going" } });
  await page.goto("/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await openEvent(page, EV.upcoming);
  await page.waitForTimeout(2000);
  await page.context().setOffline(true);
  await page.goto(`/e/${EV.upcoming}`).catch(() => {});
  await expect(page.getByText("E2E Upcoming Night").first()).toBeVisible({ timeout: 15000 });
  await page.context().setOffline(false);
});

test("a missing script after a deploy reloads once instead of a blank page", async ({ as }) => {
  const page = await as(null);
  let failed = 0;
  await page.route(/\/assets\/index-[^/]+\.js$/, async (route) => {
    if (failed++ === 0) return route.fulfill({ status: 404, body: "gone" });
    return route.continue();
  });
  await page.goto("/");
  await expect(page.locator(".card").first()).toBeVisible({ timeout: 20000 });
  expect(await page.evaluate(() => sessionStorage.getItem("assembly-healed"))).toBe("1");
});

test("the splash plays once per tab, and never on shared links", async ({ as }) => {
  const page = await as(null);
  await page.goto("/");
  expect(await page.evaluate(() => document.documentElement.dataset.splash)).not.toBe("skip");
  await page.reload();
  expect(await page.evaluate(() => document.documentElement.dataset.splash)).toBe("skip");
  const fresh = await as(null);
  await fresh.goto(`/e/${EV.upcoming}`);
  expect(await fresh.evaluate(() => document.documentElement.dataset.splash)).toBe("skip");
});

test("security headers on the built app shell", async ({ api }) => {
  const anon = await api(null);
  const h = (await anon.get("/")).headers();
  expect(h["content-security-policy"]).toBeTruthy();
  expect(h["x-content-type-options"]).toBe("nosniff");
});
