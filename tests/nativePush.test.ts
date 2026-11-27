import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Push in the iOS app (src/lib/nativePush.ts), with Apple's side played by a fake plugin.

type Listener = (arg: unknown) => void;
const listeners = new Map<string, Listener[]>();
const plugin = {
  permission: "prompt" as "prompt" | "granted" | "denied",
  /** What register() produces: a token, or an error. */
  nextToken: "a".repeat(64) as string | null,
  registered: 0,
  unregistered: 0,
  checkPermissions: vi.fn(async () => ({ receive: plugin.permission })),
  requestPermissions: vi.fn(async () => {
    if (plugin.permission === "prompt") plugin.permission = "granted";
    return { receive: plugin.permission };
  }),
  register: vi.fn(async () => {
    plugin.registered++;
    queueMicrotask(() => {
      if (plugin.nextToken) emit("registration", { value: plugin.nextToken });
      else emit("registrationError", { error: "no" });
    });
  }),
  unregister: vi.fn(async () => void plugin.unregistered++),
  addListener: vi.fn(async (name: string, fn: Listener) => {
    listeners.set(name, [...(listeners.get(name) ?? []), fn]);
    return { remove: async () => listeners.set(name, (listeners.get(name) ?? []).filter((f) => f !== fn)) };
  }),
};
function emit(name: string, arg: unknown) {
  for (const fn of listeners.get(name) ?? []) fn(arg);
}

vi.mock("@capacitor/push-notifications", () => ({ PushNotifications: plugin }));
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => true, convertFileSrc: (u: string) => u },
  registerPlugin: () => ({ getToken: async () => ({ token: "session-token" }), setToken: async () => undefined, clearToken: async () => undefined }),
}));

const storage = new Map<string, string>();
let posts: { path: string; body: { token: string }; auth?: string }[];
let opened: string[];

async function load() {
  vi.resetModules();
  vi.stubGlobal("location", { protocol: "capacitor:", origin: "capacitor://localhost", href: "capacitor://localhost/", pathname: "/", search: "", assign: (p: string) => opened.push(p) });
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, v),
    removeItem: (k: string) => void storage.delete(k),
  });
  vi.stubGlobal("document", { getElementById: () => null });
  const auth = await import("../src/lib/nativeAuth");
  await auth.loadAppSession();
  return import("../src/lib/nativePush");
}

beforeEach(() => {
  listeners.clear();
  storage.clear();
  Object.assign(plugin, { permission: "prompt", nextToken: "a".repeat(64), registered: 0, unregistered: 0 });
  posts = [];
  opened = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      posts.push({ path: url.replace("https://assembly.rsvp", ""), body: JSON.parse(init.body as string), auth: (init.headers as Record<string, string>).Authorization });
      return new Response("{}", { status: 200 });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("notifications in the app", () => {
  it("ask iOS, register the phone with the server, and show as on", async () => {
    const m = await load();
    expect(await m.getNativePushState()).toBe("off");
    expect(await m.enableNativePush()).toBe("on");
    expect(posts).toEqual([{ path: "/api/push/apns", body: { token: "a".repeat(64) }, auth: "Bearer session-token" }]);
    expect(await m.getNativePushState()).toBe("on");
    expect(listeners.get("registration")).toEqual([]);
  });

  it("show as blocked when you said no, without registering", async () => {
    plugin.permission = "denied";
    const m = await load();
    expect(await m.enableNativePush()).toBe("blocked");
    expect(await m.getNativePushState()).toBe("blocked");
    expect(plugin.registered).toBe(0);
  });

  it("explain a failed registration and leave notifications off", async () => {
    plugin.nextToken = null;
    const m = await load();
    await expect(m.enableNativePush()).rejects.toThrow(/couldn't register/);
    expect(posts).toEqual([]);
    expect(await m.getNativePushState()).toBe("off");
  });

  it("turn off, and stop for the account on sign-out", async () => {
    const m = await load();
    await m.enableNativePush();
    expect(await m.disableNativePush()).toBe("off");
    expect(posts.at(-1)?.path).toBe("/api/push/apns/remove");
    expect(plugin.unregistered).toBe(1);

    await m.enableNativePush();
    await m.forgetThisDevice();
    expect(posts.at(-1)?.path).toBe("/api/push/apns/remove");
    expect(await m.getNativePushState()).toBe("off");
  });

  it("send a new device token at launch, and open the event a tap was for", async () => {
    plugin.permission = "granted";
    storage.set("assembly-apns-token", "b".repeat(64));
    const m = await load();
    await m.startNativePush();
    expect(posts.map((p) => [p.path, p.body.token[0]])).toEqual([
      ["/api/push/apns", "a"],
      ["/api/push/apns/remove", "b"],
    ]);

    emit("pushNotificationActionPerformed", { notification: { data: { url: "/e/night-shift" } } });
    emit("pushNotificationActionPerformed", { notification: { data: { url: "https://evil.example/" } } });
    emit("pushNotificationActionPerformed", { notification: { data: { url: "//evil.example/" } } });
    expect(opened).toEqual(["/e/night-shift"]);
  });

  it("don't register at launch when notifications were never turned on", async () => {
    plugin.permission = "granted";
    const m = await load();
    await m.startNativePush();
    expect(plugin.registered).toBe(0);
  });
});
