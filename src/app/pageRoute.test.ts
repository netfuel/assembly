import { describe, expect, it } from "vitest";
import { pageFromPath } from "./PageSheet";

describe("page routes", () => {
  it("reads /a, /v and /o paths", () => {
    expect(pageFromPath("/a/juno-ray")).toEqual({ kind: "artist", slug: "juno-ray" });
    expect(pageFromPath("/v/room-9")).toEqual({ kind: "venue", slug: "room-9" });
    expect(pageFromPath("/o/flow%20tester")).toEqual({ kind: "organizer", slug: "flow tester" });
  });
  it("ignores everything else", () => {
    expect(pageFromPath("/e/abc")).toBeNull();
    expect(pageFromPath("/api/config")).toBeNull();
    expect(pageFromPath("/a")).toBeNull();
  });
});
