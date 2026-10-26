import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Skeleton, Tag } from "../components/ui";
import { PromoVideo } from "../components/PromoVideo";
import { GeneratedArt } from "../components/GeneratedArt";
import { ShareSheet } from "../components/ShareSheet";
import { Faces } from "../components/Faces";
import { SCENES, type EventSummary, type FriendAt, type RsvpStatus, type ServerConfig } from "../../shared/types";
import { dayLabel, isLive, timeRange } from "../lib/time";
import { eventUrl } from "./EventSheet";

const PAGE = 12;

/** Groups events by night in the city's timezone: Tonight, Tomorrow, Sat Oct 31, … */
function byDay(events: EventSummary[], now: Date, tz: string) {
  const groups: { label: string; events: EventSummary[] }[] = [];
  for (const e of events) {
    const label = dayLabel(e.startsAt, now, tz);
    const last = groups[groups.length - 1];
    if (last?.label === label) last.events.push(e);
    else groups.push({ label, events: [e] });
  }
  return groups;
}

/**
 * The same events as the map, as a chronological list with flyers up front. Sticky day headers, and more
 * cards load as you scroll. Videos play muted one at a time as they come into view.
 */
export function FeedView({
  events,
  loadState,
  loadError,
  online,
  tz,
  config,
  rsvps,
  friendsAt = {},
  emptyNote,
  onOpen,
  onShowOnMap,
  onRsvp,
  toast,
  distance,
}: {
  /** "0.8 mi" from the viewer, when their location is on (computed on the device). */
  distance?: (e: EventSummary) => string | null;
  events: EventSummary[];
  loadState: "loading" | "ready" | "error";
  loadError: string;
  online: boolean;
  tz: string;
  config: ServerConfig;
  rsvps: Record<string, RsvpStatus>;
  friendsAt?: Record<string, FriendAt[]>;
  emptyNote: React.ReactNode;
  onOpen: (id: string) => void;
  onShowOnMap: (id: string) => void;
  onRsvp: (id: string) => void;
  toast: (msg: string) => void;
}) {
  const [limit, setLimit] = useState(PAGE);
  const [sharing, setSharing] = useState<EventSummary | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLElement>(null);
  // The top bar floats over the list: measure where its controls end so the list and day headers start below them.
  useEffect(() => {
    const bar = document.querySelector(".topbar .filters");
    const el = root.current;
    if (!bar || !el) return;
    const set = () => el.style.setProperty("--feed-top", `${Math.ceil(bar.getBoundingClientRect().bottom) + 12}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(bar);
    window.addEventListener("resize", set);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", set);
    };
  }, []);
  const now = useMemo(() => new Date(), [events]);
  const sorted = useMemo(() => [...events].sort((a, b) => a.startsAt.localeCompare(b.startsAt)), [events]);
  const groups = useMemo(() => byDay(sorted.slice(0, limit), now, tz), [sorted, limit, now, tz]);
  // Day counts cover the whole list, not just the cards loaded so far.
  const totals = useMemo(() => new Map(byDay(sorted, now, tz).map((g) => [g.label, g.events.length])), [sorted, now, tz]);

  // A new filter starts from the top with a fresh page.
  useEffect(() => setLimit(PAGE), [events]);
  // Load the next page when the end of the list comes near.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || limit >= sorted.length) return;
    const io = new IntersectionObserver(([entry]) => entry.isIntersecting && setLimit((n) => n + PAGE), { root: root.current, rootMargin: "800px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [limit, sorted.length]);

  return (
    <section ref={root} className="feed" aria-label="Events, as a list">
      <div className="feed-inner">
        {loadState === "loading" && (
          <div className="feed-list" aria-hidden="true">
            <span className="sr-only" role="status">
              Loading events…
            </span>
            {[0, 1, 2].map((i) => (
              <div key={i} className="feed-card feed-card-skeleton">
                <Skeleton className="feed-skel-flyer" w="100%" h="auto" />
                <div className="feed-card-body">
                  <Skeleton w="35%" h={10} />
                  <Skeleton w="80%" h={26} />
                  <Skeleton w="55%" h={12} />
                </div>
              </div>
            ))}
          </div>
        )}
        {loadState === "error" && (
          <p className="feed-empty" role="alert">
            {online ? loadError : "You're offline. Nights you RSVP'd to are saved on this device: open your profile to see them."}
          </p>
        )}
        {loadState === "ready" && sorted.length === 0 && <p className="feed-empty">{emptyNote}</p>}

        {groups.map((g) => (
          <section key={g.label} className="feed-day" aria-label={g.label}>
            <h2 className="feed-day-head">
              <span>{g.label}</span>
              <span className="num">{String(totals.get(g.label) ?? g.events.length).padStart(2, "0")}</span>
            </h2>
            <ol className="feed-list">
              {g.events.map((e) => (
                <li key={e.id}>
                  <FeedCard
                    e={e}
                    now={now}
                    tz={tz}
                    config={config}
                    rsvp={rsvps[e.id] ?? null}
                    friends={friendsAt[e.id] ?? []}
                    onOpen={() => onOpen(e.id)}
                    onShowOnMap={() => onShowOnMap(e.id)}
                    onRsvp={() => onRsvp(e.id)}
                    onShare={() => setSharing(e)}
                    distance={distance?.(e) ?? null}
                  />
                </li>
              ))}
            </ol>
          </section>
        ))}
        <div ref={sentinel} className="feed-sentinel" aria-hidden="true" />
        {loadState === "ready" && sorted.length > 0 && limit >= sorted.length && <p className="feed-end note">That's everything for these filters.</p>}
      </div>
      {sharing && (
        <ShareSheet
          target={{ title: sharing.title, text: `${sharing.title}: ${dayLabel(sharing.startsAt, now, tz)}, ${timeRange(sharing.startsAt, sharing.endsAt, tz)}`, url: eventUrl(sharing.id) }}
          open
          onClose={() => setSharing(null)}
          toast={toast}
        />
      )}
    </section>
  );
}

function FeedCard({
  e,
  now,
  tz,
  config,
  rsvp,
  friends,
  onOpen,
  onShowOnMap,
  onRsvp,
  onShare,
  distance,
}: {
  distance: string | null;
  e: EventSummary;
  now: Date;
  tz: string;
  config: ServerConfig;
  rsvp: RsvpStatus | null;
  friends: FriendAt[];
  onOpen: () => void;
  onShowOnMap: () => void;
  onRsvp: () => void;
  onShare: () => void;
}) {
  const queer = e.scenes.includes("queer");
  const cancelled = e.status === "cancelled";
  const live = !cancelled && isLive(e.startsAt, e.endsAt, now);
  const [loaded, setLoaded] = useState(false);
  const labels = e.scenes.map((s) => SCENES.find((x) => x.id === s)?.label).filter(Boolean) as string[];
  return (
    <article className={`feed-card ${queer ? "is-queer" : ""} ${cancelled ? "is-cancelled" : ""} ${live ? "is-live" : ""}`}>
      {config.video && e.videoId && !cancelled ? (
        <PromoVideo uid={e.videoId} customerCode={config.streamCustomerCode} title={e.title} />
      ) : (
        <button className="feed-flyer" onClick={onOpen} aria-label={`Open ${e.title}`}>
          {e.flyerUrl ? (
            <img
              className={`fade-in ${loaded ? "is-loaded" : ""}`}
              src={e.flyerUrl}
              alt={`Flyer for ${e.title}`}
              loading="lazy"
              decoding="async"
              onLoad={() => setLoaded(true)}
              onError={() => setLoaded(true)}
            />
          ) : (
            // Seeded pixel liquid; animates only while on screen (GeneratedArt).
            <GeneratedArt
              className="flyer-generated"
              id={e.id}
              title={e.title}
              when={`${dayLabel(e.startsAt, now, tz)} / ${timeRange(e.startsAt, e.endsAt, tz)}`}
              venue={e.venueName ?? e.neighborhood}
            />
          )}
        </button>
      )}
      <div className="feed-card-body">
        <div className="feed-card-top">
          <span className="feed-when num">
            {timeRange(e.startsAt, e.endsAt, tz)}
          </span>
          {cancelled ? <Tag>Cancelled</Tag> : live ? <Tag tone="accent">Live</Tag> : null}
        </div>
        <h3 className="feed-title">
          <button className="link-plain" onClick={onOpen}>
            {e.title}
          </button>
        </h3>
        {e.pitch && <p className="feed-pitch serif-text">{e.pitch}</p>}
        <p className="feed-where">
          {e.venueName ?? e.address}
          {e.neighborhood && <span className="dim"> / {e.neighborhood}</span>}
          {distance && <span className="dim num distance"> / {distance}</span>}
        </p>
        {labels.length > 0 && (
          <p className="feed-scenes">
            <span className="marker" style={{ background: queer ? "var(--color-uv)" : "var(--color-sodium)" }} aria-hidden="true" />
            {labels.join(" / ")}
          </p>
        )}
        {friends.length > 0 && <Faces people={friends} />}
        <div className="feed-actions">
          <Button size="sm" variant={rsvp === "going" ? "confirmed" : "primary"} onClick={onRsvp} disabled={cancelled} aria-pressed={rsvp === "going"}>
            {rsvp === "going" ? "Going ✓" : "RSVP"}
          </Button>
          <Button size="sm" onClick={onShare}>
            Share
          </Button>
          <Button size="sm" variant="ghost" onClick={onShowOnMap}>
            Show on map
          </Button>
          <span className="spacer" />
          <span className="feed-going num">{e.hereNow ? `${e.hereNow} here · ` : ""}{e.goingCount} going</span>
        </div>
      </div>
    </article>
  );
}
