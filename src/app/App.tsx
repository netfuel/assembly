import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapView } from "../map/MapView";
import { Button, Chip, Frame, Label, LinkButton, Segmented, Sheet, Tag, Toast } from "../components/ui";
import { api, ApiError, signInUrl } from "../lib/api";
import { clock, dayLabel, isLive, overlaps, windowRange, type WindowId } from "../lib/time";
import { revealCards, revealChildren } from "../lib/motion";
import { useTheme } from "../lib/theme";
import { EventSheet } from "./EventSheet";
import { SCENES, type AuthProviders, type City, type EventSummary, type Me, type SceneId } from "../../shared/types";
import "./app.css";

const WINDOWS: { id: WindowId; label: string; heading: string }[] = [
  { id: "tonight", label: "Tonight", heading: "Tonight." },
  { id: "weekend", label: "Weekend", heading: "This weekend." },
  { id: "week", label: "7 days", heading: "Next 7 days." },
  { id: "all", label: "All", heading: "Coming up." },
];

const FALLBACK_CITY: City = { id: "memphis", name: "Memphis", timezone: "America/Chicago", center: [-90.01, 35.14], zoom: 12.2 };

function eventIdFromPath(): string | null {
  const m = location.pathname.match(/^\/e\/([^/]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function App() {
  const [city, setCity] = useState<City>(FALLBACK_CITY);
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState("");
  const [windowId, setWindowId] = useState<WindowId>("tonight");
  const [scenes, setScenes] = useState<SceneId[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(eventIdFromPath());
  const [focus, setFocus] = useState<{ lng: number; lat: number; key: number } | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [providers, setProviders] = useState<AuthProviders>({ google: false, apple: false });
  const [sheet, setSheet] = useState<null | "signin" | "announce" | "profile">(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [theme, setTheme] = useTheme();
  const railRef = useRef<HTMLDivElement>(null);
  const smallSheetRef = useRef<HTMLDivElement>(null);

  const toast = useCallback((msg: string) => setToastMsg(msg), []);
  useEffect(() => {
    if (!toastMsg) return;
    const t = setTimeout(() => setToastMsg(null), 2800);
    return () => clearTimeout(t);
  }, [toastMsg]);

  // Initial load: city, events, session.
  useEffect(() => {
    api.city("memphis").then(setCity).catch(() => undefined);
    api
      .events("memphis")
      .then((list) => {
        setEvents(list);
        setLoadState("ready");
      })
      .catch((err: unknown) => {
        setLoadError(err instanceof ApiError ? err.message : "Couldn't load events.");
        setLoadState("error");
      });
    api.me().then(setMe).catch(() => undefined);
    api.providers().then(setProviders).catch(() => undefined);

    const params = new URLSearchParams(location.search);
    const signin = params.get("signin");
    if (signin) {
      setToastMsg(signin === "ok" ? "You're signed in." : "Sign-in didn't go through. Try again.");
      params.delete("signin");
      history.replaceState(null, "", location.pathname + (params.size ? `?${params}` : ""));
    }
  }, []);

  // Keep the address bar in step with the open event so links can be shared.
  useEffect(() => {
    const path = selectedId ? `/e/${encodeURIComponent(selectedId)}` : "/";
    if (location.pathname !== path) history.pushState(null, "", path);
  }, [selectedId]);
  useEffect(() => {
    const onPop = () => setSelectedId(eventIdFromPath());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const now = useMemo(() => new Date(), [events, windowId]);
  const shown = useMemo(() => {
    const range = windowRange(windowId, now, city.timezone);
    return events
      .filter((e) => overlaps(e.startsAt, e.endsAt, range))
      .filter((e) => scenes.length === 0 || scenes.some((s) => e.scenes.includes(s)));
  }, [events, windowId, scenes, now, city.timezone]);

  const selected = events.find((e) => e.id === selectedId) ?? null;
  // The open event always keeps its pin, even when the filters would hide it (for example a shared link).
  const mapEvents = useMemo(() => (selected && !shown.includes(selected) ? [...shown, selected] : shown), [shown, selected]);

  // Cards slide in whenever the set changes.
  useEffect(() => {
    if (!selected) revealCards(railRef.current);
  }, [shown, selected]);
  useEffect(() => {
    if (sheet) requestAnimationFrame(() => revealChildren(document.querySelector(".sheet-center .sheet-body")));
  }, [sheet]);

  const select = useCallback(
    (id: string | null) => {
      setSelectedId(id);
      const ev = id ? events.find((e) => e.id === id) : null;
      if (ev) setFocus({ lng: ev.lng, lat: ev.lat, key: Date.now() });
    },
    [events],
  );

  // Deep link: once events load, fly to the linked event.
  useEffect(() => {
    if (loadState === "ready" && selectedId) {
      const ev = events.find((e) => e.id === selectedId);
      if (ev) setFocus({ lng: ev.lng, lat: ev.lat, key: Date.now() });
    }
    // Only on first load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadState]);

  const heading = WINDOWS.find((w) => w.id === windowId)!.heading;
  const returnTo = selectedId ? `/e/${encodeURIComponent(selectedId)}` : "/";

  return (
    <div className="app">
      <MapView events={mapEvents} center={city.center} zoom={city.zoom} selectedId={selectedId} onSelect={select} focus={focus} theme={theme} />
      <div className="map-dots" aria-hidden="true" />

      <header className="topbar">
        <nav className="nav" aria-label="Main">
          <a className="logo" href="/" aria-label="Assembly home">
            <img src="/icons/favicon.svg" alt="" width="22" height="22" />
            <span className="logo-word">Assembly</span>
          </a>
          <span className="nav-city">{city.name}</span>
          <span className="spacer" />
          <button
            className="theme-toggle"
            onClick={() => setTheme(theme === "light" ? "dark" : "light")}
            aria-label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
            title={theme === "light" ? "Dark mode" : "Light mode"}
          >
            <span className="theme-toggle-dot" aria-hidden="true" />
            <span className="hide-narrow">{theme === "light" ? "Light" : "Dark"}</span>
          </button>
          <Button size="sm" onClick={() => setSheet(me ? "announce" : "signin")}>
            + <span className="hide-narrow">Make an announcement</span>
            <span className="show-narrow">Post</span>
          </Button>
          {me ? (
            <button className="avatar" onClick={() => setSheet("profile")} aria-label="Your profile">
              {me.avatarUrl ? <img src={me.avatarUrl} alt="" referrerPolicy="no-referrer" /> : me.displayName.slice(0, 1).toUpperCase()}
            </button>
          ) : (
            <Button size="sm" variant="solid" onClick={() => setSheet("signin")}>
              Sign in
            </Button>
          )}
        </nav>
        <div className="filters" role="toolbar" aria-label="Filter events">
          <Segmented label="When" options={WINDOWS.map((w) => ({ id: w.id, label: w.label }))} value={windowId} onChange={setWindowId} />
          <span className="filters-sep" aria-hidden="true" />
          {SCENES.map((s) => (
            <Chip
              key={s.id}
              pressed={scenes.includes(s.id)}
              marker={s.id === "queer" ? "var(--color-uv)" : undefined}
              onClick={() => setScenes((cur) => (cur.includes(s.id) ? cur.filter((x) => x !== s.id) : [...cur, s.id]))}
            >
              {s.label}
            </Chip>
          ))}
        </div>
      </header>

      {!selected && (
        <section className="rail-wrap" aria-label={`${heading} events`}>
          <div className="rail-head">
            <h2 className="rail-title">{heading}</h2>
            <span className="rail-count num">{loadState === "ready" ? `${pad(shown.length)} events` : "—"}</span>
            <span className="spacer" />
            <span className="legend">
              <span className="marker" style={{ background: "var(--color-uv)" }} /> queer-centered
              <span className="marker" style={{ background: "var(--color-sodium)" }} /> everything else
            </span>
          </div>
          <div className="rail" ref={railRef}>
            {loadState === "loading" && <div className="rail-empty">Loading the map…</div>}
            {loadState === "error" && <div className="rail-empty">{loadError}</div>}
            {loadState === "ready" && shown.length === 0 && (
              <div className="rail-empty">
                Nothing on the schedule {windowId === "tonight" ? "tonight" : "for these filters"}.{" "}
                {windowId === "tonight" ? (
                  <button className="link" onClick={() => setWindowId("weekend")}>
                    Check the weekend →
                  </button>
                ) : scenes.length ? (
                  <button className="link" onClick={() => setScenes([])}>
                    Clear scenes →
                  </button>
                ) : null}
              </div>
            )}
            {shown.map((e, i) => {
              const queer = e.scenes.includes("queer");
              const live = isLive(e.startsAt, e.endsAt, now);
              return (
                <button key={e.id} className="card" onClick={() => select(e.id)}>
                  <Frame featured={live} className="card-frame">
                    <span className="card-top num">
                      <span>
                        N.{pad(i + 1)} <span className="dim">/ {pad(shown.length)}</span>
                      </span>
                      {live ? <Tag tone="accent">Live</Tag> : <span className="marker" style={{ background: queer ? "var(--color-uv)" : "var(--color-sodium)" }} />}
                    </span>
                    <span className="card-title">{e.title}</span>
                    <span className="card-when num">
                      {dayLabel(e.startsAt, now, city.timezone)} / {clock(e.startsAt, city.timezone)}
                    </span>
                    <span className="card-meta">
                      <span className="card-venue">{e.venueName ?? e.neighborhood}</span>
                      <span className="num">{e.goingCount} going</span>
                    </span>
                  </Frame>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {selected && (
        <EventSheet
          key={selected.id}
          summary={selected}
          tz={city.timezone}
          me={me}
          onClose={() => select(null)}
          onNeedSignIn={() => setSheet("signin")}
          toast={toast}
        />
      )}

      <Sheet open={sheet === "signin"} onClose={() => setSheet(null)} label="Sign in" modal center>
        <div ref={smallSheetRef} className="small-sheet">
          <div className="stack" data-reveal>
            <Label glyph="◇">Sign in</Label>
            <h1 className="sheet-title">RSVP and save your nights.</h1>
            <p className="note serif-text">Your RSVPs stay private unless you choose to show them.</p>
          </div>
          <div className="sso" data-reveal>
            <LinkButton size="lg" variant="solid" href={providers.google ? signInUrl("google", returnTo) : undefined} aria-disabled={!providers.google}>
              Continue with Google
            </LinkButton>
            <LinkButton size="lg" href={providers.apple ? signInUrl("apple", returnTo) : undefined} aria-disabled={!providers.apple}>
              Continue with Apple
            </LinkButton>
          </div>
          {!providers.google && !providers.apple && (
            <p className="note" data-reveal>
              <Tag>Setup</Tag> Sign-in isn't configured on this server yet. See README, "Set up sign-in".
            </p>
          )}
        </div>
      </Sheet>

      <Sheet open={sheet === "announce"} onClose={() => setSheet(null)} label="Make an announcement" modal center>
        <div className="stack" data-reveal>
          <Label glyph="▶">Make an announcement</Label>
          <h1 className="sheet-title">Posting opens in the next build.</h1>
          <p className="note serif-text">Flyer upload, lineup with artist links, and promo video up to 1:30 arrive in the Core build phase.</p>
        </div>
      </Sheet>

      <Sheet open={sheet === "profile" && !!me} onClose={() => setSheet(null)} label="Your profile" modal center>
        <div className="stack" data-reveal>
          <Label glyph="◇">Profile</Label>
          <h1 className="sheet-title">{me?.displayName}</h1>
        </div>
        <Button
          data-reveal
          onClick={async () => {
            await api.logout().catch(() => undefined);
            setMe(null);
            setSheet(null);
            toast("Signed out.");
          }}
        >
          Sign out
        </Button>
      </Sheet>

      <Toast message={toastMsg} />
    </div>
  );
}
