import { describe, expect, it } from "vitest";
import { DEFAULT_FILTERS, filtersFromUrl, filtersQuery, lowestPrice, matchesFilters } from "../src/lib/filters";
import type { EventSummary } from "../shared/types";

describe("filters in the URL", () => {
  it("round-trips a filtered view", () => {
    const f = { ...DEFAULT_FILTERS, windowId: "date" as const, date: "2026-10-31", scenes: ["queer" as const, "rave" as const], policies: ["all-ages", "21+"], price: "10" as const, venueTypes: ["diy"], q: "juno ray" };
    const q = filtersQuery(f);
    expect(q).toBe("?q=juno+ray&when=date&date=2026-10-31&scene=queer,rave&policy=all-ages,21%2B&price=10&venue=diy");
    expect(filtersFromUrl(q)).toEqual(f);
  });
  it("defaults stay out of the URL", () => {
    expect(filtersQuery(DEFAULT_FILTERS)).toBe("");
    expect(filtersFromUrl("")).toBeNull();
  });
  it("ignores unknown values and a date window without a date", () => {
    expect(filtersFromUrl("?when=date&scene=queer,bogus&policy=nope&price=5")).toEqual({ ...DEFAULT_FILTERS, scenes: ["queer"] });
    expect(filtersFromUrl("?when=nope")).toBeNull();
  });
});

describe("matching", () => {
  const e = { scenes: ["queer", "house"], policyTags: ["21+", "sober-friendly"], venueType: "bar", doorPrice: "$10 door, $8 advance" } as unknown as EventSummary;
  it("reads the lowest price", () => {
    expect(lowestPrice("Free before 11")).toBe(0);
    expect(lowestPrice("$10 door, $8 advance")).toBe(8);
    expect(lowestPrice("Sliding scale $5-15")).toBe(5);
    expect(lowestPrice("Donations")).toBeNull();
  });
  it("scenes match any, policies match all", () => {
    expect(matchesFilters(e, { ...DEFAULT_FILTERS, scenes: ["rave", "queer"] })).toBe(true);
    expect(matchesFilters(e, { ...DEFAULT_FILTERS, policies: ["21+", "sober-friendly"] })).toBe(true);
    expect(matchesFilters(e, { ...DEFAULT_FILTERS, policies: ["21+", "all-ages"] })).toBe(false);
  });
  it("price and venue type", () => {
    expect(matchesFilters(e, { ...DEFAULT_FILTERS, price: "10" })).toBe(true);
    expect(matchesFilters(e, { ...DEFAULT_FILTERS, price: "free" })).toBe(false);
    expect(matchesFilters({ ...e, doorPrice: null }, { ...DEFAULT_FILTERS, price: "20" })).toBe(false);
    expect(matchesFilters(e, { ...DEFAULT_FILTERS, venueTypes: ["diy"] })).toBe(false);
  });
});
