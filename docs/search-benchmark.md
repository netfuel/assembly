# Search benchmark

Goal: `GET /api/search` answers in under 300 ms at the 95th percentile at Memphis data volume.

## Rerun it

```sh
npm run bench:search
```

`scripts/bench-search.ts` builds a throwaway local D1 in the OS temp folder (your dev database is not touched), applies
`db/migrations`, loads a scaled data set, starts `wrangler dev --local` on port 8799, fires prefix, typo, multiword and
city-filtered queries, prints p50, p95, p99 and max per query type, and exits non-zero if any type's p95 is 300 ms or more.

Defaults: 4,000 events (55% upcoming, 20% in a second city, some cancelled or hidden), 3,000 artists, 400 venues, 300
hosts, 3 to 5 lineup slots per event, 60 rounds of 5 queries per type. Override with `BENCH_EVENTS`, `BENCH_ARTISTS`,
`BENCH_VENUES`, `BENCH_RUNS`, `BENCH_PORT`; `BENCH_KEEP=1` keeps the scratch database for `EXPLAIN QUERY PLAN`;
`BENCH_EXTRA_SQL=file.sql` runs extra SQL (such as a candidate index) after seeding. The data is deterministic.

## Read the numbers correctly

These are local numbers: workerd and SQLite on one machine, no network, no D1 replication or cold starts, and a
client-side round trip over loopback. They catch regressions (a scan, a missing index). They are not production
numbers; check production with Workers Logs or a probe against the deployed Worker.

## Last run (Linux sandbox, 4,000 / 3,000 / 400)

| query type | p50 ms | p95 ms | p99 ms |
| --- | --- | --- | --- |
| prefix | 19.6 | 25.9 | 29.2 |
| typo | 23.4 | 31.8 | 43.3 |
| multiword | 15.1 | 21.0 | 26.1 |
| city-filtered | 13.2 | 19.2 | 22.9 |
| all | 17.5 | 27.4 | 33.8 |

Before migration 0014 the same run gave 20.5 / 29.8 / 36.2 (all queries). Typo queries return no hits: the fallback is a
substring match (`LIKE`), so "Kiten" does not find "Kitten". That is existing behavior; the benchmark measures its cost
(an FTS miss plus three substring scans).

## What the plans showed

- `lineup_slots` is keyed `(event_id, artist_id)`, so looking up slots by artist scanned the whole table. Fixed by
  `lineup_slots_artist` (migration 0014). Artist pages use the same lookup.
- `events.venue_id` had no index. Fixed by `events_venue` (migration 0014).
- Still scans by design: `LIKE '%x%'` over names (cannot use a b-tree index) is the fallback when FTS finds nothing.
  Fine at this volume; revisit with a trigram index if the fallback gets slow at much larger volume.
