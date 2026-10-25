import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SECURITY_HEADERS, THEME_SCRIPT_HASH } from "../worker/security";

describe("security headers", () => {
  it("allows the inline theme script in index.html, and only that", () => {
    const html = readFileSync("index.html", "utf8");
    const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    expect(inline).toHaveLength(1);
    const hash = `'sha256-${createHash("sha256").update(inline[0]).digest("base64")}'`;
    expect(THEME_SCRIPT_HASH).toBe(hash);
  });
  it("public/_headers matches worker/security.ts (run npm run headers)", () => {
    const file = readFileSync("public/_headers", "utf8");
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) expect(file).toContain(`  ${k}: ${v}\n`);
  });
});
