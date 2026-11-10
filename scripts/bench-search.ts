// Search latency benchmark: scales the demo data to a realistic Memphis volume in a THROWAWAY local D1, starts
// `wrangler dev` against it, and measures GET /api/search (p50, p95, p99) for prefix, typo, multiword, and
// city-filtered queries. Run: npm run bench:search   (see docs/search-benchmark.md)
//
// Local numbers, not production numbers: this is workerd + SQLite on your machine, with no network, no D1 edge
// replication and no cold starts. Use them to catch regressions (a missing index, a full scan), not as an SLA.
//
// Options (env): BENCH_EVENTS=4000 BENCH_ARTISTS=3000 BENCH_VENUES=400 BENCH_RUNS=60 BENCH_PORT=8799 BENCH_KEEP=1
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const N_EVENTS = Number(process.env.BENCH_EVENTS ?? 4000);
const N_ARTISTS = Number(process.env.BENCH_ARTISTS ?? 3000);
const N_VENUES = Number(process.env.BENCH_VENUES ?? 400);
const RUNS = Number(process.env.BENCH_RUNS ?? 60);
const PORT = Number(process.env.BENCH_PORT ?? 8799);
const BUDGET_MS = 300;

// Deterministic pseudo-random, so two runs measure the same data.
let s = 20260101;
const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const pick = <T>(a: readonly T[]) => a[Math.floor(rnd() * a.length)];
const q = (v: string) => `'${v.replace(/'/g, "''")}'`;

const A1 = ["Juno", "Kitten", "Mister", "Soft", "Gravel", "Dalia", "Form", "Tuff", "Petal", "Big", "Lou", "Neon", "Halle", "Wet", "Static", "Velvet", "Moth", "Pulp", "Lantern", "Cobalt", "Marrow", "Sable", "Violet", "Rust", "Tin", "Glass", "Hollow", "Quartz", "Delta", "Mud"];
const A2 = ["Ray", "Static", "Ozone", "Ditch", "Saints", "Vega", "Burn", "Debt", "Grip", "Aunt", "Pallet", "Three", "Gong", "Paint", "Annex", "House", "Room", "Ceiling", "Garden", "Signal", "Club", "Choir", "Engine", "Cartel", "Parade", "Bloom", "Tape", "Lodge", "Radio", "Fever"];
const V1 = ["Static", "Moth", "Velvet", "Room", "Pulp", "Low", "Green", "Lantern", "Crosstown", "Overton", "Broad", "Cooper", "Midtown", "Binghampton", "Harbor", "Orange", "Mound", "Soulsville", "Bluff", "Riverside"];
const V2 = ["Annex", "House", "Ditch", "Warehouse", "Ceiling", "Lot", "Room", "Hall", "Basement", "Garage", "Lounge", "Yard", "Loft", "Depot", "Social Club"];
const E1 = ["Wet Paint", "Moth House show", "Basement Sessions", "Night Shift", "Slow Burn", "Heat Lamp", "Loading Dock", "Pink Noise", "Low End Theory", "Sunday Service", "Dance Church", "Tape Hiss", "Boiler Room", "Hard Pause", "Afterglow", "Soft Launch", "Warehouse Rave", "Queer Prom", "Jungle Fever", "Disco Nap"];
const NEIGH = ["South Main", "Cooper-Young", "Midtown", "Overton Square", "Crosstown", "Downtown", "Binghampton", "Broad Ave", "Orange Mound", "Soulsville"];
const TYPES = ["diy", "warehouse", "bar", "club", "outdoor"] as const;
const SCENES = ["queer", "rave", "techno", "house", "bass", "diy", "live", "bar"];

function seedSql(): string {
  const out: string[] = [];
  const city = (id: string, name: string) =>
    out.push(`INSERT OR IGNORE INTO cities (id, name, slug, timezone, center_lat, center_lng, default_zoom) VALUES (${q(id)}, ${q(name)}, ${q(id)}, 'America/Chicago', 35.14, -90.01, 12);`);
  city("memphis", "Memphis");
  city("nashville", "Nashville");
  const cityOf = (i: number) => (i % 5 === 4 ? "nashville" : "memphis"); // 80% Memphis

  const venues: { id: string; city: string }[] = [];
  for (let i = 0; i < N_VENUES; i++) {
    const id = `bench-v${i}`;
    venues.push({ id, city: cityOf(i) });
    out.push(
      `INSERT INTO venues (id, city_id, name, slug, type, address, neighborhood, lat, lng) VALUES (${q(id)}, ${q(cityOf(i))}, ${q(`${pick(V1)} ${pick(V2)} ${i}`)}, ${q(id)}, ${q(pick(TYPES))}, ${q(`${100 + i} Bench St`)}, ${q(pick(NEIGH))}, ${35.1 + rnd() * 0.1}, ${-90.05 + rnd() * 0.1});`,
    );
  }
  const artists: string[] = [];
  for (let i = 0; i < N_ARTISTS; i++) {
    const id = `bench-a${i}`;
    artists.push(id);
    out.push(`INSERT INTO artists (id, name, slug, links) VALUES (${q(id)}, ${q(`${pick(A1)} ${pick(A2)}${i % 7 === 0 ? ` ${i}` : ""}`)}, ${q(id)}, '{}');`);
  }
  const hosts = 300;
  for (let i = 0; i < hosts; i++) out.push(`INSERT INTO users (id, display_name, username) VALUES (${q(`bench-u${i}`)}, ${q(`${pick(A1)} ${pick(A2)} Presents ${i}`)}, ${q(`bench-host-${i}`)});`);

  const day = 86400000;
  const now = Date.now();
  for (let i = 0; i < N_EVENTS; i++) {
    const c = cityOf(i);
    const vs = venues.filter((v) => v.city === c);
    const v = vs[i % vs.length];
    // 55% upcoming (next ~90 days), the rest past (up to a year back).
    const start = i % 100 < 55 ? now + rnd() * 90 * day : now - rnd() * 365 * day;
    const id = `bench-e${i}`;
    const status = i % 50 === 0 ? "cancelled" : i % 40 === 1 ? "hidden" : "live";
    out.push(
      `INSERT INTO events (id, city_id, venue_id, title, pitch, starts_at, ends_at, address, neighborhood, lat, lng, scenes, status, is_sample) VALUES (${q(id)}, ${q(c)}, ${q(v.id)}, ${q(`${pick(E1)} ${i}`)}, ${q(`${pick(SCENES)} night with ${pick(A1)} ${pick(A2)}`)}, ${q(new Date(start).toISOString())}, ${q(new Date(start + 5 * 3600000).toISOString())}, ${q(`${100 + i} Bench St`)}, ${q(pick(NEIGH))}, ${35.1 + rnd() * 0.1}, ${-90.05 + rnd() * 0.1}, ${q(JSON.stringify([pick(SCENES), pick(SCENES)]))}, ${q(status)}, 0);`,
    );
    out.push(`INSERT INTO event_hosts (event_id, user_id, role) VALUES (${q(id)}, ${q(`bench-u${i % hosts}`)}, 'owner');`);
    const n = 3 + (i % 3);
    const used = new Set<string>();
    for (let p = 0; p < n; p++) {
      const a = artists[Math.floor(rnd() * artists.length)];
      if (used.has(a)) continue;
      used.add(a);
      out.push(`INSERT INTO lineup_slots (event_id, artist_id, position) VALUES (${q(id)}, ${q(a)}, ${p});`);
    }
  }
  return out.join("\n");
}

const QUERIES: Record<string, { q: string; city?: string }[]> = {
  prefix: ["ju", "kit", "vel", "moth", "wet pa"].map((q) => ({ q })),
  typo: ["Junoo Ray", "Kiten Static", "Velvett Ditch", "wet pant", "basment sessions"].map((q) => ({ q })),
  multiword: ["juno ray", "velvet ditch warehouse", "queer night kitten", "low end theory", "basement sessions soft"].map((q) => ({ q })),
  "city-filtered": ["ju", "moth house", "queer", "night shift", "static annex"].map((q) => ({ q, city: "nashville" })),
};

const pct = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];

function run(cmd: string, args: string[], cwd: string) {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", maxBuffer: 1 << 29, stdio: ["ignore", "pipe", "pipe"] });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed:\n${r.stdout}\n${r.stderr}`);
}

async function main() {
  const root = join(import.meta.dirname, "..");
  const dir = mkdtempSync(join(tmpdir(), "assembly-bench-"));
  const persist = join(dir, "state");
  const sqlFile = join(dir, "seed.sql");
  const wr = (...a: string[]) => run("npx", ["wrangler", ...a], root);
  let server: ReturnType<typeof spawn> | null = null;
  try {
    console.log(`scratch state: ${persist} (the dev database is untouched)`);
    wr("d1", "migrations", "apply", "assembly", "--local", "--persist-to", persist);
    writeFileSync(sqlFile, seedSql());
    console.log(`seeding ${N_EVENTS} events, ${N_ARTISTS} artists, ${N_VENUES} venues...`);
    wr("d1", "execute", "assembly", "--local", "--persist-to", persist, "--file", sqlFile);
    if (process.env.BENCH_EXTRA_SQL) wr("d1", "execute", "assembly", "--local", "--persist-to", persist, "--file", process.env.BENCH_EXTRA_SQL);

    server = spawn("npx", ["wrangler", "dev", "--local", "--persist-to", persist, "--port", String(PORT), "--ip", "127.0.0.1"], { cwd: root, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let log = "";
    server.stdout?.on("data", (d) => (log += d));
    server.stderr?.on("data", (d) => (log += d));
    const base = `http://127.0.0.1:${PORT}`;
    for (let i = 0; ; i++) {
      if (i > 120) throw new Error(`wrangler dev did not start:\n${log}`);
      try {
        if ((await fetch(`${base}/api/health`)).ok) break;
      } catch {
        // not up yet
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    let ip = 0;
    // A fresh client address per request: the endpoint rate-limits per IP (240 per 10 minutes).
    const get = async (query: { q: string; city?: string }) => {
      const url = `${base}/api/search?q=${encodeURIComponent(query.q)}${query.city ? `&city=${query.city}` : ""}`;
      const t = performance.now();
      const res = await fetch(url, { headers: { "CF-Connecting-IP": `10.${(ip >> 16) & 255}.${(ip >> 8) & 255}.${ip++ & 255}` } });
      const body = (await res.json()) as { events?: unknown[]; artists?: unknown[]; venues?: unknown[] };
      const ms = performance.now() - t;
      if (!res.ok) throw new Error(`${url} -> ${res.status}`);
      return { ms, hits: (body.events?.length ?? 0) + (body.artists?.length ?? 0) + (body.venues?.length ?? 0) };
    };
    for (const list of Object.values(QUERIES)) for (const x of list) await get(x); // warm up

    const rows: string[] = [];
    const all: number[] = [];
    let worst = 0;
    for (const [kind, list] of Object.entries(QUERIES)) {
      const times: number[] = [];
      let hits = 0;
      for (let r = 0; r < RUNS; r++)
        for (const x of list) {
          const m = await get(x);
          times.push(m.ms);
          hits += m.hits;
        }
      const sorted = [...times].sort((a, b) => a - b);
      all.push(...times);
      worst = Math.max(worst, pct(sorted, 95));
      rows.push(`| ${kind} | ${times.length} | ${pct(sorted, 50).toFixed(1)} | ${pct(sorted, 95).toFixed(1)} | ${pct(sorted, 99).toFixed(1)} | ${sorted.at(-1)!.toFixed(1)} | ${(hits / times.length).toFixed(1)} |`);
    }
    const sortedAll = all.sort((a, b) => a - b);
    rows.push(`| **all** | ${all.length} | ${pct(sortedAll, 50).toFixed(1)} | ${pct(sortedAll, 95).toFixed(1)} | ${pct(sortedAll, 99).toFixed(1)} | ${sortedAll.at(-1)!.toFixed(1)} | |`);
    console.log(`\nGET /api/search, local wrangler dev, ${N_EVENTS} events / ${N_ARTISTS} artists / ${N_VENUES} venues (ms, client-side round trip)\n`);
    console.log("| query type | requests | p50 | p95 | p99 | max | avg hits |\n| --- | --- | --- | --- | --- | --- | --- |");
    console.log(rows.join("\n"));
    console.log(`\nBudget: p95 < ${BUDGET_MS} ms. Worst per-type p95: ${worst.toFixed(1)} ms. ${worst < BUDGET_MS ? "PASS" : "FAIL"} (local numbers, not production).`);
    process.exitCode = worst < BUDGET_MS ? 0 : 1;
  } finally {
    // npx starts wrangler, which starts workerd: stop the whole group or they outlive the script.
    if (server?.pid) try { process.kill(-server.pid, "SIGTERM"); } catch { /* already gone */ }
    if (!process.env.BENCH_KEEP) rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
