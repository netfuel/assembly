import { readFileSync, readdirSync, type Dirent } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The viewer's position must never reach the server: only the UI may use src/lib/location.ts.
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((d: Dirent) => (d.isDirectory() ? files(join(dir, d.name)) : [join(dir, d.name)]));

describe("location privacy", () => {
  it("keeps the API client and the Worker free of location code", () => {
    expect(readFileSync("src/lib/api.ts", "utf8")).not.toMatch(/lib\/location|geolocation|coords/i);
    for (const f of files("worker").filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/lib\/location|navigator\.geolocation/);
    }
  });
  it("never writes coordinates to storage", () => {
    const src = readFileSync("src/lib/location.ts", "utf8");
    const writes = [...src.matchAll(/localStorage\.setItem\(([^)]*)\)/g)].map((m) => m[1]);
    expect(writes).toEqual(['KEY, "on"', 'KEY, "off"']);
  });
});
