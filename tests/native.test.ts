import { afterEach, describe, expect, it, vi } from "vitest";

// Native exactly when the page runs from the app bundle.
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => globalThis.location?.protocol === "capacitor:" } }));
const share = vi.fn();
vi.mock("@capacitor/share", () => ({ Share: { share } }));
vi.mock("@capacitor/filesystem", () => ({
  Directory: { Cache: "CACHE" },
  Filesystem: { writeFile: vi.fn(async ({ path }: { path: string }) => ({ uri: `file:///cache/${path}` })) },
}));

// src/lib/native.ts decides at import whether it's running in the bundled iOS app (capacitor://localhost).
async function load(protocol: string) {
  vi.resetModules();
  vi.stubGlobal("location", { protocol, origin: `${protocol}//localhost`, href: `${protocol}//localhost/`, pathname: "/", search: "" });
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

describe("links in the bundled app", () => {
  it("keeps app pages in the app and sends server files to Safari at the real site", async () => {
    const n = await load("capacitor:");
    expect(n.siteOrigin).toBe("https://assembly.rsvp");
    expect(n.appLinkTarget("/e/abc")).toEqual({ inApp: "/e/abc" });
    expect(n.appLinkTarget("https://assembly.rsvp/e/abc?ref=share")).toEqual({ inApp: "/e/abc?ref=share" });
    expect(n.appLinkTarget("https://assembly.rsvp/a/dj-somebody")).toEqual({ inApp: "/a/dj-somebody" });
    expect(n.appLinkTarget("https://assembly.rsvp/c/memphis/queer")).toEqual({ inApp: "/c/memphis/queer" });
    expect(n.appLinkTarget("https://assembly.rsvp/f/tok123")).toEqual({ inApp: "/f/tok123" });
    expect(n.appLinkTarget("https://assembly.rsvp/")).toEqual({ inApp: "/" });
    expect(n.appLinkTarget("/terms")).toEqual({ inApp: "/terms" });
    expect(n.appLinkTarget("/feeds/memphis.ics")).toEqual({ external: "https://assembly.rsvp/feeds/memphis.ics" });
    expect(n.appLinkTarget("/api/events/abc/calendar.ics")).toEqual({ external: "https://assembly.rsvp/api/events/abc/calendar.ics" });
  });

  it("leaves sign-in, other sites, mail and tel alone", async () => {
    const n = await load("capacitor:");
    for (const href of ["/api/auth/google?return_to=%2F", "https://instagram.com/x", "https://evil.example/e/abc", "mailto:hello@assembly.rsvp", "tel:+19015550100"]) {
      expect(n.appLinkTarget(href)).toBeNull();
    }
  });

  it("does nothing on the web", async () => {
    const n = await load("https:");
    expect(n.appLinkTarget("/e/abc")).toBeNull();
    expect(n.siteOrigin).toBe("https://localhost");
  });
});

describe("sharing in the app", () => {
  it("sends links and files to the iOS share sheet, and a closed sheet reads as AbortError", async () => {
    vi.stubGlobal("navigator", {});
    const n = await load("capacitor:");
    n.installNativeShare();
    const nav = navigator as Navigator;
    expect(nav.canShare({ files: [] })).toBe(true);

    share.mockResolvedValueOnce({});
    await nav.share({ title: "Night Shift", text: "Fri", url: "https://assembly.rsvp/e/abc" });
    expect(share).toHaveBeenLastCalledWith(expect.objectContaining({ title: "Night Shift", url: "https://assembly.rsvp/e/abc" }));

    share.mockResolvedValueOnce({});
    await nav.share({ files: [new File(["png"], "story card.png", { type: "image/png" })], title: "Night Shift" });
    expect(share.mock.lastCall?.[0].files[0]).toMatch(/^file:\/\/\/cache\/share\/\d+-story-card\.png$/);

    share.mockRejectedValueOnce(new Error("Share canceled"));
    await expect(nav.share({ url: "https://assembly.rsvp/" })).rejects.toMatchObject({ name: "AbortError" });
  });
});
