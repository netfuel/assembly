// Filter state in the URL (?when=weekend&scene=queer,rave&policy=all-ages&price=free&venue=diy), so a filtered map
// can be shared, and on the device, so it's still there next visit. The saved copy resets to Tonight on a new day.
import { POLICY_TAGS, SCENES, VENUE_TYPES, type EventSummary, type SceneId } from "../../shared/types";
import type { WindowId } from "./time";

export type PriceId = "any" | "free" | "10" | "20";
export const PRICES: { id: PriceId; label: string }[] = [
  { id: "any", label: "Any price" },
  { id: "free", label: "Free" },
  { id: "10", label: "Under $10" },
  { id: "20", label: "Under $20" },
];

export interface Filters {
  windowId: WindowId;
  date: string | null;
  scenes: SceneId[];
  policies: string[];
  price: PriceId;
  venueTypes: string[];
}

export const DEFAULT_FILTERS: Filters = { windowId: "tonight", date: null, scenes: [], policies: [], price: "any", venueTypes: [] };

const WINDOWS: WindowId[] = ["tonight", "weekend", "week", "all", "date"];
const KEY = "assembly:filters";
const isDate = (s: string | null | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
const sceneIds = new Set<string>(SCENES.map((s) => s.id));
const list = (raw: string | null | undefined, allowed: (s: string) => boolean) => (raw ?? "").split(",").filter(allowed);

interface Raw {
  when?: string | null;
  date?: string | null;
  scene?: string | null;
  policy?: string | null;
  price?: string | null;
  venue?: string | null;
}

function clean(raw: Raw): Filters | null {
  const when = WINDOWS.includes(raw.when as WindowId) ? (raw.when as WindowId) : null;
  const scenes = list(raw.scene, (s) => sceneIds.has(s)) as SceneId[];
  const policies = list(raw.policy, (s) => s in POLICY_TAGS);
  const venueTypes = list(raw.venue, (s) => s in VENUE_TYPES);
  const price = PRICES.some((p) => p.id === raw.price) ? (raw.price as PriceId) : "any";
  if (!when && !scenes.length && !policies.length && !venueTypes.length && price === "any") return null;
  const date = isDate(raw.date) ? raw.date : null;
  // "date" without a valid date falls back to tonight.
  return { windowId: when === "date" && !date ? "tonight" : (when ?? "tonight"), date, scenes, policies, price, venueTypes };
}

export function filtersFromUrl(search: string): Filters | null {
  const p = new URLSearchParams(search);
  return clean({ when: p.get("when"), date: p.get("date"), scene: p.get("scene"), policy: p.get("policy"), price: p.get("price"), venue: p.get("venue") });
}

/** The URL query for these filters, empty for the default (tonight, everything). */
export function filtersQuery(f: Filters): string {
  const p = new URLSearchParams();
  if (f.windowId !== "tonight") p.set("when", f.windowId);
  if (f.windowId === "date" && f.date) p.set("date", f.date);
  if (f.scenes.length) p.set("scene", f.scenes.join(","));
  if (f.policies.length) p.set("policy", f.policies.join(","));
  if (f.price !== "any") p.set("price", f.price);
  if (f.venueTypes.length) p.set("venue", f.venueTypes.join(","));
  const s = p.toString().replace(/%2C/g, ","); // "+" stays %2B: a bare + reads as a space
  return s ? `?${s}` : "";
}

/** How many filters are on, for the badge on the Filters button. The time window counts when it isn't Tonight. */
export function activeCount(f: Filters) {
  return (f.windowId !== "tonight" ? 1 : 0) + f.scenes.length + f.policies.length + (f.price !== "any" ? 1 : 0) + f.venueTypes.length;
}

export function saveFilters(f: Filters, today: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...f, day: today }));
  } catch {
    // Private mode: filters just won't persist.
  }
}

/** Saved filters from an earlier visit. On a new day the time window resets to tonight; everything else carries over. */
export function savedFilters(today: string): Filters | null {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as (Partial<Filters> & { day?: string }) | null;
    if (!raw) return null;
    const f = clean({
      when: raw.windowId,
      date: raw.date,
      scene: (raw.scenes ?? []).join(","),
      policy: (raw.policies ?? []).join(","),
      price: raw.price,
      venue: (raw.venueTypes ?? []).join(","),
    });
    if (!f) return null;
    if (raw.day !== today) {
      const kept = { ...f, windowId: "tonight" as const, date: null };
      return activeCount(kept) ? kept : null;
    }
    return f;
  } catch {
    return null;
  }
}

export function initialFilters(today: string): Filters {
  return filtersFromUrl(location.search) ?? savedFilters(today) ?? DEFAULT_FILTERS;
}

/**
 * The lowest price a door price mentions, in dollars: "Free" → 0, "$10 door, $8 advance" → 8, "Sliding scale $5-15" → 5.
 * Null when there's no number to go on.
 */
export function lowestPrice(doorPrice: string | null): number | null {
  if (!doorPrice) return null;
  if (/\bfree\b/i.test(doorPrice) || /\bno cover\b/i.test(doorPrice)) return 0;
  const nums = [...doorPrice.matchAll(/\$\s?(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
  return nums.length ? Math.min(...nums) : null;
}

/** Everything but the time window, which App applies with the city's timezone. */
export function matchesFilters(e: EventSummary, f: Filters) {
  if (f.scenes.length && !f.scenes.some((s) => e.scenes.includes(s))) return false;
  // Door policies narrow: each one picked must be on the event.
  if (f.policies.length && !f.policies.every((p) => e.policyTags.includes(p))) return false;
  if (f.venueTypes.length && !(e.venueType && f.venueTypes.includes(e.venueType))) return false;
  if (f.price !== "any") {
    const low = lowestPrice(e.doorPrice);
    // Events without a listed price don't match a price filter: we can't promise they fit.
    if (low === null) return false;
    if (f.price === "free" ? low !== 0 : low >= Number(f.price)) return false;
  }
  return true;
}

export interface Preset {
  id: string;
  label: string;
  filters: Partial<Filters>;
}
export const PRESETS: Preset[] = [
  { id: "queer-tonight", label: "Queer tonight", filters: { windowId: "tonight", scenes: ["queer"] } },
  { id: "all-ages-weekend", label: "All ages this weekend", filters: { windowId: "weekend", policies: ["all-ages"] } },
  { id: "free-week", label: "Free this week", filters: { windowId: "week", price: "free" } },
  { id: "diy-weekend", label: "DIY this weekend", filters: { windowId: "weekend", venueTypes: ["diy"] } },
];
