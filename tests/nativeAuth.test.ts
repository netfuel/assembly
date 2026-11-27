import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Sign-in inside the bundled iOS app (src/lib/nativeAuth.ts): the system sheet, the hand-off, the keychain.

const plugin = {
  authenticate: vi.fn(),
  getToken: vi.fn(async () => ({})),
  setToken: vi.fn(async () => undefined),
  clearToken: vi.fn(async () => undefined),
};
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => true },
  registerPlugin: () => plugin,
}));

const assign = vi.fn();
async function load(protocol = "capacitor:") {
  vi.resetModules();
  vi.stubGlobal("location", { protocol, href: `${protocol}//localhost/`, origin: `${protocol}//localhost`, assign });
  return import("../src/lib/nativeAuth");
}
const s256 = async (v: string) =>
  btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)))))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

beforeEach(() => {
  for (const f of Object.values(plugin)) f.mockClear();
  assign.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe("app sign-in helpers", () => {
  it("make a verifier and its S256 challenge", async () => {
    const n = await load();
    const { verifier, challenge } = await n.pkcePair();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(challenge).toBe(await s256(verifier));
  });

  it("read the app's callback, and only the app's", async () => {
    const n = await load();
    expect(n.readAppCallback("rsvp.assembly.app://auth?signin=ok&code=abc&return_to=%2Fe%2Fx")).toEqual({ signin: "ok", code: "abc", returnTo: "/e/x" });
    expect(n.readAppCallback("rsvp.assembly.app://auth?signin=waitlist")).toEqual({ signin: "waitlist", code: null, returnTo: null });
    expect(n.readAppCallback("rsvp.assembly.app://auth?signin=ok&code=a&return_to=https%3A%2F%2Fevil.example").returnTo).toBe("/");
    expect(n.readAppCallback("https://evil.example/auth?signin=ok&code=a").signin).toBe("failed");
    expect(n.readAppCallback("nonsense").signin).toBe("failed");
  });

  it("land where the web round-trip would", async () => {
    const n = await load();
    expect(n.landing("/e/x", "ok")).toBe("/e/x?signin=ok");
    expect(n.landing("/?compose=1", "failed")).toBe("/?compose=1&signin=failed");
    expect(n.landing("/e/x", "waitlist")).toBe("/?signin=waitlist");
    expect(n.landing("//evil.example", "ok")).toBe("/?signin=ok");
  });

  it("do nothing on the web", async () => {
    const n = await load("https:");
    expect(n.usesAppSession).toBe(false);
    await n.saveAppSession("tok");
    expect(n.sessionHeaders()).toEqual({});
    expect(plugin.setToken).not.toHaveBeenCalled();
  });
});

describe("Google or Apple sign-in in the app", () => {
  it("opens the sheet, trades the code with the verifier, keeps the token, and lands signed in", async () => {
    const n = await load();
    let challenge = "";
    plugin.authenticate.mockImplementation(async ({ url, callbackScheme }: { url: string; callbackScheme: string }) => {
      const u = new URL(url);
      expect(u.origin + u.pathname).toBe("https://assembly.rsvp/api/auth/google");
      expect(callbackScheme).toBe("rsvp.assembly.app");
      challenge = u.searchParams.get("app")!;
      return { url: `rsvp.assembly.app://auth?signin=ok&code=handoff-code-1234567890&return_to=${encodeURIComponent(u.searchParams.get("return_to")!)}` };
    });
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      const { code, verifier } = JSON.parse(init.body as string);
      expect(code).toBe("handoff-code-1234567890");
      expect(await s256(verifier)).toBe(challenge);
      return { ok: true, json: async () => ({ token: "session-token-from-server-0123456789abcdef" }) };
    });
    vi.stubGlobal("fetch", fetch);

    await n.appSignIn("google", "/e/night-shift");
    expect(fetch).toHaveBeenCalledWith("https://assembly.rsvp/api/auth/app/exchange", expect.objectContaining({ method: "POST" }));
    expect(plugin.setToken).toHaveBeenCalledWith({ token: "session-token-from-server-0123456789abcdef" });
    expect(n.sessionHeaders()).toEqual({ Authorization: "Bearer session-token-from-server-0123456789abcdef" });
    expect(assign).toHaveBeenCalledWith("/e/night-shift?signin=ok");
  });

  it("goes back to the gate when the address isn't on the list", async () => {
    const n = await load();
    plugin.authenticate.mockResolvedValue({ url: "rsvp.assembly.app://auth?signin=waitlist" });
    await n.appSignIn("apple", "/e/x");
    expect(plugin.setToken).not.toHaveBeenCalled();
    expect(assign).toHaveBeenCalledWith("/?signin=waitlist");
  });

  it("stays put when the sheet is closed", async () => {
    const n = await load();
    plugin.authenticate.mockResolvedValue({ cancelled: true });
    await n.appSignIn("google", "/");
    expect(assign).not.toHaveBeenCalled();
  });

  it("reports a failed exchange", async () => {
    const n = await load();
    plugin.authenticate.mockResolvedValue({ url: "rsvp.assembly.app://auth?signin=ok&code=handoff-code-1234567890" });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    await n.appSignIn("google", "/");
    expect(plugin.setToken).not.toHaveBeenCalled();
    expect(assign).toHaveBeenCalledWith("/?signin=failed");
  });
});

describe("sign-in links in the app", () => {
  it("are caught before the page sees them; other links aren't", async () => {
    const n = await load();
    plugin.authenticate.mockResolvedValue({ cancelled: true });
    let listener: ((e: Event) => void) | undefined;
    const doc = { addEventListener: (_t: string, l: (e: Event) => void) => (listener = l) } as unknown as Document;
    n.interceptSignInLinks(doc);
    const click = (href: string) => {
      const e = {
        target: { closest: () => ({ href }) },
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      };
      listener!(e as unknown as Event);
      return e;
    };
    const caught = click("capacitor://localhost/api/auth/apple?return_to=%2Fe%2Fx");
    expect(caught.preventDefault).toHaveBeenCalled();
    expect(caught.stopPropagation).toHaveBeenCalled();
    await vi.waitFor(() => expect(plugin.authenticate).toHaveBeenCalled());
    expect(new URL(plugin.authenticate.mock.calls[0][0].url).searchParams.get("return_to")).toBe("/e/x");

    for (const href of ["capacitor://localhost/e/x", "capacitor://localhost/api/auth/dev?name=x", "https://instagram.com/x"]) {
      expect(click(href).preventDefault).not.toHaveBeenCalled();
    }
  });
});
