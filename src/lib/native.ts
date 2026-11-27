// The iOS app (Capacitor, docs/ios.md) runs this same build from inside the app, at capacitor://localhost.
// Nothing is same-origin there, so anything the web app fetches or links by path (/api/..., /api/media/...,
// /fonts/...) has to name the server. On the web every helper here is a no-op.
import { Capacitor } from "@capacitor/core";

/** Running inside the iOS app (bundled, or pointed at a dev server with CAP_SERVER_URL). */
export const isNativeApp = Capacitor.isNativePlatform();

/**
 * Where the API lives, or "" when it's the page's own origin. Only the bundled app needs it: in dev mode the
 * app loads from the dev server, so /api is same-origin there as on the web.
 */
export const apiOrigin: string =
  typeof location !== "undefined" && location.protocol === "capacitor:"
    ? ((import.meta.env.VITE_API_ORIGIN as string | undefined) ?? "https://assembly.rsvp").replace(/\/$/, "")
    : "";

/** The site's cookie goes along on the web. The app sends a Bearer token instead (src/lib/nativeAuth.ts). */
export const apiCredentials: RequestCredentials = apiOrigin ? "omit" : "same-origin";

/** A server path (/api/...) as a URL this page can fetch. Absolute URLs pass through. */
export function apiUrl(path: string): string {
  return apiOrigin && path.startsWith("/") ? apiOrigin + path : path;
}

const SERVER_PATH = /^\/(api\/media|fonts)\//;

/**
 * Makes the server's own paths in an API response absolute (flyer, thumbnail and photo URLs are sent as
 * /api/media/...), so images load in the app. Returns the value unchanged on the web.
 */
export function withServerUrls<T>(value: T): T {
  if (!apiOrigin) return value;
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return SERVER_PATH.test(v) ? apiOrigin + v : v;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) out[k] = walk(x);
      return out;
    }
    return v;
  };
  return walk(value) as T;
}

/**
 * The @font-face rules point at /fonts/timeless/ on the page's origin. In the app, add the same faces pointed at
 * the server; a later rule with the same descriptors wins, so these take over. The CSS is already applied when
 * this runs (stylesheets load before module scripts), and a sheet that can't be read is skipped.
 */
export function pointFontsAtServer(doc: Document = document) {
  if (!apiOrigin) return;
  const rules: string[] = [];
  for (const sheet of Array.from(doc.styleSheets)) {
    let list: CSSRuleList;
    try {
      list = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of Array.from(list)) {
      const css = rule.cssText;
      if (css.startsWith("@font-face") && css.includes("/fonts/")) rules.push(css.replace(/url\(\s*(["']?)\/fonts\//g, `url($1${apiOrigin}/fonts/`));
    }
  }
  if (!rules.length) return;
  const style = doc.createElement("style");
  style.dataset.nativeFonts = "";
  style.textContent = rules.join("\n");
  doc.head.appendChild(style);
}

/**
 * The site's public origin, for links people share or subscribe to (an event, an invite, a feed). In the
 * bundled app the page's own origin is capacitor://localhost, which means nothing outside the app.
 */
export const siteOrigin: string = apiOrigin || (typeof location !== "undefined" ? location.origin : "");

// ---------------------------------------------------------------------------------------------------------
// Links in the iOS app. assembly.rsvp links open the app (universal links: the applinks entry in
// /.well-known/apple-app-site-association, worker/passkeys.ts), and links inside the app stay inside it.

/** Paths the app shows itself (src/app/App.tsx, src/main.tsx). Anything else on the site opens in Safari. */
const APP_PATH = /^\/(?:$|feed\/?$|e\/[^/]+|a\/[^/]+|v\/[^/]+|o\/[^/]+|f\/[^/]+|c\/[^/]+(?:\/[^/]+)?|terms|privacy|guidelines)/;
/** Paths the app's own history handling (popstate) can open without a reload. */
const SOFT_PATH = /^\/(?:$|feed\/?$|e\/[^/]+$|a\/[^/]+$|v\/[^/]+$|o\/[^/]+$)/;

const siteHost = () => (apiOrigin ? new URL(apiOrigin).host : "");

/**
 * Where a URL should go from inside the app: an app path to show, a server URL to hand to Safari, or nothing
 * (leave the link alone: other sites, mail, tel).
 */
export function appLinkTarget(href: string): { inApp: string } | { external: string } | null {
  if (!apiOrigin) return null;
  let u: URL;
  try {
    u = new URL(href, location.href);
  } catch {
    return null;
  }
  const ours = u.protocol === "capacitor:" || ((u.protocol === "https:" || u.protocol === "http:") && u.host === siteHost());
  if (!ours) return null;
  const path = u.pathname + u.search + u.hash;
  if (/^\/api\/auth\/(google|apple)$/.test(u.pathname)) return null; // sign-in has its own handler (nativeAuth.ts)
  if (APP_PATH.test(u.pathname)) return { inApp: path };
  // Server files (a calendar feed, an .ics, a flyer download): Safari, at the real site.
  return { external: apiOrigin + path };
}

/** Shows an app path: through the app's own history when it can, else by loading the bundle at that path. */
export function openInApp(path: string) {
  const pathname = path.split(/[?#]/)[0];
  if (SOFT_PATH.test(pathname) && document.getElementById("root")?.childElementCount) {
    history.pushState(null, "", path);
    window.dispatchEvent(new PopStateEvent("popstate"));
  } else {
    location.assign(path);
  }
}

/** One click handler for every link in the app (the screens don't need to know they're in an app). */
export function interceptAppLinks(doc: Document = document) {
  if (!apiOrigin) return;
  doc.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const link = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (!link || link.hasAttribute("download")) return;
    const target = appLinkTarget(link.getAttribute("href") ?? "");
    if (!target) return;
    e.preventDefault();
    if ("inApp" in target) openInApp(target.inApp);
    // Capacitor hands navigations to other hosts to Safari.
    else location.href = target.external;
  });
}

/** Universal links: an assembly.rsvp link tapped anywhere on the phone opens (or launches) the app on it. */
export async function listenForUniversalLinks() {
  if (!apiOrigin) return;
  const { App } = await import("@capacitor/app");
  const go = (url: string | undefined) => {
    const target = url ? appLinkTarget(url) : null;
    if (target && "inApp" in target && target.inApp !== location.pathname + location.search) openInApp(target.inApp);
  };
  await App.addListener("appUrlOpen", ({ url }) => go(url));
  go((await App.getLaunchUrl())?.url);
}

// ---------------------------------------------------------------------------------------------------------
// Sharing in the iOS app: the screens call navigator.share / canShare (links, story cards, flyers). Here
// those go to iOS's own share sheet, files included, so every Share button works unchanged.

async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function installNativeShare() {
  if (!isNativeApp || typeof navigator === "undefined") return;
  const share = async (data: ShareData = {}) => {
    const { Share } = await import("@capacitor/share");
    try {
      if (data.files?.length) {
        const { Filesystem, Directory } = await import("@capacitor/filesystem");
        const files: string[] = [];
        for (const f of data.files) {
          const name = f.name.replace(/[^\w.-]+/g, "-") || "assembly";
          const written = await Filesystem.writeFile({ path: `share/${Date.now()}-${name}`, data: await toBase64(f), directory: Directory.Cache, recursive: true });
          files.push(written.uri);
        }
        await Share.share({ title: data.title, text: data.text, files });
      } else {
        await Share.share({ title: data.title, text: data.text, url: data.url, dialogTitle: data.title });
      }
    } catch (err) {
      // Closing the sheet is not an error; the screens already treat AbortError as "never mind".
      if (err instanceof Error && /cancel/i.test(err.message)) throw new DOMException("Share canceled", "AbortError");
      throw err;
    }
  };
  Object.defineProperty(navigator, "share", { value: share, configurable: true });
  Object.defineProperty(navigator, "canShare", { value: () => true, configurable: true });
}
