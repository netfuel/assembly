import { describe, expect, it } from "vitest";
import { codeEmail, newCode, normalizeEmail } from "./emailAuth";

describe("email sign-in", () => {
  it("normalizes addresses", () => {
    expect(normalizeEmail("  Matt@Example.COM ")).toBe("matt@example.com");
    for (const bad of ["", "matt", "matt@", "@example.com", "matt@example", "a b@example.com", 42, null]) expect(normalizeEmail(bad)).toBeNull();
  });
  it("makes six-digit codes", () => {
    const codes = new Set(Array.from({ length: 200 }, newCode));
    for (const c of codes) expect(c).toMatch(/^\d{6}$/);
    expect(codes.size).toBeGreaterThan(190);
  });
  it("puts the code in the subject and both bodies", () => {
    const m = codeEmail("042917", "https://assembly.rsvp");
    expect(m.subject).toBe("042917 is your Assembly code");
    expect(m.text).toContain("042917");
    expect(m.html).toContain("042 917");
    expect(m.text).toContain("assembly.rsvp");
  });
});
