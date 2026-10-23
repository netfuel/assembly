import { describe, expect, it } from "vitest";
import { safeReturnTo, withResult } from "./auth";

describe("post-sign-in redirects", () => {
  it("keeps same-site paths", () => {
    expect(safeReturnTo("/e/night-shift-abc")).toBe("/e/night-shift-abc");
    expect(safeReturnTo("/?compose=1")).toBe("/?compose=1");
  });
  it("refuses anything that could leave the site", () => {
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "/\t/evil.example", "", null, undefined]) {
      expect(safeReturnTo(bad)).toBe("/");
    }
  });
  it("appends the result to paths with or without a query", () => {
    expect(withResult("/", "ok")).toBe("/?signin=ok");
    expect(withResult("/?compose=1", "ok")).toBe("/?compose=1&signin=ok");
  });
});
