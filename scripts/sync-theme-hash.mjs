// Runs before every build (npm "prebuild"). Recomputes the hash of the inline theme script in
// index.html and writes it into worker/security.ts and public/_headers, so editing that script
// can't silently get it blocked by the content security policy. Plain Node, no TypeScript loader.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const path = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const html = readFileSync(path("index.html"), "utf8");
const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
if (inline.length !== 1) throw new Error(`Expected exactly one inline <script> in index.html, found ${inline.length}.`);
const hash = `'sha256-${createHash("sha256").update(inline[0]).digest("base64")}'`;

for (const [file, pattern, replacement] of [
  ["worker/security.ts", /export const THEME_SCRIPT_HASH = "[^"]*";/, `export const THEME_SCRIPT_HASH = "${hash}";`],
  ["public/_headers", /'sha256-[A-Za-z0-9+/=]+'/, hash],
]) {
  const before = readFileSync(path(file), "utf8");
  if (!pattern.test(before)) throw new Error(`No theme script hash found in ${file}.`);
  const after = before.replace(pattern, replacement);
  if (after !== before) {
    writeFileSync(path(file), after);
    console.log(`${file}: theme script hash updated`);
  }
}
