// Filter state in the URL (?when=weekend&scene=queer,rave or ?when=date&date=2026-10-31), so a filtered map can be
// shared, and on the device, so it's still there next visit. The saved copy resets to Tonight on a new day.
import { SCENES, type SceneId } from "../../shared/types";
import type { WindowId } from "./time";

export interface Filters {
  windowId: WindowId;
  date: string | null;
  scenes: SceneId[];
}

const WINDOWS: WindowId[] = ["tonight", "weekend", "week", "all", "date"];
const KEY = "assembly:filters";
const isDate = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
const sceneIds = new Set<string>(SCENES.map((s) => s.id));

function clean(raw: { when?: string | null; date?: string | null; scene?: string | null }): Filters | null {
  const when = WINDOWS.includes(raw.when as WindowId) ? (raw.when as WindowId) : null;
  const scenes = (raw.scene ?? "").split(",").filter((s) => sceneIds.has(s)) as SceneId[];
  if (!when && !scenes.length) return null;
  const date = isDate(raw.date ?? null) ? raw.date! : null;
  // "date" without a valid date falls back to tonight.
  return { windowId: when === "date" && !date ? "tonight" : (when ?? "tonight"), date, scenes };
}

export function filtersFromUrl(search: string): Filters | null {
  const p = new URLSearchParams(search);
  return clean({ when: p.get("when"), date: p.get("date"), scene: p.get("scene") });
}

/** The URL query for these filters, empty for the default (tonight, all scenes). */
export function filtersQuery(f: Filters): string {
  const p = new URLSearchParams();
  if (f.windowId !== "tonight") p.set("when", f.windowId);
  if (f.windowId === "date" && f.date) p.set("date", f.date);
  if (f.scenes.length) p.set("scene", f.scenes.join(","));
  const s = p.toString().replace(/%2C/g, ",");
  return s ? `?${s}` : "";
}

export function saveFilters(f: Filters, today: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...f, day: today }));
  } catch {
    // Private mode: filters just won't persist.
  }
}

/** Saved filters from an earlier visit today. Scene picks carry over to a new day; the date window resets to tonight. */
export function savedFilters(today: string): Filters | null {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as (Filters & { day?: string }) | null;
    if (!raw) return null;
    const f = clean({ when: raw.windowId, date: raw.date, scene: (raw.scenes ?? []).join(",") });
    if (!f) return null;
    if (raw.day !== today) return f.scenes.length ? { windowId: "tonight", date: null, scenes: f.scenes } : null;
    return f;
  } catch {
    return null;
  }
}

export function initialFilters(today: string): Filters {
  return filtersFromUrl(location.search) ?? savedFilters(today) ?? { windowId: "tonight", date: null, scenes: [] };
}
