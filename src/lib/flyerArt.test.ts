import { describe, expect, it } from "vitest";
import { MODES, PRINTS, artParams } from "./flyerArt";

const ids = Array.from({ length: 400 }, (_, i) => `evt-${i}`);

describe("generated flyer art", () => {
  it("is stable for an event and differs between events", () => {
    expect(artParams("wyxr-64fa1e91")).toEqual(artParams("wyxr-64fa1e91"));
    expect(artParams("wyxr-64fa1e91")).not.toEqual(artParams("wyxr-991b88ea"));
  });
  it("uses every kind of liquid and print, and 2 to 4 inks", () => {
    const all = ids.map(artParams);
    expect(new Set(all.map((p) => p.mode)).size).toBe(MODES.length);
    expect(new Set(all.map((p) => p.print)).size).toBe(PRINTS.length);
    expect(new Set(all.map((p) => p.levels))).toEqual(new Set([2, 3, 4]));
  });
  it("varies color widely", () => {
    const firstInks = new Set(ids.map((id) => artParams(id).inks[1].map((v) => Math.round(v * 8)).join()));
    expect(firstInks.size).toBeGreaterThan(80);
  });
  it("keeps the darkest ink dark so titles stay readable", () => {
    for (const id of ids) {
      const [r, g, b] = artParams(id).inks[0];
      expect(0.2126 * r + 0.7152 * g + 0.0722 * b).toBeLessThan(0.2);
    }
  });
  it("labels the variation with its mode", () => {
    const p = artParams("wyxr-64fa1e91");
    expect(p.number[0]).toBe("MLRVIP"[p.mode]);
  });
});
