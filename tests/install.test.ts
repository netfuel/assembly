import { afterEach, describe, expect, it, vi } from "vitest";

// The Add to Home Screen tip (src/lib/install.ts): offered on iPhone Safari, never inside the iOS app.

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => globalThis.location?.protocol === "capacitor:", convertFileSrc: (u: string) => u },
  registerPlugin: () => ({}),
}));

async function load(protocol: string) {
  vi.resetModules();
  vi.stubGlobal("location", { protocol, origin: `${protocol}//localhost`, href: `${protocol}//localhost/`, pathname: "/", search: "" });
  vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", platform: "iPhone", maxTouchPoints: 5 });
  vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => undefined });
  return import("../src/lib/install");
}
afterEach(() => vi.unstubAllGlobals());

describe("the home screen tip", () => {
  it("shows the Share steps in iPhone Safari", async () => {
    expect((await load("https:")).installMode()).toBe("ios");
  });

  it("never shows in the iOS app", async () => {
    const m = await load("capacitor:");
    expect(m.installMode()).toBeNull();
    expect(m.welcomeMode()).toBeNull();
  });
});
