import { describe, expect, it } from "vitest";
import { checkinWindow, newDoorCode, notMigrated } from "../worker/checkins";

describe("check-in", () => {
  it("opens 30 minutes before the start and closes 30 minutes after the end", () => {
    const w = checkinWindow("2026-10-31T03:00:00.000Z", "2026-10-31T08:00:00.000Z");
    expect(new Date(w.opens).toISOString()).toBe("2026-10-31T02:30:00.000Z");
    expect(new Date(w.closes).toISOString()).toBe("2026-10-31T08:30:00.000Z");
  });
  it("door codes are six unambiguous characters", () => {
    for (let i = 0; i < 50; i++) expect(newDoorCode()).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
  });
  it("spots a database that hasn't had the migration", () => {
    expect(notMigrated(new Error("D1_ERROR: no such table: checkins"))).toBe(true);
    expect(notMigrated(new Error("D1_ERROR: no such column: door_code"))).toBe(true);
    expect(notMigrated(new Error("something else"))).toBe(false);
  });
});
