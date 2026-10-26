import { describe, expect, it } from "vitest";
import { validUsername } from "../worker/friends";

describe("usernames", () => {
  it("normalizes case and a leading @", () => {
    expect(validUsername("@Ana.K")).toEqual({ ok: true, value: "ana.k" });
  });
  it("rejects bad shapes and reserved names", () => {
    for (const bad of ["ab", "a".repeat(25), "_ana", "ana_", "an..a", "ana k", "admin", "assembly", 42]) expect(validUsername(bad).ok).toBe(false);
  });
});

import { normalizeEmail, sha256Hex } from "../worker/friends";
describe("contact hashing", () => {
  it("normalizes then hashes like the phone does", async () => {
    expect(normalizeEmail("  Ana@Example.COM ")).toBe("ana@example.com");
    expect(await sha256Hex("ana@example.com")).toMatch(/^[0-9a-f]{64}$/);
  });
});
