import { describe, expect, it } from "vitest";
import { ftsQuery, likePattern } from "../worker/search";

describe("search query", () => {
  it("turns words into quoted prefix terms", () => {
    expect(ftsQuery("Juno Ray")).toBe('"juno"* "ray"*');
  });
  it("drops FTS syntax and accents", () => {
    expect(ftsQuery('Café "OR" NEAR(x) -drop*')).toBe('"cafe"* "or"* "near"* "x"* "drop"*');
  });
  it("returns null for nothing searchable", () => {
    expect(ftsQuery("  --- ")).toBeNull();
  });
});

describe("likePattern", () => {
  const bytes = (s: string) => new TextEncoder().encode(s).length;
  it("wraps and escapes short queries", () => {
    expect(likePattern("50%_off\\")).toBe("%50\\%\\_off\\\\%");
  });
  it("stays within D1's 50-byte LIKE limit", () => {
    for (const q of ["x".repeat(80), "é".repeat(80), "🎧".repeat(40), "%".repeat(40)]) expect(bytes(likePattern(q))).toBeLessThanOrEqual(50);
  });
  it("never leaves a dangling escape", () => {
    const p = likePattern("a".repeat(45) + "%%%");
    expect(p.slice(1, -1).replace(/\\[%_\\]/g, "")).not.toMatch(/\\/);
  });
});
