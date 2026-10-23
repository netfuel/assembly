import { describe, expect, it } from "vitest";
import { normalizeUrl, slugify, sniffImage, validateEvent, validateProfile } from "./validate";

const opts = { now: new Date("2026-10-23T18:00:00Z"), bounds: { center: [-90.01, 35.14] as [number, number], radiusDeg: 0.6 }, userId: "u1" };
const base = {
  title: "  Wet   Paint ",
  startsAt: "2026-10-24T03:00:00Z",
  endsAt: "2026-10-24T08:00:00Z",
  address: "123 Example St",
  lat: 35.15,
  lng: -89.99,
  scenes: ["queer", "house", "nope"],
  policyTags: ["21+", "made-up"],
  ticketUrl: "ra.co/events/123",
  lineup: [{ name: "Juno Ray", setStart: "10:00 pm", links: { soundcloud: "soundcloud.com/juno", bogus: "x" } }],
};

describe("validateEvent", () => {
  it("normalizes a good event", () => {
    const r = validateEvent(base, opts);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.title).toBe("Wet Paint");
    expect(r.value.scenes).toEqual(["queer", "house"]);
    expect(r.value.policyTags).toEqual(["21+"]);
    expect(r.value.ticketUrl).toBe("https://ra.co/events/123");
    expect(r.value.lineup[0].links).toEqual({ soundcloud: "https://soundcloud.com/juno" });
  });

  it("explains what's missing in plain words", () => {
    const r = validateEvent({ ...base, title: " ", scenes: [], lat: "x" }, opts);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.errors).sort()).toEqual(["location", "scenes", "title"]);
  });

  it("rejects ends before starts and very long events", () => {
    const a = validateEvent({ ...base, endsAt: "2026-10-24T02:00:00Z" }, opts);
    const b = validateEvent({ ...base, endsAt: "2026-10-28T03:00:00Z" }, opts);
    expect(a.ok || a.errors.endsAt).toMatch(/after the start/);
    expect(b.ok || b.errors.endsAt).toMatch(/up to 72 hours/);
  });

  it("keeps pins inside the city", () => {
    const r = validateEvent({ ...base, lat: 36.16, lng: -86.78 }, opts); // Nashville
    expect(r.ok || r.errors.location).toMatch(/outside Memphis/);
  });

  it("only attaches flyers the user uploaded", () => {
    expect(validateEvent({ ...base, flyerKey: "flyers/u1/a.webp" }, opts).ok).toBe(true);
    const r = validateEvent({ ...base, flyerKey: "flyers/u2/a.webp" }, opts);
    expect(r.ok).toBe(false);
  });

  it("refuses past events for new posts but allows edits", () => {
    const past = { ...base, startsAt: "2026-10-01T03:00:00Z", endsAt: "2026-10-01T06:00:00Z" };
    expect(validateEvent(past, opts).ok).toBe(false);
    expect(validateEvent(past, { ...opts, editing: true }).ok).toBe(true);
  });

  it("accepts a listed venue without a pin", () => {
    expect(validateEvent({ ...base, venueId: "sample-room-9", lat: undefined, lng: undefined, address: "" }, opts).ok).toBe(true);
  });
});

describe("helpers", () => {
  it("normalizes pasted links", () => {
    expect(normalizeUrl("instagram.com/assembly")).toBe("https://instagram.com/assembly");
    expect(normalizeUrl("http://example.com")).toBeNull();
    expect(normalizeUrl("javascript:alert(1)")).toBeNull();
  });
  it("slugifies titles", () => {
    expect(slugify("Pulp After Dark: Vol. 2!")).toBe("pulp-after-dark-vol-2");
    expect(slugify("Ça va")).toBe("ca-va");
  });
  it("sniffs image types from bytes", () => {
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpg");
    expect(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]))).toBe("png");
    expect(sniffImage(new TextEncoder().encode("RIFF1234WEBPVP8 "))).toBe("webp");
    expect(sniffImage(new TextEncoder().encode("<svg>"))).toBeNull();
  });
});

describe("validateProfile", () => {
  it("cleans and keeps known fields", () => {
    const r = validateProfile({
      displayName: "  Matt  ",
      pronouns: "he/him",
      bio: "Runs a party.",
      scenes: ["queer", "techno", "made-up"],
      links: { soundcloud: "soundcloud.com/matt", myspace: "x" },
      showAttendance: true,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual({
      displayName: "Matt",
      pronouns: "he/him",
      bio: "Runs a party.",
      scenes: ["queer", "techno"],
      links: { soundcloud: "https://soundcloud.com/matt" },
      showAttendance: true,
    });
  });
  it("needs a name and real links", () => {
    const r = validateProfile({ displayName: " ", links: { site: "javascript:alert(1)" } });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.errors).sort()).toEqual(["displayName", "links.site"]);
  });
  it("defaults attendance to private", () => {
    const r = validateProfile({ displayName: "A", showAttendance: "yes" });
    expect(r.ok && r.value.showAttendance).toBe(false);
  });
});
