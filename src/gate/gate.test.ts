import { describe, expect, it } from "vitest";
import { gateReturnTo, looksLikeEmail, mountFor } from "./gate";

describe("what the page mounts", () => {
  it("shows the gate only when the server says so", () => {
    expect(mountFor({ gate: "on" }, "/")).toBe("gate");
    expect(mountFor({ gate: "on" }, "/?from=/e/abc")).toBe("gate");
    expect(mountFor({ gate: "off" }, "/")).toBe("app");
    expect(mountFor({ gate: "off-for-you" }, "/")).toBe("app");
    expect(mountFor({}, "/")).toBe("app");
  });
  it("never walls off policy pages or an offline visitor", () => {
    expect(mountFor({ gate: "on" }, "/privacy")).toBe("legal");
    expect(mountFor({ gate: "on" }, "/terms/")).toBe("legal");
    expect(mountFor(null, "/")).toBe("app");
  });
});

describe("gate form", () => {
  it("enables the button for a practical address", () => {
    expect(looksLikeEmail("matt@example.com")).toBe(true);
    expect(looksLikeEmail("  matt@example.com ")).toBe(true);
    expect(looksLikeEmail("matt@example")).toBe(false);
    expect(looksLikeEmail("matt")).toBe(false);
    expect(looksLikeEmail("")).toBe(false);
  });
  it("sends Google back to a shared event, or home", () => {
    expect(gateReturnTo("?from=/e/night-shift")).toBe("/e/night-shift");
    expect(gateReturnTo("?from=https://evil.example")).toBe("/");
    expect(gateReturnTo("")).toBe("/");
  });
});
