import { describe, expect, it } from "vitest";
import { validatePageEdit } from "../worker/validate";

describe("page edits", () => {
  it("keeps only the fields sent, and cleans links", () => {
    const r = validatePageEdit({ bio: "  Warm house.  ", links: { instagram: "instagram.com/juno", nope: "x" } }, "artist");
    expect(r).toEqual({ ok: true, value: { bio: "Warm house.", links: { instagram: "https://instagram.com/juno" } } });
  });
  it("flags a link that isn't a web address", () => {
    const r = validatePageEdit({ links: { bandcamp: "not a url ##" } }, "artist");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors["links.bandcamp"]).toBeTruthy();
  });
  it("lets venues set door notes and house policy, from known tags only", () => {
    const r = validatePageEdit({ accessNotes: "Side door. Ramp at back.", housePolicy: ["21+", "made-up"] }, "venue");
    expect(r).toEqual({ ok: true, value: { accessNotes: "Side door. Ramp at back.", housePolicy: ["21+"] } });
  });
  it("ignores venue-only fields on artists", () => {
    expect(validatePageEdit({ accessNotes: "x", housePolicy: ["21+"] }, "artist")).toEqual({ ok: true, value: {} });
  });
  it("caps the bio", () => {
    const r = validatePageEdit({ bio: "x".repeat(2000) }, "artist");
    expect(r.ok && r.value.bio?.length).toBe(600);
  });
});
