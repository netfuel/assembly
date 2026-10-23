import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Button, Frame, Label, LinkButton, Sheet, Tag } from "../components/ui";
import { api, ApiError } from "../lib/api";
import { dayLabel, isLive, timeRange } from "../lib/time";
import { directionsLinks, downloadIcs } from "../lib/calendar";
import { countTo, revealChildren, stamp } from "../lib/motion";
import { POLICY_TAGS, SCENES, type EventDetail, type EventSummary, type Me, type RsvpStatus } from "../../shared/types";

// three.js loads only when someone opens an event without uploaded art.
const FlyerShader = lazy(() => import("../components/FlyerShader"));

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

function GeneratedFlyer({ event }: { event: EventSummary }) {
  const queer = event.scenes.includes("queer");
  return (
    <div className={`flyer-generated ${queer ? "is-queer" : ""}`}>
      <Suspense fallback={<div className="flyer-shader" data-fallback="true" />}>
        <FlyerShader id={event.id} queer={queer} />
      </Suspense>
      <div className="flyer-type">
        <span className="flyer-type-title">{event.title}</span>
        <span className="flyer-type-sub">{event.venueName ?? event.neighborhood}</span>
      </div>
    </div>
  );
}

export function EventSheet({
  summary,
  tz,
  me,
  onClose,
  onNeedSignIn,
  toast,
}: {
  summary: EventSummary;
  tz: string;
  me: Me | null;
  onClose: () => void;
  onNeedSignIn: () => void;
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
  const live = isLive(e.startsAt, e.endsAt, now);
  const directions = directionsLinks(e);
  const baseGoing = e.goingCount - (detail?.viewerRsvp === "going" ? 1 : 0);
  const going = baseGoing + (rsvp === "going" ? 1 : 0);

  useEffect(() => {
    revealChildren(root.current);
  }, [summary.id]);

  useEffect(() => {
    countTo(goingEl.current, going);
  }, [going]);

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
    if (next === "going") stamp(rsvpBtn.current);
    setBusy(true);
    try {
      await api.rsvp(e.id, next);
      if (next === "going") toast("You're going. Saved to your list.");
      else if (next === "interested") toast("Marked as interested.");
    } catch (err) {
      setRsvp(prev);
      toast(err instanceof ApiError ? err.message : "Couldn't save your RSVP. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function share() {
    const url = eventUrl(e.id);
    const text = `${e.title}: ${dayLabel(e.startsAt, now, tz)}, ${timeRange(e.startsAt, e.endsAt, tz)}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: e.title, text, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      toast("Link copied.");
    } catch (err) {
      if ((err as DOMException)?.name !== "AbortError") toast(`Copy this link: ${url}`);
    }
  }

  const sceneLabels = e.scenes.map((s) => SCENES.find((x) => x.id === s)?.label).filter(Boolean) as string[];

  return (
    <Sheet open onClose={onClose} label={e.title}>
      <div ref={root} className={`event ${queer ? "is-queer" : ""}`}>
        <div data-reveal>
          {e.flyerUrl ? <img className="flyer" src={e.flyerUrl} alt={`Flyer for ${e.title}`} /> : <GeneratedFlyer event={e} />}
        </div>

        <header className="event-head" data-reveal>
          <div className="event-meta">
            <span className="marker" style={{ background: queer ? "var(--color-uv)" : "var(--color-sodium)" }} aria-hidden="true" />
            {live ? <span className="live-tag">Happening now</span> : <span>{sceneLabels.join(" / ")}</span>}
          </div>
          <h1 className="event-title">{e.title}</h1>
          {e.pitch && <p className="event-pitch">{e.pitch}</p>}
          <p className="event-when num">
            {dayLabel(e.startsAt, now, tz)} <span className="dim">/</span> {timeRange(e.startsAt, e.endsAt, tz)}
          </p>
        </header>

        <div className="event-actions" data-reveal>
          <Button
            ref={rsvpBtn}
            size="lg"
            variant={rsvp === "going" ? "confirmed" : "primary"}
            onClick={() => choose("going")}
            disabled={busy}
            aria-pressed={rsvp === "going"}
          >
            {rsvp === "going" ? "Going ✓" : "RSVP"}
          </Button>
          <Button size="lg" variant={rsvp === "interested" ? "confirmed" : "default"} onClick={() => choose("interested")} disabled={busy} aria-pressed={rsvp === "interested"}>
            {rsvp === "interested" ? "Interested ✓" : "Interested"}
          </Button>
          {e.ticketUrl && (
            <LinkButton size="lg" href={e.ticketUrl} target="_blank" rel="noopener noreferrer">
              Tickets ↗
            </LinkButton>
          )}
          <Button size="lg" onClick={share}>
            Share
          </Button>
          <p className="going num">
            <span ref={goingEl}>{going}</span> going
          </p>
        </div>

        <Frame as="section" className="where" aria-label="Location" data-reveal>
          <Label glyph="⌖">Where</Label>
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
        </Frame>

        <section aria-label="Lineup" data-reveal>
          <Label glyph="♫">Lineup</Label>
          {loadError && <p className="note">{loadError}</p>}
          {!detail && !loadError && <p className="note">Loading the lineup…</p>}
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
        </section>

        <section aria-label="Door" data-reveal>
          <Label glyph="▣">Door</Label>
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
        </section>

        <p className="note" data-reveal>
          {e.isSample && (
            <>
              <Tag>Sample</Tag>{" "}
            </>
          )}
          Tickets are sold by the organizer on their own site. Assembly links out and never handles payment.
        </p>
      </div>
    </Sheet>
  );
}
