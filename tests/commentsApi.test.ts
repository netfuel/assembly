import { beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { AppContext } from "../worker/env";
import { commentActions, commentModeration, eventComments } from "../worker/comments";
import { reactions } from "../worker/reactions";
import { featureGate } from "../worker/features";
import { fakeEnv } from "./helpers/fakeEnv";
import { COMMENT_MAX, type CommentThread } from "../shared/types";

// Users: org (hosts ev1), mod (moderator), ann and bob (regular). The test app trusts an x-user header for the session.
let ctx: ReturnType<typeof fakeEnv>;
function app() {
  const a = new Hono<AppContext>();
  a.use("*", async (c, next) => {
    c.set("userId", c.req.header("x-user") ?? null);
    await next();
  });
  a.use("*", featureGate);
  a.route("/events", reactions);
  a.route("/events", eventComments);
  a.route("/comments", commentActions);
  a.route("/", commentModeration);
  return a;
}
const call = (user: string | null, method: string, path: string, body?: unknown) =>
  app().request(path, {
    method,
    headers: { "content-type": "application/json", ...(user ? { "x-user": user } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, ctx.env);
const json = async <T = any>(r: Response) => (await r.json()) as T;
const post = (user: string | null, body: string, parentId?: string) => call(user, "POST", "/events/ev1/comments", { body, parentId });
const thread = async (user: string | null) => json<CommentThread>(await call(user, "GET", "/events/ev1/comments"));

beforeEach(() => {
  ctx = fakeEnv({ MODERATORS: "mod@example.com" });
  const q = ctx.sqlite;
  for (const u of ["org", "mod", "ann", "bob"]) q.prepare("INSERT INTO users (id, display_name) VALUES (?, ?)").run(u, u);
  q.prepare("INSERT INTO identities (user_id, provider, provider_subject, email) VALUES ('mod', 'email', 'mod', 'mod@example.com')").run();
  const city = (q.prepare("SELECT id FROM cities LIMIT 1").get() as { id: string }).id;
  q.prepare(
    "INSERT INTO events (id, city_id, title, starts_at, ends_at, address, lat, lng, status) VALUES ('ev1', ?, 'Night', '2030-01-01T02:00:00Z', '2030-01-01T06:00:00Z', '1 Main', 35.1, -90, 'live')",
  ).run(city);
  q.prepare("INSERT INTO event_hosts (event_id, user_id) VALUES ('ev1', 'org')").run();
});

describe("auth", () => {
  it("lets anyone read but needs a session to write", async () => {
    expect((await call(null, "GET", "/events/ev1/comments")).status).toBe(200);
    expect((await post(null, "hi")).status).toBe(401);
    expect((await call(null, "PATCH", "/comments/x", { body: "a" })).status).toBe(401);
    expect((await call(null, "DELETE", "/comments/x")).status).toBe(401);
    expect((await call(null, "POST", "/comments/x/report", { reason: "spam" })).status).toBe(401);
  });
  it("404s every comments route when the feature is off", async () => {
    ctx.env.FEATURES_OFF = "comments";
    expect((await call("ann", "GET", "/events/ev1/comments")).status).toBe(404);
    expect((await post("ann", "hi")).status).toBe(404);
    expect((await call("ann", "DELETE", "/comments/x")).status).toBe(404);
    expect((await call("mod", "GET", "/mod/comments")).status).toBe(404);
  });
});

describe("create and edit", () => {
  it("posts, enforces the length limit, and edits only your own", async () => {
    const r = await post("ann", "  hello  ");
    expect(r.status).toBe(201);
    const id = (await json(r)).comment.id;
    expect((await post("ann", "x".repeat(COMMENT_MAX + 1))).status).toBe(400);
    expect((await post("ann", "x".repeat(COMMENT_MAX))).status).toBe(201);
    expect((await call("bob", "PATCH", `/comments/${id}`, { body: "mine now" })).status).toBe(403);
    const e = await json<CommentThread>(await call("ann", "PATCH", `/comments/${id}`, { body: "edited" }));
    const c = e.comments.find((x) => x.id === id)!;
    expect(c.body).toBe("edited");
    expect(c.edited).toBe(true);
  });
  it("rate limits a user to 10 comments an hour", async () => {
    for (let i = 0; i < 10; i++) expect((await post("ann", `c${i}`)).status).toBe(201);
    expect((await post("ann", "one more")).status).toBe(429);
    expect((await post("bob", "me too")).status).toBe(201);
  });
});

describe("remove: permissions and placeholders", () => {
  const make = async (user: string, replyTo?: string) => (await json(await post(user, "text", replyTo))).comment.id as string;

  it("only the author, the organizer or a moderator can remove", async () => {
    const id = await make("ann");
    expect((await call("bob", "DELETE", `/comments/${id}`)).status).toBe(403);
    expect((await call("ann", "DELETE", `/comments/${id}`)).status).toBe(200);
  });
  it("stores who removed it and shows the right placeholder above replies", async () => {
    const byOrg = await make("ann");
    const byMod = await make("ann");
    const byAuthor = await make("ann");
    for (const id of [byOrg, byMod, byAuthor]) await make("bob", id);
    expect((await call("org", "DELETE", `/comments/${byOrg}`)).status).toBe(200);
    expect((await call("mod", "DELETE", `/comments/${byMod}`)).status).toBe(200);
    expect((await call("ann", "DELETE", `/comments/${byAuthor}`)).status).toBe(200);
    const t = await thread("bob");
    const by = (id: string) => t.comments.find((c) => c.id === id)!;
    expect(by(byOrg)).toMatchObject({ status: "removed", body: "", author: null, removedBy: "organizer" });
    expect(by(byMod)).toMatchObject({ status: "removed", removedBy: "moderator" });
    expect(by(byAuthor)).toMatchObject({ status: "removed", removedBy: "author" });
    expect(t.comments.filter((c) => c.parentId).length).toBe(3);
    // Soft delete: the row and its attribution stay in the database, the words don't.
    const row = ctx.sqlite.prepare("SELECT status, body, removed_by FROM comments WHERE id = ?").get(byOrg);
    expect(row).toMatchObject({ status: "removed", body: "", removed_by: "organizer" });
  });
  it("a removed comment without replies drops out, and can't be removed or edited again", async () => {
    const id = await make("ann");
    await call("org", "DELETE", `/comments/${id}`);
    expect((await thread("bob")).comments).toEqual([]);
    expect((await call("org", "DELETE", `/comments/${id}`)).status).toBe(404);
    expect((await call("ann", "PATCH", `/comments/${id}`, { body: "back" })).status).toBe(404);
  });
  it("marks canDelete for staff and the author only", async () => {
    const id = await make("ann");
    const can = async (u: string) => (await thread(u)).comments.find((c) => c.id === id)!.canDelete;
    expect([await can("ann"), await can("org"), await can("mod"), await can("bob")]).toEqual([true, true, true, false]);
  });
  it("the moderator queue is moderators only and records a moderator removal", async () => {
    const id = await make("ann");
    expect((await call("org", "GET", "/mod/comments")).status).toBe(403);
    expect((await call("org", "POST", `/mod/comments/${id}`, { action: "remove" })).status).toBe(403);
    expect((await call("mod", "POST", `/mod/comments/${id}`, { action: "remove" })).status).toBe(200);
    expect(ctx.sqlite.prepare("SELECT removed_by FROM comments WHERE id = ?").get(id)).toMatchObject({ removed_by: "moderator" });
  });
});

describe("reactions", () => {
  const react = (u: string | null, kind: string, on?: boolean) => call(u, "POST", "/events/ev1/react", { kind, on });
  it("needs a session, validates the kind, toggles, and honours the flag", async () => {
    expect((await react(null, "fire")).status).toBe(401);
    expect((await react("ann", "nope")).status).toBe(400);
    expect(await json(await react("ann", "fire"))).toEqual({ counts: { fire: 1 }, mine: ["fire"] });
    await react("ann", "fire");
    expect((await json(await react("bob", "fire"))).counts).toEqual({ fire: 2 });
    expect(await json(await react("ann", "fire", false))).toEqual({ counts: { fire: 1 }, mine: [] });
    ctx.env.FEATURES_OFF = "reactions";
    expect((await react("ann", "heart")).status).toBe(404);
  });
});
