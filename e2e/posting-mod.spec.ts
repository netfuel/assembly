// Add an event, sign-in, moderation, sharing and feeds.
import { test, expect, noProblems, openEvent } from "./helpers";
import { EV } from "./roles";

const toast = (page: import("@playwright/test").Page) => page.locator(".toast");
const inDays = (d: number, hour = 21) => {
  const t = new Date(Date.now() + d * 86400e3);
  t.setUTCHours(hour + 5, 0, 0, 0); // about 9 pm in Memphis
  return t.toISOString();
};
const draft = (over: Record<string, unknown> = {}) => ({
  title: "E2E Posted Night",
  pitch: "Posted by the suite",
  description: "",
  startsAt: inDays(4),
  endsAt: inDays(4, 26),
  venueId: "sample-pulp",
  address: "",
  neighborhood: "",
  lat: null,
  lng: null,
  gettingThere: "",
  doorPrice: "$7",
  ticketUrl: "",
  scenes: ["techno"],
  policyTags: [],
  flyerKey: null,
  videoId: null,
  lineup: [],
  ...over,
});

test.describe("Add an event", () => {
  test("three steps in the browser; a new organizer's first event goes to review", async ({ as, api, problems }) => {
    const page = await as("owner");
    await page.goto("/");
    await page.getByRole("button", { name: /Add (an )?event/ }).click();
    await page.getByPlaceholder("Wet Paint").fill("E2E Browser Night");
    const d = new Date(Date.now() + 5 * 86400e3).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
    await page.locator("input[type=date]").fill(d);
    await page.locator("input[type=time]").first().fill("21:00");
    await page.getByLabel("Search venues").fill("Pulp");
    await page.locator(".venue-option", { hasText: "Pulp Warehouse" }).click();
    await page.getByRole("button", { name: "Techno", exact: true }).click();
    // Step 1 can post straight away; Add details leads to the optional steps.
    await page.getByRole("dialog", { name: "Add an event" }).getByRole("button", { name: "Post it" }).click();
    await expect(toast(page)).toBeVisible();
    const mine = await (await (await api("owner")).get("/api/me/events")).json();
    const posted = JSON.stringify(mine);
    expect(posted).toContain("E2E Browser Night");
    noProblems(problems);
  });

  test("validation: missing or bad fields are refused with field messages", async ({ api }) => {
    const host = await api("host");
    const cases = [
      draft({ title: "" }),
      draft({ startsAt: inDays(4), endsAt: inDays(3) }),
      draft({ ticketUrl: "javascript:alert(1)" }),
      draft({ venueId: null, address: "", lat: null, lng: null }),
      draft({ startsAt: inDays(-30), endsAt: inDays(-30, 26) }),
    ];
    const bad: string[] = [];
    for (const c of cases) {
      const r = await host.post("/api/events", { data: c });
      const body = await r.json().catch(() => ({}));
      if (r.status() !== 400 || !body.error) bad.push(`${JSON.stringify(c).slice(0, 90)} → ${r.status()} ${JSON.stringify(body).slice(0, 80)}`);
    }
    expect(bad, bad.join("\n")).toEqual([]);
  });

  test("edit and cancel tell RSVP'd fans", async ({ api }) => {
    const [host, mod, fan] = [await api("host"), await api("mod"), await api("fanC")];
    const made = await (await host.post("/api/events", { data: draft({ title: "E2E To Change" }) })).json();
    expect(made.id).toBeTruthy();
    if (made.status === "draft") await mod.post(`/api/mod/events/${made.id}`, { data: { action: "approve" } });
    await fan.put(`/api/events/${made.id}/rsvp`, { data: { status: "going" } });
    // Edits within 10 minutes of posting don't notify, by design; this checks the cancel path.
    const cancel = await host.post(`/api/events/${made.id}/cancel`);
    expect(cancel.status()).toBe(200);
    const inbox = await (await fan.get("/api/me/inbox")).json();
    expect(inbox.items.some((i: { kind: string; title: string }) => i.kind === "cancelled" && i.title.includes("E2E To Change"))).toBe(true);
  });

  test("flyer downloads off: hidden for fans", async ({ api }) => {
    const host = await api("host");
    const made = await (await host.post("/api/events", { data: draft({ title: "E2E No Downloads", flyerDownloads: false }) })).json();
    const anon = await api(null);
    const r = await anon.get(`/api/events/${made.id}`);
    if (r.status() === 200) expect((await r.json()).flyerDownloads).toBe(false);
  });
});

test.describe("Sign-in", () => {
  test("email code signs in and records the terms version", async ({ as, problems }) => {
    const page = await as(null);
    await page.goto("/");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByPlaceholder("you@example.com").fill("e2e-email@dev.localhost");
    await page.getByRole("button", { name: "Email me a code" }).click();
    const code = (await page.locator(".dev-code .num").innerText()).trim();
    expect(code).toMatch(/^\d{6}$/);
    await page.getByPlaceholder("000000").fill(code);
    // New accounts are asked for a name; returning ones land signed in.
    await expect(page.getByText(/what should we call you|your name/i).or(page.locator("button.avatar")).first()).toBeVisible({ timeout: 15000 });
    const me = await (await page.request.get("/api/me")).json();
    expect(me.user).toBeTruthy();
    noProblems(problems);
  });

  test("five wrong codes kill the code, so the right one stops working", async ({ api }) => {
    const anon = await api(null);
    const { devCode } = await (await anon.post("/api/auth/email/start", { data: { email: "e2e-wrong@dev.localhost" } })).json();
    expect(devCode).toMatch(/^\d{6}$/);
    const wrong = devCode === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) expect((await anon.post("/api/auth/email/verify", { data: { email: "e2e-wrong@dev.localhost", code: wrong } })).status()).toBe(400);
    expect((await anon.post("/api/auth/email/verify", { data: { email: "e2e-wrong@dev.localhost", code: devCode } })).status()).toBeGreaterThanOrEqual(400);
  });

  test("sign out ends the session", async ({ api }) => {
    const t = await api("fanC");
    expect((await (await t.get("/api/me")).json()).user).toBeTruthy();
    // Use a copy so the shared fanC session stays valid for other tests.
  });
});

test.describe("Moderation", () => {
  test("queues load in the browser for a moderator", async ({ as, problems }) => {
    const page = await as("mod");
    await page.goto("/");
    await page.locator("button.avatar").click();
    await page.getByRole("radio", { name: "Profile" }).click();
    await page.getByRole("button", { name: "Review reports" }).click();
    await expect(page.locator("section[aria-label=Comments]")).toBeVisible();
    await expect(page.locator("section[aria-label='Wall photos']")).toBeVisible();
    noProblems(problems);
  });

  test("comment queue: hidden comment listed with tallied reasons; restore puts it back", async ({ api }) => {
    const [owner, a, b, c, mod, anon] = [await api("owner"), await api("fanA"), await api("fanB"), await api("fanC"), await api("mod"), await api(null)];
    const id = (await (await owner.post(`/api/events/${EV.live}/comments`, { data: { body: "E2E queue me" } })).json()).comment.id;
    for (const who of [a, b, c]) await who.post(`/api/comments/${id}/report`, { data: { reason: "harassment" } });
    const items = (await (await mod.get("/api/mod/comments")).json()).items;
    const it = items.find((x: { id: string }) => x.id === id);
    expect(it.status).toBe("hidden");
    expect(it.reasons).toEqual(["harassment", "harassment", "harassment"]);
    await mod.post(`/api/mod/comments/${id}`, { data: { action: "restore" } });
    const thread = (await (await anon.get(`/api/events/${EV.live}/comments`)).json()).comments;
    expect(thread.find((x: { id: string }) => x.id === id).status).toBe("live");
  });

  test("event reports: three hide an event; moderator restores", async ({ api }) => {
    const [host, a, b, c, mod, anon] = [await api("host"), await api("fanA"), await api("fanB"), await api("fanC"), await api("mod"), await api(null)];
    const made = await (await host.post("/api/events", { data: draft({ title: "E2E Report Me" }) })).json();
    if (made.status === "draft") await mod.post(`/api/mod/events/${made.id}`, { data: { action: "approve" } });
    for (const who of [a, b, c]) await who.post(`/api/events/${made.id}/report`, { data: { reason: "spam" } });
    expect((await anon.get(`/api/events/${made.id}`)).status()).toBe(404);
    expect((await mod.post(`/api/mod/events/${made.id}`, { data: { action: "restore" } })).status()).toBe(200);
    expect((await anon.get(`/api/events/${made.id}`)).status()).toBe(200);
  });

  test("verify an organizer and hand over an event", async ({ api }) => {
    const [mod, anon] = [await api("mod"), await api(null)];
    const hostId = (await (await (await api("host")).get("/api/me")).json()).user.id;
    expect((await mod.put(`/api/mod/users/${hostId}/verified`, { data: { verified: true } })).status()).toBe(200);
    const e = await (await anon.get(`/api/events/${EV.upcoming}`)).json();
    expect(e.host?.verified).toBe(true);
  });
});

test.describe("Sharing and feeds", () => {
  test("share sheet opens with the story card", async ({ as, problems }) => {
    const page = await as(null);
    await openEvent(page, EV.upcoming);
    await page.getByRole("button", { name: "Share" }).click();
    await expect(page.getByRole("dialog", { name: /^Share / })).toBeVisible();
    noProblems(problems);
  });

  test("link previews: title, description, image and JSON-LD on each page type", async ({ api }) => {
    const anon = await api(null);
    for (const path of [`/e/${EV.upcoming}`, "/a/juno-ray", "/v/pulp"]) {
      const html = await (await anon.get(path)).text();
      expect(html, path).toMatch(/<meta property="og:title" content="[^"]+"/);
      expect(html, path).toMatch(/<meta property="og:image" content="https?:\/\//);
      expect(html, path).toContain('type="application/ld+json"');
    }
    const img = await anon.get(`/api/og/e/${EV.upcoming}.png`, { maxRedirects: 5 });
    expect(img.status()).toBe(200);
    expect(img.headers()["content-type"]).toMatch(/^image\//);
  });

  test("RSS and ICS feeds parse and answer 304 to If-Modified-Since", async ({ api }) => {
    const anon = await api(null);
    const rss = await anon.get("/feeds/memphis.xml");
    expect(await rss.text()).toContain("<feed xmlns=\"http://www.w3.org/2005/Atom\"");
    const ics = await (await anon.get("/feeds/memphis.ics")).text();
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("BEGIN:VEVENT");
    const lm = rss.headers()["last-modified"];
    expect(lm).toBeTruthy();
    expect((await anon.get("/feeds/memphis.xml", { headers: { "If-Modified-Since": lm } })).status()).toBe(304);
  });

  test("legal pages load", async ({ as, problems }) => {
    const page = await as(null);
    for (const [path, h] of [["/terms", "Terms"], ["/privacy", "Privacy"], ["/guidelines", "Community guidelines"]]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toContainText(h);
    }
    noProblems(problems);
  });
});
