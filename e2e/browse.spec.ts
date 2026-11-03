// Home sheet, feed, filters, date pill, search, and the event page's structure by phase.
import { test, expect, noProblems, openEvent, openSection } from "./helpers";
import { EV } from "./roles";

const summary = (page: import("@playwright/test").Page) => page.locator(".sheet-summary");
const nights = async (page: import("@playwright/test").Page) => Number(((await summary(page).innerText()).match(/(\d+) night/) ?? [])[1] ?? NaN);

test.describe("Feed and filters", () => {
  test("default window is the next 7 days for a new visitor", async ({ as, problems }) => {
    const page = await as(null);
    await page.goto("/");
    await expect(page.locator(".date-pill")).toContainText("Next 7 days");
    await expect(summary(page)).toContainText(/\d+ nights?/);
    noProblems(problems);
  });

  test("live events lead the rail with a Live now badge", async ({ as, problems }) => {
    const page = await as(null);
    await page.goto("/");
    // Other sample nights can be live too, depending on the time of day; every live card must come before the rest.
    await expect(page.locator(".card", { hasText: "E2E Live Night" })).toContainText(/live now/i);
    const live = await page.locator(".card:not(.card-skeleton)").evaluateAll((els) => els.map((e) => /live now/i.test(e.textContent ?? "")));
    expect(live[0], "the first card is live").toBe(true);
    expect(live.indexOf(false) === -1 || live.slice(live.indexOf(false)).every((x) => !x), "no live card after a non-live one").toBe(true);
    noProblems(problems);
  });

  test("date pill: Tonight, This weekend, Everything coming up change the count", async ({ as, problems }) => {
    const page = await as(null);
    await page.goto("/");
    await expect(summary(page)).toContainText(/\d+ night/);
    const week = await nights(page);
    await page.locator(".date-pill").click();
    await page.getByRole("menuitemradio", { name: "Everything coming up" }).click();
    await expect(page.locator(".date-pill")).toContainText("Coming up");
    expect(await nights(page)).toBeGreaterThanOrEqual(week);
    await page.locator(".date-pill").click();
    await page.getByRole("menuitemradio", { name: "Tonight" }).click();
    await expect(page.locator(".date-pill")).toContainText("Tonight");
    // The live fixture is on tonight.
    await expect(page.locator(".card", { hasText: "E2E Live Night" })).toBeVisible();
    await expect(page.locator(".card", { hasText: "E2E Upcoming Night" })).toHaveCount(0);
    noProblems(problems);
  });

  test("scene filter narrows the feed and survives a reload", async ({ as, problems }) => {
    const page = await as(null);
    await page.goto("/");
    await page.locator(".date-pill").click();
    await page.getByRole("menuitemradio", { name: "Everything coming up" }).click();
    const all = await nights(page);
    await page.locator(".hs-filters").click();
    await page.getByRole("button", { name: "Queer", exact: true }).click();
    await page.getByRole("button", { name: /^Show \d+ events?$/ }).click();
    await expect(page.locator(".hs-filters")).toHaveAttribute("aria-label", /Filters, 1 on/);
    const queer = await nights(page);
    expect(queer).toBeLessThan(all);
    expect(queer).toBeGreaterThan(0);
    await page.reload();
    await expect(page.locator(".hs-filters")).toHaveAttribute("aria-label", /Filters, 1 on/);
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(page.locator(".hs-filters")).toHaveAttribute("aria-label", "Filters");
    noProblems(problems);
  });

  test("quick pick presets apply their filters", async ({ as, problems }) => {
    const page = await as(null);
    await page.goto("/");
    await page.locator(".hs-filters").click();
    await page.getByRole("button", { name: "Queer tonight" }).click();
    await page.getByRole("button", { name: /^Show \d+ events?$/ }).click();
    await expect(page.locator(".date-pill")).toContainText("Tonight");
    noProblems(problems);
  });
});

test.describe("Search", () => {
  test("results are grouped, and an artist opens its page", async ({ as, problems }) => {
    const page = await as(null);
    await page.goto("/");
    await page.locator(".hs-search").click();
    await page.getByRole("searchbox").fill("juno");
    await expect(page.getByRole("region", { name: "Artists" }).or(page.locator("section[aria-label=Artists]"))).toContainText("Juno Ray");
    await page.locator("section[aria-label=Artists] .search-item").first().click();
    await expect(page).toHaveURL(/\/a\/juno-ray/);
    await expect(page.getByText("Juno Ray").first()).toBeVisible();
    noProblems(problems);
  });

  test("an event result opens the event", async ({ as, problems }) => {
    const page = await as(null);
    await page.goto("/");
    await page.locator(".hs-search").click();
    await page.getByRole("searchbox").fill("E2E Live");
    await page.locator("section[aria-label=Events] .search-item").first().click();
    await expect(page.locator(".event-title")).toHaveText("E2E Live Night");
    noProblems(problems);
  });

  test("recent searches are kept and can be cleared", async ({ as, problems }) => {
    const page = await as(null);
    await page.goto("/");
    await page.locator(".hs-search").click();
    await page.getByRole("searchbox").fill("techno");
    await page.getByRole("searchbox").press("Enter");
    await page.locator(".hs-search").click();
    // The box reopens with the applied search; clearing it shows the recent list.
    await page.getByRole("button", { name: "Clear search" }).click();
    await expect(page.locator(".search-recent")).toContainText("techno");
    await page.getByRole("button", { name: "Clear", exact: true }).click();
    await expect(page.locator(".search-recent")).toHaveCount(0);
    noProblems(problems);
  });

  test("a long query doesn't break search", async ({ as, problems }) => {
    test.fail(true, "Known bug #2 in the regression report: remove this line when it's fixed.");
    const page = await as(null);
    await page.goto("/");
    await page.locator(".hs-search").click();
    await page.getByRole("searchbox").fill("the longest possible search for a warehouse party downtown");
    await expect(page.locator(".search-empty, .search-group").first()).toBeVisible();
    await expect(page.locator(".field-error")).toHaveCount(0);
    noProblems(problems);
  });
});

test.describe("Event page", () => {
  test("opens by link signed out, with title, time, venue and door", async ({ as, problems }) => {
    const page = await as(null);
    await openEvent(page, EV.upcoming);
    await expect(page.locator(".event-title")).toHaveText("E2E Upcoming Night");
    await expect(page.locator(".event-where")).toContainText("Pulp Warehouse");
    await expect(page.locator(".event-tags")).toContainText("$5");
    noProblems(problems);
  });

  test("opens from a feed card and closes back to the feed", async ({ as, problems }) => {
    const page = await as(null);
    await page.goto("/");
    await page.locator(".card", { hasText: "E2E Live Night" }).click();
    await expect(page.locator(".event-title")).toHaveText("E2E Live Night");
    await expect(page).toHaveURL(/\/e\/e2e-live/);
    await page.getByRole("button", { name: /close/i }).first().click();
    await expect(page.locator(".event-title")).toHaveCount(0);
    await expect(page.locator(".card:not(.card-skeleton)").first()).toBeVisible();
    noProblems(problems);
  });

  test("sections by phase", async ({ as, problems }) => {
    const page = await as("fanA");
    const ids = async () => page.locator(".ev-section-row").evaluateAll((els) => els.map((e) => e.id));
    await openEvent(page, EV.upcoming);
    expect((await ids())[0]).toBe("ev-details");
    await openEvent(page, EV.live);
    expect(await ids()).toEqual(expect.arrayContaining(["ev-here", "ev-wall", "ev-details", "ev-comments"]));
    expect((await ids())[0]).toBe("ev-here");
    await openEvent(page, EV.past);
    expect((await ids())[0]).toBe("ev-wall");
    await openEvent(page, EV.cancelled);
    await expect(page.locator(".cancelled-banner")).toBeVisible();
    noProblems(problems);
  });

  test("action bar shows the one action for each state", async ({ as, problems }) => {
    const page = await as("fanA");
    const bar = page.locator(".ev-bar-primary, .ev-bar-note").first();
    await openEvent(page, EV.upcoming);
    await expect(bar).toHaveText(/RSVP|Going/);
    await openEvent(page, EV.live);
    await expect(bar).toHaveText("Check in");
    await openEvent(page, EV.past);
    await expect(bar).toHaveText("See the wall");
    await openEvent(page, EV.cancelled);
    await expect(bar).toHaveText("Cancelled");
    noProblems(problems);
  });

  test("a photo-free night has no wall", async ({ as, problems }) => {
    const page = await as("fanA");
    await openEvent(page, EV.photoFree);
    await expect(page.locator("#ev-wall")).toHaveCount(0);
    noProblems(problems);
  });

  test("tickets and directions link out, and the calendar file downloads", async ({ as, problems }) => {
    const page = await as(null);
    await openEvent(page, EV.upcoming);
    await expect(page.locator(".ev-bar-tickets")).toHaveAttribute("href", "https://example.com/tickets/e2e-upcoming");
    await openSection(page, "details");
    await expect(page.getByRole("link", { name: /Google Maps/ })).toHaveAttribute("href", /google\.com\/maps/);
    const ics = page.getByRole("button", { name: /Calendar/ }).first();
    if (await ics.count()) {
      const [download] = await Promise.all([page.waitForEvent("download"), ics.click()]);
      expect(download.suggestedFilename()).toMatch(/\.ics$/);
    }
    noProblems(problems);
  });

  test("cards and pages show no reaction or comment counts on the feed card", async ({ as, problems }) => {
    const page = await as(null);
    await page.goto("/");
    await expect(page.locator(".card").first()).toBeVisible();
    await expect(page.locator(".card .reactions, .card .reaction")).toHaveCount(0);
    noProblems(problems);
  });
});
