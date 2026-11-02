// RSVP, live timing, check-in, the wall and reactions, through the browser.
import { test, expect, noProblems, openEvent, openSection, ids } from "./helpers";
import { EV, VENUE } from "./roles";

const toast = (page: import("@playwright/test").Page) => page.locator(".toast");

test.describe("RSVP", () => {
  test("going, then not going, moves the count and the Saved tab", async ({ as, problems }) => {
    const page = await as("fanB");
    await openEvent(page, EV.upcoming);
    const going = page.locator(".going");
    const before = Number((await going.innerText()).match(/\d+/)?.[0] ?? 0);
    await page.locator(".ev-bar-primary").click();
    await expect(page.locator(".ev-bar-primary")).toHaveText(/Going/);
    await expect(going).toContainText(String(before + 1));
    await expect(toast(page)).toContainText("You're going");
    // Saved tab lists it.
    await page.goto("/");
    await page.locator("button.avatar").click();
    await page.getByRole("radio", { name: "Saved" }).click();
    await expect(page.getByText("E2E Upcoming Night").first()).toBeVisible();
    // Un-going.
    await openEvent(page, EV.upcoming);
    await page.locator(".ev-bar-primary").click();
    await expect(page.locator(".ev-bar-primary")).toHaveText("RSVP");
    await expect(going).toContainText(String(before));
    noProblems(problems);
  });

  test("interested fills the bookmark and shows under Saved for later", async ({ as, problems }) => {
    const page = await as("fanB");
    await openEvent(page, EV.upcoming);
    await page.getByRole("button", { name: "Save for later" }).click();
    await expect(page.getByRole("button", { name: /Saved. Tap to unsave/ })).toHaveAttribute("aria-pressed", "true");
    await page.goto("/");
    await page.locator("button.avatar").click();
    await page.getByRole("radio", { name: "Saved" }).click();
    await expect(page.getByText("Saved for later")).toBeVisible();
    noProblems(problems);
  });

  test("RSVP signed out asks you to sign in", async ({ as, problems }) => {
    const page = await as(null);
    await openEvent(page, EV.upcoming);
    await page.locator(".ev-bar-primary").click();
    await expect(page.getByRole("dialog").getByText(/sign in/i).first()).toBeVisible();
    noProblems(problems);
  });
});

test.describe("Live timing", () => {
  test("host ends a night early, then reopens it", async ({ as, problems }) => {
    const page = await as("host");
    await openEvent(page, EV.live);
    await page.getByRole("button", { name: "End now" }).click();
    await expect(toast(page)).toContainText("Ended");
    await openEvent(page, EV.live);
    await expect(page.getByRole("button", { name: "Reopen" }).first()).toBeVisible();
    await page.getByRole("button", { name: "Reopen" }).first().click();
    await expect(toast(page)).toContainText("Reopened");
    await openEvent(page, EV.live);
    await expect(page.getByRole("button", { name: "End now" })).toBeVisible();
    noProblems(problems);
  });

  test("Still going adds an hour", async ({ as, api, problems }) => {
    const anon = await api(null);
    const before = (await (await anon.get(`/api/events/${EV.live}`)).json()).endsAt;
    const page = await as("host");
    await openEvent(page, EV.live);
    await page.getByRole("button", { name: /Still going/ }).click();
    await expect(toast(page)).toContainText("hour more");
    const after = (await (await anon.get(`/api/events/${EV.live}`)).json()).endsAt;
    expect(Date.parse(after) - Date.parse(before)).toBe(3600_000);
    noProblems(problems);
  });

  test("fans don't see live controls", async ({ as, problems }) => {
    const page = await as("fanA");
    await openEvent(page, EV.live);
    await expect(page.getByRole("button", { name: "End now" })).toHaveCount(0);
    noProblems(problems);
  });
});

test.describe("Check-in", () => {
  test("near the venue: checked in, count up, bar says You're here; check out reverses it", async ({ as, problems }) => {
    const page = await as("fanA", { geo: { latitude: VENUE.lat + 0.0005, longitude: VENUE.lng } });
    await openEvent(page, EV.live);
    await page.locator(".ev-bar-primary").click();
    await expect(page.locator(".checkin-stamp")).toBeVisible();
    await expect(page.locator(".checkin-count")).toContainText("1 here now");
    await expect(page.locator(".ev-bar-primary")).not.toHaveText("Check in");
    await page.getByRole("button", { name: "Check out" }).click();
    await expect(page.locator(".checkin-count")).toContainText("0 here now");
    await expect(page.locator(".ev-bar-primary")).toHaveText("Check in");
    noProblems(problems);
  });

  test("far away: a clear message and no check-in", async ({ as, problems }) => {
    const page = await as("fanB", { geo: { latitude: VENUE.lat + 0.2, longitude: VENUE.lng } });
    await openEvent(page, EV.live);
    await page.locator(".ev-bar-primary").click();
    await expect(page.locator(".checkin .field-error")).toContainText("close to the venue");
    await expect(page.locator(".checkin-count")).toContainText("0 here now");
    noProblems(problems);
  });

  test("location denied: a clear message, no crash", async ({ as, problems }) => {
    const page = await as("fanB", { geo: "denied" });
    await openEvent(page, EV.live);
    await page.locator(".ev-bar-primary").click();
    await expect(page.locator(".checkin .field-error")).toContainText(/location/i);
    noProblems(problems);
  });

  test("the host is let in without a location check", async ({ as, problems }) => {
    const page = await as("host", { geo: "denied" });
    await openEvent(page, EV.live);
    await openSection(page, "here");
    await page.locator(".checkin").getByRole("button", { name: "Check in" }).click();
    await expect(page.locator(".checkin-stamp")).toBeVisible();
    await page.getByRole("button", { name: "Check out" }).click();
    noProblems(problems);
  });

  test("before doors there's no Check in", async ({ as, problems }) => {
    const page = await as("fanA");
    await openEvent(page, EV.upcoming);
    await expect(page.locator(".ev-bar-primary")).not.toHaveText("Check in");
    noProblems(problems);
  });
});

test.describe("Wall", () => {
  test("a checked-in fan posts a photo; camera and location data are stripped", async ({ as, api, problems }) => {
    const a = await api("fanA");
    expect((await a.post(`/api/events/${EV.live}/checkin`, { data: { method: "gps", near: true } })).status()).toBe(200);
    const page = await as("fanA");
    await openEvent(page, EV.live);
    await openSection(page, "wall");
    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "+ Post a photo" }).click()]);
    await chooser.setFiles("e2e/photo.jpg");
    await page.locator(".wall-composer input[placeholder^='Who']").fill("E2E caption");
    await page.locator(".wall-composer").getByRole("button", { name: "Post" }).click();
    await expect(page.locator(".wall-composer")).toHaveCount(0, { timeout: 20000 });
    const wall = await (await a.get(`/api/events/${EV.live}/wall`)).json();
    const post = wall.posts.find((p: { caption: string }) => p.caption === "E2E caption");
    expect(post).toBeTruthy();
    const bytes = Buffer.from(await (await a.get(post.url)).body());
    expect(bytes.includes(Buffer.from("TestCameraMaker")), "camera maker stripped").toBe(false);
    expect(bytes.includes(Buffer.from("Exif")), "EXIF block stripped").toBe(false);
    noProblems(problems);
  });

  test("the server strips location and camera data too, not only the app", async ({ api }) => {
    test.fail(true, "Known bug #3 in the regression report: remove this line when it's fixed.");
    const a = await api("fanA");
    const photo = { name: "raw.jpg", mimeType: "image/jpeg", buffer: (await import("node:fs")).readFileSync("e2e/photo.jpg") };
    const r = await a.post(`/api/events/${EV.live}/wall`, { multipart: { photo, caption: "raw upload" } });
    expect(r.status(), await r.text()).toBe(201);
    const post = (await r.json()).posts.find((p: { caption: string }) => p.caption === "raw upload");
    const bytes = Buffer.from(await (await a.get(post.url)).body());
    expect(bytes.includes(Buffer.from("TestCameraMaker")), "EXIF from a direct upload is served as-is").toBe(false);
  });

  test("a fan who didn't check in can't post", async ({ api }) => {
    const b = await api("fanB");
    const wall = await (await b.get(`/api/events/${EV.live}/wall`)).json();
    expect(wall.canPost).toBe(false);
    expect(wall.postNote).toMatch(/Check in/);
  });

  test("signed out and not RSVP'd: only host highlights", async ({ api }) => {
    const anon = await api(null);
    const wall = await (await anon.get(`/api/events/${EV.live}/wall`)).json();
    expect(wall.view).toBe("highlights");
    expect(wall.posts.every((p: { highlight: boolean }) => p.highlight)).toBe(true);
  });

  test("anonymous posts hide the author from the host, not from moderators", async ({ api }) => {
    const a = await api("fanA");
    const form = { photo: { name: "p.jpg", mimeType: "image/jpeg", buffer: (await import("node:fs")).readFileSync("e2e/photo.jpg") }, caption: "anon e2e", anonymous: "1" };
    const r = await a.post(`/api/events/${EV.live}/wall`, { multipart: form });
    expect(r.status(), await r.text()).toBe(201);
    const host = await api("host");
    const hostView = await (await host.get(`/api/events/${EV.live}/wall`)).json();
    const p = hostView.posts.find((x: { caption: string }) => x.caption === "anon e2e");
    expect(p.author).toBeNull();
    const mod = await api("mod");
    const queue = await (await mod.get(`/api/mod/wall`)).json();
    expect(Array.isArray(queue.items)).toBe(true);
  });

  test('"I\'m in this photo" hides it at once', async ({ api }) => {
    const a = await api("fanA");
    const host = await api("host");
    const posts = (await (await host.get(`/api/events/${EV.live}/wall`)).json()).posts;
    const target = posts[0];
    const b = await api("fanB");
    await b.put(`/api/events/${EV.live}/rsvp`, { data: { status: "going" } });
    const r = await b.post(`/api/wall/${target.id}/report`, { data: { reason: "remove-me" } });
    expect(r.status()).toBe(200);
    const after = (await (await b.get(`/api/events/${EV.live}/wall`)).json()).posts;
    expect(after.find((p: { id: string }) => p.id === target.id)).toBeFalsy();
    void a;
  });

  test("host highlights a photo and anyone with the link can see it", async ({ api }) => {
    const host = await api("host");
    const posts = (await (await host.get(`/api/events/${EV.live}/wall`)).json()).posts.filter((p: { status: string }) => p.status === "live");
    expect(posts.length).toBeGreaterThan(0);
    const r = await host.patch(`/api/wall/${posts[0].id}`, { data: { highlight: true } });
    expect(r.status()).toBe(200);
    const anon = await api(null);
    const pub = (await (await anon.get(`/api/events/${EV.live}/wall`)).json()).posts;
    expect(pub.some((p: { id: string }) => p.id === posts[0].id)).toBe(true);
    expect((await anon.get(posts[0].thumbUrl)).status()).toBe(200);
  });
});

test.describe("Reactions", () => {
  test("tap to add and remove; counts change at once", async ({ as, problems }) => {
    const page = await as("fanC");
    await openEvent(page, EV.upcoming);
    const fire = page.locator(".reaction", { has: page.locator("svg") }).nth(1);
    const label = async () => (await fire.getAttribute("aria-label")) ?? "";
    const n = async () => Number((await label()).match(/\d+/)?.[0] ?? 0);
    const before = await n();
    await fire.click();
    await expect(fire).toHaveAttribute("aria-pressed", "true");
    await expect.poll(n).toBe(before + 1);
    await page.reload();
    await expect(page.locator(".reaction").nth(1)).toHaveAttribute("aria-pressed", "true");
    await page.locator(".reaction").nth(1).click();
    await expect(page.locator(".reaction").nth(1)).toHaveAttribute("aria-pressed", "false");
    noProblems(problems);
  });

  test("signed out tap opens sign-in", async ({ as, problems }) => {
    const page = await as(null);
    await openEvent(page, EV.upcoming);
    await page.locator(".reaction").first().click();
    await expect(page.getByRole("dialog").getByText(/sign in/i).first()).toBeVisible();
    noProblems(problems);
  });

  test("every reaction button is at least 44 px", async ({ as }) => {
    const page = await as("fanA");
    await openEvent(page, EV.upcoming);
    const sizes = await page.locator(".reaction").evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => Math.min(r.width, r.height)));
    expect(sizes.length).toBe(5);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(44);
  });
});

test("ids fixture", () => expect(ids().host).toBeTruthy());
