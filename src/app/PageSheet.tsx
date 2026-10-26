import { useEffect, useRef, useState } from "react";
import { Button, Label, LinkButton, Segmented, Sheet, Skeleton, Tag } from "../components/ui";
import { GeneratedArt } from "../components/GeneratedArt";
import { ShareSheet } from "../components/ShareSheet";
import { api, ApiError } from "../lib/api";
import { prepareAvatar } from "../lib/media";
import { revealChildren } from "../lib/motion";
import { clock, timeRange } from "../lib/time";
import { MapSnippet } from "../map/MapSnippet";
import type { MapTheme } from "../map/mapStyle";
import { FeedCard } from "./FeedView";
import { LINK_LABELS, ReportBox } from "./EventSheet";
import { POLICY_TAGS, SCENES, VENUE_TYPES, type ArtistLinks, type FriendAt, type Me, type PageEvent, type PageKind, type PageProfile, type RsvpStatus, type ServerConfig } from "../../shared/types";

export type PageRef = { kind: PageKind; slug: string };

const PREFIX: Record<PageKind, "a" | "v" | "o"> = { artist: "a", venue: "v", organizer: "o" };
const NOUN: Record<PageKind, string> = { artist: "Artist", venue: "Venue", organizer: "Organizer" };

export const pageUrl = (p: PageRef) => `${location.origin}/${PREFIX[p.kind]}/${encodeURIComponent(p.slug)}`;
export const pagePath = (p: PageRef) => `/${PREFIX[p.kind]}/${encodeURIComponent(p.slug)}`;

/** /a/<slug>, /v/<slug>, /o/<slug> */
export function pageFromPath(path = location.pathname): PageRef | null {
  const m = path.match(/^\/(a|v|o)\/([^/]+)/);
  if (!m) return null;
  const kind = ({ a: "artist", v: "venue", o: "organizer" } as const)[m[1] as "a" | "v" | "o"];
  return { kind, slug: decodeURIComponent(m[2]) };
}

/**
 * An artist, venue or organizer page: one header (photo, name, city and scenes, bio, links) and one list of their
 * shows, Upcoming first with Past a tab away. Venues add the address, a small map, directions and door notes.
 * The owner edits in place; anyone signed in can claim an unclaimed artist or venue page, or report it.
 */
export function PageSheet({
  page,
  me,
  config,
  tz,
  theme,
  rsvps,
  friendsAt,
  onClose,
  onOpenEvent,
  onShowOnMap,
  onShowPlace,
  onRsvp,
  onNeedSignIn,
  onEditProfile,
  toast,
}: {
  page: PageRef;
  me: Me | null;
  config: ServerConfig;
  tz: string;
  theme: MapTheme;
  rsvps: Record<string, RsvpStatus | undefined>;
  friendsAt: Record<string, FriendAt[] | undefined>;
  onClose: () => void;
  onOpenEvent: (id: string) => void;
  onShowOnMap: (id: string) => void;
  onShowPlace: (lng: number, lat: number) => void;
  onRsvp: (id: string) => void;
  onNeedSignIn: () => void;
  /** Organizers edit their page from their own profile. */
  onEditProfile: () => void;
  toast: (m: string) => void;
}) {
  const [p, setP] = useState<PageProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"upcoming" | "past">("upcoming");
  const [sharing, setSharing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let stale = false;
    setP(null);
    setError(null);
    api
      .page(page.kind, page.slug)
      .then((r) => {
        if (stale) return;
        setP(r);
        // No shows coming up: open on the past ones instead of an empty tab.
        setTab(r.upcomingCount === 0 && r.pastCount > 0 ? "past" : "upcoming");
      })
      .catch((err: unknown) => !stale && setError(err instanceof ApiError ? err.message : "Couldn't load this page."));
    return () => {
      stale = true;
    };
  }, [page.kind, page.slug, me?.id]);

  useEffect(() => {
    if (p) revealChildren(root.current);
  }, [p?.id]);

  const scenes = p ? (p.scenes.map((s) => SCENES.find((x) => x.id === s)?.label).filter(Boolean) as string[]) : [];
  const meta = p
    ? p.kind === "venue" && p.venue
      ? [VENUE_TYPES[p.venue.type] ?? p.venue.type, p.venue.neighborhood].filter(Boolean).join(" · ")
      : [p.city, scenes.join(", ")].filter(Boolean).join(" · ")
    : "";
  const links = p ? (Object.entries(p.links).filter(([, v]) => v) as [string, string][]) : [];
  const feedUrl = p ? `${location.origin}/feeds/${PREFIX[p.kind]}/${encodeURIComponent(p.slug)}.xml` : "";

  return (
    <>
      <Sheet open onClose={onClose} label={p?.name ?? NOUN[page.kind]}>
        <div ref={root} className="page">
          {error && (
            <div className="stack">
              <Label glyph="◇">{NOUN[page.kind]}</Label>
              <p className="note">{error}</p>
            </div>
          )}
          {!p && !error && <PageSkeleton />}
          {p && (
            <>
              <header className="page-head" data-reveal>
                <PagePhoto p={p} />
                <div className="page-id">
                  <span className="page-kind">
                    {NOUN[p.kind]}
                    {p.verified && <Tag tone="strong">{p.kind === "organizer" ? "Verified" : "Claimed"}</Tag>}
                  </span>
                  <h1 className="page-name">{p.name}</h1>
                  {meta && <p className="page-meta">{meta}</p>}
                </div>
              </header>

              {p.bio && <p className="page-bio serif-text" data-reveal>{p.bio}</p>}

              {links.length > 0 && (
                <ul className="page-links" aria-label="Links" data-reveal>
                  {links.map(([k, href]) => (
                    <li key={k}>
                      <a href={href} target="_blank" rel="noopener noreferrer">
                        {LINK_LABELS[k] ?? k} ↗
                      </a>
                    </li>
                  ))}
                </ul>
              )}

              <div className="page-actions" data-reveal>
                <Button onClick={() => setSharing(true)}>Share</Button>
                <LinkButton href={feedUrl} target="_blank" rel="noopener noreferrer" title="Follow in a feed reader">
                  RSS
                </LinkButton>
                {p.viewerCanEdit &&
                  (p.kind === "organizer" ? (
                    <Button variant="ghost" onClick={onEditProfile}>
                      Edit your profile
                    </Button>
                  ) : (
                    <Button variant="ghost" onClick={() => setEditing((v) => !v)} aria-expanded={editing}>
                      {editing ? "Done editing" : "Edit page"}
                    </Button>
                  ))}
              </div>

              {editing && p.kind !== "organizer" && <PageEditor p={p} onSaved={(np) => (setP(np), setEditing(false), toast("Page updated."))} toast={toast} />}

              {p.kind === "venue" && p.venue && <VenueBlock p={p} theme={theme} onShowPlace={onShowPlace} />}

              <section className="page-shows" aria-label="Shows" data-reveal>
                <Segmented
                  label="Shows"
                  value={tab}
                  onChange={setTab}
                  options={[
                    { id: "upcoming", label: `Upcoming${p.upcomingCount ? ` ${p.upcomingCount}` : ""}` },
                    { id: "past", label: `Past${p.pastCount ? ` ${p.pastCount}` : ""}` },
                  ]}
                />
                <PageFeed
                  key={`${p.id}:${tab}`}
                  p={p}
                  when={tab}
                  tz={tz}
                  config={config}
                  rsvps={rsvps}
                  friendsAt={friendsAt}
                  onOpenEvent={onOpenEvent}
                  onShowOnMap={onShowOnMap}
                  onRsvp={onRsvp}
                  toast={toast}
                />
              </section>

              <footer className="page-foot">
                {p.kind !== "organizer" && !p.claimed && (
                  <ClaimBox p={p} me={me} open={claiming} onOpen={() => (me ? setClaiming(true) : onNeedSignIn())} onClaimed={(np) => (setP(np), setClaiming(false), toast("Sent. A moderator will check and get back to you."))} toast={toast} />
                )}
                {p.viewerClaim !== "owner" && (
                  <ReportBox
                    target={p.kind === "organizer" ? { kind: "user", id: p.id, name: p.name } : { kind: p.kind, id: p.slug, name: p.name, label: "Report this page" }}
                    me={me}
                    onNeedSignIn={onNeedSignIn}
                    toast={toast}
                  />
                )}
              </footer>
            </>
          )}
        </div>
      </Sheet>
      {p && (
        <ShareSheet
          target={{ title: p.name, text: `${p.name} on Assembly${p.upcomingCount ? `: ${p.upcomingCount} show${p.upcomingCount === 1 ? "" : "s"} coming up` : ""}`, url: pageUrl(page) }}
          open={sharing}
          onClose={() => setSharing(false)}
          toast={toast}
        />
      )}
    </>
  );
}

/** Their photo, or for artists and venues without one, generated art from their id; organizers get an initial. */
function PagePhoto({ p }: { p: PageProfile }) {
  if (p.photoUrl) return <img className="page-photo" src={p.photoUrl} alt="" referrerPolicy="no-referrer" />;
  if (p.kind === "organizer")
    return (
      <span className="page-photo is-initial" aria-hidden="true">
        {p.name.slice(0, 1).toUpperCase()}
      </span>
    );
  return <GeneratedArt compact id={p.id} className="page-photo" />;
}

function PageSkeleton() {
  return (
    <div className="stack" role="status" aria-label="Loading">
      <div className="page-head">
        <Skeleton w={88} h={88} />
        <span className="skel-stack">
          <Skeleton w={60} h={10} />
          <Skeleton w="70%" h={30} />
          <Skeleton w="45%" h={12} />
        </span>
      </div>
      <Skeleton w="90%" h={14} />
      <Skeleton w="75%" h={14} />
    </div>
  );
}

function VenueBlock({ p, theme, onShowPlace }: { p: PageProfile; theme: MapTheme; onShowPlace: (lng: number, lat: number) => void }) {
  const v = p.venue!;
  const q = `${v.lat},${v.lng}`;
  return (
    <section className="page-venue" aria-label="Getting there" data-reveal>
      <button className="map-snippet-wrap" onClick={() => onShowPlace(v.lng, v.lat)} aria-label={`Show ${p.name} on the map`}>
        <MapSnippet lng={v.lng} lat={v.lat} theme={theme} label={`Map of ${p.name}`} />
      </button>
      <p className="page-address">{v.address}</p>
      <div className="where-links">
        <LinkButton size="sm" href={`https://maps.apple.com/?daddr=${q}`} target="_blank" rel="noopener noreferrer">
          ▷ Apple Maps
        </LinkButton>
        <LinkButton size="sm" href={`https://www.google.com/maps/dir/?api=1&destination=${q}`} target="_blank" rel="noopener noreferrer">
          ▷ Google Maps
        </LinkButton>
      </div>
      {(v.accessNotes || v.housePolicy.length > 0) && (
        <div className="ev-block">
          <h3 className="ev-subhead">Door and access</h3>
          {v.accessNotes && <p className="page-notes">{v.accessNotes}</p>}
          {v.housePolicy.length > 0 && (
            <ul className="event-tags">
              {v.housePolicy.map((t) => (
                <li key={t}>{POLICY_TAGS[t] ?? t}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

/** Upcoming or past shows, a page at a time. Artist pages show each set time. Past is dimmed and has no RSVP. */
function PageFeed({
  p,
  when,
  tz,
  config,
  rsvps,
  friendsAt,
  onOpenEvent,
  onShowOnMap,
  onRsvp,
  toast,
}: {
  p: PageProfile;
  when: "upcoming" | "past";
  tz: string;
  config: ServerConfig;
  rsvps: Record<string, RsvpStatus | undefined>;
  friendsAt: Record<string, FriendAt[] | undefined>;
  onOpenEvent: (id: string) => void;
  onShowOnMap: (id: string) => void;
  onRsvp: (id: string) => void;
  toast: (m: string) => void;
}) {
  const [events, setEvents] = useState<PageEvent[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sharing, setSharing] = useState<PageEvent | null>(null);
  const now = new Date();

  const load = (cursor: string | null) => {
    setBusy(true);
    api
      .pageEvents(p.kind, p.slug, when, cursor)
      .then((r) => {
        setEvents((cur) => (cursor && cur ? [...cur, ...r.events] : r.events));
        setNext(r.next);
      })
      .catch((err: unknown) => toast(err instanceof ApiError ? err.message : "Couldn't load the shows."))
      .finally(() => setBusy(false));
  };
  useEffect(() => load(null), []); // keyed by page and tab

  if (!events)
    return (
      <div className="skel-list" role="status" aria-label="Loading shows">
        <Skeleton w="100%" h={180} />
      </div>
    );
  if (!events.length)
    return (
      <p className="note">
        {when === "upcoming" ? (p.kind === "venue" ? "Nothing on the calendar here yet." : "No shows coming up yet.") : "No past shows on Assembly yet."}
      </p>
    );
  return (
    <>
      <ol className="feed-list page-feed">
        {events.map((e) => (
          <li key={e.id}>
            <FeedCard
              e={e}
              past={when === "past"}
              setLine={p.kind === "artist" && (e.setStart || e.room) ? ["Set", e.setStart, e.room].filter(Boolean).join(" · ") : null}
              now={now}
              tz={tz}
              config={config}
              rsvp={rsvps[e.id] ?? null}
              friends={friendsAt[e.id] ?? []}
              onOpen={() => onOpenEvent(e.id)}
              onShowOnMap={() => onShowOnMap(e.id)}
              onRsvp={() => onRsvp(e.id)}
              onShare={() => setSharing(e)}
              distance={null}
            />
          </li>
        ))}
      </ol>
      {next && (
        <Button onClick={() => load(next)} disabled={busy}>
          {busy ? "Loading…" : "More shows"}
        </Button>
      )}
      {sharing && (
        <ShareSheet
          target={{ title: sharing.title, text: `${sharing.title}: ${clock(sharing.startsAt, tz)}, ${timeRange(sharing.startsAt, sharing.endsAt, tz)}`, url: `${location.origin}/e/${encodeURIComponent(sharing.id)}` }}
          open
          onClose={() => setSharing(null)}
          toast={toast}
        />
      )}
    </>
  );
}

const LINK_KEYS = ["instagram", "soundcloud", "bandcamp", "mixcloud", "ra", "spotify", "site"] as const;

/** The owner's editor: photo, bio, links, and for venues the door notes and house policy. */
function PageEditor({ p, onSaved, toast }: { p: PageProfile; onSaved: (p: PageProfile) => void; toast: (m: string) => void }) {
  const kind = p.kind as "artist" | "venue";
  const [bio, setBio] = useState(p.bio ?? "");
  const [links, setLinks] = useState<ArtistLinks>(p.links);
  const [notes, setNotes] = useState(p.venue?.accessNotes ?? "");
  const [policy, setPolicy] = useState<string[]>(p.venue?.housePolicy ?? []);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  const save = async () => {
    setBusy(true);
    try {
      onSaved(await api.editPage(kind, p.slug, { bio, links, ...(kind === "venue" ? { accessNotes: notes, housePolicy: policy } : {}) }));
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fields);
        toast(err.message);
      } else toast("Couldn't save. Try again.");
    } finally {
      setBusy(false);
    }
  };
  const photo = async (f: File) => {
    setBusy(true);
    try {
      onSaved(await api.pagePhoto(kind, p.slug, await prepareAvatar(f)));
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't upload the photo.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="page-editor compose" aria-label="Edit page">
      <div className="field">
        <span className="field-label">Photo</span>
        <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => e.target.files?.[0] && photo(e.target.files[0])} />
        <Button size="sm" onClick={() => file.current?.click()} disabled={busy}>
          {p.photoUrl ? "Change photo" : "Add a photo"}
        </Button>
      </div>
      <label className="field">
        <span className="field-label">Bio</span>
        <textarea rows={4} maxLength={600} value={bio} onChange={(e) => setBio(e.target.value)} placeholder={kind === "artist" ? "Sound, crew, where you play." : "The room, the sound, who it's for."} />
        <span className="field-hint">{bio.length}/600</span>
      </label>
      {kind === "venue" && (
        <>
          <label className="field">
            <span className="field-label">Door and access</span>
            <textarea rows={3} maxLength={400} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Entrance, parking, transit, step-free access." />
          </label>
          <div className="field">
            <span className="field-label">House policy</span>
            <div className="chips">
              {Object.entries(POLICY_TAGS).map(([id, label]) => (
                <button key={id} type="button" className="chip" aria-pressed={policy.includes(id)} onClick={() => setPolicy((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
      <div className="field">
        <span className="field-label">Links</span>
        <div className="page-link-fields">
          {LINK_KEYS.map((k) => (
            <label key={k} className={`field ${errors[`links.${k}`] ? "has-error" : ""}`}>
              <span className="field-hint">{LINK_LABELS[k]}</span>
              <input value={links[k] ?? ""} inputMode="url" onChange={(e) => setLinks((cur) => ({ ...cur, [k]: e.target.value }))} placeholder={k === "site" ? "example.com" : `${k}.com/…`} />
              {errors[`links.${k}`] && <span className="field-error">{errors[`links.${k}`]}</span>}
            </label>
          ))}
        </div>
      </div>
      <Button variant="primary" size="lg" onClick={save} disabled={busy}>
        {busy ? "Saving…" : "Save"}
      </Button>
    </section>
  );
}

/** "Is this you?" for an unclaimed artist or venue page. A moderator checks the message before handing it over. */
function ClaimBox({
  p,
  me,
  open,
  onOpen,
  onClaimed,
  toast,
}: {
  p: PageProfile;
  me: Me | null;
  open: boolean;
  onOpen: () => void;
  onClaimed: (p: PageProfile) => void;
  toast: (m: string) => void;
}) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  if (p.viewerClaim === "pending") return <p className="note">Your claim is with a moderator. We'll let you know.</p>;
  if (!open || !me)
    return (
      <button className="link" onClick={onOpen}>
        {p.kind === "artist" ? `Are you ${p.name}? Claim this page` : `Run ${p.name}? Claim this page`}
      </button>
    );
  return (
    <section className="report" aria-label="Claim this page">
      <Label glyph="◇">Claim this page</Label>
      <p className="note">Tell us how to confirm it's you: a DM from {p.kind === "artist" ? "your" : "the venue's"} Instagram, an email from {p.kind === "artist" ? "your" : "the venue's"} domain, or someone who can vouch.</p>
      <textarea className="report-note" rows={3} maxLength={400} value={message} onChange={(e) => setMessage(e.target.value)} aria-label="How we can confirm it's you" />
      <div className="report-actions">
        <Button
          size="sm"
          disabled={busy || message.trim().length < 10}
          onClick={async () => {
            setBusy(true);
            try {
              onClaimed(await api.claimPage(p.kind as "artist" | "venue", p.slug, message));
            } catch (err) {
              toast(err instanceof ApiError ? err.message : "Couldn't send. Try again.");
            } finally {
              setBusy(false);
            }
          }}
        >
          Send to a moderator
        </Button>
      </div>
    </section>
  );
}
