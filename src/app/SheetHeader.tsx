import { useEffect, useRef, useState } from "react";
import { POLICY_TAGS, SCENES, VENUE_TYPES } from "../../shared/types";
import { DEFAULT_FILTERS, PRICES, type Filters } from "../lib/filters";
import { dateHeading, tonightDate, type WindowId } from "../lib/time";

export const WHEN_LABELS: { id: WindowId; label: string }[] = [
  { id: "tonight", label: "Tonight" },
  { id: "weekend", label: "This weekend" },
  { id: "week", label: "Next 7 days" },
  { id: "all", label: "Everything coming up" },
  { id: "date", label: "Pick a date…" },
];

/** Everything but the time window, in a few words: "Queer, Free, DIY space". */
function otherFilters(f: Filters): string[] {
  const out: string[] = [];
  if (f.q) out.push(`“${f.q}”`);
  if (f.friends) out.push("Friends going");
  for (const s of f.scenes) out.push(SCENES.find((x) => x.id === s)?.label ?? s);
  for (const p of f.policies) out.push(POLICY_TAGS[p] ?? p);
  if (f.price !== "any") out.push(PRICES.find((p) => p.id === f.price)?.label ?? "");
  for (const v of f.venueTypes) out.push(VENUE_TYPES[v] ?? v);
  return out.filter(Boolean);
}

/**
 * The sheet's header, in the thumb zone: search, one date pill, and Filters. Other filters show as one summary line
 * (not a row of chips) that opens the Filters sheet.
 */
export function SheetHeader({
  filters,
  tz,
  count,
  loading,
  onSearch,
  onFilters,
  onChange,
  near,
  onNear,
}: {
  /** Your location: on (the map opened around you), off (offer it), locating, or unavailable (say nothing). */
  near?: "on" | "off" | "locating" | "none";
  onNear?: () => void;
  filters: Filters;
  tz: string;
  count: number;
  loading: boolean;
  onSearch: () => void;
  onFilters: () => void;
  onChange: (f: Filters) => void;
}) {
  const [menu, setMenu] = useState(false);
  const dateInput = useRef<HTMLInputElement>(null);
  const pill = useRef<HTMLDivElement>(null);
  const others = otherFilters(filters);
  const when = filters.windowId === "date" && filters.date ? dateHeading(filters.date) : WHEN_LABELS.find((w) => w.id === filters.windowId)!.label.replace("Everything coming up", "Coming up");

  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => !pill.current?.contains(e.target as Node) && setMenu(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [menu]);

  return (
    <div className="sheet-header">
      <div className="sheet-header-row">
        <button type="button" className="hs-search no-sheet-drag" onClick={onSearch} aria-label="Search events, artists, and venues">
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
          </svg>
          <span className={filters.q ? "" : "dim"}>{filters.q ?? "Search"}</span>
        </button>
        <div className="date-pill-wrap no-sheet-drag" ref={pill}>
          <button type="button" className="date-pill" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
            {when}
            <svg viewBox="0 0 10 6" width="10" height="6" aria-hidden="true">
              <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.4" />
            </svg>
          </button>
          {menu && (
            <div className="date-menu" role="menu">
              {WHEN_LABELS.map((w) => (
                <button
                  key={w.id}
                  role="menuitemradio"
                  aria-checked={filters.windowId === w.id}
                  onClick={() => {
                    if (w.id === "date") {
                      try {
                        dateInput.current?.showPicker();
                      } catch {
                        dateInput.current?.focus();
                      }
                      return;
                    }
                    onChange({ ...filters, windowId: w.id });
                    setMenu(false);
                  }}
                >
                  {w.label}
                </button>
              ))}
              <input
                ref={dateInput}
                className="date-menu-input"
                type="date"
                aria-label="Pick a date"
                min={tonightDate(new Date(), tz)}
                value={filters.date ?? tonightDate(new Date(), tz)}
                onChange={(e) => {
                  if (!e.target.value) return;
                  onChange({ ...filters, windowId: "date", date: e.target.value });
                  setMenu(false);
                }}
              />
            </div>
          )}
        </div>
        <button type="button" className={`hs-filters no-sheet-drag ${others.length ? "is-active" : ""}`} onClick={onFilters} aria-label={others.length ? `Filters, ${others.length} on` : "Filters"}>
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <path d="M2 4h12M4.5 8h7M7 12h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
          </svg>
          {others.length > 0 && <span className="hs-filters-count num">{others.length}</span>}
        </button>
      </div>
      <p className="sheet-summary">
        <span className="num">
          {loading ? "Finding nights…" : `${count} ${count === 1 ? "night" : "nights"}`}
          {near === "on" && !loading && " near you"}
        </span>
        {(near === "off" || near === "locating") && onNear && (
          <>
            <span className="dim" aria-hidden="true">
              {" "}
              ·{" "}
            </span>
            <button className="sheet-summary-near no-sheet-drag" onClick={onNear} disabled={near === "locating"}>
              {near === "locating" ? "Finding you…" : "Show what's near me"}
            </button>
          </>
        )}
        {others.length > 0 && (
          <>
            <span className="dim" aria-hidden="true">
              {" "}
              ·{" "}
            </span>
            <button className="sheet-summary-filters no-sheet-drag" onClick={onFilters}>
              {others.join(", ")}
            </button>
            <button
              className="sheet-summary-clear no-sheet-drag"
              onClick={() => onChange({ ...DEFAULT_FILTERS, windowId: filters.windowId, date: filters.date })}
              aria-label="Clear filters"
            >
              Clear
            </button>
          </>
        )}
      </p>
    </div>
  );
}
