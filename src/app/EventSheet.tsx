import { useEffect, useState } from "react";
import { Button, LinkButton, Sheet } from "../components/ui";
import { api, ApiError } from "../lib/api";
import { dayLabel, isLive, timeRange } from "../lib/time";
import { directionsLinks, downloadIcs } from "../lib/calendar";
import { POLICY_TAGS, SCENES, type EventDetail, type EventSummary, type Me, type RsvpStatus } from "../../shared/types";

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

export function FlyerPlaceholder({ event }: { event: EventSummary }) {
  const queer = event.scenes.includes("queer");
  return (
    <div className={`flyer-placeholder ${queer ? "is-queer" : ""}`} aria-hidden="true">
      <span className="flyer-placeholder-title">{event.title}</span>
      <span className="flyer-placeholder-sub mono">{event.venueName ?? event.neighborhood}</span>
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
  const now = new Date();
  const e = detail ?? summary;
  const queer = e.scenes.includes("queer");
  const live = isLive(e.startsAt, e.endsAt, now);
  const directions = directionsLinks(e);
  const going = e.goingCount + (rsvp === "going" && detail?.viewerRsvp !== "going" ? 1 : 0) - (rsvp !== "going" && detail?.viewerRsvp === "going" ? 1 : 0);

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

  return (
    <Sheet open onClose={onClose} label={e.title}>
      <div className={`event ${queer ? "is-queer" : ""}`}>
        {e.flyerUrl ? <img className="flyer" src={e.flyerUrl} alt={`Flyer for ${e.title}`} /> : <FlyerPlaceholder event={e} />}

        <header className="event-head">
          <p className="eyebrow">
            {live ? <span className="live-tag">Happening now</span> : e.scenes.map((s) => SCENES.find((x) => x.id === s)?.label).filter(Boolean).join(" · ")}
          </p>
          <h1 className="event-title">{e.title}</h1>
          {e.pitch && <p className="event-pitch">{e.pitch}</p>}
          <p className="event-when mono">
            {dayLabel(e.startsAt, now, tz)} · {timeRange(e.startsAt, e.endsAt, tz)}
          </p>
        </header>

        <div className="event-actions">
          <Button size="lg" variant={rsvp === "going" ? "confirmed" : "primary"} onClick={() => choose("going")} disabled={busy} aria-pressed={rsvp === "going"}>
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
        </div>
        <p className="going mono">{going} going</p>

        <section className="where" aria-label="Location">
          <p className="where-venue">
            <strong>{e.venueName ?? "Location"}</strong>
            {e.neighborhood && <span> · {e.neighborhood}</span>}
          </p>
          <p className="where-address mono">{e.address}</p>
          {detail?.gettingThere && <p className="where-note">{detail.gettingThere}</p>}
          <div className="where-links">
            <LinkButton href={directions.apple} target="_blank" rel="noopener noreferrer">
              Apple Maps
            </LinkButton>
            <LinkButton href={directions.google} target="_blank" rel="noopener noreferrer">
              Google Maps
            </LinkButton>
            <Button onClick={() => downloadIcs(e, eventUrl(e.id))}>Add to calendar</Button>
          </div>
        </section>

        <section aria-label="Lineup">
          <h2 className="section-label">Lineup</h2>
          {loadError && <p className="note">{loadError}</p>}
          {!detail && !loadError && <p className="note">Loading the lineup…</p>}
          {detail && detail.lineup.length === 0 && <p className="note">Lineup to be announced.</p>}
          {detail && detail.lineup.length > 0 && (
            <ul className="lineup">
              {detail.lineup.map((slot) => (
                <li key={slot.artistId}>
                  <span className="lineup-time mono">{slot.setStart ?? ""}</span>
                  <span className="lineup-artist">
                    <strong>{slot.name}</strong>
                    {(slot.note || slot.room) && <small>{[slot.room, slot.note].filter(Boolean).join(" · ")}</small>}
                    <span className="artist-links">
                      {Object.entries(slot.links).map(([k, href]) =>
                        href ? (
                          <a key={k} href={href} target="_blank" rel="noopener noreferrer">
                            {LINK_LABELS[k] ?? k}
                          </a>
                        ) : null,
                      )}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-label="Door">
          <h2 className="section-label">Door</h2>
          <div className="tags">
            {e.doorPrice && <span className="tag tag-strong">{e.doorPrice}</span>}
            {e.policyTags.map((t) => (
              <span key={t} className="tag">
                {POLICY_TAGS[t] ?? t}
              </span>
            ))}
          </div>
        </section>

        <p className="note">
          {e.isSample ? "Sample event for development. " : ""}Tickets are sold by the organizer on their own site; Assembly links out and never handles payment.
        </p>
      </div>
    </Sheet>
  );
}
