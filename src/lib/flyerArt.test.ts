import { describe, expect, it } from "vitest";
import { STYLES, artStyle, artSvg } from "./flyerArt";

describe("generated flyer art", () => {
  it("is stable for an event and differs between events", () => {
    expect(artSvg("wyxr-64fa1e91", false)).toBe(artSvg("wyxr-64fa1e91", false));
    expect(artSvg("wyxr-64fa1e91", false)).not.toBe(artSvg("wyxr-991b88ea", false));
  });
  it("spreads events across all five styles", () => {
    const seen = new Set(Array.from({ length: 200 }, (_, i) => artStyle(`evt-${i}`)));
    expect([...seen].sort()).toEqual([...STYLES].sort());
  });
  it("uses the violet family for queer-centered events and sodium otherwise", () => {
    for (const style of STYLES) {
      expect(artSvg("x", true, { style })).not.toBe(artSvg("x", false, { style }));
      // Print carries its inks as filter values; the others name them.
      if (style === "print") continue;
      expect(artSvg("x", true, { style })).toMatch(/#a98bff/);
      expect(artSvg("x", false, { style })).toMatch(/#ff9a3c/);
    }
  });
});
