// Gets the live site (assembly.rsvp) ready for real people. Safe to run again: it skips what's done.
// 1. Signs you in to Cloudflare if needed.
// 2. Applies database changes (D1 migrations) to the live database.
// 3. Sets the secrets the app needs: notification keys, moderators, email sender, Google and Apple sign-in, Stream.
// 4. Checks that the site answers, and lists the dashboard steps that can't be scripted.
// Secrets go straight to Cloudflare through wrangler; nothing is written to disk.
import { execSync, spawnSync } from "node:child_process";
import { webcrypto as crypto } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const rl = createInterface({ input: stdin, output: stdout });
const ask = async (q, def = "") => (await rl.question(def ? `${q} [${def}] ` : `${q} `)).trim() || def;
const yes = async (q, def = false) => {
  const a = (await ask(`${q} (${def ? "Y/n" : "y/N"})`)).toLowerCase();
  return a ? a.startsWith("y") : def;
};
const step = (n, s) => console.log(`\n\x1b[1m${n}. ${s}\x1b[0m`);
const ok = (s) => console.log(`   \x1b[32m✓\x1b[0m ${s}`);
const todo = [];

function wrangler(args, { input, quiet } = {}) {
  const r = spawnSync("npx", ["wrangler", ...args], {
    input,
    encoding: "utf8",
    stdio: input !== undefined ? ["pipe", quiet ? "pipe" : "inherit", "inherit"] : quiet ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (r.status !== 0) throw new Error(`wrangler ${args.join(" ")} failed`);
  return r.stdout ?? "";
}

async function putSecret(name, value) {
  wrangler(["secret", "put", name], { input: `${value}\n`, quiet: true });
  ok(`${name} set`);
}

const b64url = (buf) => Buffer.from(buf).toString("base64url");

try {
  step(1, "Cloudflare sign-in");
  try {
    const who = execSync("npx wrangler whoami", { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    if (/not authenticated/i.test(who)) throw new Error("signed out");
    ok("Signed in");
  } catch {
    wrangler(["login"]);
  }

  step(2, "Live database changes");
  console.log("   Applies anything new in db/migrations (for example email sign-in) to the live database.");
  wrangler(["d1", "migrations", "apply", "assembly", "--remote"]);

  const secrets = new Set();
  try {
    const out = wrangler(["secret", "list", "--format", "json"], { quiet: true });
    for (const s of JSON.parse(out.slice(out.indexOf("[")))) secrets.add(s.name);
  } catch {
    console.log("   (Couldn't list existing secrets; you'll be asked about each one.)");
  }
  const has = (n) => secrets.has(n);

  step(3, "Notifications");
  if (has("VAPID_PUBLIC_KEY") && has("VAPID_PRIVATE_KEY")) ok("Keys already set. Keeping them, so existing subscriptions keep working.");
  else if (await yes("Turn on notifications (generates keys)?", true)) {
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const pub = b64url(await crypto.subtle.exportKey("raw", pair.publicKey));
    const priv = (await crypto.subtle.exportKey("jwk", pair.privateKey)).d;
    await putSecret("VAPID_PUBLIC_KEY", pub);
    await putSecret("VAPID_PRIVATE_KEY", priv);
    await putSecret("VAPID_SUBJECT", "mailto:hello@assembly.rsvp");
  }

  step(4, "Moderators");
  if (has("MODERATORS") && !(await yes("Moderators are set. Change them?"))) ok("Keeping current moderators");
  else {
    const list = await ask("Moderator sign-in emails, comma-separated:", "netfuel@gmail.com");
    await putSecret("MODERATORS", list);
  }

  step(5, "Email sign-in codes");
  if (has("EMAIL_FROM")) ok("Email sender is set");
  else {
    console.log("   Needs the Workers Paid plan and assembly.rsvp onboarded under Compute > Email Service > Email Sending.");
    if (await yes("Is assembly.rsvp onboarded for Email Sending?")) await putSecret("EMAIL_FROM", await ask("Send codes from:", "hello@assembly.rsvp"));
    else todo.push("Email sign-in: upgrade to Workers Paid, onboard assembly.rsvp under Compute > Email Service > Email Sending, then run this again.");
  }

  step(6, "Google sign-in");
  if (has("GOOGLE_CLIENT_ID") && has("GOOGLE_CLIENT_SECRET") && !(await yes("Google is set. Replace it with a new client (for example a new client_secret_….json)?"))) ok("Keeping current Google client");
  else {
    console.log(`   In Google Cloud Console (console.cloud.google.com):
   - APIs & Services > OAuth consent screen: app name Assembly, support email, and these links:
       home      https://assembly.rsvp
       privacy   https://assembly.rsvp/privacy
       terms     https://assembly.rsvp/terms
   - Credentials > Create credentials > OAuth client ID > Web application. Authorized redirect URIs:
       https://assembly.rsvp/api/auth/google/callback
       https://www.assembly.rsvp/api/auth/google/callback
       http://localhost:5173/api/auth/google/callback
   - Publish the app (Audience > Publish) so anyone can sign in, not just test users.`);
    // Use a client_secret_….json in this folder if there is one (it's git-ignored).
    const { readdirSync } = await import("node:fs");
    const found = readdirSync(".").find((f) => /^client_secret.*\.json$/.test(f));
    let answer = "";
    if (found && (await yes(`Use ${found.slice(0, 40)}… from this folder?`, true))) answer = found;
    else {
      console.log("   Easiest: drag the client_secret_….json file Google gave you into this window when asked.");
      answer = await ask("Path to the Google JSON file, or press Enter to type the ID and secret instead:");
    }
    let id = "";
    let secret = "";
    if (answer) {
      // Dragging a file into Terminal adds quotes or backslash-escaped spaces.
      const path = answer.replace(/^['"]|['"]$/g, "").replace(/\\ /g, " ").replace(/^~/, process.env.HOME);
      const { readFileSync } = await import("node:fs");
      const json = JSON.parse(readFileSync(path, "utf8"));
      const client = json.web ?? json.installed;
      if (!client?.client_id || !client?.client_secret) throw new Error("That file doesn't look like a Google OAuth client (no client_id/client_secret).");
      if (json.installed) console.log("   \x1b[33m!\x1b[0m This is a Desktop client. Create a Web application client instead, or redirects will fail.");
      const uris = client.redirect_uris ?? [];
      const needed = ["https://assembly.rsvp/api/auth/google/callback", "https://www.assembly.rsvp/api/auth/google/callback"];
      if (json.web?.project_id) console.log(`   Google Cloud project: ${json.web.project_id}`);
      const missing = needed.filter((u) => !uris.includes(u));
      if (missing.length) {
        console.log("   \x1b[33m!\x1b[0m This file doesn't list these redirect URIs:");
        for (const u of missing) console.log(`       ${u}`);
        console.log("     Add them in Google Cloud Console > Credentials > your client, or sign-in will fail there.");
        console.log("     (The ID and secret don't change, so it's fine to continue. A file downloaded before the change won't show them.)");
      } else ok("Redirect URIs for assembly.rsvp are listed");
      id = client.client_id;
      secret = client.client_secret;
    } else if (await yes("Have the client ID and secret ready to paste?")) {
      id = await ask("Client ID:");
      secret = await ask("Client secret:");
    }
    if (id && secret) {
      await putSecret("GOOGLE_CLIENT_ID", id);
      await putSecret("GOOGLE_CLIENT_SECRET", secret);
      console.log("   Stored in Cloudflare. You can delete the JSON file now (it's git-ignored either way).");
    } else todo.push("Google sign-in: create the OAuth client (step 6 above), then run this again.");
  }

  step(7, "Apple sign-in (optional, needs a paid Apple Developer account)");
  if (has("APPLE_CLIENT_ID")) ok("Apple is set");
  else if (await yes("Set up Apple now?")) {
    console.log("   Services ID return URL: https://assembly.rsvp/api/auth/apple/callback");
    await putSecret("APPLE_CLIENT_ID", await ask("Services ID (client ID):"));
    await putSecret("APPLE_TEAM_ID", await ask("Team ID:"));
    await putSecret("APPLE_KEY_ID", await ask("Key ID:"));
    const path = await ask("Path to the .p8 key file:");
    const { readFileSync } = await import("node:fs");
    await putSecret("APPLE_PRIVATE_KEY", readFileSync(path.replace(/^~/, process.env.HOME), "utf8").trim());
  } else todo.push("Apple sign-in (optional): see README, Set up sign-in.");

  step(8, "Promo video (optional, Cloudflare Stream)");
  if (has("STREAM_API_TOKEN")) ok("Stream is set");
  else if (await yes("Set up Stream now? (Stream must be enabled on the account)")) {
    await putSecret("CLOUDFLARE_ACCOUNT_ID", await ask("Account ID (dashboard sidebar, or wrangler whoami):"));
    await putSecret("STREAM_API_TOKEN", await ask("API token with Stream: Edit:"));
    const code = await ask("Stream customer code (optional, the customer-… part of playback URLs):");
    if (code) await putSecret("STREAM_CUSTOMER_CODE", code);
  } else todo.push("Promo video (optional): enable Stream, then run this again.");

  step(9, "Checking the live site");
  for (const url of ["https://assembly.rsvp/api/health", "https://www.assembly.rsvp/api/health", "https://assembly.netfuel.workers.dev/api/health"]) {
    try {
      const res = await fetch(url, { redirect: "manual" });
      console.log(`   ${res.status === 200 ? "\x1b[32m✓\x1b[0m" : "\x1b[33m!\x1b[0m"} ${url} → ${res.status}`);
      if (res.status !== 200 && url.includes("//assembly.rsvp"))
        todo.push("assembly.rsvp isn't answering: in the dashboard open Workers & Pages > assembly > Settings > Domains & Routes and add assembly.rsvp as a Custom domain.");
    } catch (err) {
      console.log(`   \x1b[33m!\x1b[0m ${url} → ${err.cause?.code ?? err.message}`);
      if (url.includes("//assembly.rsvp")) todo.push("assembly.rsvp isn't reachable yet: add it as a Custom domain on the assembly Worker (Settings > Domains & Routes).");
    }
  }
  try {
    const providers = await (await fetch("https://assembly.netfuel.workers.dev/api/auth/providers")).json();
    console.log(`   Sign-in options live: ${Object.entries(providers).filter(([, v]) => v).map(([k]) => k).join(", ") || "none yet"}`);
  } catch {
    // Not critical.
  }

  todo.push(
    "Inbound email for hello@assembly.rsvp (the contact address in the policies): Email Service > Email Routing > forward hello@ to your inbox.",
    "Visitor counts without cookies: Analytics & Logs > Web Analytics > add assembly.rsvp (automatic setup).",
    "Sign in on the live site, open your profile, and confirm you see Review reports. Post a test event and delete it.",
  );
  console.log("\n\x1b[1mStill to do in the Cloudflare and Google dashboards:\x1b[0m");
  todo.forEach((t, i) => console.log(`   ${i + 1}. ${t}`));
  console.log("\nSecrets take effect right away; no redeploy needed. Run this again any time to fill in the rest.");
} catch (err) {
  console.error(`\n\x1b[31m${err.message}\x1b[0m`);
  process.exitCode = 1;
} finally {
  rl.close();
}
