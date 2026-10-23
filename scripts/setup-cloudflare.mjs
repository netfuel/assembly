// One-time Cloudflare setup for Assembly. Run with: npm run setup:cloudflare
// 1. Signs in to Cloudflare (opens the browser) if needed
// 2. Creates the D1 database, KV namespace, and R2 bucket, or reuses ones that already exist
// 3. Writes their IDs into wrangler.jsonc
// 4. Applies the database migrations to the remote database
// Safe to run again: existing resources are found and reused.
import { execSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const D1_NAME = "assembly";
const KV_TITLE = "assembly-sessions";
const R2_BUCKET = "assembly-media";
const CONFIG = new URL("../wrangler.jsonc", import.meta.url);

function run(cmd, { quiet = false } = {}) {
  return execSync(`npx wrangler ${cmd}`, { encoding: "utf8", stdio: quiet ? ["ignore", "pipe", "pipe"] : ["inherit", "pipe", "inherit"] });
}

function interactive(cmd) {
  const r = spawnSync("npx", ["wrangler", ...cmd.split(" ")], { stdio: "inherit" });
  if (r.status !== 0) throw new Error(`wrangler ${cmd} failed`);
}

/** wrangler prints banners before its JSON; take from the first [ or {. */
function parseJson(text) {
  const start = text.search(/[[{]/);
  if (start < 0) throw new Error(`Expected JSON from wrangler, got:\n${text}`);
  return JSON.parse(text.slice(start));
}

function step(msg) {
  console.log(`\n▸ ${msg}`);
}

// 1. Sign in
step("Checking your Cloudflare sign-in");
try {
  const who = run("whoami", { quiet: true });
  if (/not authenticated|You are not logged in/i.test(who)) throw new Error("signed out");
  console.log("Signed in.");
} catch {
  console.log("Opening the browser so you can sign in to Cloudflare…");
  interactive("login");
}

// 2a. D1
step(`D1 database "${D1_NAME}"`);
let db = parseJson(run("d1 list --json", { quiet: true })).find((d) => d.name === D1_NAME);
if (!db) {
  run(`d1 create ${D1_NAME}`);
  db = parseJson(run("d1 list --json", { quiet: true })).find((d) => d.name === D1_NAME);
}
if (!db?.uuid) throw new Error("Couldn't find the D1 database after creating it.");
console.log(`Using ${db.uuid}`);

// 2b. KV
step(`KV namespace "${KV_TITLE}"`);
let kv = parseJson(run("kv namespace list", { quiet: true })).find((n) => n.title === KV_TITLE);
if (!kv) {
  run(`kv namespace create ${KV_TITLE}`);
  kv = parseJson(run("kv namespace list", { quiet: true })).find((n) => n.title === KV_TITLE);
}
if (!kv?.id) throw new Error("Couldn't find the KV namespace after creating it.");
console.log(`Using ${kv.id}`);

// 2c. R2 (bucket names are the identifier; no ID to record)
step(`R2 bucket "${R2_BUCKET}"`);
try {
  run(`r2 bucket create ${R2_BUCKET}`, { quiet: true });
  console.log("Created.");
} catch (err) {
  const out = `${err.stdout ?? ""}${err.stderr ?? ""}`;
  if (/already exists|already own/i.test(out)) console.log("Already exists.");
  else if (/enable R2|R2 is not enabled|purchase/i.test(out)) {
    console.log("R2 isn't enabled on this account yet. Turn it on in the Cloudflare dashboard (R2 > Overview), then run this again.");
    process.exit(1);
  } else throw err;
}

// 3. Write IDs into wrangler.jsonc
step("Writing IDs into wrangler.jsonc");
let config = readFileSync(CONFIG, "utf8");
config = config.replace(/("database_id":\s*")[^"]*(")/, `$1${db.uuid}$2`);
config = config.replace(/("binding":\s*"SESSIONS",\s*"id":\s*")[^"]*(")/, `$1${kv.id}$2`);
writeFileSync(CONFIG, config);
console.log("Done.");

// 4. Migrations
step("Applying database migrations to the remote database");
interactive(`d1 migrations apply ${D1_NAME} --remote`);

// 5. Fonts (optional: only when they're present locally)
const fontFiles = ["TimelessSansVF.woff2", "TimelessSerifVF.woff2", "TimelessSerifItalicVF.woff2"];
if (fontFiles.every((f) => existsSync(new URL(`../public/fonts/timeless/${f}`, import.meta.url)))) {
  step("Uploading the Timeless fonts to R2");
  spawnSync("node", [fileURLToPath(new URL("./upload-fonts.mjs", import.meta.url))], { stdio: "inherit" });
} else {
  console.log("\nSkipping font upload: the Timeless files aren't in public/fonts/timeless/. Run npm run fonts:upload later.");
}

console.log(`
✓ Cloudflare is set up.
  Next: commit wrangler.jsonc (the IDs aren't secret) and push.
  Sign-in secrets are separate: see README, "Set up sign-in".`);
