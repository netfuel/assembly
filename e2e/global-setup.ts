// Runs after scripts/e2e-reset.mjs has made a fresh database (.wrangler/e2e: migrations + seed, times relative to now):
//   1. signs in each role once and saves its cookies to e2e/.auth/<role>.json,
//   2. adds e2e events that are upcoming, live, just past and cancelled, with the host role as host.
import { request } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { BASE, ROLES, type Role } from "./roles";

function sql(command: string) {
  execFileSync("npx", ["wrangler", "d1", "execute", "assembly", "--local", "--persist-to", ".wrangler/e2e", "--command", command], { stdio: "pipe" });
}

export default async function globalSetup() {
  mkdirSync("e2e/.auth", { recursive: true });
  const ids: Partial<Record<Role, string>> = {};
  for (const role of Object.keys(ROLES) as Role[]) {
    const ctx = await request.newContext({ baseURL: BASE });
    const r = await ctx.get(`/api/auth/dev?name=${encodeURIComponent(ROLES[role])}`, { maxRedirects: 0 });
    if (r.status() >= 400) throw new Error(`dev sign-in failed for ${role}: ${r.status()}. Is DEV_LOGIN=1 in .dev.vars?`);
    const me = await (await ctx.get("/api/me")).json();
    ids[role] = me.user.id;
    await ctx.storageState({ path: `e2e/.auth/${role}.json` });
    await ctx.dispose();
  }
  writeFileSync("e2e/.auth/ids.json", JSON.stringify(ids));

  // Events relative to now. Pulp Warehouse allows photos, so these have a wall.
  const ev = (id: string, title: string, start: string, end: string, status = "live") =>
    `INSERT INTO events (id, city_id, venue_id, title, pitch, starts_at, ends_at, address, neighborhood, lat, lng, door_price, ticket_url, policy_tags, scenes, status, is_sample)
     SELECT '${id}', 'memphis', v.id, '${title}', 'E2E fixture', strftime('%Y-%m-%dT%H:%M:%SZ','now','${start}'), strftime('%Y-%m-%dT%H:%M:%SZ','now','${end}'),
       v.address, v.neighborhood, v.lat, v.lng, '$5', 'https://example.com/tickets/${id}', '["18+"]', '["techno"]', '${status}', 0
     FROM venues v WHERE v.id = 'sample-pulp';`;
  sql(
    [
      // Safe to re-run without a reset.
      `DELETE FROM events WHERE id LIKE 'e2e-%';`,
      ev("e2e-live", "E2E Live Night", "-1 hours", "+3 hours"),
      ev("e2e-upcoming", "E2E Upcoming Night", "+2 days", "+2 days", "live"),
      ev("e2e-past", "E2E Past Night", "-6 hours", "-2 hours"),
      ev("e2e-cancelled", "E2E Cancelled Night", "+3 days", "+3 days", "cancelled"),
      `UPDATE events SET ends_at = strftime('%Y-%m-%dT%H:%M:%SZ', starts_at, '+5 hours') WHERE id IN ('e2e-upcoming', 'e2e-cancelled');`,
      ...["e2e-live", "e2e-upcoming", "e2e-past", "e2e-cancelled"].map((e) => `INSERT INTO event_hosts (event_id, user_id, role) VALUES ('${e}', '${ids.host}', 'owner');`),
      `INSERT INTO lineup_slots (event_id, artist_id, position) VALUES ('e2e-live', 'sample-juno-ray', 0), ('e2e-upcoming', 'sample-juno-ray', 0);`,
    ].join("\n"),
  );
}
