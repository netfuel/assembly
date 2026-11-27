import { useSyncExternalStore } from "react";
import { isNativeApp } from "./native";
import { api } from "./api";
import { appCacheOn, clearOffline, keepFlyer, putOffline } from "./appCache";

// Saved events work offline: fetching them once while online lets the service worker keep a copy
// (see the event-details and media caches in vite.config.ts).

const USER_CACHES = ["event-details", "api-me"];

/**
 * Fetch details and flyers for these events and store them in the caches the service worker reads
 * when offline. Writes the caches directly, so it works on the first visit before the worker takes control.
 */
export async function saveForOffline(events: { id: string }[]) {
  if (appCacheOn) return saveForOfflineInApp(events);
  if (isNativeApp || !("caches" in window) || !navigator.onLine) return;
  try {
    const details = await caches.open("event-details");
    const media = await caches.open("media");
    for (const { id } of events.slice(0, 40)) {
      try {
        const url = new URL(`/api/events/${encodeURIComponent(id)}`, location.origin).toString();
        const res = await fetch(url, { credentials: "same-origin" });
        if (!res.ok) continue;
        await details.put(url, res.clone());
        const detail = (await res.json()) as { flyerUrl?: string | null };
        if (detail.flyerUrl) {
          const flyer = new URL(detail.flyerUrl, location.origin).toString();
          if (!(await media.match(flyer))) {
            const img = await fetch(flyer);
            if (img.ok) await media.put(flyer, img);
          }
        }
      } catch {
        // Flaky connection: try again next time.
      }
    }
  } catch {
    // Cache storage unavailable (private mode, for example).
  }
}

/**
 * The iOS app's copy (src/lib/appCache.ts): each event's details, with the flyer stored on the device and the
 * copy pointing at it, so the address, set times and flyer all open with no signal.
 */
async function saveForOfflineInApp(events: { id: string }[]) {
  if (!navigator.onLine) return;
  for (const { id } of events.slice(0, 40)) {
    try {
      const detail = await api.event(id);
      const flyer = detail.flyerUrl ? await keepFlyer(detail.flyerUrl) : null;
      await putOffline(`/api/events/${encodeURIComponent(id)}`, flyer ? { ...detail, flyerUrl: flyer } : detail);
    } catch {
      // Flaky connection: try again next time.
    }
  }
}

/** Keep your profile and Going list on the device, so the app still knows who you are offline. */
export async function saveProfileForOffline() {
  // In the iOS app the API client keeps these whenever they load (src/lib/api.ts, appCache.ts).
  if (isNativeApp || !("caches" in window) || !navigator.onLine) return;
  try {
    const cache = await caches.open("api-me");
    for (const path of ["/api/me", "/api/me/events"]) {
      const url = new URL(path, location.origin).toString();
      const res = await fetch(url, { credentials: "same-origin" });
      if (res.ok) await cache.put(url, res);
    }
  } catch {
    // Not critical.
  }
}

/** On sign-out or account deletion, drop cached personal data (RSVP state, profile) from this device. */
export async function clearUserCaches() {
  await clearOffline();
  if (!("caches" in window)) return;
  await Promise.all(USER_CACHES.map((name) => caches.delete(name).catch(() => false)));
}

/** True when the browser says there's no connection. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener("online", cb);
      window.addEventListener("offline", cb);
      return () => {
        window.removeEventListener("online", cb);
        window.removeEventListener("offline", cb);
      };
    },
    () => navigator.onLine,
    () => true,
  );
}
