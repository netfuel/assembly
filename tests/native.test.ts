import { afterEach, describe, expect, it, vi } from "vitest";

// src/lib/native.ts decides at import whether it's running in the bundled iOS app (capacitor://localhost).
async function load(protocol: string) {
  vi.resetModules();
  vi.stubGlobal("location", { protocol, origin: `${protocol}//localhost` });
  return import("../src/lib/native");
}
afterEach(() => vi.unstubAllGlobals());

describe("native helpers on the web", () => {
  it("leave paths, credentials and responses alone", async () => {
    const n = await load("https:");
    expect(n.apiOrigin).toBe("");
    expect(n.apiCredentials).toBe("same-origin");
    expect(n.apiUrl("/api/config")).toBe("/api/config");
    const body = { flyerUrl: "/api/media/flyers/a.webp" };
    expect(n.withServerUrls(body)).toBe(body);
  });
});

describe("native helpers in the bundled app", () => {
  it("send API calls to the server, without cookies (the app uses a Bearer token)", async () => {
    const n = await load("capacitor:");
    expect(n.apiOrigin).toBe("https://assembly.rsvp");
    expect(n.apiCredentials).toBe("omit");
    expect(n.apiUrl("/api/config")).toBe("https://assembly.rsvp/api/config");
    expect(n.apiUrl("https://tiles.openfreemap.org/x")).toBe("https://tiles.openfreemap.org/x");
  });

  it("make media and font paths absolute, anywhere in a response", async () => {
    const n = await load("capacitor:");
    const out = n.withServerUrls({
      flyerUrl: "/api/media/flyers/a.webp",
      lineup: [{ photo: "/api/media/pages/b.webp", name: "/api/media is not a path here" }],
      host: { avatarUrl: "https://lh3.googleusercontent.com/x" },
      title: "/e/abc",
      count: 3,
      empty: null,
    });
    expect(out).toEqual({
      flyerUrl: "https://assembly.rsvp/api/media/flyers/a.webp",
      lineup: [{ photo: "https://assembly.rsvp/api/media/pages/b.webp", name: "/api/media is not a path here" }],
      host: { avatarUrl: "https://lh3.googleusercontent.com/x" },
      title: "/e/abc",
      count: 3,
      empty: null,
    });
  });

  it("re-points @font-face rules at the server", async () => {
    const n = await load("capacitor:");
    const appended: { textContent: string }[] = [];
    const face = '@font-face { font-family: "Timeless Sans"; src: url("/fonts/timeless/TimelessSansVF.woff2") format("woff2"); }';
    const doc = {
      styleSheets: [
        { cssRules: [{ cssText: face }, { cssText: "body { color: red; }" }] },
        {
          get cssRules(): never {
            throw new Error("cross-origin sheet");
          },
        },
      ],
      createElement: () => ({ dataset: {}, textContent: "" }),
      head: { appendChild: (el: { textContent: string }) => appended.push(el) },
    } as unknown as Document;
    n.pointFontsAtServer(doc);
    expect(appended).toHaveLength(1);
    expect(appended[0].textContent).toContain('url("https://assembly.rsvp/fonts/timeless/TimelessSansVF.woff2")');
    expect(appended[0].textContent).not.toContain("body");
  });
});
