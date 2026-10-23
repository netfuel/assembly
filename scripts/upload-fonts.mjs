// Uploads the Timeless fonts from public/fonts/timeless/ to the private R2 bucket, where the
// Worker serves them to Assembly's own pages (worker/fonts.ts). Run once, and again only if the
// fonts change: npm run fonts:upload
// The files never go into git: the Timeless license forbids public repositories.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const BUCKET = "assembly-media";
const FILES = ["TimelessSansVF.woff2", "TimelessSerifVF.woff2", "TimelessSerifItalicVF.woff2"];
const dir = new URL("../public/fonts/timeless/", import.meta.url);

const missing = FILES.filter((f) => !existsSync(new URL(f, dir)));
if (missing.length) {
  console.error(`Missing in public/fonts/timeless/: ${missing.join(", ")}\nGet them from https://timeless.co/type (see README, Fonts).`);
  process.exit(1);
}

for (const f of FILES) {
  console.log(`Uploading ${f}…`);
  execFileSync(
    "npx",
    [
      "wrangler", "r2", "object", "put", `${BUCKET}/fonts/timeless/${f}`,
      "--remote",
      "--file", fileURLToPath(new URL(f, dir)), // handles spaces, e.g. a Dropbox path
      "--content-type", "font/woff2",
      "--cache-control", "public, max-age=31536000, immutable",
    ],
    { stdio: "inherit" },
  );
}
console.log("\n✓ Fonts are in R2. Production serves them at /fonts/timeless/ to Assembly's own pages only.");
