import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Offline copies in the iOS app (src/lib/appCache.ts), through the real API client (src/lib/api.ts).

const files = new Map<string, string>();
vi.mock("@capacitor/filesystem", () => ({
  Directory: { Data: "DATA" },
  Encoding: { UTF8: "utf8" },
  Filesystem: {
    writeFile: vi.fn(async ({ path, data }: { path: string; data: string }) => {
      files.set(path, data);
      return { uri: `file:///data/${path}` };
    }),
    readFile: vi.fn(async ({ path }: { path: string }) => {
      if (!files.has(path)) throw new Error("File does not exist");
      return { data: files.get(path)! };
    }),
    stat: vi.fn(async ({ path }: { path: string }) => {
      if (!files.has(path)) throw new Error("File does not exist");
      return {};
    }),
    getUri: vi.fn(async ({ path }: { path: string }) => ({ uri: `file:///data/${path}` })),
    rmdir: vi.fn(async ({ path }: { path: string }) => {
      for (const k of [...files.keys()]) if (k.startsWith(`${path}/`)) files.delete(k);
    }),
  },
}));
vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => globalThis.location?.protocol === "capacitor:",
    convertFileSrc: (uri: string) => uri.replace("file://", "capacitor://localhost/_capacitor_file_"),
  },
  registerPlugin: () => ({ getToken: async () => ({}), setToken: async () => undefined, clearToken: async () => undefined }),
}));

async function load(protocol = "capacitor:") {
  vi.resetModules();
  vi.stubGlobal("location", { protocol, origin: `${protocol}//localhost`, href: `${protocol}//localhost/`, pathname: "/", search: "" });
  vi.stubGlobal("navigator", { onLine: true });
  vi.stubGlobal("window", {});
  const api = await import("../src/lib/api");
  const cache = await import("../src/lib/appCache");
  const offline = await import("../src/lib/offline");
  return { ...api, ...cache, ...offline };
}

const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body, blob: async () => new Blob(["img"]) });
let online = true;
let responses: Record<string, unknown> = {};
beforeEach(() => {
  files.clear();
  online = true;
  responses = {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (!online) throw new TypeError("Load failed");
      const path = url.replace("https://assembly.rsvp", "");
      return json(responses[path] ?? {});
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("offline copies in the app", () => {
  it("keep your profile and Going list as they load, and answer with them offline", async () => {
    const m = await load();
    responses["/api/me"] = { user: { id: "u1", displayName: "Matt" } };
    expect((await m.api.me())?.displayName).toBe("Matt");
    await vi.waitFor(() => expect(files.size).toBe(1));

    online = false;
    expect((await m.api.me())?.displayName).toBe("Matt");
  });

  it("keep a saved event's details and flyer for the door", async () => {
    const m = await load();
    responses["/api/events/night-1"] = { id: "night-1", title: "Night Shift", address: "123 Main St", flyerUrl: "/api/media/flyers/abc.webp" };
    await m.saveForOffline([{ id: "night-1" }]);

    online = false;
    const e = await m.api.event("night-1");
    expect(e.address).toBe("123 Main St");
    expect(e.flyerUrl).toMatch(/^capacitor:\/\/localhost\/_capacitor_file_\/data\/offline-media\/.+\.webp$/);
  });

  it("don't keep events you only looked at, and never answer a write offline", async () => {
    const m = await load();
    responses["/api/events/glance"] = { id: "glance" };
    await m.api.event("glance");
    online = false;
    await expect(m.api.event("glance")).rejects.toMatchObject({ status: 0 });
    await expect(m.api.rsvp("glance", "going")).rejects.toMatchObject({ status: 0 });
  });

  it("are wiped on sign-out", async () => {
    const m = await load();
    responses["/api/me"] = { user: { id: "u1", displayName: "Matt" } };
    await m.api.me();
    await vi.waitFor(() => expect(files.size).toBe(1));
    await m.clearUserCaches();
    expect(files.size).toBe(0);
    online = false;
    await expect(m.api.me()).rejects.toMatchObject({ status: 0 });
  });

  it("aren't kept on the web (the service worker does it there)", async () => {
    const m = await load("https:");
    responses["/api/me"] = { user: { id: "u1" } };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => json(responses[url] ?? {})),
    );
    await m.api.me();
    expect(files.size).toBe(0);
    expect(m.fileFor("/api/events?city=memphis&from=1")).toMatch(/^offline\/[A-Za-z0-9_-]+\.json$/);
  });
});
