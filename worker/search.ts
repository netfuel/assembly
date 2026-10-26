// GET /api/search?q=&city= : one box finds events, artists, and venues.
// Full-text search (FTS5, db/migrations/0004_search.sql) with prefix matching for type-ahead, ranked with
// live and upcoming events first. Falls back to a plain substring match when the index finds nothing
// (typos, partial words) or doesn't exist yet on a database that hasn't had the migration.
import { Hono } from "hono";
import type { AppContext, Env } from "./env";
import { EVENT_SELECT, toSummary, type EventRow } from "./events";
import { rateLimit } from "./posting";
import type { EventSummary, SearchPlace, SearchResults } from "../shared/types";

/** "Juno ray's" → `"juno"* "ray"*`: every word must appear, each as a prefix. Quotes stop FTS syntax from leaking in. */
export function ftsQuery(q: string): string | null {
  const words = q
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, 8);
  return words.length ? words.map((w) => `"${w}"*`).join(" ") : null;
}

interface Hit {
  kind: "event" | "artist" | "venue";
  ref_id: string;
  score: number;
}

async function ftsHits(env: Env, q: string, city: string): Promise<Hit[] | null> {
  const match = ftsQuery(q);
  if (!match) return [];
  try {
    const { results } = await env.DB.prepare(
      // Name matches weigh ten times the body (bm25 is lower-is-better).
      `SELECT kind, ref_id, bm25(search_index, 0, 0, 0, 10, 1) AS score FROM search_index
       WHERE search_index MATCH ?1 AND (city_id = ?2 OR city_id IS NULL) ORDER BY score LIMIT 120`,
    )
      .bind(match, city)
      .all<Hit>();
    return results;
  } catch (err) {
    // No index yet (migration not applied) or an unexpected query: the substring search still works.
    console.error("search index", err instanceof Error ? err.message : String(err));
    return null;
  }
}

async function likeHits(env: Env, q: string, city: string): Promise<Hit[]> {
  const like = `%${q.replace(/[%_\\]/g, (m) => `\\${m}`).slice(0, 60)}%`;
  const [ev, ar, ve] = await env.DB.batch<{ id: string }>([
    env.DB.prepare(
      `SELECT DISTINCT e.id FROM events e LEFT JOIN venues v ON v.id = e.venue_id
       LEFT JOIN lineup_slots ls ON ls.event_id = e.id LEFT JOIN artists a ON a.id = ls.artist_id
       WHERE e.city_id = ?2 AND e.status IN ('live', 'cancelled')
         AND (e.title LIKE ?1 ESCAPE '\\' OR v.name LIKE ?1 ESCAPE '\\' OR a.name LIKE ?1 ESCAPE '\\') LIMIT 80`,
    ).bind(like, city),
    env.DB.prepare(`SELECT id FROM artists WHERE name LIKE ?1 ESCAPE '\\' LIMIT 20`).bind(like),
    env.DB.prepare(`SELECT id FROM venues WHERE city_id = ?2 AND name LIKE ?1 ESCAPE '\\' LIMIT 20`).bind(like, city),
  ]);
  const map = (kind: Hit["kind"], rows: { id: string }[] | undefined) => (rows ?? []).map((r, i) => ({ kind, ref_id: r.id, score: i }));
  return [...map("event", ev.results), ...map("artist", ar.results), ...map("venue", ve.results)];
}

const inList = (n: number) => Array.from({ length: n }, () => "?").join(",");

export async function search(env: Env, q: string, city: string): Promise<SearchResults> {
  const trimmed = q.trim().slice(0, 80);
  const empty: SearchResults = { q: trimmed, events: [], artists: [], venues: [], eventIds: [] };
  if (trimmed.length < 2) return empty;
  let hits = await ftsHits(env, trimmed, city);
  if (!hits || hits.length === 0) hits = await likeHits(env, trimmed, city);
  if (!hits.length) return empty;

  const now = new Date().toISOString();
  const ids = (kind: Hit["kind"]) => hits!.filter((h) => h.kind === kind).map((h) => h.ref_id);
  const eventIds = ids("event");
  const artistIds = ids("artist").slice(0, 12);
  const venueIds = ids("venue").slice(0, 12);
  const score = new Map(hits.map((h) => [`${h.kind}:${h.ref_id}`, h.score]));

  // Upcoming events that match directly, plus every upcoming event by a matching artist or at a matching venue.
  const { results: rows } = await env.DB.prepare(
    `${EVENT_SELECT}
     WHERE e.city_id = ? AND e.status IN ('live', 'cancelled') AND e.ends_at > ?
       AND (e.id IN (${inList(eventIds.length || 1)})
         ${artistIds.length ? `OR e.id IN (SELECT event_id FROM lineup_slots WHERE artist_id IN (${inList(artistIds.length)}))` : ""}
         ${venueIds.length ? `OR e.venue_id IN (${inList(venueIds.length)})` : ""})
     ORDER BY e.starts_at LIMIT 300`,
  )
    .bind(city, now, ...(eventIds.length ? eventIds : [""]), ...artistIds, ...venueIds)
    .all<EventRow>();
  const all = rows.map(toSummary);
  const direct = new Set(eventIds);
  const nowMs = Date.now();
  const lowerQ = trimmed.toLowerCase();
  const rank = (e: EventSummary) => [
    Date.parse(e.startsAt) <= nowMs && Date.parse(e.endsAt) > nowMs && e.status !== "cancelled" ? 0 : 1, // live now
    e.title.toLowerCase() === lowerQ ? 0 : e.title.toLowerCase().startsWith(lowerQ) ? 1 : 2, // name match
    direct.has(e.id) ? 0 : 1, // matched itself, not only through an artist or venue
    score.get(`event:${e.id}`) ?? 0,
    -e.goingCount,
    Date.parse(e.startsAt),
  ];
  const cmp = (a: EventSummary, b: EventSummary) => {
    const ra = rank(a);
    const rb = rank(b);
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] - rb[i];
    return 0;
  };
  const events = all.filter((e) => direct.has(e.id)).sort(cmp).slice(0, 40);

  // Artists and venues with their upcoming count and next show.
  const places = async (kind: "artist" | "venue", list: string[]): Promise<SearchPlace[]> => {
    if (!list.length) return [];
    const sql =
      kind === "artist"
        ? `SELECT a.id, a.name, a.slug, NULL AS address, NULL AS neighborhood, NULL AS type FROM artists a WHERE a.id IN (${inList(list.length)})`
        : `SELECT v.id, v.name, COALESCE(v.slug, v.id) AS slug, v.address, v.neighborhood, v.type FROM venues v WHERE v.id IN (${inList(list.length)})`;
    // Before migration 0008 venues have no slug column: fall back to the id, which /v/<id> also finds.
    const { results } = await env.DB.prepare(sql)
      .bind(...list)
      .all<Pick<SearchPlace, "id" | "name" | "slug" | "address" | "neighborhood" | "type">>()
      .catch(() =>
        env.DB.prepare(sql.replace("COALESCE(v.slug, v.id) AS slug", "v.id AS slug"))
          .bind(...list)
          .all<Pick<SearchPlace, "id" | "name" | "slug" | "address" | "neighborhood" | "type">>(),
      );
    // Which upcoming events belong to each: lineup slots for artists, the venue column for venues.
    const belongs = new Map<string, Set<string>>();
    if (kind === "artist") {
      const { results: slots } = await env.DB.prepare(`SELECT artist_id, event_id FROM lineup_slots WHERE artist_id IN (${inList(list.length)})`)
        .bind(...list)
        .all<{ artist_id: string; event_id: string }>();
      for (const sl of slots) (belongs.get(sl.artist_id) ?? belongs.set(sl.artist_id, new Set()).get(sl.artist_id)!).add(sl.event_id);
    } else {
      for (const r of rows) if (r.venue_id) (belongs.get(r.venue_id) ?? belongs.set(r.venue_id, new Set()).get(r.venue_id)!).add(r.id);
    }
    return results
      .map((r) => {
        const mine = belongs.get(r.id) ?? new Set<string>();
        const upcoming = all.filter((e) => mine.has(e.id)); // already sorted by start
        const next = upcoming[0];
        return { ...r, upcoming: upcoming.length, next: next ? { id: next.id, title: next.title, startsAt: next.startsAt } : null };
      })
      .sort((a, b) => b.upcoming - a.upcoming || (score.get(`${kind}:${a.id}`) ?? 0) - (score.get(`${kind}:${b.id}`) ?? 0));
  };
  const [artists, venues] = await Promise.all([places("artist", artistIds), places("venue", venueIds)]);
  return { q: trimmed, events, artists: artists.slice(0, 8), venues: venues.slice(0, 8), eventIds: all.map((e) => e.id) };
}

export const searchRoute = new Hono<AppContext>();

searchRoute.get("/", async (c) => {
  const ip = c.req.header("CF-Connecting-IP") ?? "local";
  if (!(await rateLimit(c.env.SESSIONS, `search:${ip}`, 240, 600))) return c.json({ error: "Too many searches. Try again in a few minutes." }, 429);
  const q = c.req.query("q") ?? "";
  const city = c.req.query("city") ?? c.env.DEFAULT_CITY;
  const results = await search(c.env, q, city);
  // Zero-result searches are logged without anyone's details, to find missing artists and venues.
  if (q.trim().length >= 2 && !results.events.length && !results.artists.length && !results.venues.length) console.log("search: no results", { q: q.trim().slice(0, 80) });
  c.header("Cache-Control", "public, max-age=60");
  return c.json(results);
});
