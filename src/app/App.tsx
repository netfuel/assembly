import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapView } from "../map/MapView";
import { Button, Frame, Sheet, Tag, Toast, Skeleton } from "../components/ui";
import { InstallPrompt } from "../components/InstallPrompt";
import { LocateButton } from "../components/LocateButton";
import { GeneratedArt } from "../components/GeneratedArt";
import { formatMiles, milesBetween, useMyLocation } from "../lib/location";
import { SubscribeSheet } from "../components/SubscribeSheet";
import { hideSplash } from "../lib/splash";
import { announceGoing } from "../lib/install";
import { FeedView } from "./FeedView";
import { HomeSheet, useWide, type Detent } from "./HomeSheet";
import { SheetHeader } from "./SheetHeader";
import { SearchSheet } from "./SearchSheet";
import { FriendsSheet, InviteSheet } from "./FriendsSheet";
import { Faces } from "../components/Faces";
import { DEFAULT_FILTERS, activeCount, filtersQuery, initialFilters, matchesFilters, saveFilters, type Filters } from "../lib/filters";
import { FilterSheet } from "./FilterSheet";
import { api, ApiError } from "../lib/api";
import { clock, dayLabel, isLive, nightRange, overlaps, tonightDate, windowRange, type WindowId } from "../lib/time";
import { revealCards, revealChildren } from "../lib/motion";
import { useTheme } from "../lib/theme";
import { clearUserCaches, saveForOffline, saveProfileForOffline, useOnline } from "../lib/offline";
import { EventSheet } from "./EventSheet";
import { AnnounceForm } from "./AnnounceForm";
import { ProfileSheet } from "./ProfileSheet";
import { SignInSheet } from "./SignInSheet";
import { ModerationSheet } from "./ModerationSheet";
import { type AuthProviders, type FriendAt, type FriendsState, type RsvpStatus, type City, type EventDetail, type EventSummary, type MeProfile, type ServerConfig } from "../../shared/types";
import "./app.css";


const FALLBACK_CITY: City = { id: "memphis", name: "Memphis", timezone: "America/Chicago", center: [-90.01, 35.14], zoom: 12.2 };

type View = "map" | "feed";
const VIEW_KEY = "assembly:view";
/** /feed or ?view=feed opens the list; otherwise the last view used on this device; the map by default. */
function initialView(): View {
  if (location.pathname === "/feed" || location.pathname === "/feed/") return "feed";
  const q = new URLSearchParams(location.search).get("view");
  if (q === "feed" || q === "map") return q;
  if (location.pathname === "/") {
    try {
      if (localStorage.getItem(VIEW_KEY) === "feed") return "feed";
    } catch {
      // ignore
    }
  }
  return "map";
}

function eventIdFromPath(): string | null {
  const m = location.pathname.match(/^\/e\/([^/]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "Around you": nights within this distance count as close enough to frame with your dot. */
const NEAR_MILES = 6;

export function App() {
  const [city, setCity] = useState<City>(FALLBACK_CITY);
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  useEffect(() => {
    if (loadState !== "loading") hideSplash();
  }, [loadState]);
  const [loadError, setLoadError] = useState("");
  // All filters live in one object, shared by the map and the rail, the URL, and the Filters sheet.
  const [filters, setFilters] = useState<Filters>(() => {
    const f = initialFilters(tonightDate(new Date(), "America/Chicago"));
    return { ...f, date: f.date ?? tonightDate(new Date(), "America/Chicago") };
  });
  const windowId = filters.windowId;
  const pickedDate = filters.date ?? tonightDate(new Date(), "America/Chicago");
  const scenes = filters.scenes;
  const setWindowId = (windowId: WindowId) => setFilters((f) => ({ ...f, windowId }));
  const [selectedId, setSelectedId] = useState<string | null>(eventIdFromPath());
  const [view, setViewState] = useState<View>(initialView);
  const wide = useWide();
  // The home sheet's height. Full is the feed; peek and half show the map with cards.
  const [detent, setDetent] = useState<Detent>(() => (initialView() === "feed" ? "full" : "half"));
  const setView = (v: View) => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // Private mode: it just won't be remembered.
    }
  };
  // Your RSVPs, so feed cards can show "Going" and toggle it.
  const [rsvps, setRsvps] = useState<Record<string, RsvpStatus>>({});
  // Friends: null until loaded (or when the server doesn't have friends yet).
  const [friendsState, setFriendsState] = useState<FriendsState | null>(null);
  const [friendsAt, setFriendsAt] = useState<Record<string, FriendAt[]>>({});
  // A friend's invite link (/f/<token>) opened this page.
  const [inviteToken] = useState(() => location.pathname.match(/^\/f\/([\w-]{8,64})/)?.[1] ?? null);
  const [focus, setFocus] = useState<{ lng: number; lat: number; key: number } | null>(null);
  const [me, setMe] = useState<MeProfile | null>(null);
  const [providers, setProviders] = useState<AuthProviders>({ google: false, apple: false });
  const [providersFailed, setProvidersFailed] = useState(false);
  const [sheet, setSheet] = useState<null | "signin" | "announce" | "profile" | "moderation" | "subscribe" | "friends" | "invite">(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [config, setConfig] = useState<ServerConfig>({ video: false, streamCustomerCode: null });
  const [editing, setEditing] = useState<EventDetail | null>(null);
  // An open event that isn't in the loaded list: your own hidden event, or a link to one weeks out.
  const [extra, setExtra] = useState<EventSummary | null>(null);
  const [detailVersion, setDetailVersion] = useState(0);
  const [highlight, setHighlight] = useState<{ id: string; follow: boolean } | null>(null);
  const [theme, setTheme] = useTheme();
  const online = useOnline();
  // The viewer's position stays on this device: the dot on the map and distances on cards. Never sent to the API.
  const loc = useMyLocation();
  const [followMe, setFollowMe] = useState(false);
  const locStatus = useRef(loc.status);
  useEffect(() => {
    const was = locStatus.current;
    locStatus.current = loc.status;
    if (loc.status === "denied" && was !== "denied") {
      setFollowMe(false);
      setToastMsg("Location is blocked for this site. Allow it in your browser or phone settings to see where you are.");
    }
    if (loc.status === "unavailable" && was !== "unavailable") {
      setFollowMe(false);
      setToastMsg("Couldn't find your location right now. The map stays on the city.");
    }
  }, [loc.status]);
  function tapLocate() {
    if (loc.status === "locating") return;
    if (loc.status === "on") {
      if (followMe) {
        loc.stop();
        setFollowMe(false);
        setToastMsg("Location off. Your dot is cleared.");
      } else {
        setFollowMe(true);
      }
      return;
    }
    setToastMsg("Your location stays on this device. Assembly never saves or shares it.");
    loc.start();
    setFollowMe(true);
  }
  const myPos = loc.position;
  const distanceTo = useCallback(
    (e: { lat: number; lng: number }) => (myPos ? formatMiles(milesBetween(myPos, e)) : null),
    [myPos],
  );

  // Keep your saved nights on the device for when the signal drops at the door.
  const meId = me?.id;
  useEffect(() => {
    if (!meId) return;
    saveProfileForOffline();
  }, [meId]);
  const friendsFeature = config.features?.friends !== false;
  useEffect(() => {
    if (!meId || !friendsFeature) return setFriendsState(null);
    api.friends().then(setFriendsState).catch(() => setFriendsState(null));
  }, [meId, friendsFeature]);
  const friendsOn = !!friendsState?.me.friendsOn;
  // Friends' nights: on load, whenever an event sheet closes (you may have RSVP'd), and every two minutes.
  const loadFriendsAt = useCallback(() => api.friendsAt().then(setFriendsAt).catch(() => undefined), []);
  useEffect(() => {
    if (!meId || !friendsOn) return setFriendsAt({});
    void loadFriendsAt();
    const t = setInterval(() => document.visibilityState === "visible" && void loadFriendsAt(), 120000);
    return () => clearInterval(t);
  }, [meId, friendsOn, friendsState?.friends.length, loadFriendsAt]);
  useEffect(() => {
    if (meId && friendsOn && !selectedId) void loadFriendsAt();
  }, [selectedId, meId, friendsOn, loadFriendsAt]);
  useEffect(() => {
    if (inviteToken) setSheet("invite");
  }, [inviteToken]);
  // Saved for the door, and the feed's Going state. Re-read when an event sheet closes, since you may have RSVP'd there.
  useEffect(() => {
    if (!meId) return setRsvps({});
    if (selectedId) return;
    api
      .myEvents()
      .then((r) => {
        saveForOffline(r.going);
        setRsvps(Object.fromEntries(r.going.filter((g) => g.rsvp).map((g) => [g.id, g.rsvp as RsvpStatus])));
      })
      .catch(() => undefined);
  }, [meId, selectedId]);
  const railRef = useRef<HTMLDivElement>(null);

  const toast = useCallback((msg: string) => setToastMsg(msg), []);
  useEffect(() => {
    if (!toastMsg) return;
    const t = setTimeout(() => setToastMsg(null), 2800);
    return () => clearTimeout(t);
  }, [toastMsg]);

  // Initial load: city, events, session.
  const loadEvents = useCallback(
    (fresh = false) =>
      api
        .events("memphis", undefined, fresh)
        .then((list) => {
          setEvents(list);
          setLoadState("ready");
          return list;
        })
        .catch((err: unknown) => {
          setLoadError(err instanceof ApiError ? err.message : "Couldn't load events.");
          setLoadState("error");
          return [] as EventSummary[];
        }),
    [],
  );

  useEffect(() => {
    api.city("memphis").then(setCity).catch(() => undefined);
    loadEvents();
    api.providers().then(setProviders).catch(() => setProvidersFailed(true));
    api.config().then(setConfig).catch(() => undefined);

    const params = new URLSearchParams(location.search);
    const signin = params.get("signin");
    const compose = params.get("compose") === "1";
    api
      .me()
      .then((user) => {
        setMe(user);
        // Signed in from the Post button: go straight to the form.
        if (user && compose) setSheet("announce");
      })
      .catch(() => undefined);
    if (signin || compose) {
      if (signin) setToastMsg(signin === "ok" ? "You're signed in." : "Sign-in didn't go through. Try again.");
      params.delete("signin");
      params.delete("compose");
      history.replaceState(null, "", location.pathname + (params.size ? `?${params}` : ""));
    }
  }, [loadEvents]);

  // Keep the address bar in step with the open event so links can be shared.
  // On the map, the filters ride along in the query so a filtered view can be shared too.
  const filterQuery = filtersQuery(filters);
  useEffect(() => {
    const path = selectedId ? `/e/${encodeURIComponent(selectedId)}` : view === "feed" ? "/feed" : "/";
    if (location.pathname !== path) history.pushState(null, "", path + (selectedId ? "" : filterQuery));
    else if (!selectedId && location.search !== filterQuery) {
      // Keep one-off params (sign-in results) out of the way: they're cleared on load.
      history.replaceState(null, "", path + filterQuery);
    }
  }, [selectedId, filterQuery, view]);
  useEffect(() => {
    saveFilters({ ...filters, date: filters.windowId === "date" ? filters.date : null }, tonightDate(new Date(), "America/Chicago"));
  }, [filters]);
  useEffect(() => {
    const onPop = () => {
      setSelectedId(eventIdFromPath());
      if (!eventIdFromPath()) setViewState(location.pathname.startsWith("/feed") ? "feed" : "map");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const now = useMemo(() => new Date(), [events, windowId, pickedDate]);

  // The list covers two weeks. A picked date further out loads that night and merges it in.
  useEffect(() => {
    if (windowId !== "date") return;
    const night = nightRange(pickedDate, city.timezone);
    if (!night || night.to.getTime() < Date.now()) return;
    let stale = false;
    api
      .events("memphis", night)
      .then((list) => {
        if (stale || !list.length) return;
        setEvents((cur) => {
          const ids = new Set(cur.map((e) => e.id));
          const add = list.filter((e) => !ids.has(e.id));
          return add.length ? [...cur, ...add] : cur;
        });
      })
      .catch(() => undefined);
    return () => {
      stale = true;
    };
  }, [windowId, pickedDate, city.timezone]);

  // A search applied to the map and feed: the server says which events match; events beyond the loaded
  // two weeks come back with it and join the list.
  const [searchHits, setSearchHits] = useState<{ q: string; ids: Set<string> } | null>(null);
  const fitNext = useRef(false);
  useEffect(() => {
    const q = filters.q;
    if (!q) return setSearchHits(null);
    const ctl = new AbortController();
    api
      .search(q, ctl.signal)
      .then((r) => {
        setSearchHits({ q, ids: new Set(r.eventIds) });
        const extra = [...r.events];
        setEvents((cur) => {
          const have = new Set(cur.map((e) => e.id));
          const add = extra.filter((e) => !have.has(e.id));
          return add.length ? [...cur, ...add] : cur;
        });
      })
      .catch(() => !ctl.signal.aborted && setSearchHits({ q, ids: new Set() }));
    return () => ctl.abort();
  }, [filters.q]);

  const matching = useCallback(
    (f: Filters) => {
      const range = windowRange(f.windowId, now, city.timezone, f.date ?? undefined);
      // "All" means two weeks for browsing; for a search it means everything coming up.
      if (f.q && f.windowId === "all") range.to = new Date(now.getTime() + 400 * 86400e3);
      // While a search is loading, show nothing rather than everything.
      const ids = f.q ? (searchHits?.q === f.q ? searchHits.ids : new Set<string>()) : null;
      return events.filter(
        (e) => (!ids || ids.has(e.id)) && (!f.friends || !!friendsAt[e.id]?.length) && overlaps(e.startsAt, e.endsAt, range) && matchesFilters(e, f),
      );
    },
    [events, now, city.timezone, searchHits, friendsAt],
  );
  const shown = useMemo(() => matching(filters), [matching, filters]);
  // Tonight's events with a friend going or there, whatever the filters say: a quick way to find your people.
  const friendsTonight = useMemo(() => {
    if (!Object.keys(friendsAt).length) return [];
    const tonight = windowRange("tonight", now, city.timezone);
    return events
      .filter((e) => friendsAt[e.id]?.length && overlaps(e.startsAt, e.endsAt, tonight))
      .sort((a, b) => (friendsAt[b.id]?.length ?? 0) - (friendsAt[a.id]?.length ?? 0));
  }, [events, friendsAt, now, city.timezone]);
  // Frame the results on the map once a search lands.
  useEffect(() => {
    if (!fitNext.current || !filters.q || searchHits?.q !== filters.q) return;
    fitNext.current = false;
    if (shown.length) setFit({ key: Date.now(), points: shown.map((e) => [e.lng, e.lat]) });
  }, [shown, searchHits, filters.q]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [fit, setFit] = useState<{ key: number; points: [number, number][]; minZoom?: number } | null>(null);
  // Open on what's around you: the first fix frames you and the closest few nights (within a short ride),
  // or just your neighborhood when nothing's close. Once per load, and never over an open event or a search.
  const framedMe = useRef(false);
  useEffect(() => {
    if (framedMe.current || !myPos || loadState === "loading") return;
    framedMe.current = true;
    if (selectedId || filters.q) return;
    const near = shown
      .map((e) => ({ e, d: milesBetween(myPos, e) }))
      .filter((x) => x.d <= NEAR_MILES)
      .sort((a, b) => a.d - b.d)
      .slice(0, 4);
    setFit({ key: Date.now(), points: [[myPos.lng, myPos.lat], ...near.map((x) => [x.e.lng, x.e.lat] as [number, number])], minZoom: near.length ? undefined : 13.5 });
  }, [myPos, loadState, shown, selectedId, filters.q]);

  const selected = events.find((e) => e.id === selectedId) ?? (extra && extra.id === selectedId ? extra : null);

  // Fetch an open event that the list doesn't include.
  useEffect(() => {
    if (loadState !== "ready" || !selectedId || events.some((e) => e.id === selectedId) || extra?.id === selectedId) return;
    let stale = false;
    api
      .event(selectedId)
      .then((d) => {
        if (stale) return;
        setExtra(d);
        setFocus({ lng: d.lng, lat: d.lat, key: Date.now() });
      })
      .catch((err: unknown) => {
        if (stale) return;
        toast(err instanceof ApiError ? err.message : "Couldn't open that event.");
        setSelectedId(null);
      });
    return () => {
      stale = true;
    };
  }, [loadState, selectedId, events, extra, toast, me]);


  const openEvent = (id: string) => {
    setSheet(null);
    setExtra(null);
    setSelectedId(id);
    const ev = events.find((e) => e.id === id);
    if (ev) setFocus({ lng: ev.lng, lat: ev.lat, key: Date.now() });
  };

  async function afterSave(id: string, message: string) {
    setSheet(null);
    setEditing(null);
    setExtra(null);
    const list = await loadEvents(true);
    setDetailVersion((v) => v + 1);
    setSelectedId(id);
    const ev = list.find((e) => e.id === id);
    if (ev) setFocus({ lng: ev.lng, lat: ev.lat, key: Date.now() });
    toast(message);
  }
  // The open event always keeps its pin, even when the filters would hide it (for example a shared link).
  const mapEvents = useMemo(() => (selected && !shown.includes(selected) ? [...shown, selected] : shown), [shown, selected]);

  // On phones, the card swiped to the front of the rail rings its pin (and the map follows it).
  useEffect(() => {
    const rail = railRef.current;
    if (!rail || selectedId || !window.matchMedia("(max-width: 899px)").matches) return;
    let timer = 0;
    const onScroll = () => {
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        const left = rail.getBoundingClientRect().left;
        let best: HTMLElement | null = null;
        let bestDist = Infinity;
        for (const card of rail.querySelectorAll<HTMLElement>(".card[data-id]")) {
          const d = Math.abs(card.getBoundingClientRect().left - left - 16);
          if (d < bestDist) {
            bestDist = d;
            best = card;
          }
        }
        if (best?.dataset.id) setHighlight({ id: best.dataset.id, follow: true });
      }, 120);
    };
    rail.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      rail.removeEventListener("scroll", onScroll);
      clearTimeout(timer);
    };
  }, [selectedId, shown]);

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

  const emptyNote = (
    <>
                Nothing on the schedule {windowId === "tonight" ? "tonight" : windowId === "date" ? "that night yet" : "for these filters"}.{" "}
                {windowId === "tonight" ? (
                  <button className="link" onClick={() => setWindowId("weekend")}>
                    Check the weekend →
                  </button>
                ) : activeCount(filters) ? (
                  <button className="link" onClick={() => setFilters((f) => ({ ...DEFAULT_FILTERS, date: f.date }))}>
                    Clear filters →
                  </button>
                ) : null}
    </>
  );
  const [signInIntent, setSignInIntent] = useState<"post" | null>(null);
  const returnTo =
    signInIntent === "post" ? "/?compose=1" : sheet === "invite" && inviteToken ? `/f/${inviteToken}` : selectedId ? `/e/${encodeURIComponent(selectedId)}` : "/";
  // RSVP from a feed card: Going on, or off again. Optimistic, like the event page.
  async function feedRsvp(id: string) {
    if (!me) return openSignIn();
    const next = rsvps[id] === "going" ? null : "going";
    const prev = rsvps[id] ?? null;
    const delta = next === "going" ? 1 : prev === "going" ? -1 : 0;
    const apply = (status: RsvpStatus | null, d: number) => {
      setRsvps((r) => {
        const copy = { ...r };
        if (status) copy[id] = status;
        else delete copy[id];
        return copy;
      });
      setEvents((list) => list.map((e) => (e.id === id ? { ...e, goingCount: Math.max(0, e.goingCount + d) } : e)));
    };
    apply(next, delta);
    try {
      await api.rsvp(id, next);
      if (next) {
        const ev = events.find((e) => e.id === id);
        if (ev) saveForOffline([ev]);
        toast("You're going. Saved to your list.");
        announceGoing();
      }
    } catch (err) {
      apply(prev, -delta);
      toast(err instanceof ApiError ? err.message : "Couldn't save your RSVP. Try again.");
    }
  }
  // Dragging the sheet to full is opening the feed; back down is the map.
  const changeDetent = useCallback((d: Detent) => {
    setDetent(d);
    setViewState(d === "full" ? "feed" : "map");
    try {
      localStorage.setItem(VIEW_KEY, d === "full" ? "feed" : "map");
    } catch {
      // ignore
    }
  }, []);
  useEffect(() => {
    if (view === "feed" && detent !== "full") setDetent("full");
    if (view === "map" && detent === "full") setDetent("half");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  function showOnMap(id: string) {
    const ev = events.find((e) => e.id === id);
    setView("map");
    if (!ev) return;
    setHighlight({ id, follow: true });
    setFocus({ lng: ev.lng, lat: ev.lat, key: Date.now() });
  }

  const openSignIn = (intent: "post" | null = null) => {
    setSignInIntent(intent);
    setSheet("signin");
  };

  return (
    <div className="app">
      <MapView
        friends={friendsAt}
        fit={fit}
        // While following the viewer's dot, cards still ring their pin but don't pull the map away.
        highlight={selectedId ? null : followMe && highlight ? { ...highlight, follow: false } : highlight}
        events={mapEvents}
        center={city.center}
        zoom={city.zoom}
        selectedId={selectedId}
        onSelect={select}
        focus={focus}
        theme={theme}
        myPosition={myPos}
        followMe={followMe}
        onUnfollow={() => setFollowMe(false)}
      />
      <div className="map-dots" aria-hidden="true" />

      <header className="topbar">
        <nav className="nav" aria-label="Main">
          <a className="logo" href="/" aria-label="Assembly home">
            <img src="/icons/favicon.svg" alt="" width="22" height="22" />
            <span className="logo-word">Assembly</span>
          </a>
          <span className="nav-city">{city.name}</span>
          {!online && (
            <span className="offline-tag" role="status">
              Offline
            </span>
          )}
          <span className="spacer" />
          <Button
            size="sm"
            onClick={() => {
              if (!me) return openSignIn("post");
              setEditing(null);
              setSheet("announce");
            }}
          >
            + <span className="hide-narrow">Make an announcement</span>
            <span className="show-narrow">Post</span>
          </Button>
          {me ? (
            <button className="avatar" onClick={() => setSheet("profile")} aria-label="Your profile">
              {me.avatarUrl ? <img src={me.avatarUrl} alt="" referrerPolicy="no-referrer" /> : me.displayName.slice(0, 1).toUpperCase()}
              {!!(friendsState?.incoming.length || friendsState?.invites.some((i) => !i.seen)) && <span className="avatar-dot" aria-label="New friend requests or invites" />}
            </button>
          ) : (
            <Button size="sm" variant="solid" onClick={() => openSignIn()}>
              Sign in
            </Button>
          )}
        </nav>
      </header>

      <HomeSheet
        detent={detent}
        onDetent={changeDetent}
        hidden={!!selected && !wide}
        floating={<LocateButton status={loc.status} following={followMe} onTap={tapLocate} />}
        header={
          <SheetHeader
            filters={filters}
            tz={city.timezone}
            count={shown.length}
            loading={loadState === "loading"}
            onSearch={() => setSearchOpen(true)}
            near={loc.status === "on" ? "on" : loc.status === "locating" ? "locating" : loc.status === "off" ? "off" : "none"}
            onNear={() => {
              setToastMsg("Your location stays on this device. Assembly never saves or shares it.");
              loc.start();
            }}
            onFilters={() => setFiltersOpen(true)}
            onChange={setFilters}
          />
        }
        peekExtra={
          <>
          {friendsTonight.length > 0 && (
            <div className="friends-tonight" role="list" aria-label="Friends tonight">
              <span className="friends-tonight-label">Friends tonight</span>
              {friendsTonight.map((e) => (
                <button key={e.id} role="listitem" className="friends-tonight-item" onClick={() => select(e.id)}>
                  <Faces people={friendsAt[e.id]} size={20} label={false} />
                  <span className="friends-tonight-title">{e.title}</span>
                  {friendsAt[e.id].some((f) => f.state === "here") && <span className="friends-tonight-here">here</span>}
                </button>
              ))}
            </div>
          )}
          </>
        }
        half={
          <>
          <div className="rail" ref={railRef}>
            {loadState === "loading" && (
              <>
                <span className="sr-only" role="status">
                  Loading events…
                </span>
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="card card-skeleton" aria-hidden="true" style={{ animationDelay: `${i * 80}ms` }}>
                    <Frame className="card-frame">
                      <span className="card-top">
                        <Skeleton w={44} h={9} />
                        <Skeleton w={8} h={8} />
                      </span>
                      <span className="card-body skel-stack">
                        <Skeleton w="85%" h={18} />
                        <Skeleton w="55%" h={18} />
                      </span>
                      <Skeleton w="60%" h={9} />
                      <span className="card-meta">
                        <Skeleton w="45%" h={9} />
                        <Skeleton w={48} h={9} />
                      </span>
                    </Frame>
                  </div>
                ))}
              </>
            )}
            {loadState === "error" && <div className="rail-empty">{loadError}</div>}
            {loadState === "ready" && shown.length === 0 && (
              <div className="rail-empty">{emptyNote}</div>
            )}
            {shown.map((e, i) => {
              const queer = e.scenes.includes("queer");
              const cancelled = e.status === "cancelled";
              const live = !cancelled && isLive(e.startsAt, e.endsAt, now);
              return (
                <button
                  key={e.id}
                  data-id={e.id}
                  className={`card ${cancelled ? "is-cancelled" : ""} ${highlight?.id === e.id ? "is-highlighted" : ""}`}
                  onClick={() => select(e.id)}
                  onMouseEnter={() => setHighlight({ id: e.id, follow: false })}
                  onMouseLeave={() => setHighlight((h) => (h?.id === e.id ? null : h))}
                  onFocus={() => setHighlight({ id: e.id, follow: false })}
                >
                  <Frame featured={live} className="card-frame">
                    <span className="card-top num">
                      <span>
                        N.{pad(i + 1)} <span className="dim">/ {pad(shown.length)}</span>
                      </span>
                      {cancelled ? <Tag>Cancelled</Tag> : live ? <Tag tone="accent">Live</Tag> : <span className="marker" style={{ background: queer ? "var(--color-uv)" : "var(--color-sodium)" }} />}
                    </span>
                    <span className="card-body">
                      <span className="card-title">{e.title}</span>
                      {!e.thumbUrl && <GeneratedArt compact id={e.id} className="card-thumb" />}
                      {e.thumbUrl && (
                        <img
                          className="card-thumb"
                          src={e.thumbUrl}
                          alt=""
                          loading="lazy"
                          style={{ borderColor: queer ? "var(--color-uv)" : "var(--color-sodium)" }}
                          // Older flyers have no thumbnail.
                          onError={(ev) => ev.currentTarget.remove()}
                        />
                      )}
                    </span>
                    <span className="card-when num">
                      {dayLabel(e.startsAt, now, city.timezone)} / {clock(e.startsAt, city.timezone)}
                      {myPos && <span className="dim"> / {distanceTo(e)}</span>}
                    </span>
                    {friendsAt[e.id] && (
                      <span className="card-friends">
                        <Faces people={friendsAt[e.id]} size={18} />
                      </span>
                    )}
                    <span className="card-meta">
                      <span className="card-venue">{e.venueName ?? e.neighborhood}</span>
                      <span className="num">{e.hereNow ? `${e.hereNow} here · ` : ""}{e.goingCount} going</span>
                    </span>
                  </Frame>
                </button>
              );
            })}
          </div>
          </>
        }
        full={
          <>
        <FeedView
          embedded
          events={shown}
          loadState={loadState}
          loadError={loadError}
          online={online}
          tz={city.timezone}
          config={config}
          rsvps={rsvps}
          friendsAt={friendsAt}
          emptyNote={emptyNote}
          onOpen={select}
          onShowOnMap={showOnMap}
          onRsvp={feedRsvp}
          toast={toast}
          distance={myPos ? distanceTo : undefined}
        />
            <footer className="sheet-footer">
              <button className="link" onClick={() => setSheet("subscribe")}>
                Subscribe in your calendar
              </button>
              <button className="link" onClick={() => setTheme(theme === "light" ? "dark" : "light")}>
                {theme === "light" ? "Dark mode" : "Light mode"}
              </button>
              <a href="/guidelines">Guidelines</a>
              <a href="/privacy">Privacy</a>
              <a href="/terms">Terms</a>
            </footer>
          </>
        }
      />

      {selected && (
        <EventSheet
          key={`${selected.id}:${detailVersion}`}
          summary={selected}
          friends={friendsAt[selected.id] ?? []}
          friendsOn={friendsOn}
          myFriends={friendsState?.friends ?? []}
          tz={city.timezone}
          me={me}
          config={config}
          onClose={() => select(null)}
          onNeedSignIn={() => openSignIn()}
          onEdit={(d) => {
            setEditing(d);
            setSheet("announce");
          }}
          onChanged={() => setDetailVersion((v) => v + 1)}
          toast={toast}
        />
      )}

      <Sheet open={sheet === "signin"} onClose={() => setSheet(null)} label="Sign in" modal center>
        <SignInSheet
          providers={providers}
          unreachable={providersFailed}
          returnTo={returnTo}
          onSignedIn={(user, isNew) => {
            setMe(user);
            toast(isNew ? `Welcome, ${user.displayName}.` : "You're signed in.");
            // Came from the Post button: go straight to the form.
            setSheet(signInIntent === "post" ? "announce" : inviteToken ? "invite" : null);
          }}
        />
      </Sheet>

      <Sheet
        open={sheet === "announce" && !!me}
        onClose={() => {
          setSheet(null);
          setEditing(null);
        }}
        label={editing ? "Edit announcement" : "Make an announcement"}
        modal
        center
        className="sheet-compose"
      >
        <AnnounceForm
          key={editing?.id ?? "new"}
          city={city}
          theme={theme}
          config={config}
          existing={editing}
          toast={toast}
          onPosted={(id, mode) =>
            afterSave(
              id,
              mode === "created" ? "Posted. It's on the map." : mode === "review" ? "Sent for review. You'll hear when it's live." : "Changes saved.",
            )
          }
          onCancelled={(id) => afterSave(id, "Marked cancelled. It stays on the map so people know.")}
        />
      </Sheet>

      <Sheet open={sheet === "profile" && !!me} onClose={() => setSheet(null)} label="Your profile" modal center>
        {me && (
          <ProfileSheet
            me={me}
            tz={city.timezone}
            onChange={setMe}
            onOpenEvent={openEvent}
            onAnnounce={() => {
              setEditing(null);
              setSheet("announce");
            }}
            onModerate={() => setSheet("moderation")}
            friends={friendsState}
            onFriends={() => setSheet("friends")}
            config={config}
            onSignedOut={(message) => {
              clearUserCaches();
              setMe(null);
              setSheet(null);
              setSelectedId(null);
              toast(message);
            }}
            toast={toast}
          />
        )}
      </Sheet>

      <Sheet open={sheet === "friends" && !!me} onClose={() => setSheet("profile")} label="Friends" modal center>
        <FriendsSheet state={friendsState} onState={setFriendsState} onOpenEvent={openEvent} toast={toast} />
      </Sheet>

      <Sheet open={sheet === "invite" && !!inviteToken} onClose={() => setSheet(null)} label="Friend invite" modal center>
        {inviteToken && (
          <InviteSheet
            token={inviteToken}
            signedIn={!!me}
            onNeedSignIn={() => openSignIn()}
            onDone={(st) => {
              if (st) setFriendsState(st);
              // Not on yet: show the explainer next, so the new friendship means something.
              setSheet(st && !st.me.friendsOn ? "friends" : null);
            }}
            toast={toast}
          />
        )}
      </Sheet>

      <Sheet open={sheet === "moderation" && !!me?.moderator} onClose={() => setSheet("profile")} label="Review reports" modal center className="sheet-compose">
        <ModerationSheet tz={city.timezone} onOpenEvent={openEvent} toast={toast} />
      </Sheet>

      <SearchSheet
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        initial={filters.q ?? ""}
        tz={city.timezone}
        onOpenEvent={(id) => {
          setSearchOpen(false);
          select(id);
        }}
        onApply={(q) => {
          setSearchOpen(false);
          // Results can be weeks out: look across all dates, keep the other filters.
          setFilters((f) => ({ ...f, q, windowId: f.windowId === "date" ? "date" : "all" }));
          fitNext.current = true;
        }}
      />
      <FilterSheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        filters={filters}
        tz={city.timezone}
        friendsOn={friendsOn}
        count={(f) => matching(f).length}
        onApply={(f) => {
          setFilters(f);
          setFiltersOpen(false);
        }}
      />
      <SubscribeSheet
        open={sheet === "subscribe"}
        onClose={() => setSheet(null)}
        citySlug={city.id}
        cityName={city.name}
        scene={scenes.length === 1 ? scenes[0] : null}
        toast={toast}
      />
      <InstallPrompt />
      <Toast message={toastMsg} />
    </div>
  );
}
