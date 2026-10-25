import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatMiles, milesBetween } from "./location";

describe("distance", () => {
  it("measures great-circle miles", () => {
    // Overton Park Shell to the Orpheum: about 3.4 miles as the crow flies.
    const mi = milesBetween({ lat: 35.14569, lng: -89.99482 }, { lat: 35.14022, lng: -90.05555 });
    expect(mi).toBeGreaterThan(3.2);
    expect(mi).toBeLessThan(3.6);
    expect(milesBetween({ lat: 35, lng: -90 }, { lat: 35, lng: -90 })).toBe(0);
  });
  it("formats for cards", () => {
    expect(formatMiles(0.04)).toBe("< 0.1 mi");
    expect(formatMiles(0.84)).toBe("0.8 mi");
    expect(formatMiles(18.4)).toBe("18 mi");
  });
});

// The viewer's position must never reach the server: only the UI may use the location module.
describe("location privacy", () => {
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? files(join(dir, d.name)) : [join(dir, d.name)]));
  it("keeps the API client and the Worker free of location code", () => {
    const api = readFileSync("src/lib/api.ts", "utf8");
    expect(api).not.toMatch(/location|geolocation|coords/i);
    for (const f of files("worker").filter((f) => /\.ts$/.test(f) && !f.endsWith(".test.ts"))) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/lib\/location|navigator\.geolocation/);
    }
  });
  it("never writes coordinates to storage", () => {
    const src = readFileSync("src/lib/location.ts", "utf8");
    const writes = [...src.matchAll(/localStorage\.setItem\(([^)]*)\)/g)].map((m) => m[1]);
    expect(writes).toEqual(['KEY, "on"']);
  });
});
