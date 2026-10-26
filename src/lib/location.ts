import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The viewer's own position, for the dot on the map and distances on cards.
 *
 * Privacy: coordinates live only in memory on this device. They are never sent to the Assembly
 * server, never written to storage, and never logged. The only thing remembered is whether the
 * person turned location on, so the next visit can resume without asking again.
 */
export type Position = { lng: number; lat: number; accuracy: number; heading: number | null };
export type LocationStatus = "off" | "locating" | "on" | "denied" | "unavailable";

const KEY = "assembly-location"; // "on" or "off" once the person chose; never coordinates

/** "off" only when the person turned location off themselves; then we never resume on our own. */
function turnedOff(): boolean {
  try {
    return localStorage.getItem(KEY) === "off";
  } catch {
    return false;
  }
}
function remember(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    // Private mode: it just won't be remembered.
  }
}

export function useMyLocation() {
  const [status, setStatus] = useState<LocationStatus>("off");
  const [position, setPosition] = useState<Position | null>(null);
  const watchId = useRef<number | null>(null);
  const wanted = useRef(false);

  const clearWatch = () => {
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = null;
  };

  const watch = useCallback(() => {
    if (watchId.current !== null || document.visibilityState !== "visible") return;
    watchId.current = navigator.geolocation.watchPosition(
      (p) => {
        // A fix that lands after the person turned location off is dropped.
        if (!wanted.current) return;
        setPosition({
          lng: p.coords.longitude,
          lat: p.coords.latitude,
          accuracy: p.coords.accuracy,
          heading: p.coords.heading !== null && !Number.isNaN(p.coords.heading) && (p.coords.speed ?? 0) > 0.5 ? p.coords.heading : null,
        });
        setStatus("on");
      },
      (err) => {
        clearWatch();
        wanted.current = false;
        setPosition(null);
        if (err.code === err.PERMISSION_DENIED) {
          setStatus("denied");
        } else {
          setStatus("unavailable");
        }
      },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 },
    );
  }, []);

  /** Turn location on. Only ever called from a tap, so the permission prompt follows a clear intent. */
  const start = useCallback(() => {
    if (!("geolocation" in navigator) || !window.isSecureContext) {
      setStatus("unavailable");
      return;
    }
    wanted.current = true;
    remember(true);
    setStatus((s) => (s === "on" ? s : "locating"));
    watch();
  }, [watch]);

  /** Turn location off and clear the dot. */
  const stop = useCallback(() => {
    wanted.current = false;
    remember(false);
    clearWatch();
    setPosition(null);
    setStatus("off");
  }, []);

  // Start on launch when the browser already allows it (so there's no prompt on open), unless they turned it off here.
  useEffect(() => {
    if (turnedOff() || !navigator.permissions?.query) return;
    navigator.permissions
      .query({ name: "geolocation" as PermissionName })
      .then((p) => {
        if (p.state === "granted") start();
      })
      .catch(() => undefined);
  }, [start]);

  // Watch only while the page is on screen, to save battery.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        if (wanted.current) watch();
      } else {
        clearWatch();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      clearWatch();
    };
  }, [watch]);

  return { status, position, start, stop };
}

const EARTH_MILES = 3958.8;
/** Great-circle distance in miles, computed on the device. */
export function milesBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** "0.3 mi", "2.4 mi", "18 mi". */
export function formatMiles(mi: number): string {
  if (mi < 0.1) return "< 0.1 mi";
  if (mi < 10) return `${mi.toFixed(1)} mi`;
  return `${Math.round(mi)} mi`;
}
