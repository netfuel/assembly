import { describe, expect, it } from "vitest";
import { filtersFromUrl, filtersQuery } from "../src/lib/filters";

describe("filters in the URL", () => {
  it("round-trips a filtered view", () => {
    const f = { windowId: "date" as const, date: "2026-10-31", scenes: ["queer" as const, "rave" as const] };
    const q = filtersQuery(f);
    expect(q).toBe("?when=date&date=2026-10-31&scene=queer,rave");
    expect(filtersFromUrl(q)).toEqual(f);
  });
  it("defaults stay out of the URL", () => {
    expect(filtersQuery({ windowId: "tonight", date: null, scenes: [] })).toBe("");
    expect(filtersFromUrl("")).toBeNull();
  });
  it("ignores unknown scenes and a date window without a date", () => {
    expect(filtersFromUrl("?when=date&scene=queer,bogus")).toEqual({ windowId: "tonight", date: null, scenes: ["queer"] });
    expect(filtersFromUrl("?when=nope")).toBeNull();
  });
});
