import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Button, Frame, Label, LinkButton, Sheet, Tag } from "../components/ui";
import { api, ApiError } from "../lib/api";
import { PromoVideo } from "../components/PromoVideo";
import { Avatar } from "./ProfileSheet";
import { saveForOffline } from "../lib/offline";
import { PushPrompt } from "../components/PushControl";
import { dayLabel, isLive, timeRange } from "../lib/time";
import { directionsLinks, downloadIcs } from "../lib/calendar";
import { countTo, revealChildren, stamp } from "../lib/motion";
import { POLICY_TAGS, SCENES, type EventDetail, type EventSummary, type HostSummary, type Me, type MeProfile, type RsvpStatus, type ServerConfig } from "../../shared/types";

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
  onEdit,
  onChanged,
  config,
  toast,
}: {
  summary: EventSummary;
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
      if (next) saveForOffline([e]);
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
    <Sheet open onClose={onClose} label={e.title}>
      <div ref={root} className={`event ${queer ? "is-queer" : ""}`}>
        <div data-reveal>
          {e.flyerUrl ? <img className="flyer" src={e.flyerUrl} alt={`Flyer for ${e.title}`} /> : <GeneratedFlyer event={e} />}
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
            {live ? <span className="live-tag">Happening now</span> : <span>{sceneLabels.join(" / ")}</span>}
            {cancelled && <Tag tone="accent">Cancelled</Tag>}
            {e.updated && !cancelled && <Tag>Updated</Tag>}
          </div>
          <h1 className={`event-title ${cancelled ? "is-cancelled" : ""}`}>{e.title}</h1>
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
            disabled={busy || cancelled}
            aria-pressed={rsvp === "going"}
          >
            {rsvp === "going" ? "Going ✓" : "RSVP"}
          </Button>
          <Button size="lg" variant={rsvp === "interested" ? "confirmed" : "default"} onClick={() => choose("interested")} disabled={busy || cancelled} aria-pressed={rsvp === "interested"}>
            {rsvp === "interested" ? "Interested ✓" : "Interested"}
          </Button>
          {e.ticketUrl && !cancelled && (
            <LinkButton size="lg" href={e.ticketUrl} target="_blank" rel="noopener noreferrer">
              Tickets ↗
            </LinkButton>
          )}
          <Button size="lg" onClick={share}>
            Share
          </Button>
          <Button size="lg" onClick={makeStory} disabled={story === "working"}>
            {story === "working" ? "Making card…" : "Story card"}
          </Button>
          <p className="going num">
            <span ref={goingEl}>{going}</span> going
            {rsvp && <span className="dim"> · Saved on this device for the door</span>}
          </p>
          {rsvp && !cancelled && (
            <div className="going-push">
              <PushPrompt config={config} toast={toast} />
            </div>
          )}
        </div>

        {e.videoId && (
          <section aria-label="Promo video" data-reveal>
            <Label glyph="▷">Promo</Label>
            <div className="event-video">
              <PromoVideo uid={e.videoId} customerCode={config.streamCustomerCode} title={e.title} />
            </div>
          </section>
        )}

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

        {detail?.host && (
          <div data-reveal>
            <HostLine host={detail.host} me={me} toast={toast} />
          </div>
        )}

        {(e.doorPrice || e.policyTags.length > 0) && (
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
    </Sheet>
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
