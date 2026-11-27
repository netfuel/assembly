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
