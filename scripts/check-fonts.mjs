// Fails a deploy when the Timeless fonts aren't in public/fonts/timeless/.
// They're gitignored (the license forbids public repositories), so a fresh clone won't have them.
import { existsSync } from "node:fs";

const files = ["TimelessSansVF.woff2", "TimelessSerifVF.woff2", "TimelessSerifItalicVF.woff2"];
const missing = files.filter((f) => !existsSync(new URL(`../public/fonts/timeless/${f}`, import.meta.url)));

if (missing.length) {
  console.error(
    `Missing Timeless fonts in public/fonts/timeless/: ${missing.join(", ")}\n` +
      "Download the family from https://timeless.co/type and copy the variable WOFF2 files there (see README, Fonts).",
  );
  process.exit(1);
}
console.log("Timeless fonts present.");
