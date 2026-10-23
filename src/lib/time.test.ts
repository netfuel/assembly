import { describe, expect, it } from "vitest";
import { clock, dayLabel, localParts, windowRange, zonedTime } from "./time";

const TZ = "America/Chicago";

describe("zonedTime", () => {
  it("converts Memphis wall time to UTC across daylight saving", () => {
    expect(zonedTime(2026, 10, 23, 22, TZ).toISOString()).toBe("2026-10-24T03:00:00.000Z"); // CDT
    expect(zonedTime(2026, 11, 13, 22, TZ).toISOString()).toBe("2026-11-14T04:00:00.000Z"); // CST
  });
  it("rolls day overflow into the next month", () => {
    expect(zonedTime(2026, 10, 32, 6, TZ).toISOString()).toBe("2026-11-01T12:00:00.000Z"); // DST ends Nov 1
  });
});

describe("windowRange", () => {
  it("tonight runs until 6 am the next morning", () => {
    const now = new Date("2026-10-23T20:00:00Z"); // Fri 3 pm Memphis
    const r = windowRange("tonight", now, TZ);
    expect(r.to.toISOString()).toBe("2026-10-24T11:00:00.000Z");
  });
  it("2 am still counts as the previous night", () => {
    const now = new Date("2026-10-24T07:00:00Z"); // Sat 2 am Memphis
    expect(localParts(now, TZ).hour).toBe(2);
    expect(windowRange("tonight", now, TZ).to.toISOString()).toBe("2026-10-24T11:00:00.000Z");
  });
  it("weekend from a Wednesday is Friday noon to Monday 6 am", () => {
    const now = new Date("2026-10-21T17:00:00Z"); // Wed noon
    const r = windowRange("weekend", now, TZ);
    expect(r.from.toISOString()).toBe("2026-10-23T17:00:00.000Z");
    expect(r.to.toISOString()).toBe("2026-10-26T11:00:00.000Z");
  });
  it("weekend on a Saturday starts now and ends Monday 6 am", () => {
    const now = new Date("2026-10-24T18:00:00Z"); // Sat 1 pm
    const r = windowRange("weekend", now, TZ);
    expect(r.from).toEqual(now);
    expect(r.to.toISOString()).toBe("2026-10-26T11:00:00.000Z");
  });
});

describe("labels", () => {
  const now = new Date("2026-10-23T20:00:00Z"); // Fri 3 pm
  it("labels nights, not calendar days", () => {
    expect(dayLabel("2026-10-24T03:00:00Z", now, TZ)).toBe("Tonight"); // Fri 10 pm
    expect(dayLabel("2026-10-24T07:30:00Z", now, TZ)).toBe("Tonight"); // Sat 2:30 am
    expect(dayLabel("2026-10-25T03:00:00Z", now, TZ)).toBe("Tomorrow");
    expect(dayLabel("2026-10-31T03:00:00Z", now, TZ)).toBe("Fri Oct 30");
  });
  it("formats clock times", () => {
    expect(clock("2026-10-24T03:00:00Z", TZ)).toBe("10 pm");
    expect(clock("2026-10-24T06:30:00Z", TZ)).toBe("1:30 am");
  });
});
