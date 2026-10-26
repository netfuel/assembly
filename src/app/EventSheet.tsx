import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { GeneratedArt } from "../components/GeneratedArt";
import { Button, Frame, Label, LinkButton, LiveBadge, Segmented, Sheet, Tag, Skeleton } from "../components/ui";
import { announceGoing } from "../lib/install";
import { ShareSheet } from "../components/ShareSheet";
import { FlyerViewer } from "../components/FlyerViewer";
import { CheckIn } from "./CheckIn";
import { EventWall } from "./EventWall";
import { Faces } from "../components/Faces";
import { FriendAvatar } from "./FriendsSheet";
import { createPortal } from "react-dom";
import { api, ApiError } from "../lib/api";
import { PromoVideo } from "../components/PromoVideo";
import { Avatar } from "./ProfileSheet";
import { saveForOffline } from "../lib/offline";
import { PushPrompt } from "../components/PushControl";
import { dayLabel, isLive, timeRange } from "../lib/time";
import { directionsLinks, downloadIcs } from "../lib/calendar";
import { countTo, flipIn, hasFlipOrigin, reducedMotion, revealChildren, stamp, useGSAP } from "../lib/motion";
import { POLICY_TAGS, SCENES, type EventDetail, type EventSummary, type FriendAt, type FriendPerson, type HerePerson, type PresenceVisibility, type HostSummary, type Me, type MeProfile, type Presence, type RsvpStatus, type ServerConfig } from "../../shared/types";


const LINK_LABELS: Record<string, string> = {
  instagram: "Instagram",
  soundcloud: "SoundCloud",
  bandcamp: "Bandcamp",
  mixcloud: "Mixcloud",
  ra: "RA",
  spotify: "Spotify",
  site: "Site",
};

export function eventUrl(id: string) {
  return `${location.origin}/e/${encodeURIComponent(id)}`;
}

/** "Live now · until 2 am" with the time left once it's under an hour: the door is still open, here's for how long. */
function liveLine(endsAt: string, now: Date) {
  const left = Math.round((Date.parse(endsAt) - now.getTime()) / 60_000);
  if (left <= 0) return "Live now · wrapping up";
  if (left < 60) return `Live now · ${left} min left`;
  const h = Math.floor(left / 60);
  const m = left % 60;
  return `Live now · ${h}h${m ? ` ${m}m` : ""} left`;
}

type SectionKey = "details" | "here" | "wall" | "people";
/** What comes first depends on the night: before, the details; during, who's here and the wall; after, the wall. */
const SECTION_ORDER: Record<"cancelled" | "upcoming" | "live" | "past", SectionKey[]> = {
  upcoming: ["details", "people"],
  live: ["here", "wall", "details"],
  past: ["wall", "details"],
  cancelled: ["details"],
};

export function EventSheet({
  summary,
  friends = [],
  friendsOn = false,
  myFriends = [],
  tz,
  me,
  onClose,
  onNeedSignIn,
  onEdit,
  onChanged,
  config,
  toast,
}: {
  summary: EventSummary;
  /** Friends going to or at this event (only when your friends are on). */
  friends?: FriendAt[];
  friendsOn?: boolean;
  /** Your friends, for inviting. */
  myFriends?: FriendPerson[];
  tz: string;
  me: MeProfile | null;
  onClose: () => void;
  onNeedSignIn: () => void;
  onEdit: (detail: EventDetail) => void;
  /** Something about the event changed (a new host): reload it. */
  onChanged: () => void;
  config: ServerConfig;
  toast: (msg: string) => void;
}) {
  const [detail, setDetail] = useState<EventDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rsvp, setRsvp] = useState<RsvpStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const rsvpBtn = useRef<HTMLButtonElement>(null);
  const goingEl = useRef<HTMLSpanElement>(null);
  const now = new Date();
  const e = detail ?? summary;
  const queer = e.scenes.includes("queer");
  const cancelled = e.status === "cancelled";
  const live = !cancelled && isLive(e.startsAt, e.endsAt, now);
  const directions = directionsLinks(e);
  // One state, one primary action (design review): upcoming → RSVP, doors open → Check in, after → See the wall.
  const nowMs = now.getTime();
  const phase: "cancelled" | "upcoming" | "live" | "past" = cancelled
    ? "cancelled"
    : nowMs > Date.parse(e.endsAt) + 30 * 60e3
      ? "past"
      : nowMs >= Date.parse(e.startsAt) - 30 * 60e3
        ? "live"
        : "upcoming";
  const photoFree = e.policyTags.includes("no-photos");
  // Beta modules can be switched off on the server (FEATURES_OFF); their sections and actions go with them.
  const feat = config.features ?? { wall: true, friends: true, checkin: true };
  const canCheckIn = feat.checkin && phase === "live";
  const hasWall = feat.wall && !photoFree;
  const [open, setOpen] = useState<Record<string, boolean>>(() => ({
    details: phase === "upcoming" || phase === "cancelled",
    here: phase === "live",
    wall: phase === "past" || (phase === "live" && !photoFree),
    people: false,
  }));
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
  const [checkInSignal, setCheckInSignal] = useState(0);
  const reveal = (key: string) => {
    setOpen((o) => ({ ...o, [key]: true }));
    requestAnimationFrame(() => sectionRefs.current[key]?.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" }));
  };
  // Tags people decide on at a glance stay visible; the rest fold into Details.
  const KEY_TAGS = ["queer-centered", "all-ages", "18+", "21+", "accessible-entrance", "harm-reduction"];
  const keyTags = e.policyTags.filter((t) => KEY_TAGS.includes(t));
  const otherTags = e.policyTags.filter((t) => !KEY_TAGS.includes(t));
  const baseGoing = e.goingCount - (detail?.viewerRsvp === "going" ? 1 : 0);
  const going = baseGoing + (rsvp === "going" ? 1 : 0);

  // Opened from a card: the card's art flies into the hero, so the sheet itself doesn't slide.
  const hero = useRef<HTMLDivElement>(null);
  const [flipping] = useState(() => hasFlipOrigin(summary.id));
  useLayoutEffect(() => {
    flipIn(summary.id, hero.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tweens made here are reverted if the page closes mid-animation. The stamp runs from a click, so it goes through contextSafe.
  const { contextSafe } = useGSAP(
    () => {
      revealChildren(root.current);
    },
    { scope: root, dependencies: [summary.id] },
  );
  useGSAP(
    () => {
      countTo(goingEl.current, going);
    },
    { scope: root, dependencies: [going] },
  );
  const stampRsvp = contextSafe(() => stamp(rsvpBtn.current));

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setLoadError(null);
    api
      .event(summary.id)
      .then((d) => {
        if (cancelled) return;
        setDetail(d);
        setRsvp(d.viewerRsvp);
      })
      .catch((err: unknown) => !cancelled && setLoadError(err instanceof ApiError ? err.message : "Couldn't load the lineup."));
    return () => {
      cancelled = true;
    };
  }, [summary.id, me?.id]);

  async function choose(status: RsvpStatus) {
    if (!me) return onNeedSignIn();
    const next = rsvp === status ? null : status;
    const prev = rsvp;
    setRsvp(next);
    if (next === "going") stampRsvp();
    setBusy(true);
    try {
      await api.rsvp(e.id, next);
      if (next) saveForOffline([e]);
      if (next === "going") {
        toast("You're going. Saved to your list.");
        announceGoing();
      }
      else if (next === "interested") toast("Marked as interested.");
    } catch (err) {
      setRsvp(prev);
      toast(err instanceof ApiError ? err.message : "Couldn't save your RSVP. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const [sharing, setSharing] = useState(false);
  const [viewing, setViewing] = useState(false);
  const [checkedIn, setCheckedIn] = useState(false);
  const onPresence = useCallback((p: Presence) => setCheckedIn(!!p.viewer?.checkedIn), []);
  const shareTarget = {
    title: e.title,
    text: `${e.title}: ${dayLabel(e.startsAt, now, tz)}, ${timeRange(e.startsAt, e.endsAt, tz)}${e.venueName ? ` at ${e.venueName}` : ""}`,
    url: eventUrl(e.id),
  };

  const [story, setStory] = useState<null | "working" | { url: string; file: File }>(null);
  async function makeStory() {
    setStory("working");
    try {
      const { renderStoryCard } = await import("../lib/storyCard");
      const blob = await renderStoryCard(e, `${eventUrl(e.id)}?ref=story`, tz);
      const file = new File([blob], `assembly-${e.id}.png`, { type: "image/png" });
      setStory({ url: URL.createObjectURL(blob), file });
    } catch {
      setStory(null);
      toast("Couldn't make the story card. Try again.");
    }
  }
  function closeStory() {
    if (story && story !== "working") URL.revokeObjectURL(story.url);
    setStory(null);
  }
  async function shareStory(file: File) {
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: e.title });
        return;
      }
    } catch (err) {
      if ((err as DOMException)?.name === "AbortError") return;
    }
    // No file sharing here (most desktops): save it instead.
    const a = document.createElement("a");
    a.href = URL.createObjectURL(file);
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  const sceneLabels = e.scenes.map((s) => SCENES.find((x) => x.id === s)?.label).filter(Boolean) as string[];

  return (
    <>
    <Sheet open={!!story && story !== "working"} onClose={closeStory} label="Story card" modal center className="story-sheet">
      {story && story !== "working" && (
        <div className="story-preview">
          <Label glyph="▣">Story card</Label>
          <img src={story.url} alt={`Story card for ${e.title}`} />
          <div className="story-actions">
            <Button variant="primary" size="lg" onClick={() => shareStory(story.file)}>
              Share to stories
            </Button>
            <LinkButton size="lg" href={story.url} download={story.file.name}>
              Save image
            </LinkButton>
          </div>
          <p className="note">The QR code opens this event. In Instagram, add the image to your story and place a link sticker for the same URL.</p>
        </div>
      )}
    </Sheet>
    <Sheet open onClose={onClose} label={e.title} className={flipping ? "is-flip" : ""}>
      <div ref={root} className={`event ${queer ? "is-queer" : ""}`}>
        <div className="event-hero" ref={hero}>
          {e.flyerUrl ? (
            <button className="flyer-open" onClick={() => setViewing(true)} aria-label={`Open the flyer for ${e.title} full screen`}>
              <FlyerImage src={e.flyerUrl} alt={`Flyer for ${e.title}`} />
            </button>
          ) : (
            <GeneratedArt
              className="flyer-generated"
              id={e.id}
              title={e.title}
              when={`${dayLabel(e.startsAt, now, tz)} / ${timeRange(e.startsAt, e.endsAt, tz)}`}
              venue={e.venueName ?? e.neighborhood}
            />
          )}
        </div>

        {cancelled && (
          <p className="cancelled-banner" role="status" data-reveal>
            <strong>Cancelled.</strong> The organizer called this one off. Check their links for a new date.
          </p>
        )}

        {detail?.viewerIsHost && (
          <div className="host-bar" data-reveal>
            <span>
              <Tag tone="strong">Host</Tag> {e.status === "hidden"
                ? "Hidden after reports. We'll review it."
                : e.status === "draft"
                  ? "In review. Only you can see it until a moderator approves it, usually within a day."
                  : "You posted this."}
            </span>
            <Button size="sm" onClick={() => onEdit(detail)}>
              Edit
            </Button>
          </div>
        )}

        {detail && detail.viewerCanEdit && !detail.viewerIsHost && (
          <div data-reveal>
            <ModBar detail={detail} onEdit={() => onEdit(detail)} onHanded={onChanged} toast={toast} />
          </div>
        )}

        <header className="event-head" data-reveal>
          <div className="event-meta">
            <span className="marker" style={{ background: queer ? "var(--color-uv)" : "var(--color-sodium)" }} aria-hidden="true" />
            {live ? <LiveBadge size="sm">{liveLine(e.endsAt, now)}</LiveBadge> : <span>{sceneLabels.join(" / ")}</span>}
            {cancelled && <Tag tone="danger">Cancelled</Tag>}
            {e.updated && !cancelled && <Tag>Updated</Tag>}
          </div>
          <h1 className={`event-title ${cancelled ? "is-cancelled" : ""}`}>{e.title}</h1>
          {e.pitch && <p className="event-pitch">{e.pitch}</p>}
          <p className="event-when num">
            {dayLabel(e.startsAt, now, tz)} <span className="dim">/</span> {timeRange(e.startsAt, e.endsAt, tz)}
          </p>
          <p className="event-where">
            <span className="event-where-venue">{e.venueName ?? e.neighborhood ?? "Location"}</span>
            {e.venueName && e.neighborhood && <span className="dim"> / {e.neighborhood}</span>}
            <span className="event-where-address">{e.address}</span>
          </p>
          {(keyTags.length > 0 || otherTags.length > 0 || e.doorPrice) && (
            <ul className="event-tags" aria-label="Door">
              {e.doorPrice && <li className="is-price">{e.doorPrice}</li>}
              {keyTags.map((t) => (
                <li key={t} className={t === "queer-centered" ? "is-queer" : ""}>
                  {POLICY_TAGS[t] ?? t}
                </li>
              ))}
              {otherTags.length > 0 && (
                <li>
                  <button className="event-tags-more" onClick={() => reveal("details")}>
                    +{otherTags.length}
                  </button>
                </li>
              )}
            </ul>
          )}
          <p className="going num" aria-live="polite">
            <span ref={goingEl}>{going}</span> going
            {rsvp && <span className="dim"> · saved on this device for the door</span>}
          </p>
        </header>

        {rsvp && !cancelled && phase !== "past" && (
          <div className="going-push" data-reveal>
            <PushPrompt config={config} toast={toast} />
          </div>
        )}

        {/* Sections, ordered by the night's state. The one that matters now is open; the rest are a single row. */}
        {SECTION_ORDER[phase].map((key) => {
          const toggle = () => setOpen((o) => ({ ...o, [key]: !o[key] }));
          if (key === "here")
            return !feat.checkin ? null : (
              <EvSection key={key} id="here" title="Here now" summary={checkedIn ? "You're checked in" : "Check in at the door"} open={open.here} onToggle={toggle} refs={sectionRefs}>
                <CheckIn trigger={checkInSignal} event={e} me={me} onNeedSignIn={onNeedSignIn} onChange={onPresence} toast={toast} />
                {friendsOn && (
          <FriendsHere
            eventId={e.id}
            friends={friends}
            myFriends={myFriends}
            showToggle={rsvp === "going" || checkedIn}
            checkedIn={checkedIn}
            upcoming={Date.parse(e.endsAt) > Date.now()}
            toast={toast}
          />
                )}
              </EvSection>
            );
          if (key === "people")
            return friendsOn ? (
              <EvSection key={key} id="people" title="Friends" summary={friends.length ? `${friends.length} going` : "Invite a friend"} open={open.people} onToggle={toggle} refs={sectionRefs}>
          <FriendsHere
            eventId={e.id}
            friends={friends}
            myFriends={myFriends}
            showToggle={rsvp === "going" || checkedIn}
            checkedIn={checkedIn}
            upcoming={Date.parse(e.endsAt) > Date.now()}
            toast={toast}
          />
              </EvSection>
            ) : null;
          if (key === "wall")
            return !hasWall ? null : (
              <EvSection key={key} id="wall" title="Wall" summary={phase === "past" ? "Photos from the night" : "Photos from the room"} open={open.wall} onToggle={toggle} refs={sectionRefs}>
                <EventWall event={e} me={me} checkedIn={checkedIn} onNeedSignIn={onNeedSignIn} toast={toast} />
              </EvSection>
            );
          return (
            <EvSection
              key={key}
              id="details"
              title="Details"
              summary={[detail?.lineup.length ? `${detail.lineup.length} on the lineup` : "Lineup", e.policyTags.length ? "door" : null, "getting there"].filter(Boolean).join(" · ")}
              open={open.details}
              onToggle={toggle}
              refs={sectionRefs}
            >
              <div className="ev-block" aria-label="Lineup">
                <h3 className="ev-subhead">Lineup</h3>
          {loadError && <p className="note">{loadError}</p>}
          {!detail && !loadError && (
            <div className="skel-list" role="status" aria-label="Loading the lineup">
              {[0, 1, 2].map((i) => (
                <div key={i} className="skel-row">
                  <Skeleton w={30} h={10} />
                  <span className="skel-stack">
                    <Skeleton w={`${70 - i * 12}%`} h={20} />
                    <Skeleton w="40%" h={10} />
                  </span>
                  <Skeleton w={60} h={10} />
                </div>
              ))}
            </div>
          )}
          {detail && detail.lineup.length === 0 && <p className="note">Lineup to be announced.</p>}
          {detail && detail.lineup.length > 0 && (
            <ol className="lineup">
              {detail.lineup.map((slot, i) => (
                <li key={slot.artistId}>
                  <span className="lineup-index num">N.{String(i + 1).padStart(2, "0")}</span>
                  <span className="lineup-artist">
                    <span className="lineup-name">{slot.name}</span>
                    {(slot.note || slot.room) && <span className="lineup-note">{[slot.room, slot.note].filter(Boolean).join(" / ")}</span>}
                    <span className="artist-links">
                      {Object.entries(slot.links).map(([k, href]) =>
                        href ? (
                          <a key={k} href={href} target="_blank" rel="noopener noreferrer">
                            {LINK_LABELS[k] ?? k} ↗
                          </a>
                        ) : null,
                      )}
                    </span>
                  </span>
                  <span className="lineup-time num">{slot.setStart ?? ""}</span>
                </li>
              ))}
            </ol>
          )}
              </div>
              {(e.doorPrice || e.policyTags.length > 0) && (
                <div className="ev-block" aria-label="Door">
                  <h3 className="ev-subhead">Door</h3>
                  <ul className="door">
                    {e.doorPrice && (
                      <li>
                        <strong>{e.doorPrice}</strong>
                      </li>
                    )}
                    {e.policyTags.map((t) => (
                      <li key={t}>{POLICY_TAGS[t] ?? t}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="ev-block where" aria-label="Getting there">
                <h3 className="ev-subhead">Getting there</h3>
          <p className="where-venue">
            {e.venueName ?? "Location"}
            {e.neighborhood && <span className="dim"> / {e.neighborhood}</span>}
          </p>
          <p className="where-address">{e.address}</p>
          {detail?.gettingThere && <p className="where-note serif-text">{detail.gettingThere}</p>}
          <div className="where-links">
            <LinkButton size="sm" href={directions.apple} target="_blank" rel="noopener noreferrer">
              ▷ Apple Maps
            </LinkButton>
            <LinkButton size="sm" href={directions.google} target="_blank" rel="noopener noreferrer">
              ▷ Google Maps
            </LinkButton>
            <Button size="sm" onClick={() => downloadIcs(e, eventUrl(e.id))}>
              + Calendar
            </Button>
          </div>
              </div>
              {e.videoId && (
                <div className="ev-block" aria-label="Promo video">
                  <h3 className="ev-subhead">Promo</h3>
            <div className="event-video">
              <PromoVideo uid={e.videoId} customerCode={config.streamCustomerCode} title={e.title} />
            </div>
                </div>
              )}
            </EvSection>
          );
        })}

        <div className="ev-quiet">
        {detail?.host && (
          <div data-reveal>
            <HostLine host={detail.host} me={me} toast={toast} />
          </div>
        )}


        <p className="note" data-reveal>
          {e.isSample && (
            <>
              <Tag>Sample</Tag>{" "}
            </>
          )}
          Tickets are sold by the organizer on their own site. Assembly links out and never handles payment.
        </p>

        {!detail?.viewerIsHost && (
          <div className="report-links" data-reveal>
            <ReportBox target={{ kind: "event", id: e.id, name: e.title }} me={me} onNeedSignIn={onNeedSignIn} toast={toast} />
            {detail?.host && detail.host.id !== me?.id && (
              <ReportBox target={{ kind: "user", id: detail.host.id, name: "the organizer" }} me={me} onNeedSignIn={onNeedSignIn} toast={toast} />
            )}
          </div>
        )}

        </div>

        {/* One pinned bar: the night's primary action, tickets when there are some, and icons for the rest. */}
        <div className="ev-bar">
          {phase === "cancelled" ? (
            <span className="ev-bar-note">Cancelled</span>
          ) : phase === "past" ? (
            <Button size="lg" variant="primary" className="ev-bar-primary" onClick={() => reveal(hasWall ? "wall" : "details")} disabled={!hasWall}>
              {hasWall ? "See the wall" : "That's a wrap"}
            </Button>
          ) : canCheckIn && !checkedIn ? (
            <Button
              size="lg"
              variant="primary"
              className="ev-bar-primary"
              onClick={() => {
                if (!me) return onNeedSignIn();
                reveal("here");
                setCheckInSignal((n) => n + 1);
              }}
            >
              Check in
            </Button>
          ) : canCheckIn && hasWall ? (
            <Button size="lg" variant="primary" className="ev-bar-primary" onClick={() => reveal("wall")}>
              See the wall
            </Button>
          ) : (
            <Button
              ref={rsvpBtn}
              size="lg"
              variant={rsvp === "going" ? "confirmed" : "primary"}
              className="ev-bar-primary"
              onClick={() => choose("going")}
              disabled={busy}
              aria-pressed={rsvp === "going"}
            >
              {rsvp === "going" ? "Going ✓" : "RSVP"}
            </Button>
          )}
          {e.ticketUrl && (phase === "upcoming" || phase === "live") && (
            <LinkButton size="lg" className="ev-bar-tickets" href={e.ticketUrl} target="_blank" rel="noopener noreferrer">
              Tickets ↗
            </LinkButton>
          )}
          <span className="ev-bar-icons">
            {(phase === "upcoming" || phase === "live") && (
              <button
                className="ev-icon"
                onClick={() => choose("interested")}
                disabled={busy}
                aria-pressed={rsvp === "interested"}
                aria-label={rsvp === "interested" ? "Saved. Tap to unsave" : "Save for later"}
                title="Save"
              >
                <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true">
                  <path d="M4 2h8v12l-4-3-4 3z" fill={rsvp === "interested" ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
                </svg>
              </button>
            )}
            {/* With tickets the bar is full; directions stay one tap away under Details. */}
            <a className={`ev-icon ${e.ticketUrl && (phase === "upcoming" || phase === "live") ? "is-spare" : ""}`} href={directions.apple} target="_blank" rel="noopener noreferrer" aria-label="Directions" title="Directions">
              <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true">
                <path d="M8 1.5l6.5 6.5L8 14.5 1.5 8z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
                <path d="M6 9.5V7.5h4M8.5 6l1.5 1.5L8.5 9" fill="none" stroke="currentColor" strokeWidth="1.3" />
              </svg>
            </a>
            <button className="ev-icon" onClick={() => setSharing(true)} aria-label="Share" title="Share">
              <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true">
                <path d="M8 1.5v9M5 4.5l3-3 3 3M3.5 7.5v6.5h9V7.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
              </svg>
            </button>
          </span>
        </div>
      </div>
    </Sheet>
    <ShareSheet
      target={shareTarget}
      open={sharing}
      onClose={() => setSharing(false)}
      toast={toast}
      extra={
        <Button
          size="lg"
          onClick={() => {
            setSharing(false);
            void makeStory();
          }}
          disabled={story === "working"}
        >
          {story === "working" ? "Making the card…" : "Story card for Instagram"}
        </Button>
      }
    />
    {viewing && e.flyerUrl && (
      <FlyerViewer src={e.flyerUrl} title={e.title} url={eventUrl(e.id)} credit={detail?.host?.displayName ?? null} onClose={() => setViewing(false)} toast={toast} />
    )}
    </>
  );
}

const EVENT_REASONS = [
  { id: "unsafe", label: "Unsafe or dangerous" },
  { id: "hateful", label: "Hateful or harassing" },
  { id: "spam", label: "Spam or scam" },
  { id: "wrong-info", label: "Wrong time or place" },
  { id: "other", label: "Something else" },
];
const USER_REASONS = [
  { id: "unsafe", label: "Unsafe or dangerous" },
  { id: "hateful", label: "Hateful or harassing" },
  { id: "impersonation", label: "Pretending to be someone" },
  { id: "spam", label: "Spam or scam" },
  { id: "other", label: "Something else" },
];

function ReportBox({
  target,
  me,
  onNeedSignIn,
  toast,
}: {
  target: { kind: "event" | "user"; id: string; name: string };
  me: Me | null;
  onNeedSignIn: () => void;
  toast: (m: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const reasons = target.kind === "event" ? EVENT_REASONS : USER_REASONS;
  const label = target.kind === "event" ? "Report this event" : `Report ${target.name}`;

  if (sent) return <p className="note">Thanks. We'll take a look.</p>;
  if (!open) {
    return (
      <button className="link report-link" onClick={() => (me ? setOpen(true) : onNeedSignIn())}>
        {label}
      </button>
    );
  }
  return (
    <Frame as="section" className="report" aria-label={label}>
      <Label glyph="!">{label}</Label>
      <div className="report-reasons" role="radiogroup" aria-label="Reason">
        {reasons.map((r) => (
          <button
            key={r.id}
            type="button"
            role="radio"
            aria-checked={reason === r.id}
            className="chip"
            aria-pressed={reason === r.id}
            onClick={() => setReason(r.id)}
          >
            {r.label}
          </button>
        ))}
      </div>
      <textarea
        className="report-note"
        rows={2}
        maxLength={280}
        value={note}
        onChange={(ev) => setNote(ev.target.value)}
        placeholder="Anything we should know? (optional)"
        aria-label="Details"
      />
      <div className="report-actions">
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Never mind
        </Button>
        <Button
          size="sm"
          disabled={!reason || busy}
          onClick={async () => {
            setBusy(true);
            try {
              if (target.kind === "event") await api.report(target.id, reason!, note);
              else await api.reportUser(target.id, reason!, note);
              setSent(true);
            } catch (err) {
              toast(err instanceof ApiError ? err.message : "Couldn't send the report. Try again.");
            } finally {
              setBusy(false);
            }
          }}
        >
          Send report
        </Button>
      </div>
      <p className="note">Reports are private. {target.kind === "event" ? "The organizer doesn't" : "They don't"} see who sent them.</p>
    </Frame>
  );
}

/** Who posted it, with the verified badge. Moderators can verify from here. */
function HostLine({ host, me, toast }: { host: HostSummary; me: MeProfile | null; toast: (m: string) => void }) {
  const [verified, setVerified] = useState(host.verified);
  return (
    <div className="host-line">
      <Avatar user={host} size={32} />
      <span className="host-line-text">
        <span className="dim">Posted by</span> {host.displayName}
        {verified && (
          <span className="verified" title="Verified organizer: vetted by the Assembly team">
            <VarsityMark /> Verified
          </span>
        )}
      </span>
      {me?.moderator && me.id !== host.id && (
        <Button
          size="sm"
          variant="ghost"
          onClick={async () => {
            try {
              const r = await api.setVerified(host.id, !verified);
              setVerified(r.verified);
              toast(r.verified ? `${host.displayName} is verified.` : "Verification removed.");
            } catch (err) {
              toast(err instanceof ApiError ? err.message : "Couldn't change verification.");
            }
          }}
        >
          {verified ? "Unverify" : "Verify"}
        </Button>
      )}
    </div>
  );
}

/** The verified badge: a small varsity-letter A, the one place the assembly theme shows up in trust UI. */
export function VarsityMark() {
  return (
    <svg className="varsity" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M2 1h12v10l-6 4-6-4z" fill="var(--color-accent)" />
      <path d="M5.2 10.5 8 3.5l2.8 7M6.2 8h3.6" fill="none" stroke="var(--color-accent-ink)" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

/** Moderator tools on any event: edit it, or hand it to an organizer's account by email. */
function ModBar({ detail, onEdit, onHanded, toast }: { detail: EventDetail; onEdit: () => void; onHanded: () => void; toast: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const imported = detail.id.startsWith("wyxr-");
  return (
    <div className="host-bar mod-bar">
      <span>
        <Tag tone="strong">Moderator</Tag>{" "}
        {detail.host ? `Hosted by ${detail.host.displayName}.` : imported ? "Imported from WYXR. No host yet." : "No host yet."}
      </span>
      <span className="inline-actions">
        <Button size="sm" onClick={onEdit}>
          Edit
        </Button>
        <Button size="sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          Hand over
        </Button>
      </span>
      {open && (
        <form
          className="hand-over"
          onSubmit={async (ev) => {
            ev.preventDefault();
            setBusy(true);
            try {
              const r = await api.handOver(detail.id, email);
              toast(`${r.host.displayName} is the host now.`);
              setOpen(false);
              onHanded();
            } catch (err) {
              toast(err instanceof ApiError ? err.message : "Couldn't hand it over.");
            } finally {
              setBusy(false);
            }
          }}
        >
          <input type="email" value={email} onChange={(ev) => setEmail(ev.target.value)} placeholder="Organizer's sign-in email" aria-label="Organizer's sign-in email" required />
          <Button type="submit" size="sm" variant="primary" disabled={busy || !email.trim()}>
            {busy ? "Saving…" : "Make them host"}
          </Button>
          <p className="note">They need an account first. They'll get a notification and can edit and cancel it.{imported ? " Future WYXR imports won't overwrite it once it has a host." : ""}</p>
        </form>
      )}
    </div>
  );
}

/** The flyer fades in once it's decoded, over a shimmer sized to a square flyer, so the sheet doesn't jump. */
function FlyerImage({ src, alt }: { src: string; alt: string }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div className={`flyer-wrap ${loaded ? "is-loaded" : ""}`}>
      {!loaded && <Skeleton className="flyer-skel" w="100%" h="100%" />}
      <img
        className={`flyer fade-in ${loaded ? "is-loaded" : ""}`}
        src={src}
        alt={alt}
        decoding="async"
        ref={(el) => {
          // Already in the cache: complete before React attaches onLoad.
          if (el?.complete && el.naturalWidth && !loaded) setLoaded(true);
        }}
        onLoad={() => setLoaded(true)}
        onError={() => setLoaded(true)}
      />
    </div>
  );
}

/**
 * Friends at this event; your choice for this night (just me, friends, or everyone here); who's in the room with
 * you once you've checked in; and inviting friends.
 */
function FriendsHere({
  eventId,
  friends,
  myFriends,
  showToggle,
  checkedIn,
  upcoming,
  toast,
}: {
  eventId: string;
  friends: FriendAt[];
  myFriends: FriendPerson[];
  showToggle: boolean;
  checkedIn: boolean;
  upcoming: boolean;
  toast: (m: string) => void;
}) {
  const [visibility, setVisibility] = useState<PresenceVisibility | null>(null);
  const [room, setRoom] = useState<HerePerson[]>([]);
  const [inviting, setInviting] = useState(false);
  useEffect(() => {
    if (!showToggle) return;
    api
      .friendVisibility(eventId)
      .then((r) => setVisibility(r.visibility))
      .catch(() => setVisibility(null));
  }, [eventId, showToggle]);
  useEffect(() => {
    if (!checkedIn) return setRoom([]);
    const load = () => api.hereList(eventId).then((r) => setRoom(r.people.filter((p) => !p.friend))).catch(() => undefined);
    void load();
    const t = setInterval(() => document.visibilityState === "visible" && void load(), 60000);
    return () => clearInterval(t);
  }, [eventId, checkedIn, visibility]);

  const here = friends.filter((f) => f.state === "here");
  const going = friends.filter((f) => f.state === "going");
  const goingIds = new Set(friends.map((f) => f.id));
  return (
    <section className="friends-here" aria-label="Friends" data-reveal>
      <div className="friends-here-head">
        <Label glyph="◎">Friends</Label>
        <span className="spacer" />
        {upcoming && myFriends.length > 0 && (
          <Button size="sm" onClick={() => setInviting(true)}>
            Invite friends
          </Button>
        )}
      </div>
      {friends.length > 0 ? (
        <>
          <Faces people={friends} size={28} label={false} />
          <p className="friends-here-names">
            {here.length > 0 && (
              <>
                <strong>Here now:</strong> {here.map((f) => f.displayName).join(", ")}.{" "}
              </>
            )}
            {going.length > 0 && (
              <>
                <strong>Going:</strong> {going.map((f) => f.displayName).join(", ")}.
              </>
            )}
          </p>
        </>
      ) : (
        <p className="note">None of your friends are going yet.</p>
      )}
      {room.length > 0 && (
        <div className="friends-room">
          <span className="field-label">Also here, sharing with the room</span>
          <ul className="room-list">
            {room.map((p) => (
              <li key={p.id}>
                <FriendAvatar p={p} size={24} />
                {p.displayName}
              </li>
            ))}
          </ul>
        </div>
      )}
      {showToggle && visibility && (
        <div className="friends-visibility">
          <span className="field-label">Who sees you're {checkedIn ? "here" : "going"}</span>
          <Segmented
            label="Who sees you tonight"
            options={[
              { id: "me", label: "Just me" },
              { id: "friends", label: "Friends" },
              { id: "event", label: "Everyone here" },
            ]}
            value={visibility}
            onChange={async (v) => {
              const prev = visibility;
              const next = v as PresenceVisibility;
              setVisibility(next);
              try {
                await api.setFriendVisibility(eventId, next);
                toast(next === "me" ? "This night is just for you now." : next === "friends" ? "Friends can see you're going." : "Friends, and anyone checked in here, can see you're here.");
              } catch (err) {
                setVisibility(prev);
                toast(err instanceof ApiError ? err.message : "Couldn't change that.");
              }
            }}
          />
          {visibility === "event" && <p className="note">People checked in to this event see your name and photo while you're here. Friends see you as usual.</p>}
        </div>
      )}
      {inviting && <InviteFriends eventId={eventId} friends={myFriends.filter((f) => !goingIds.has(f.id))} onClose={() => setInviting(false)} toast={toast} />}
    </section>
  );
}

function InviteFriends({ eventId, friends, onClose, toast }: { eventId: string; friends: FriendPerson[]; onClose: () => void; toast: (m: string) => void }) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return createPortal(
    <div className="wall-modal" role="dialog" aria-modal="true" aria-label="Invite friends" onClick={(ev) => ev.target === ev.currentTarget && onClose()}>
      <form
        className="wall-composer"
        onSubmit={async (ev) => {
          ev.preventDefault();
          if (!picked.size) return;
          setBusy(true);
          try {
            const r = await api.inviteToEvent(eventId, [...picked]);
            toast(r.sent ? `Invited ${r.sent} friend${r.sent === 1 ? "" : "s"}.` : "They've already been invited.");
            onClose();
          } catch (err) {
            toast(err instanceof ApiError ? err.message : "Couldn't send invites.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <Label glyph="◎">Invite friends</Label>
        {friends.length === 0 ? (
          <p className="note">All your friends are already going.</p>
        ) : (
          <ul className="friend-list invite-pick">
            {friends.map((f) => (
              <li key={f.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={picked.has(f.id)}
                    onChange={() =>
                      setPicked((cur) => {
                        const n = new Set(cur);
                        if (n.has(f.id)) n.delete(f.id);
                        else n.add(f.id);
                        return n;
                      })
                    }
                  />
                  <FriendAvatar p={f} size={28} />
                  <span className="friend-name">{f.displayName}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <p className="note">They get a notification (if they turned those on) and see it under Friends.</p>
        <div className="wall-composer-actions">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="lg" disabled={!picked.size || busy}>
            {busy ? "Sending…" : picked.size ? `Invite ${picked.size}` : "Invite"}
          </Button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

/** One collapsible section of the event page: a single row with a short summary when closed. */
function EvSection({
  id,
  title,
  summary,
  open,
  onToggle,
  refs,
  children,
}: {
  id: string;
  title: string;
  summary: string;
  open: boolean;
  onToggle: () => void;
  refs: React.MutableRefObject<Record<string, HTMLElement | null>>;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`ev-section ${open ? "is-open" : ""}`}
      ref={(el) => {
        refs.current[id] = el;
      }}
    >
      <h2 className="ev-section-h">
        <button id={`ev-${id}`} className="ev-section-row" aria-expanded={open} aria-controls={`ev-${id}-body`} onClick={onToggle}>
          <span className="ev-section-title">{title}</span>
          <span className="ev-section-summary">{open ? "" : summary}</span>
          <svg className="ev-section-chev" viewBox="0 0 12 8" width="12" height="8" aria-hidden="true">
            <path d="M1 1.5l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
      </h2>
      {open && (
        <div id={`ev-${id}-body`} className="ev-section-body" role="region" aria-labelledby={`ev-${id}`}>
          {children}
        </div>
      )}
    </section>
  );
}
