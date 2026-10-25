import { useEffect, useRef, useState } from "react";
import { Button, Label, Sheet, Skeleton } from "../components/ui";
import { api, ApiError } from "../lib/api";
import { clock, dayLabel } from "../lib/time";
import { VENUE_TYPES, type SearchPlace, type SearchResults } from "../../shared/types";

const RECENT_KEY = "assembly:recent-searches";
function recent(): string[] {
  try {
    return (JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as string[]).slice(0, 6);
  } catch {
    return [];
  }
}
function remember(q: string) {
  const v = q.trim();
  if (v.length < 2) return;
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([v, ...recent().filter((r) => r.toLowerCase() !== v.toLowerCase())].slice(0, 6)));
  } catch {
    // Private mode: no history, which is fine.
  }
}
function forgetAll() {
  try {
    localStorage.removeItem(RECENT_KEY);
  } catch {
    // ignore
  }
}

/**
 * One search box for events, artists, and venues. Results come in as you type, grouped by kind.
 * Tap an event to open it; tap an artist or venue (or "Show all") to filter the map and feed to their nights.
 */
export function SearchSheet({
  open,
  onClose,
  initial,
  tz,
  onOpenEvent,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  initial: string;
  tz: string;
  onOpenEvent: (id: string) => void;
  /** Filter the map and feed to this search. */
  onApply: (q: string) => void;
}) {
  const [q, setQ] = useState(initial);
  const [results, setResults] = useState<SearchResults | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>(recent);
  const input = useRef<HTMLInputElement>(null);
  const now = new Date();

  useEffect(() => {
    if (!open) return;
    setQ(initial);
    setHistory(recent());
    // The sheet focuses itself first; then the field.
    const t = setTimeout(() => input.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [open, initial]);

  useEffect(() => {
    const v = q.trim();
    if (v.length < 2) {
      setResults(null);
      setBusy(false);
      setError(null);
      return;
    }
    const ctl = new AbortController();
    setBusy(true);
    const t = setTimeout(() => {
      api
        .search(v, ctl.signal)
        .then((r) => {
          setResults(r);
          setError(null);
        })
        .catch((err) => {
          if (ctl.signal.aborted) return;
          setError(err instanceof ApiError ? err.message : "Search isn't responding. Try again.");
        })
        .finally(() => !ctl.signal.aborted && setBusy(false));
    }, 180);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [q]);

  const apply = (value: string) => {
    remember(value);
    onApply(value.trim());
  };
  const total = results ? results.events.length + results.artists.length + results.venues.length : 0;
  const status = !results ? "" : total === 0 ? "No results" : `${results.events.length} events, ${results.artists.length} artists, ${results.venues.length} venues`;

  return (
    <Sheet open={open} onClose={onClose} label="Search" modal className="sheet-search">
      <div className="search-sheet">
        <form
          className="search-form"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            if (q.trim().length >= 2) apply(q);
          }}
        >
          <Label glyph="⌕">Search</Label>
          <div className="search-field">
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
            </svg>
            <input
              ref={input}
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Artists, venues, events, neighborhoods"
              aria-label="Search events, artists, and venues"
              enterKeyHint="search"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              maxLength={80}
            />
            {q && (
              <button type="button" className="search-clear" onClick={() => setQ("")} aria-label="Clear search">
                ×
              </button>
            )}
          </div>
          <div className={`search-progress ${busy ? "is-busy" : ""}`} aria-hidden="true" />
          <span className="sr-only" role="status" aria-live="polite">
            {status}
          </span>
        </form>

        {!results && !error && q.trim().length < 2 && (
          <div className="search-start">
            {history.length > 0 ? (
              <section aria-label="Recent searches">
                <div className="search-group-head">
                  <span className="field-label">Recent</span>
                  <button
                    className="link"
                    onClick={() => {
                      forgetAll();
                      setHistory([]);
                    }}
                  >
                    Clear
                  </button>
                </div>
                <ul className="search-recent">
                  {history.map((h) => (
                    <li key={h}>
                      <button onClick={() => setQ(h)}>{h}</button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : (
              <p className="note serif-text">Find a DJ, a band, a room, or a night. Try a venue name or a neighborhood.</p>
            )}
          </div>
        )}

        {busy && !results && (
          <div className="skel-list" aria-hidden="true">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="search-skel">
                <Skeleton w={44} h={44} />
                <span className="skel-stack">
                  <Skeleton w={`${70 - i * 10}%`} h={14} />
                  <Skeleton w="40%" h={10} />
                </span>
              </div>
            ))}
          </div>
        )}

        {error && <p className="field-error">{error}</p>}

        {results && total === 0 && (
          <p className="search-empty serif-text">
            Nothing on the schedule for "{results.q}". Try a shorter word, or check the spelling.
          </p>
        )}

        {results && results.events.length > 0 && (
          <section className="search-group" aria-label="Events">
            <div className="search-group-head">
              <span className="field-label">
                Events <span className="num dim">{results.events.length}</span>
              </span>
              <button className="link" onClick={() => apply(results.q)}>
                Show {results.eventIds.length === 1 ? "it" : `all ${results.eventIds.length}`} on the map →
              </button>
            </div>
            <ul className="search-list">
              {results.events.slice(0, 8).map((e) => {
                const queer = e.scenes.includes("queer");
                return (
                  <li key={e.id}>
                    <button
                      className="search-item"
                      onClick={() => {
                        remember(results.q);
                        onOpenEvent(e.id);
                      }}
                    >
                      <SearchThumb url={e.thumbUrl} queer={queer} />
                      <span className="search-text">
                        <span className="search-name">
                          {e.status === "cancelled" && <span className="dim">Cancelled: </span>}
                          {e.title}
                        </span>
                        <span className="search-meta num">
                          {dayLabel(e.startsAt, now, tz)} / {clock(e.startsAt, tz)}
                          {e.venueName && ` · ${e.venueName}`}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {results && results.artists.length > 0 && (
          <PlaceGroup label="Artists" places={results.artists} now={now} tz={tz} onPick={(p) => apply(p.name)} />
        )}
        {results && results.venues.length > 0 && <PlaceGroup label="Venues" places={results.venues} now={now} tz={tz} onPick={(p) => apply(p.name)} />}

        {results && total > 0 && (
          <Button className="search-apply" size="lg" variant="primary" onClick={() => apply(results.q)}>
            Show {results.eventIds.length} {results.eventIds.length === 1 ? "night" : "nights"} on the map and feed
          </Button>
        )}
      </div>
    </Sheet>
  );
}

function PlaceGroup({ label, places, now, tz, onPick }: { label: string; places: SearchPlace[]; now: Date; tz: string; onPick: (p: SearchPlace) => void }) {
  return (
    <section className="search-group" aria-label={label}>
      <div className="search-group-head">
        <span className="field-label">
          {label} <span className="num dim">{places.length}</span>
        </span>
      </div>
      <ul className="search-list">
        {places.map((p) => (
          <li key={p.id}>
            <button className="search-item" onClick={() => onPick(p)} disabled={p.upcoming === 0}>
              <span className={`search-thumb search-thumb-glyph`} aria-hidden="true">
                {label === "Artists" ? "♫" : "⌖"}
              </span>
              <span className="search-text">
                <span className="search-name">{p.name}</span>
                <span className="search-meta">
                  {p.type && VENUE_TYPES[p.type] ? `${VENUE_TYPES[p.type]} · ` : ""}
                  {p.upcoming === 0
                    ? "No upcoming shows"
                    : `${p.upcoming} upcoming${p.next ? ` · next ${dayLabel(p.next.startsAt, now, tz)}${label === "Artists" ? `: ${p.next.title}` : ""}` : ""}`}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The flyer thumbnail, or a scene-colored square when there isn't one (or it fails to load). */
function SearchThumb({ url, queer }: { url: string | null; queer: boolean }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) return <span className={`search-thumb search-thumb-empty ${queer ? "is-queer" : ""}`} aria-hidden="true" />;
  return <img className="search-thumb" src={url} alt="" loading="lazy" onError={() => setFailed(true)} />;
}
