import { describe, expect, it } from "vitest";
import { cleanBody, visibleRows } from "../worker/comments";
import { ago } from "../src/lib/time";

describe("comment bodies", () => {
  it("trim, drop control characters and collapse blank runs", () => {
    expect(cleanBody("  hi  ")).toBe("hi");
    expect(cleanBody("a\r\n\r\n\r\n\r\nb")).toBe("a\n\nb");
    expect(cleanBody("x\u0000y\u0007")).toBe("xy");
  });
  it("reject empty or non-text", () => {
    expect(cleanBody("   \n\n ")).toBeNull();
    expect(cleanBody(42)).toBeNull();
    expect(cleanBody(undefined)).toBeNull();
  });
});

describe("ago", () => {
  const now = Date.parse("2026-10-26T12:00:00Z");
  it("reads in minutes, hours, then days", () => {
    expect(ago("2026-10-26T11:59:40Z", now)).toBe("just now");
    expect(ago("2026-10-26T11:48:00Z", now)).toBe("12 min ago");
    expect(ago("2026-10-26T09:00:00Z", now)).toBe("3 hr ago");
    expect(ago("2026-10-24T12:00:00Z", now)).toBe("2 d ago");
  });
});

describe("what a viewer sees", () => {
  const row = (id: string, parent_id: string | null, status = "live", relation: string | null = null) => ({ id, parent_id, status, relation });
  const shown = (rows: ReturnType<typeof row>[]) => visibleRows(rows).map((r) => `${r.id}${r.placeholder ? `:${r.placeholder}` : ""}`);
  it("drops a removed comment unless replies hang off it", () => {
    expect(shown([row("a", null, "removed")])).toEqual([]);
    expect(shown([row("a", null, "removed"), row("b", "a")])).toEqual(["a:removed", "b"]);
  });
  it("hides muted people, keeping a placeholder only above other people's replies", () => {
    expect(shown([row("a", null, "live", "mute"), row("b", "a", "live", "mute")])).toEqual([]);
    expect(shown([row("a", null, "live", "block"), row("b", "a")])).toEqual(["a:muted", "b"]);
    expect(shown([row("a", null), row("b", "a", "live", "blocked-by")])).toEqual(["a"]);
  });
});
