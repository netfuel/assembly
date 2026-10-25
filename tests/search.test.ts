import { describe, expect, it } from "vitest";
import { ftsQuery } from "../worker/search";

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
