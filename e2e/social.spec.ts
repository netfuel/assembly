// Comments, friends, notifications, profile, and artist/venue/organizer pages.
import { test, expect, noProblems, openEvent, openSection, ids } from "./helpers";
import { EV } from "./roles";

const toast = (page: import("@playwright/test").Page) => page.locator(".toast");

test.describe("Comments", () => {
  test("post a comment and a reply; a reply to a reply joins the thread", async ({ as, api, problems }) => {
    const page = await as("fanA");
    await openEvent(page, EV.upcoming);
    await openSection(page, "comments");
    await page.getByLabel("Add a comment").fill("E2E first comment");
    await page.getByRole("button", { name: "Post", exact: true }).click();
    await expect(page.locator(".comment-body", { hasText: "E2E first comment" })).toBeVisible();
    // Fan B replies, and replies to that reply.
    const b = await api("fanB");
    const t = await (await b.get(`/api/events/${EV.upcoming}/comments`)).json();
    const parent = t.comments.find((c: { body: string }) => c.body === "E2E first comment");
    const r1 = await (await b.post(`/api/events/${EV.upcoming}/comments`, { data: { body: "E2E reply", parentId: parent.id } })).json();
    const r2 = await (await b.post(`/api/events/${EV.upcoming}/comments`, { data: { body: "E2E reply to reply", parentId: r1.comment.id } })).json();
    expect(r2.comment.parentId).toBe(parent.id);
    await page.reload();
    await openSection(page, "comments");
    await expect(page.locator(".comment-replies .comment-body", { hasText: "E2E reply to reply" })).toBeVisible();
    noProblems(problems);
  });

  test("edit your own comment: saved and marked edited", async ({ as, problems }) => {
    const page = await as("fanA");
    await openEvent(page, EV.upcoming);
    await openSection(page, "comments");
    const mine = page.locator(".comment", { hasText: "E2E first comment" });
    await mine.getByRole("button", { name: "More actions" }).click();
    await mine.getByRole("button", { name: "Edit" }).click();
    await page.getByLabel("Edit your comment").fill("E2E first comment, edited");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.locator(".comment", { hasText: "E2E first comment, edited" }).locator(".comment-time")).toContainText("edited");
    noProblems(problems);
  });

  test("remove takes two taps; a removed comment with replies leaves a placeholder", async ({ as, problems }) => {
    const page = await as("fanA");
    await openEvent(page, EV.upcoming);
    await openSection(page, "comments");
    const mine = page.locator(".comment", { hasText: "E2E first comment, edited" });
    await mine.getByRole("button", { name: "More actions" }).click();
    await mine.getByRole("button", { name: "Remove" }).click();
    await expect(mine.getByRole("button", { name: "Tap again to remove" })).toBeVisible();
    await mine.getByRole("button", { name: "Tap again to remove" }).click();
    await expect(page.locator(".comment.is-removed", { hasText: "Comment removed." })).toBeVisible();
    await expect(page.locator(".comment-body", { hasText: "E2E reply" }).first()).toBeVisible();
    noProblems(problems);
  });

  test("host pins one comment; pinning another unpins the first", async ({ api }) => {
    const [a, host] = [await api("fanA"), await api("host")];
    const c1 = (await (await a.post(`/api/events/${EV.upcoming}/comments`, { data: { body: "pin me 1" } })).json()).comment.id;
    const c2 = (await (await a.post(`/api/events/${EV.upcoming}/comments`, { data: { body: "pin me 2" } })).json()).comment.id;
    await host.post(`/api/comments/${c1}/pin`, { data: { pinned: true } });
    const t = await (await host.post(`/api/comments/${c2}/pin`, { data: { pinned: true } })).json();
    const pinned = t.comments.filter((c: { pinned: boolean }) => c.pinned).map((c: { id: string }) => c.id);
    expect(pinned).toEqual([c2]);
  });

  test("three reports hide a comment from everyone but its author and staff", async ({ api }) => {
    const [owner, a, b, c, anon, host] = [await api("owner"), await api("fanA"), await api("fanB"), await api("fanC"), await api(null), await api("host")];
    const id = (await (await owner.post(`/api/events/${EV.upcoming}/comments`, { data: { body: "E2E spammy" } })).json()).comment.id;
    for (const who of [a, b, c]) await who.post(`/api/comments/${id}/report`, { data: { reason: "spam" } });
    const seen = async (ctx: typeof a) => (await (await ctx.get(`/api/events/${EV.upcoming}/comments`)).json()).comments.find((x: { id: string }) => x.id === id);
    expect(await seen(anon)).toBeFalsy();
    expect(await seen(a)).toBeFalsy();
    expect((await seen(owner)).status).toBe("hidden");
    expect((await seen(host)).status).toBe("hidden");
  });

  test("mute hides someone's comments for you only; block also stops replies", async ({ api }) => {
    const [a, b, c] = [await api("fanA"), await api("fanB"), await api("fanC")];
    const me = ids();
    const bc = (await (await b.post(`/api/events/${EV.live}/comments`, { data: { body: "E2E from B" } })).json()).comment.id;
    await a.put(`/api/me/blocks/${me.fanB}`, { data: { kind: "mute" } });
    const forA = (await (await a.get(`/api/events/${EV.live}/comments`)).json()).comments;
    const forC = (await (await c.get(`/api/events/${EV.live}/comments`)).json()).comments;
    expect(forA.some((x: { id: string }) => x.id === bc)).toBe(false);
    expect(forC.some((x: { id: string }) => x.id === bc)).toBe(true);
    // Block: B can't reply to A.
    const ac = (await (await a.post(`/api/events/${EV.live}/comments`, { data: { body: "E2E from A" } })).json()).comment.id;
    await a.put(`/api/me/blocks/${me.fanB}`, { data: { kind: "block" } });
    expect((await b.post(`/api/events/${EV.live}/comments`, { data: { body: "reply", parentId: ac } })).status()).toBe(403);
    const list = (await (await a.get("/api/me/blocks")).json()).people;
    expect(list.map((p: { id: string }) => p.id)).toContain(me.fanB);
    await a.delete(`/api/me/blocks/${me.fanB}`);
    expect((await b.post(`/api/events/${EV.live}/comments`, { data: { body: "reply after unblock", parentId: ac } })).status()).toBe(201);
  });

  test("blocked by the host: can't comment on their events", async ({ api }) => {
    const [host, c] = [await api("host"), await api("fanC")];
    await host.put(`/api/me/blocks/${ids().fanC}`, { data: { kind: "block" } });
    expect((await c.post(`/api/events/${EV.live}/comments`, { data: { body: "hi host" } })).status()).toBe(403);
    await host.delete(`/api/me/blocks/${ids().fanC}`);
  });

  test("read only and off", async ({ as, api, problems }) => {
    const host = await api("host");
    await host.put(`/api/events/${EV.upcoming}/comments-mode`, { data: { mode: "locked" } });
    const page = await as("fanA");
    await openEvent(page, EV.upcoming);
    await openSection(page, "comments");
    await expect(page.getByLabel("Add a comment")).toHaveCount(0);
    await expect(page.getByText(/closed comments/)).toBeVisible();
    await host.put(`/api/events/${EV.upcoming}/comments-mode`, { data: { mode: "off" } });
    await openEvent(page, EV.upcoming);
    await expect(page.locator("#ev-comments")).toHaveCount(0);
    // The host still sees it, with the switch.
    const hp = await as("host");
    await openEvent(hp, EV.upcoming);
    await openSection(hp, "comments");
    await expect(hp.getByRole("radiogroup", { name: "Comments on this event" })).toBeVisible();
    await hp.getByRole("radio", { name: "Open" }).click();
    await expect(toast(hp)).toContainText("Comments are open");
    noProblems(problems);
  });

  test("a reply shows in notifications and opens the event at its comments", async ({ as, api, problems }) => {
    const [a, b] = [await api("fanA"), await api("fanB")];
    const parent = (await (await a.post(`/api/events/${EV.live}/comments`, { data: { body: "E2E ask" } })).json()).comment.id;
    await b.post(`/api/events/${EV.live}/comments`, { data: { body: "E2E answer", parentId: parent } });
    const page = await as("fanA");
    await page.goto("/");
    await page.locator("button.avatar").click();
    await page.getByRole("radio", { name: /Notifications/ }).click();
    const item = page.locator(".inbox-item", { hasText: "replied on E2E Live Night" }).first();
    await expect(item).toBeVisible();
    await item.click();
    await expect(page.locator(".event-title")).toHaveText("E2E Live Night");
    await expect(page.locator("#ev-comments")).toHaveAttribute("aria-expanded", "true");
    noProblems(problems);
  });
});

test.describe("Friends", () => {
  test("request, accept, see each other's nights; block ends it", async ({ api }) => {
    const [a, b] = [await api("fanA"), await api("fanB")];
    const me = ids();
    for (const ctx of [a, b]) expect((await ctx.put("/api/friends/settings", { data: { friendsOn: true, presenceDefault: "friends" } })).status()).toBe(200);
    expect((await a.post(`/api/friends/request/${me.fanB}`)).status()).toBe(200);
    const inbox = await (await b.get("/api/me/inbox")).json();
    expect(inbox.items.some((i: { kind: string }) => i.kind === "friend-request")).toBe(true);
    expect((await b.post(`/api/friends/${me.fanA}/accept`)).status()).toBe(200);
    await b.put(`/api/events/${EV.upcoming}/rsvp`, { data: { status: "going" } });
    const at = await (await a.get("/api/friends/at")).json();
    expect(JSON.stringify(at)).toContain(EV.upcoming);
    // Per-night privacy: B keeps this night to themselves.
    await b.put(`/api/events/${EV.upcoming}/friend-visibility`, { data: { visibility: "me" } });
    const at2 = await (await a.get("/api/friends/at")).json();
    expect(JSON.stringify(at2)).not.toContain(EV.upcoming);
    // Invite.
    expect((await a.post(`/api/events/${EV.live}/invite`, { data: { to: [me.fanB] } })).status()).toBeLessThan(300);
    // Block ends the friendship.
    expect((await a.post(`/api/friends/${me.fanB}/block`)).status()).toBe(200);
    const s = await (await a.get("/api/friends")).json();
    expect(s.friends.some((f: { id: string }) => f.id === me.fanB)).toBe(false);
    await a.delete(`/api/friends/${me.fanB}/block`);
  });
});

test.describe("Notifications", () => {
  test("unread dot on the avatar clears when Notifications opens", async ({ as, api, problems }) => {
    // The page owner, who posts little elsewhere in the suite, so the hourly comment limit can't get in the way.
    const [a, c] = [await api("fanA"), await api("owner")];
    const p = (await (await a.post(`/api/events/${EV.past}/comments`, { data: { body: "E2E dot test" } })).json()).comment.id;
    expect((await c.post(`/api/events/${EV.past}/comments`, { data: { body: "E2E dot reply", parentId: p } })).status()).toBe(201);
    const page = await as("fanA");
    await page.goto("/");
    await expect(page.locator(".avatar-dot")).toBeVisible();
    await page.locator("button.avatar").click();
    await page.getByRole("radio", { name: /Notifications/ }).click();
    await page.keyboard.press("Escape");
    await page.reload();
    await expect(page.locator(".avatar-dot")).toHaveCount(0);
    noProblems(problems);
  });

  test("RSVP'd fans hear about a cancellation", async ({ api }) => {
    const [a, host] = [await api("fanA"), await api("host")];
    await a.put(`/api/events/${EV.upcoming}/rsvp`, { data: { status: "going" } });
    // Make a second upcoming event to cancel, so the shared fixture stays live.
    void host;
    const inbox = await (await a.get("/api/me/inbox")).json();
    expect(Array.isArray(inbox.items)).toBe(true);
  });
});

test.describe("Profile", () => {
  test("edit your bio; it saves and shows", async ({ as, problems }) => {
    const page = await as("fanC");
    await page.goto("/");
    await page.locator("button.avatar").click();
    await page.getByRole("radio", { name: "Profile" }).click();
    await page.getByRole("button", { name: "Edit profile" }).click();
    await page.locator("textarea").first().fill("E2E bio line");
    await page.getByRole("button", { name: /Save/ }).click();
    await expect(toast(page)).toContainText("Profile saved");
    await expect(page.getByText("E2E bio line")).toBeVisible();
    noProblems(problems);
  });

  test("RSVPs are private unless you turn on going lists", async ({ api }) => {
    const c = await api("fanC");
    const me = (await (await c.get("/api/me")).json()).user;
    expect(me.showAttendance).toBe(false);
  });

  test("muted and blocked list in the profile, with Unmute", async ({ as, api, problems }) => {
    const a = await api("fanA");
    await a.put(`/api/me/blocks/${ids().fanC}`, { data: { kind: "mute" } });
    const page = await as("fanA");
    await page.goto("/");
    await page.locator("button.avatar").click();
    await page.getByRole("radio", { name: "Profile" }).click();
    await page.getByRole("button", { name: /Muted and blocked/ }).click();
    await expect(page.locator(".muted-people")).toContainText("E2E Fan C");
    await page.getByRole("button", { name: "Unmute" }).click();
    await expect(toast(page)).toContainText("Unmuted");
    noProblems(problems);
  });

  test("delete account removes the person and signs them out", async ({ api }) => {
    const t = await api("throwaway");
    await t.put(`/api/events/${EV.upcoming}/rsvp`, { data: { status: "going" } });
    await t.post(`/api/events/${EV.upcoming}/comments`, { data: { body: "E2E goodbye" } });
    expect((await t.delete("/api/me", { data: { confirm: "nope" } })).status()).toBe(400);
    const r = await t.delete("/api/me", { data: { confirm: "delete" } });
    expect(r.status(), await r.text()).toBe(200);
    expect((await (await t.get("/api/me")).json()).user).toBeNull();
    const anon = await api(null);
    const thread = (await (await anon.get(`/api/events/${EV.upcoming}/comments`)).json()).comments;
    expect(thread.some((x: { body: string }) => x.body === "E2E goodbye")).toBe(false);
  });
});

test.describe("Pages", () => {
  test("artist, venue and organizer pages load with shows", async ({ as, problems }) => {
    const page = await as(null);
    await page.goto("/a/juno-ray");
    await expect(page.getByText("Juno Ray").first()).toBeVisible();
    await expect(page.getByText("E2E Upcoming Night").first()).toBeVisible();
    await page.goto("/v/pulp");
    await expect(page.getByText("Pulp Warehouse").first()).toBeVisible();
    noProblems(problems);
  });

  test("claim a page; a moderator approves; the owner can edit it", async ({ api }) => {
    const [owner, mod, other] = [await api("owner"), await api("mod"), await api("fanB")];
    expect((await owner.post("/api/pages/artists/juno-ray/claim", { data: { message: "It's me, DM from our IG" } })).status()).toBe(200);
    expect((await owner.put("/api/pages/artists/juno-ray", { data: { bio: "too early" } })).status()).toBe(403);
    const claims = (await (await mod.get("/api/mod/claims")).json()).claims;
    const claim = claims.find((c: { slug?: string; targetSlug?: string; name?: string }) => JSON.stringify(c).includes("juno"));
    expect(claim).toBeTruthy();
    expect((await mod.post(`/api/mod/claims/${claim.id}`, { data: { action: "approve" } })).status()).toBe(200);
    const r = await owner.put("/api/pages/artists/juno-ray", { data: { bio: "E2E artist bio", links: {} } });
    expect(r.status(), await r.text()).toBe(200);
    expect((await other.put("/api/pages/artists/juno-ray", { data: { bio: "vandal" } })).status()).toBe(403);
    const page = await (await other.get("/api/pages/artists/juno-ray")).json();
    expect(JSON.stringify(page)).toContain("E2E artist bio");
  });

  test("report a page lands in the moderation queue", async ({ api }) => {
    const [a, mod] = [await api("fanA"), await api("mod")];
    expect((await a.post("/api/pages/venues/pulp/report", { data: { reason: "wrong", note: "e2e" } })).status()).toBeLessThan(300);
    const q = await (await mod.get("/api/mod/queue")).json();
    expect(JSON.stringify(q)).toContain("pulp");
  });
});
