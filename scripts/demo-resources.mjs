#!/usr/bin/env node
// Resources for demo.assembly.rsvp, safe to run on every deploy.
//
//   node scripts/demo-resources.mjs provision   finds or creates the demo D1 database, KV namespace and R2
//                                               bucket, and writes their ids into wrangler.jsonc (env.demo)
//   node scripts/demo-resources.mjs domain      attaches demo.assembly.rsvp to the assembly-demo Worker
//
// Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID (the same secrets the production deploy uses).
import { readFileSync, writeFileSync } from "node:fs";

const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
const D1_NAME = "assembly-demo";
const KV_TITLE = "assembly-demo-sessions";
const BUCKET = "assembly-demo-media";
const WORKER = "assembly-demo";
const HOST = "demo.assembly.rsvp";
const ZONE = "assembly.rsvp";

if (!TOKEN || !ACCOUNT) {
  console.error("Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID.");
  process.exit(1);
}

async function cf(method, path, body) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!json.success) throw new Error(`${method} ${path}: ${res.status} ${JSON.stringify(json.errors ?? json)}`);
  return json.result;
}

const acct = `/accounts/${ACCOUNT}`;

async function provision() {
  const dbs = await cf("GET", `${acct}/d1/database?name=${D1_NAME}`);
  const db = dbs.find((d) => d.name === D1_NAME) ?? (await cf("POST", `${acct}/d1/database`, { name: D1_NAME }));
  console.log(`D1 ${D1_NAME}: ${db.uuid}`);

  const spaces = await cf("GET", `${acct}/storage/kv/namespaces?per_page=100`);
  const kv = spaces.find((n) => n.title === KV_TITLE) ?? (await cf("POST", `${acct}/storage/kv/namespaces`, { title: KV_TITLE }));
  console.log(`KV ${KV_TITLE}: ${kv.id}`);

  try {
    await cf("GET", `${acct}/r2/buckets/${BUCKET}`);
    console.log(`R2 ${BUCKET}: exists`);
  } catch {
    await cf("POST", `${acct}/r2/buckets`, { name: BUCKET });
    console.log(`R2 ${BUCKET}: created`);
  }

  const file = "wrangler.jsonc";
  const text = readFileSync(file, "utf8").replace('"DEMO_D1_ID"', JSON.stringify(db.uuid)).replace('"DEMO_KV_ID"', JSON.stringify(kv.id));
  writeFileSync(file, text);
  console.log("wrote ids to wrangler.jsonc (env.demo)");
}

async function domain() {
  const existing = await cf("GET", `${acct}/workers/domains?hostname=${HOST}`);
  if (existing.some((d) => d.hostname === HOST && d.service === WORKER)) return console.log(`${HOST} already points at ${WORKER}`);
  const [zone] = await cf("GET", `/zones?name=${ZONE}`);
  if (!zone) throw new Error(`zone ${ZONE} not found on this account`);
  await cf("PUT", `${acct}/workers/domains`, { hostname: HOST, service: WORKER, environment: "production", zone_id: zone.id });
  console.log(`attached ${HOST} to ${WORKER}`);
}

const step = process.argv[2];
if (step === "provision") await provision();
else if (step === "domain") await domain();
else {
  console.error("usage: node scripts/demo-resources.mjs provision|domain");
  process.exit(1);
}
