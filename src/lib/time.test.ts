import { describe, expect, it } from "vitest";
import { clock, dateHeading, dayLabel, fromInputs, localParts, nightRange, toInputs, tonightDate, windowRange, zonedTime } from "./time";

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

describe("form wall-clock helpers", () => {
  const tz = "America/Chicago";
  it("converts a night that runs past midnight", () => {
    // Oct 24 2026 is CDT (UTC-5).
    expect(fromInputs("2026-10-24", "22:00", "03:00", tz)).toEqual({
      startsAt: "2026-10-25T03:00:00.000Z",
      endsAt: "2026-10-25T08:00:00.000Z",
    });
  });
  it("keeps same-day ranges on the same day", () => {
    expect(fromInputs("2026-12-05", "14:30", "18:00", tz)).toEqual({
      startsAt: "2026-12-05T20:30:00.000Z",
      endsAt: "2026-12-06T00:00:00.000Z",
    });
  });
  it("handles the night DST ends", () => {
    // Oct 31 → Nov 1 2026: clocks fall back at 2 am, so 10 pm CDT to 4 am CST is seven hours.
    const r = fromInputs("2026-10-31", "22:00", "04:00", tz)!;
    expect((Date.parse(r.endsAt) - Date.parse(r.startsAt)) / 3600e3).toBe(7);
  });
  it("round-trips to input values", () => {
    expect(toInputs("2026-10-25T03:00:00.000Z", tz)).toEqual({ date: "2026-10-24", time: "22:00" });
  });
  it("rejects incomplete input", () => {
    expect(fromInputs("", "22:00", "03:00", tz)).toBeNull();
  });
});

describe("pick a date", () => {
  const tz = "America/Chicago";
  it("covers 6 am to 6 am local", () => {
    expect(nightRange("2026-10-31", tz)).toEqual({ from: new Date("2026-10-31T11:00:00Z"), to: new Date("2026-11-01T12:00:00Z") });
  });
  it("starts from now when the night is under way", () => {
    const now = new Date("2026-10-31T04:00:00Z"); // 11 pm Oct 30 local
    expect(windowRange("date", now, tz, "2026-10-30").from).toEqual(now);
  });
  it("treats 2 am as last night", () => {
    expect(tonightDate(new Date("2026-10-24T07:00:00Z"), tz)).toBe("2026-10-23");
    expect(tonightDate(new Date("2026-10-24T13:00:00Z"), tz)).toBe("2026-10-24");
  });
  it("labels a date", () => {
    expect(dateHeading("2026-10-31")).toBe("Sat Oct 31");
  });
});

describe("liveFirst", () => {
  it("puts what's on now first, then by start time", async () => {
    const { liveFirst } = await import("./time");
    const now = new Date("2026-10-26T22:00:00Z");
    const list = [
      { id: "later", startsAt: "2026-10-27T02:00:00Z", endsAt: "2026-10-27T06:00:00Z" },
      { id: "cancelled-live", startsAt: "2026-10-26T21:00:00Z", endsAt: "2026-10-27T01:00:00Z", status: "cancelled" },
      { id: "live", startsAt: "2026-10-26T21:30:00Z", endsAt: "2026-10-27T01:00:00Z" },
      { id: "earlier-done", startsAt: "2026-10-26T18:00:00Z", endsAt: "2026-10-26T20:00:00Z" },
    ];
    expect(liveFirst(list, now).map((e) => e.id)).toEqual(["live", "earlier-done", "cancelled-live", "later"]);
  });
});

describe("live window", () => {
  it("runs 30 minutes past the end, unless the organizer ended it", async () => {
    const { isLive } = await import("./time");
    const start = "2026-10-26T22:00:00Z";
    const end = "2026-10-27T02:00:00Z";
    expect(isLive(start, end, new Date("2026-10-26T21:59:00Z"))).toBe(false);
    expect(isLive(start, end, new Date("2026-10-27T01:00:00Z"))).toBe(true);
    expect(isLive(start, end, new Date("2026-10-27T02:20:00Z"))).toBe(true);
    expect(isLive(start, end, new Date("2026-10-27T02:31:00Z"))).toBe(false);
    expect(isLive(start, end, new Date("2026-10-27T02:20:00Z"), true)).toBe(false);
  });
  it("gives an event with no end time six hours, and crosses midnight", () => {
    const blank = fromInputs("2026-10-30", "22:00", "", "America/Chicago")!;
    expect(Date.parse(blank.endsAt) - Date.parse(blank.startsAt)).toBe(6 * 3600e3);
    const late = fromInputs("2026-10-30", "22:00", "03:00", "America/Chicago")!;
    expect(Date.parse(late.endsAt) - Date.parse(late.startsAt)).toBe(5 * 3600e3);
  });
});
