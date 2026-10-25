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
