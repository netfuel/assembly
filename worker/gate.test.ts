import { describe, expect, it } from "vitest";
import { gateAllowList, gateAllowsEmail, gateFor, gateOn, gatePublic } from "./gate";

describe("launch gate switch", () => {
  it("is off unless GATE is exactly on", () => {
    expect(gateOn({})).toBe(false);
    expect(gateOn({ GATE: "off" })).toBe(false);
    expect(gateOn({ GATE: "" })).toBe(false);
    expect(gateOn({ GATE: "on" })).toBe(true);
    expect(gateOn({ GATE: " ON " })).toBe(true);
  });
  it("tells a listed sign-in the gate is off for them", () => {
    expect(gateFor({ GATE: "on" }, false)).toBe("on");
    expect(gateFor({ GATE: "on" }, true)).toBe("off-for-you");
    expect(gateFor({}, false)).toBe("off");
    expect(gateFor({}, true)).toBe("off");
  });
  it("lets only listed emails through while on", () => {
    const env = { GATE: "on", MODERATORS: "Matt@Example.com, 'x@y.org'", GATE_ALLOW: "tester@example.com\nnot-an-email" };
    expect(gateAllowList(env)).toEqual(["matt@example.com", "x@y.org", "tester@example.com"]);
    expect(gateAllowsEmail(env, "matt@example.com")).toBe(true);
    expect(gateAllowsEmail(env, "TESTER@example.com")).toBe(true);
    expect(gateAllowsEmail(env, "someone@gmail.com")).toBe(false);
    expect(gateAllowsEmail(env, null)).toBe(false);
    expect(gateAllowsEmail({ GATE: "on" }, "matt@example.com")).toBe(false);
    expect(gateAllowsEmail({}, "someone@gmail.com")).toBe(true);
  });
});

describe("gated API allow-list", () => {
  it("lets a gated visitor reach only what the gate screen needs", () => {
    for (const [path, method] of [
      ["/config", "GET"],
      ["/health", "GET"],
      ["/log", "POST"],
      ["/interest", "POST"],
      ["/auth/google", "GET"],
      ["/auth/google/callback", "GET"],
      ["/auth/email/start", "POST"],
      ["/auth/providers", "GET"],
      ["/media/flyers/abc/x.jpg", "GET"],
      ["/og/event-1.png", "GET"],
    ] as const) {
      expect(gatePublic(path, method), `${method} ${path}`).toBe(true);
    }
  });
  it("denies everything else, including reads", () => {
    for (const [path, method] of [
      ["/events", "GET"],
      ["/events/abc", "GET"],
      ["/search?q=x", "GET"],
      ["/me", "GET"],
      ["/cities/memphis", "GET"],
      ["/interest", "GET"],
      ["/interest/export", "GET"],
      ["/pages/venue-1", "GET"],
      ["/friends", "GET"],
      ["/push/subscribe", "POST"],
      ["/uploads/flyer", "POST"],
    ] as const) {
      expect(gatePublic(path, method), `${method} ${path}`).toBe(false);
    }
  });
});
