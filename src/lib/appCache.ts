// Offline copies in the iOS app (docs/ios.md). The web keeps saved events for the door with its service worker
// (vite.config.ts runtime caches); WKWebView runs no service worker for the app's content, so the app keeps its
// own copy on the device instead: JSON for a few API answers, and flyer images as files.
//
// - Always refreshed when they load: your profile, your Going list, event lists, the city record.
// - Saved for the door by saveForOffline: each Going or Saved event's details, with its flyer stored locally.
// - With no connection, the API client (src/lib/api.ts request) answers from these copies.
// - Sign-out and account deletion wipe them (clearUserCaches in src/lib/offline.ts).
import { Capacitor } from "@capacitor/core";
import { apiOrigin } from "./native";

/** Only the bundled app keeps its own copies; the web has the service worker. */
export const appCacheOn = !!apiOrigin;

const JSON_DIR = "offline";
const MEDIA_DIR = "offline-media";

/** API answers worth having offline. Event details are written only for saved events (saveEventForOffline). */
const KEPT = [/^\/api\/me$/, /^\/api\/me\/events$/, /^\/api\/events(\?.*)?$/, /^\/api\/cities\/[^/?]+$/];
const READABLE = [...KEPT, /^\/api\/events\/[^/?]+$/];

export const keptOnLoad = (path: string) => appCacheOn && KEPT.some((r) => r.test(path));
export const readableOffline = (path: string) => appCacheOn && READABLE.some((r) => r.test(path));

/** One file per API path, named by its base64url so any query string is safe in a file name. */
export function fileFor(path: string): string {
  const name = btoa(unescape(encodeURIComponent(path))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${JSON_DIR}/${name}.json`;
}

const fs = () => import("@capacitor/filesystem");

export async function putOffline(path: string, body: unknown): Promise<void> {
  if (!appCacheOn) return;
  try {
    const { Filesystem, Directory, Encoding } = await fs();
    await Filesystem.writeFile({ path: fileFor(path), data: JSON.stringify(body), directory: Directory.Data, encoding: Encoding.UTF8, recursive: true });
  } catch (err) {
    console.error("offline copy", err);
  }
}

export async function getOffline<T>(path: string): Promise<T | null> {
  if (!appCacheOn) return null;
  try {
    const { Filesystem, Directory, Encoding } = await fs();
    const { data } = await Filesystem.readFile({ path: fileFor(path), directory: Directory.Data, encoding: Encoding.UTF8 });
    return JSON.parse(typeof data === "string" ? data : await data.text()) as T;
  } catch {
    return null;
  }
}

async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/**
 * Stores a flyer on the device and returns a URL the app's web view can show it from, with no connection.
 * Flyers are immutable (a new upload gets a new key), so one already stored is reused. Null on failure.
 */
export async function keepFlyer(url: string): Promise<string | null> {
  if (!appCacheOn || !/^https:\/\//.test(url)) return null;
  try {
    const { Filesystem, Directory } = await fs();
    const ext = (/\.(webp|jpe?g|png|gif|avif)(?:$|\?)/i.exec(url)?.[1] ?? "img").toLowerCase();
    const path = `${MEDIA_DIR}/${fileFor(url).slice(JSON_DIR.length + 1, -5)}.${ext}`;
    try {
      const { uri } = await Filesystem.getUri({ path, directory: Directory.Data });
      await Filesystem.stat({ path, directory: Directory.Data });
      return Capacitor.convertFileSrc(uri);
    } catch {
      // Not stored yet.
    }
    const res = await fetch(url, { credentials: "omit" });
    if (!res.ok) return null;
    const { uri } = await Filesystem.writeFile({ path, data: await toBase64(await res.blob()), directory: Directory.Data, recursive: true });
    return Capacitor.convertFileSrc(uri);
  } catch {
    return null;
  }
}

/** Drops every offline copy (sign-out, account deletion). */
export async function clearOffline(): Promise<void> {
  if (!appCacheOn) return;
  try {
    const { Filesystem, Directory } = await fs();
    for (const path of [JSON_DIR, MEDIA_DIR]) await Filesystem.rmdir({ path, directory: Directory.Data, recursive: true }).catch(() => undefined);
  } catch {
    // Nothing stored.
  }
}
