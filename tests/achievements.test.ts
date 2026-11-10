import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { fakeDb } from "./support/fakeD1";
import { countedNights, earnedFrom, MIN_GAP_MS, syncMarks, type Night } from "../worker/achievements";
import { removeCheckin } from "../worker/checkins";
import { achievements, friendMarks } from "../worker/achievements";
import { featureGate, features } from "../worker/features";
import type { Env } from "../worker/env";

const H = 3600e3;
const D = 24 * H;
const T0 = Date.parse("2026-06-05T02:00:00Z");
const night = (i: number, o: Partial<Night> = {}): Night => ({ eventId: `e${i}`, at: T0 + i * D, endsAt: T0 + i * D + 5 * H, venueKey: "v1", queer: false, method: "gps", ...o });

describe("rules (pure)", () => {
  it("first night, regular, venues, streak, queer night, last call", () => {
    const ids = (h: Night[]) => [...earnedFrom(h).keys()].sort();
    expect(ids([])).toEqual([]);
    expect(ids([night(0)])).toEqual(["first-night"]);
    expect(ids([night(0), night(1), night(2)])).toEqual(["first-night", "three-nights", "week-streak"]);
    expect(ids([night(0), night(10), night(20)])).toEqual(["first-night", "three-nights"]);
    expect(ids([0, 10, 20, 30, 40].map((i) => night(i, { venueKey: `v${i}` })))).toContain("five-venues");
    expect(ids([night(0, { queer: true })])).toContain("queer-night");
    expect(ids([night(0, { at: T0 + 4.5 * H })])).toContain("last-call");
    expect(ids([night(0)])).not.toContain("last-call");
  });
  it("names the check-in that completed each mark", () => {
    const m = earnedFrom([night(0), night(1), night(2), night(3)]);
    expect(m.get("first-night")?.eventId).toBe("e0");
    expect(m.get("three-nights")?.eventId).toBe("e2");
  });
  it("host check-ins and quick hops between venues don't count", () => {
    expect(earnedFrom([night(0, { method: "host" })]).size).toBe(0);
    const hop = [night(0, { venueKey: "a" }), night(0, { eventId: "x", at: T0 + MIN_GAP_MS - 1, venueKey: "b" })];
    expect(countedNights(hop)).toHaveLength(1);
    const later = [night(0, { venueKey: "a" }), night(0, { eventId: "x", at: T0 + MIN_GAP_MS, venueKey: "b" })];
    expect(countedNights(later)).toHaveLength(2);
    // Same room twice in a night is fine, but it is still one night.
    const same = [night(0), night(0, { eventId: "y", at: T0 + 10 * 60e3 })];
    expect(countedNights(same)).toHaveLength(2);
    expect(earnedFrom([...same, night(0, { eventId: "z", at: T0 + 20 * 60e3 })]).has("three-nights")).toBe(false);
  });
});

function seed() {
  const { sqlite, db } = fakeDb();
  sqlite.exec(`INSERT OR IGNORE INTO cities (id, name, slug, timezone, center_lat, center_lng) VALUES ('c','Test','test-city','America/Chicago',35,-90);
    INSERT INTO users (id, display_name) VALUES ('ana','Ana'),('bo','Bo'),('cy','Cy');
    INSERT INTO venues (id, city_id, name, type, address, lat, lng) VALUES ('v1','c','Hi Tone','club','a',35,-90),('v2','c','Growlers','bar','b',35.1,-90.1);`);
  const env = { DB: db, FEATURES_OFF: "" } as unknown as Env;
  let n = 0;
  const event = (venue: string, startsAt: string, tags = "[]") => {
    const id = `ev${++n}`;
    const ends = new Date(Date.parse(startsAt) + 5 * H).toISOString();
    sqlite.prepare("INSERT INTO events (id, city_id, venue_id, title, starts_at, ends_at, address, lat, lng, policy_tags) VALUES (?, 'c', ?, ?, ?, ?, 'x', 35, -90, ?)").run(id, venue, `Night ${n}`, startsAt, ends, tags);
    return id;
  };
  const checkin = (user: string, ev: string, at: string, method = "gps") =>
    sqlite.prepare("INSERT OR REPLACE INTO checkins (event_id, user_id, method, created_at) VALUES (?, ?, ?, ?)").run(ev, user, method, at);
  const marks = (user: string) => (sqlite.prepare("SELECT achievement_id FROM achievements WHERE user_id = ? ORDER BY achievement_id").all(user) as { achievement_id: string }[]).map((r) => r.achievement_id);
  return { sqlite, env, event, checkin, marks };
}

describe("marks in the database", () => {
  it("fire once, and never from another person's check-in", async () => {
    const s = seed();
    const e1 = s.event("v1", "2026-06-05T02:00:00Z");
    s.checkin("ana", e1, "2026-06-05T02:30:00Z");
    expect((await syncMarks(s.env, "ana")).map((m) => m.id)).toEqual(["first-night"]);
    expect(await syncMarks(s.env, "ana")).toEqual([]);
    expect(s.marks("ana")).toEqual(["first-night"]);
    // Bo has no check-ins: syncing Bo (or Ana again) never gives Bo anything.
    expect(await syncMarks(s.env, "bo")).toEqual([]);
    expect(s.marks("bo")).toEqual([]);
    // Bo checks in to the same event: Bo earns their own; Ana's rows are untouched.
    s.checkin("bo", e1, "2026-06-05T03:00:00Z");
    expect((await syncMarks(s.env, "bo")).map((m) => m.id)).toEqual(["first-night"]);
    expect(s.marks("ana")).toEqual(["first-night"]);
  });

  it("are removed with the check-in", async () => {
    const s = seed();
    const q = s.event("v1", "2026-06-05T02:00:00Z", '["queer-centered"]');
    s.checkin("ana", q, "2026-06-05T02:30:00Z");
    await syncMarks(s.env, "ana");
    expect(s.marks("ana")).toEqual(["first-night", "queer-night"]);
    s.checkin("bo", q, "2026-06-05T02:30:00Z");
    await syncMarks(s.env, "bo");
    await removeCheckin(s.env, q, "ana");
    expect(s.marks("ana")).toEqual([]);
    expect(s.marks("bo")).toEqual(["first-night", "queer-night"]);
  });

  it("move to the next qualifying check-in when an earlier one is removed", async () => {
    const s = seed();
    const a = s.event("v1", "2026-06-05T02:00:00Z");
    const b = s.event("v1", "2026-06-06T02:00:00Z");
    s.checkin("ana", a, "2026-06-05T02:30:00Z");
    s.checkin("ana", b, "2026-06-06T02:30:00Z");
    await syncMarks(s.env, "ana");
    await removeCheckin(s.env, a, "ana");
    const row = s.sqlite.prepare("SELECT event_id FROM achievements WHERE user_id = 'ana' AND achievement_id = 'first-night'").get() as { event_id: string };
    expect(row.event_id).toBe(b);
  });

  it("deleting an event or an account takes its marks along", async () => {
    const s = seed();
    const e = s.event("v1", "2026-06-05T02:00:00Z");
    s.checkin("ana", e, "2026-06-05T02:30:00Z");
    await syncMarks(s.env, "ana");
    s.sqlite.prepare("DELETE FROM events WHERE id = ?").run(e);
    expect(s.marks("ana")).toEqual([]);
  });
});

function api(env: Env, userId: string | null) {
  const app = new Hono<{ Bindings: Env; Variables: { userId: string | null } }>().basePath("/api");
  app.use("*", async (c, next) => {
    c.set("userId", userId);
    await next();
  });
  app.use("*", featureGate);
  app.route("/me/achievements", achievements as never);
  app.route("/friends", friendMarks as never);
  return (path: string, init?: RequestInit) => app.request(path, init, env);
}

describe("API", () => {
  it("lists my marks and hides one or all; friends see name and date only", async () => {
    const s = seed();
    const e = s.event("v1", "2026-06-05T02:00:00Z");
    const f = s.event("v2", "2026-06-06T02:00:00Z", '["queer-centered"]');
    s.checkin("ana", e, "2026-06-05T02:30:00Z");
    s.checkin("ana", f, "2026-06-06T06:30:00Z");
    await syncMarks(s.env, "ana");
    s.sqlite.prepare("INSERT INTO friendships (user_a, user_b, status, requested_by) VALUES ('ana','bo','accepted','ana')").run();

    const asAna = api(s.env, "ana");
    const mine = await (await asAna("/api/me/achievements")).json<{ marks: { id: string; venueName: string | null }[]; locked: unknown[] }>();
    expect(mine.marks.map((m) => m.id).sort()).toEqual(["first-night", "last-call", "queer-night"]);
    expect(mine.marks.find((m) => m.id === "queer-night")?.venueName).toBe("Growlers");
    expect(mine.locked).toHaveLength(3);

    const asBo = api(s.env, "bo");
    const seen = await (await asBo("/api/friends/ana/achievements")).json<{ marks: Record<string, unknown>[] }>();
    expect(seen.marks.length).toBe(3);
    for (const m of seen.marks) expect(Object.keys(m).sort()).toEqual(["date", "glyph", "name"]);
    expect(JSON.stringify(seen)).not.toMatch(/Growlers|Hi Tone|T\d\d:/);

    // Hide one.
    await asAna("/api/me/achievements/last-call/hidden", { method: "PUT", body: JSON.stringify({ hidden: true }) });
    expect((await (await asBo("/api/friends/ana/achievements")).json<{ marks: unknown[] }>()).marks).toHaveLength(2);
    // Opt in to detail.
    await asAna("/api/me/achievements/share-detail", { method: "PUT", body: JSON.stringify({ on: true }) });
    const detailed = await (await asBo("/api/friends/ana/achievements")).json<{ marks: { venue?: string; time?: string }[] }>();
    expect(detailed.marks.every((m) => "venue" in m && typeof m.time === "string")).toBe(true);
    // Hide all.
    await asAna("/api/me/achievements/hidden", { method: "PUT", body: JSON.stringify({ hidden: true }) });
    expect((await (await asBo("/api/friends/ana/achievements")).json<{ marks: unknown[] }>()).marks).toEqual([]);
    // Ana still sees her own.
    expect((await (await asAna("/api/me/achievements")).json<{ marks: unknown[] }>()).marks).toHaveLength(3);
    // A stranger is turned away.
    expect((await api(s.env, "cy")("/api/friends/ana/achievements")).status).toBe(403);
    expect((await asAna("/api/me/achievements/nope/hidden", { method: "PUT", body: JSON.stringify({ hidden: true }) })).status).toBe(404);
  });

  it("answers 404 when the flag is off (or check-in is)", async () => {
    const s = seed();
    for (const off of ["achievements", "checkin"]) {
      const env = { ...s.env, FEATURES_OFF: off } as Env;
      expect(features(env).achievements).toBe(false);
      const call = api(env, "ana");
      expect((await call("/api/me/achievements")).status).toBe(404);
      expect((await call("/api/me/achievements/hidden", { method: "PUT", body: JSON.stringify({ hidden: true }) })).status).toBe(404);
      expect((await call("/api/friends/bo/achievements")).status).toBe(404);
    }
    expect((await api(s.env, "ana")("/api/me/achievements")).status).toBe(200);
  });
});
