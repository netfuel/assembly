// Signing in inside the iOS app (docs/ios.md, worker/appAuth.ts). The bundled app runs at capacitor://localhost,
// where the site's session cookie can't reach, so it holds a session token instead: kept in the keychain by the
// AssemblyAuth plugin (native/assembly-auth), sent as a Bearer token. Google and Apple sign-in run in the system
// sign-in sheet. On the web, and in dev mode (the app loading `npm run dev`), none of this runs: the cookie works.
import { registerPlugin } from "@capacitor/core";
import { apiOrigin, apiUrl } from "./native";

interface AssemblyAuthPlugin {
  authenticate(options: { url: string; callbackScheme: string }): Promise<{ url?: string; cancelled?: boolean }>;
  getToken(): Promise<{ token?: string }>;
  setToken(options: { token: string }): Promise<void>;
  clearToken(): Promise<void>;
}

const AssemblyAuth = registerPlugin<AssemblyAuthPlugin>("AssemblyAuth");

/** The server sends the sign-in sheet here when it's done (worker/appAuth.ts APP_SCHEME). */
const APP_SCHEME = "rsvp.assembly.app";

/** Only the bundled app needs its own session; everywhere else the cookie does the job. */
export const usesAppSession = !!apiOrigin;

let token: string | null = null;

/** Reads the token from the keychain. Run once before the first API call. */
export async function loadAppSession(): Promise<void> {
  if (!usesAppSession) return;
  try {
    token = (await AssemblyAuth.getToken()).token ?? null;
  } catch {
    token = null;
  }
}

/** The Authorization header for API calls from the app; nothing on the web. */
export function sessionHeaders(): Record<string, string> {
  return usesAppSession && token ? { Authorization: `Bearer ${token}` } : {};
}

export async function saveAppSession(value: string): Promise<void> {
  if (!usesAppSession) return;
  token = value;
  await AssemblyAuth.setToken({ token: value }).catch((err) => console.error("keychain save", err));
}

/** After sign-out or account deletion. */
export async function clearAppSession(): Promise<void> {
  if (!usesAppSession) return;
  token = null;
  await AssemblyAuth.clearToken().catch((err) => console.error("keychain clear", err));
}

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** A PKCE verifier (stays in the app) and its S256 challenge (goes to the server first). */
export async function pkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: b64url(new Uint8Array(digest)) };
}

type Result = "ok" | "failed" | "waitlist";

/** Same-site paths only, as the server allows (worker/auth.ts safeReturnTo). */
function safePath(value: string | null | undefined): string {
  return value && value.startsWith("/") && !value.startsWith("//") && !/[\\\u0000-\u001f]/.test(value) ? value : "/";
}

/** Where the sign-in sheet came back to: rsvp.assembly.app://auth?signin=…&code=…&return_to=… */
export function readAppCallback(url: string): { signin: Result; code: string | null; returnTo: string | null } {
  try {
    const u = new URL(url);
    const signin = u.searchParams.get("signin");
    if (u.protocol !== `${APP_SCHEME}:`) throw new Error("not ours");
    return {
      signin: signin === "ok" || signin === "waitlist" ? signin : "failed",
      code: u.searchParams.get("code"),
      returnTo: u.searchParams.has("return_to") ? safePath(u.searchParams.get("return_to")) : null,
    };
  } catch {
    return { signin: "failed", code: null, returnTo: null };
  }
}

/** The page to land on, with ?signin= as the web round-trip leaves it (the gate and app read it). */
export function landing(path: string, result: Result): string {
  const p = result === "waitlist" ? "/" : safePath(path);
  return `${p}${p.includes("?") ? "&" : "?"}signin=${result}`;
}

/** Google or Apple sign-in in the system sheet, then into the app signed in (or turned away, as on the web). */
export async function appSignIn(provider: "google" | "apple", returnTo: string): Promise<void> {
  const { verifier, challenge } = await pkcePair();
  const url = `${apiUrl(`/api/auth/${provider}`)}?app=${challenge}&return_to=${encodeURIComponent(safePath(returnTo))}`;
  let answer: { url?: string; cancelled?: boolean };
  try {
    answer = await AssemblyAuth.authenticate({ url, callbackScheme: APP_SCHEME });
  } catch (err) {
    console.error("sign-in sheet", err);
    location.assign(landing(returnTo, "failed"));
    return;
  }
  if (answer.cancelled || !answer.url) return; // closed the sheet: stay put
  const back = readAppCallback(answer.url);
  const destination = back.returnTo ?? returnTo;
  if (back.signin !== "ok" || !back.code) {
    location.assign(landing(destination, back.signin));
    return;
  }
  const res = await fetch(apiUrl("/api/auth/app/exchange"), {
    method: "POST",
    credentials: "omit",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ code: back.code, verifier }),
  }).catch(() => null);
  const body = res?.ok ? ((await res.json().catch(() => null)) as { token?: string } | null) : null;
  if (!body?.token) {
    location.assign(landing(destination, "failed"));
    return;
  }
  await saveAppSession(body.token);
  location.assign(landing(destination, "ok"));
}

const SIGN_IN_PATH = /^\/api\/auth\/(google|apple)$/;

/**
 * Every Google and Apple button is a plain link to /api/auth/{provider}?return_to=… (the gate, the sign-in
 * sheet). In the app, catch those clicks before anything else and run the sheet instead. One place, so the
 * screens don't need to know they're in an app.
 */
export function interceptSignInLinks(doc: Document = document): void {
  if (!usesAppSession) return;
  doc.addEventListener(
    "click",
    (e) => {
      const link = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!link) return;
      const u = new URL(link.href, location.href);
      const match = SIGN_IN_PATH.exec(u.pathname);
      if (!match) return;
      e.preventDefault();
      e.stopPropagation();
      void appSignIn(match[1] as "google" | "apple", u.searchParams.get("return_to") ?? "/");
    },
    { capture: true },
  );
}
