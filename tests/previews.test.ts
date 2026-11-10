import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { og } from "../worker/og";
import { ogPages } from "../worker/ogPages";
import { imageSize } from "../worker/ogHead";
import type { Env } from "../worker/env";

// Runs the real preview routes (events, artists, venues, organizers, cities, scenes) against a SQLite database built
// from db/migrations, and checks the tags every link-unfurler reads. It cannot say how iMessage, WhatsApp, Discord,
// Slack, Signal or Facebook actually render a link: that needs their debuggers (see docs/link-previews.md).

const ORIGIN = "https://assembly.test";
const INDEX_HTML = readFileSync("index.html", "utf8");

/** Just enough of D1's API on node:sqlite. */
function d1(db: DatabaseSync) {
  const stmt = (sql: string, args: unknown[] = []) => ({
    bind: (...a: unknown[]) => stmt(sql, a),
    first: async () => (db.prepare(sql).get(...(args as never[])) as unknown) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...(args as never[])) as unknown[] }),
    run: async () => db.prepare(sql).run(...(args as never[])),
  });
  return { prepare: (sql: string) => stmt(sql) } as unknown as D1Database;
}

// A PNG header claiming 1600 x 900: all imageSize reads.
const bigPng = new Uint8Array(32);
bigPng.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
new DataView(bigPng.buffer).setUint32(16, 1600);
new DataView(bigPng.buffer).setUint32(20, 900);

let app: Hono<{ Bindings: Env }>;

beforeAll(() => {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync("db/migrations").sort()) db.exec(readFileSync(`db/migrations/${f}`, "utf8"));
  const soon = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
  db.exec(`
    INSERT OR IGNORE INTO cities (id, name, slug, timezone, center_lat, center_lng) VALUES ('memphis', 'Memphis', 'memphis', 'America/Chicago', 35.1, -90);
    INSERT INTO venues (id, city_id, name, slug, type, address, neighborhood, lat, lng, photo_key) VALUES
      ('v1', 'memphis', 'Room 9 "Below"', 'room-9', 'club', '1 Main St', 'Overton Square', 35.1, -90, 'pages/room9.png');
    INSERT INTO users (id, display_name, username, avatar_url) VALUES ('u1', 'Juno <Presents>', 'juno', 'https://lh3.googleusercontent.com/a/x');
    INSERT INTO artists (id, name, slug, bio, photo_key, city_id, updated_at) VALUES
      ('a1', 'Kitten Static', 'kitten-static', 'Warm house & disco.', 'pages/kitten.png', 'memphis', '2026-01-01T00:00:00Z'),
      ('a2', 'No Photo', 'no-photo', NULL, NULL, 'memphis', '2026-01-01T00:00:00Z');
    INSERT INTO events (id, city_id, venue_id, title, pitch, starts_at, ends_at, address, lat, lng, scenes, status, is_sample) VALUES
      ('e1', 'memphis', 'v1', 'Wet Paint', 'Queer house', '${soon(24)}', '${soon(29)}', '1 Main St', 35.1, -90, '["queer","house"]', 'live', 0),
      ('e2', 'memphis', 'v1', 'Secret', NULL, '${soon(48)}', '${soon(52)}', '1 Main St', 35.1, -90, '["techno"]', 'hidden', 0);
    INSERT INTO event_hosts (event_id, user_id, role) VALUES ('e1', 'u1', 'owner');
    INSERT INTO lineup_slots (event_id, artist_id, position) VALUES ('e1', 'a1', 0);
  `);
  const env = {
    DB: d1(db),
    ASSETS: { fetch: async () => new Response(INDEX_HTML, { headers: { "Content-Type": "text/html" } }) },
    MEDIA: { get: async (key: string) => (key === "pages/kitten.png" || key === "pages/room9.png" ? { arrayBuffer: async () => bigPng.buffer } : null) },
  } as unknown as Env;
  const root = new Hono<{ Bindings: Env }>();
  root.route("/e", og);
  root.route("/", ogPages);
  app = new Hono<{ Bindings: Env }>();
  app.all("*", (c) => root.fetch(c.req.raw, env));
});

const get = async (path: string) => {
  const res = await app.request(`${ORIGIN}${path}`);
  return { res, html: await res.text() };
};
const tag = (html: string, attr: string) => html.match(new RegExp(`<meta[^>]*(?:property|name)="${attr}"[^>]*content="([^"]*)"`))?.[1];
const link = (html: string, rel: string) => html.match(new RegExp(`<link[^>]*rel="${rel}"[^>]*href="([^"]*)"`))?.[1];
const robots = (html: string) => /<meta name="robots" content="noindex">/.test(html);

const PAGES: [string, string][] = [
  ["event", "/e/e1"],
  ["artist", "/a/kitten-static"],
  ["artist without a photo", "/a/no-photo"],
  ["venue", "/v/room-9"],
  ["organizer", "/o/juno"],
  ["city", "/c/memphis"],
  ["scene", "/c/memphis/queer"],
];

describe.each(PAGES)("%s page", (_name, path) => {
  it("has the required social tags with absolute https URLs", async () => {
    const { res, html } = await get(path);
    expect(res.status).toBe(200);
    for (const p of ["og:title", "og:description", "og:url", "og:image", "og:image:alt", "twitter:title", "twitter:description", "twitter:image"]) {
      expect(tag(html, p), p).toBeTruthy();
    }
    expect(tag(html, "twitter:card")).toBe("summary_large_image");
    for (const p of ["og:url", "og:image", "twitter:image"]) expect(tag(html, p), p).toMatch(/^https:\/\/assembly\.test\//);
    expect(link(html, "canonical")).toBe(`${ORIGIN}${path}`);
    expect(tag(html, "og:url")).toBe(`${ORIGIN}${path}`);
    expect(Number(tag(html, "og:image:width"))).toBeGreaterThanOrEqual(300);
    expect(Number(tag(html, "og:image:height"))).toBeGreaterThanOrEqual(157);
    expect(robots(html)).toBe(false);
    expect(res.headers.get("x-robots-tag")).toBeNull();
  });

  it("replaces the site defaults instead of adding to them, and escapes text", async () => {
    const { html } = await get(path);
    for (const p of ["og:title", "og:image", "twitter:card"]) expect(html.match(new RegExp(`(?:property|name)="${p}"`, "g"))).toHaveLength(1);
    expect(html.match(/rel="canonical"/g)).toHaveLength(1);
    expect(html.match(/<title>/g)).toHaveLength(1);
    expect(html).not.toContain("<Presents>");
  });
});

describe("what each page says", () => {
  it("gives every page type its own title", async () => {
    const titles = await Promise.all(PAGES.slice(0, 1).concat(PAGES.slice(1).filter((p) => p[0] !== "artist without a photo")).map(async ([, p]) => tag((await get(p)).html, "og:title")));
    expect(new Set(titles).size).toBe(titles.length);
    expect(titles).toContain("Underground music in Memphis");
    expect(titles).toContain("Queer in Memphis");
  });
  it("uses a photo's real size when it is big enough, else the designed 1200 x 630 image", async () => {
    const photo = (await get("/a/kitten-static")).html;
    expect(tag(photo, "og:image")).toBe(`${ORIGIN}/api/media/pages/kitten.png`);
    expect([tag(photo, "og:image:width"), tag(photo, "og:image:height")]).toEqual(["1600", "900"]);
    const designed = (await get("/a/no-photo")).html;
    expect(tag(designed, "og:image")).toBe(`${ORIGIN}/icons/og.png`);
    expect([tag(designed, "og:image:width"), tag(designed, "og:image:height")]).toEqual(["1200", "630"]);
    expect(tag((await get("/o/juno")).html, "og:image")).toContain("/api/og/e/e1.png");
  });
  it("names the next show on city and scene pages", async () => {
    expect(tag((await get("/c/memphis/queer")).html, "og:description")).toContain("Wet Paint");
    expect(tag((await get("/c/memphis/rave")).html, "og:description")).toContain("nothing posted yet");
  });
});

describe("hidden, deleted and unknown pages", () => {
  it.each(["/e/e2", "/e/nope", "/a/nope", "/v/nope", "/o/nope", "/c/atlantis", "/c/memphis/not-a-scene"])("%s is kept out of search", async (path) => {
    const { res, html } = await get(path);
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
    expect(robots(html)).toBe(true);
    expect(tag(html, "og:title")).toBe("Assembly"); // the site default, not leaked page data
    expect(html).not.toContain("Secret");
  });
});

describe("imageSize", () => {
  it("reads PNG, JPEG and WebP headers", () => {
    expect(imageSize(bigPng)).toEqual({ width: 1600, height: 900 });
    for (const f of ["png", "jpg", "webp"]) {
      const s = imageSize(new Uint8Array(readFileSync(`tests/fixtures/meta.${f}`)));
      expect(s?.width, f).toBeGreaterThan(0);
      expect(s?.height, f).toBeGreaterThan(0);
    }
    expect(imageSize(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});
