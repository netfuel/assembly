// Builds the Worker the way Cloudflare's deploy does (wrangler's bundler, not Vite) and calls it
// with stand-in bindings. Catches code that only works under Vite, like import.meta.env.
// Run before a release: npm run check:bundle
import { execSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const out = mkdtempSync(join(tmpdir(), "assembly-bundle-"));
execSync(`npx wrangler deploy --dry-run --outdir ${out}`, { stdio: ["ignore", "ignore", "inherit"] });
const mod = await import(join(out, "index.js"));
const kv = { get: async () => null, put: async () => {}, delete: async () => {} };
const stmt = { bind: () => stmt, first: async () => null, all: async () => ({ results: [] }), run: async () => ({ meta: {} }) };
const env = {
  SESSIONS: kv,
  DEFAULT_CITY: "memphis",
  DB: { prepare: () => stmt, batch: async () => [] },
  ASSETS: { fetch: async () => new Response("<html><head><title>x</title></head></html>", { headers: { "content-type": "text/html" } }) },
};
const ctx = { waitUntil() {}, passThroughOnException() {} };
let failed = false;
for (const path of ["/api/health", "/api/auth/providers", "/api/config", "/e/example"]) {
  const res = await mod.default.fetch(new Request(`https://assembly.rsvp${path}`), env, ctx);
  const csp = res.headers.has("content-security-policy");
  const ok = res.status < 500 && csp;
  if (!ok) failed = true;
  console.log(`${ok ? "ok  " : "FAIL"} ${path} ${res.status}${csp ? "" : " (no security headers)"}`);
}
process.exit(failed ? 1 : 0);
