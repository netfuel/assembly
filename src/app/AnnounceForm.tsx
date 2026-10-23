import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button, Chip, Label, Segmented, Tag } from "../components/ui";
import { PinPicker } from "../map/PinPicker";
import { api, ApiError, videoPlayerUrl, type EventDraft } from "../lib/api";
import { dayLabel, fromInputs, localParts, timeRange, toInputs } from "../lib/time";
import { formatDuration, MediaError, prepareFlyer, uploadToStream, videoDuration, VIDEO_MAX_BYTES, VIDEO_MAX_SECONDS } from "../lib/media";
import { POLICY_TAGS, SCENES, type ArtistMatch, type City, type EventDetail, type GeocodeResult, type ServerConfig, type Venue } from "../../shared/types";
import type { MapTheme } from "../map/mapStyle";
import "./announce.css";

const DRAFT_KEY = "assembly-draft-v1";

const LINK_FIELDS: { key: string; label: string; placeholder: string }[] = [
  { key: "instagram", label: "Instagram", placeholder: "instagram.com/name" },
  { key: "soundcloud", label: "SoundCloud", placeholder: "soundcloud.com/name" },
  { key: "bandcamp", label: "Bandcamp", placeholder: "name.bandcamp.com" },
  { key: "mixcloud", label: "Mixcloud", placeholder: "mixcloud.com/name" },
  { key: "ra", label: "RA", placeholder: "ra.co/dj/name" },
  { key: "spotify", label: "Spotify", placeholder: "open.spotify.com/artist/…" },
  { key: "site", label: "Website", placeholder: "name.com" },
];

interface Row {
  key: string;
  artistId?: string;
  name: string;
  links: Record<string, string>;
  setStart: string;
  room: string;
  note: string;
}

interface FormState {
  title: string;
  pitch: string;
  description: string;
  date: string;
  start: string;
  end: string;
  where: "venue" | "address";
  venueId: string | null;
  address: string;
  neighborhood: string;
  lat: number | null;
  lng: number | null;
  gettingThere: string;
  doorPrice: string;
  ticketUrl: string;
  scenes: string[];
  policyTags: string[];
  flyer: { key: string; url: string } | null;
  video: { uid: string; seconds: number | null } | null;
  lineup: Row[];
}

let rowSeq = 0;
const newRow = (r: Partial<Row> = {}): Row => ({ key: `r${++rowSeq}`, name: "", links: {}, setStart: "", room: "", note: "", ...r });

function emptyState(tz: string): FormState {
  const p = localParts(new Date(), tz);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    title: "",
    pitch: "",
    description: "",
    date: `${p.year}-${pad(p.month)}-${pad(p.day)}`,
    start: "22:00",
    end: "03:00",
    where: "venue",
    venueId: null,
    address: "",
    neighborhood: "",
    lat: null,
    lng: null,
    gettingThere: "",
    doorPrice: "",
    ticketUrl: "",
    scenes: [],
    policyTags: [],
    flyer: null,
    video: null,
    lineup: [newRow()],
  };
}

function fromEvent(e: EventDetail, tz: string): FormState {
  const s = toInputs(e.startsAt, tz);
  const en = toInputs(e.endsAt, tz);
  return {
    title: e.title,
    pitch: e.pitch ?? "",
    description: e.description ?? "",
    date: s.date,
    start: s.time,
    end: en.time,
    where: e.venueId ? "venue" : "address",
    venueId: e.venueId,
    address: e.address,
    neighborhood: e.neighborhood ?? "",
    lat: e.lat,
    lng: e.lng,
    gettingThere: e.gettingThere ?? "",
    doorPrice: e.doorPrice ?? "",
    ticketUrl: e.ticketUrl ?? "",
    scenes: [...e.scenes],
    policyTags: [...e.policyTags],
    flyer: e.flyerKey && e.flyerUrl ? { key: e.flyerKey, url: e.flyerUrl } : null,
    video: e.videoId ? { uid: e.videoId, seconds: null } : null,
    lineup: e.lineup.length
      ? e.lineup.map((l) =>
          newRow({
            artistId: l.artistId,
            name: l.name,
            links: Object.fromEntries(Object.entries(l.links).filter((kv): kv is [string, string] => !!kv[1])),
            setStart: l.setStart ?? "",
            room: l.room ?? "",
            note: l.note ?? "",
          }),
        )
      : [newRow()],
  };
}

function loadDraft(): FormState | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as FormState;
    d.lineup = (d.lineup?.length ? d.lineup : [newRow()]).map((r) => ({ ...r, key: `r${++rowSeq}` }));
    return d;
  } catch {
    return null;
  }
}

function saveDraft(s: FormState | null) {
  try {
    if (s) localStorage.setItem(DRAFT_KEY, JSON.stringify(s));
    else localStorage.removeItem(DRAFT_KEY);
  } catch {
    // Private mode or storage blocked: the draft just won't survive closing the form.
  }
}

function Field({ label, hint, error, count, children }: { label: string; hint?: ReactNode; error?: string; count?: [number, number]; children: ReactNode }) {
  return (
    <label className={`field ${error ? "has-error" : ""}`}>
      <span className="field-label">
        {label}
        {count && (
          <span className={`field-count num ${count[0] > count[1] ? "over" : ""}`}>
            {count[0]}/{count[1]}
          </span>
        )}
      </span>
      {children}
      {error ? <span className="field-error">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

function Section({ n, title, children, id }: { n: string; title: string; children: ReactNode; id: string }) {
  return (
    <section className="compose-section" aria-labelledby={`${id}-h`} data-reveal>
      <h2 className="compose-h" id={`${id}-h`}>
        <span className="compose-n num">{n}</span>
        {title}
      </h2>
      <div className="compose-fields">{children}</div>
    </section>
  );
}

/** Which section a server field error belongs to, so we can scroll to the first one. */
const FIELD_SECTION: Record<string, string> = {
  flyerKey: "flyer",
  title: "what",
  pitch: "what",
  description: "what",
  startsAt: "when",
  endsAt: "when",
  venueId: "where",
  address: "where",
  location: "where",
  scenes: "door",
  ticketUrl: "door",
  lineup: "lineup",
  video: "video",
  videoId: "video",
};

/** Which error keys each form value answers for. Keys ending in "." match a prefix. */
const ERROR_KEYS: Partial<Record<keyof FormState, string[]>> = {
  date: ["startsAt", "endsAt"],
  start: ["startsAt", "endsAt"],
  end: ["startsAt", "endsAt"],
  where: ["venueId", "address", "location"],
  venueId: ["venueId"],
  lat: ["location"],
  lng: ["location"],
  flyer: ["flyerKey"],
  video: ["video", "videoId"],
  lineup: ["lineup", "lineup."],
};

export function AnnounceForm({
  city,
  theme,
  config,
  existing,
  onPosted,
  onCancelled,
  toast,
}: {
  city: City;
  theme: MapTheme;
  config: ServerConfig;
  existing: EventDetail | null;
  onPosted: (id: string, mode: "created" | "updated") => void;
  onCancelled: (id: string) => void;
  toast: (msg: string) => void;
}) {
  const tz = city.timezone;
  const editing = !!existing;
  const [s, setS] = useState<FormState>(() => (existing ? fromEvent(existing, tz) : (loadDraft() ?? emptyState(tz))));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const root = useRef<HTMLFormElement>(null);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setS((cur) => ({ ...cur, [k]: v }));

  // Clear a field's error as soon as the person changes that field.
  const prev = useRef(s);
  useEffect(() => {
    const before = prev.current;
    prev.current = s;
    const changed = (Object.keys(s) as (keyof FormState)[]).filter((k) => s[k] !== before[k]);
    if (!changed.length) return;
    setErrors((errs) => {
      const stale = (key: string) =>
        changed.some((k) => (ERROR_KEYS[k] ?? [k]).some((e) => key === e || (e.endsWith(".") && key.startsWith(e))));
      const next = Object.fromEntries(Object.entries(errs).filter(([key]) => !stale(key)));
      if (Object.keys(next).length === Object.keys(errs).length) return errs;
      if (!Object.keys(next).length) setFormError(null);
      return next;
    });
  }, [s]);

  // New posts keep a draft on this device, so closing the form doesn't lose work.
  useEffect(() => {
    if (editing) return;
    const t = setTimeout(() => saveDraft(s), 400);
    return () => clearTimeout(t);
  }, [s, editing]);

  const times = useMemo(() => fromInputs(s.date, s.start, s.end, tz), [s.date, s.start, s.end, tz]);
  const overnight = s.end && s.start && s.end <= s.start;

  function clientCheck(): Record<string, string> {
    const e: Record<string, string> = {};
    if (!s.title.trim()) e.title = "Give the event a name.";
    if (!times) e.startsAt = "Pick a date and start and end times.";
    if (s.where === "venue" && !s.venueId) e.venueId = "Pick the venue, or switch to Address.";
    if (s.where === "address") {
      if (!s.address.trim()) e.address = "Add the address so people can find it.";
      if (s.lat == null || s.lng == null) e.location = "Drag the map so the pin sits on the entrance.";
    }
    if (!s.scenes.length) e.scenes = "Pick at least one scene so people can find it.";
    s.lineup.forEach((r, i) => {
      if (!r.name.trim() && (r.setStart || r.room || r.note || Object.values(r.links).some(Boolean))) e[`lineup.${i}.name`] = "Add the artist's name.";
    });
    return e;
  }

  function scrollToFirst(errs: Record<string, string>) {
    const first = Object.keys(errs)[0];
    if (!first) return;
    const section = FIELD_SECTION[first] ?? FIELD_SECTION[first.split(".")[0]] ?? "what";
    root.current?.querySelector(`#${section}-h`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (saving) return;
    setFormError(null);
    const errs = clientCheck();
    setErrors(errs);
    if (Object.keys(errs).length) {
      setFormError("Some details need another look.");
      scrollToFirst(errs);
      return;
    }
    const draft: EventDraft = {
      title: s.title,
      pitch: s.pitch,
      description: s.description,
      startsAt: times!.startsAt,
      endsAt: times!.endsAt,
      venueId: s.where === "venue" ? s.venueId : null,
      address: s.where === "address" ? s.address : "",
      neighborhood: s.where === "address" ? s.neighborhood : "",
      lat: s.where === "address" ? s.lat : null,
      lng: s.where === "address" ? s.lng : null,
      gettingThere: s.gettingThere,
      doorPrice: s.doorPrice,
      ticketUrl: s.ticketUrl,
      scenes: s.scenes,
      policyTags: s.policyTags,
      flyerKey: s.flyer?.key ?? null,
      videoId: s.video?.uid ?? null,
      lineup: s.lineup
        .filter((r) => r.name.trim())
        .map((r) => ({ artistId: r.artistId, name: r.name, links: r.links, setStart: r.setStart, room: r.room, note: r.note })),
    };
    setSaving(true);
    try {
      const res = existing ? await api.updateEvent(existing.id, draft) : await api.createEvent(draft);
      if (!existing) saveDraft(null);
      onPosted(res.id, existing ? "updated" : "created");
    } catch (err) {
      if (err instanceof ApiError) {
        // Lineup errors are numbered by the rows we sent; empty rows were left out, so map back to form rows.
        const sent = s.lineup.map((r, i) => (r.name.trim() ? i : -1)).filter((i) => i >= 0);
        const fields = Object.fromEntries(
          Object.entries(err.fields).map(([k, v]) => [k.replace(/^lineup\.(\d+)/, (_, i: string) => `lineup.${sent[Number(i)] ?? i}`), v]),
        );
        setFormError(err.message);
        setErrors(fields);
        scrollToFirst(fields);
        if (err.status === 401) setFormError("Your sign-in expired. Sign in again; your draft is saved on this device.");
      } else setFormError("Couldn't post. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  async function cancelEvent() {
    if (!existing) return;
    setSaving(true);
    try {
      await api.cancelEvent(existing.id);
      onCancelled(existing.id);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Couldn't cancel. Try again.");
    } finally {
      setSaving(false);
      setConfirmCancel(false);
    }
  }

  const errorCount = Object.keys(errors).length;

  return (
    <form ref={root} className="compose" onSubmit={submit} noValidate>
      <div className="stack" data-reveal>
        <Label glyph="▶">{editing ? "Edit announcement" : "Make an announcement"}</Label>
        <h1 className="sheet-title">{editing ? s.title || "Untitled" : "Put it on the map."}</h1>
        <p className="note serif-text">
          {editing
            ? "Changes show right away. People who RSVP'd see an Updated tag."
            : "Everything goes live as soon as you post: full address, times, and lineup, so people can plan."}
        </p>
      </div>

      <Section n="01" title="Flyer" id="flyer">
        <FlyerField value={s.flyer} onChange={(f) => set("flyer", f)} error={errors.flyerKey} />
      </Section>

      <Section n="02" title="The night" id="what">
        <Field label="Name" error={errors.title} count={[s.title.length, 80]}>
          <input value={s.title} maxLength={80} onChange={(e) => set("title", e.target.value)} placeholder="Wet Paint" autoComplete="off" />
        </Field>
        <Field label="One line" hint="Shows on the map card." error={errors.pitch} count={[s.pitch.length, 140]}>
          <input value={s.pitch} maxLength={140} onChange={(e) => set("pitch", e.target.value)} placeholder="Disco edits till the lights come up" />
        </Field>
        <Field label="About" hint="Optional. Vibe, dress code, what to bring." error={errors.description}>
          <textarea rows={4} value={s.description} maxLength={4000} onChange={(e) => set("description", e.target.value)} />
        </Field>
      </Section>

      <Section n="03" title="When" id="when">
        <div className="field-row three">
          <Field label="Date" error={errors.startsAt}>
            <input type="date" value={s.date} onChange={(e) => set("date", e.target.value)} />
          </Field>
          <Field label="Doors">
            <input type="time" value={s.start} step={900} onChange={(e) => set("start", e.target.value)} />
          </Field>
          <Field label="Ends" error={errors.endsAt}>
            <input type="time" value={s.end} step={900} onChange={(e) => set("end", e.target.value)} />
          </Field>
        </div>
        {times && (
          <p className="compose-summary num">
            {dayLabel(times.startsAt, new Date(), tz)} <span className="dim">/</span> {timeRange(times.startsAt, times.endsAt, tz)}
            {overnight && <Tag>Ends next morning</Tag>}
            <span className="dim"> · {city.name} time</span>
          </p>
        )}
      </Section>

      <Section n="04" title="Where" id="where">
        <WhereField s={s} setS={setS} city={city} theme={theme} errors={errors} />
      </Section>

      <Section n="05" title="Scene and door" id="door">
        <div className={`field ${errors.scenes ? "has-error" : ""}`}>
          <span className="field-label">Scene</span>
          <div className="chips">
            {SCENES.map((sc) => (
              <Chip
                key={sc.id}
                pressed={s.scenes.includes(sc.id)}
                marker={sc.id === "queer" ? "var(--color-uv)" : undefined}
                onClick={() => set("scenes", s.scenes.includes(sc.id) ? s.scenes.filter((x) => x !== sc.id) : [...s.scenes, sc.id])}
              >
                {sc.label}
              </Chip>
            ))}
          </div>
          {errors.scenes && <span className="field-error">{errors.scenes}</span>}
        </div>
        <div className="field">
          <span className="field-label">At the door</span>
          <div className="chips">
            {Object.entries(POLICY_TAGS).map(([id, label]) => (
              <Chip key={id} pressed={s.policyTags.includes(id)} onClick={() => set("policyTags", s.policyTags.includes(id) ? s.policyTags.filter((x) => x !== id) : [...s.policyTags, id])}>
                {label}
              </Chip>
            ))}
          </div>
        </div>
        <div className="field-row">
          <Field label="Door price" hint="Free, $10, $5–15 sliding…" error={errors.doorPrice}>
            <input value={s.doorPrice} maxLength={60} onChange={(e) => set("doorPrice", e.target.value)} placeholder="$10" />
          </Field>
          <Field label="Ticket link" hint="We link out. Payment happens on your ticket site." error={errors.ticketUrl}>
            <input value={s.ticketUrl} inputMode="url" onChange={(e) => set("ticketUrl", e.target.value)} placeholder="ra.co/events/…" />
          </Field>
        </div>
      </Section>

      <Section n="06" title="Lineup" id="lineup">
        <LineupField rows={s.lineup} onChange={(rows) => set("lineup", rows)} errors={errors} />
      </Section>

      <Section n="07" title="Promo video" id="video">
        <VideoField enabled={config.video} customerCode={config.streamCustomerCode} value={s.video} onChange={(v) => set("video", v)} error={errors.video ?? errors.videoId} />
      </Section>

      <footer className="compose-foot">
        {formError && (
          <p className="compose-error" role="alert">
            {formError}
            {errorCount > 1 && <span className="dim"> ({errorCount} fields)</span>}
          </p>
        )}
        <div className="compose-actions">
          {editing && !confirmCancel && existing?.status === "live" && (
            <Button type="button" variant="ghost" onClick={() => setConfirmCancel(true)} disabled={saving}>
              Cancel event
            </Button>
          )}
          {confirmCancel && (
            <span className="confirm-cancel" role="group" aria-label="Confirm cancel">
              <span>Mark it cancelled for everyone?</span>
              <Button type="button" size="sm" onClick={cancelEvent} disabled={saving}>
                Yes, cancel it
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmCancel(false)}>
                Keep it
              </Button>
            </span>
          )}
          <span className="spacer" />
          <Button type="submit" variant="primary" size="lg" disabled={saving}>
            {saving ? "Saving…" : editing ? "Save changes" : "Post it"}
          </Button>
        </div>
      </footer>
    </form>
  );
}

/* ---------- Flyer ---------- */

function FlyerField({ value, onChange, error }: { value: { key: string; url: string } | null; onChange: (v: { key: string; url: string } | null) => void; error?: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function take(file: File | undefined) {
    if (!file) return;
    setMsg(null);
    setBusy(true);
    try {
      const { blob } = await prepareFlyer(file);
      const res = await api.uploadFlyer(blob);
      onChange(res);
    } catch (err) {
      setMsg(err instanceof MediaError || err instanceof ApiError ? err.message : "Couldn't upload that flyer. Try again.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className={`field ${error || msg ? "has-error" : ""}`}>
      <div
        className={`flyer-drop ${drag ? "is-drag" : ""} ${value ? "has-flyer" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          take(e.dataTransfer.files[0]);
        }}
      >
        {value ? (
          <img src={value.url} alt="Your flyer" />
        ) : (
          <div className="flyer-drop-empty">
            <span className="flyer-drop-glyph" aria-hidden="true">
              ▣
            </span>
            <span>{busy ? "Uploading…" : "Drop your flyer here"}</span>
            <span className="dim">JPG, PNG, or WebP. Portrait works best. No flyer? We'll make one.</span>
          </div>
        )}
        {busy && value && <div className="flyer-drop-busy">Uploading…</div>}
      </div>
      <div className="inline-actions">
        <Button type="button" size="sm" onClick={() => input.current?.click()} disabled={busy}>
          {value ? "Replace flyer" : "Choose image"}
        </Button>
        {value && (
          <Button type="button" size="sm" variant="ghost" onClick={() => onChange(null)} disabled={busy}>
            Remove
          </Button>
        )}
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" hidden onChange={(e) => take(e.target.files?.[0])} />
      </div>
      {(msg || error) && <span className="field-error">{msg ?? error}</span>}
    </div>
  );
}

/* ---------- Where ---------- */

function WhereField({
  s,
  setS,
  city,
  theme,
  errors,
}: {
  s: FormState;
  setS: React.Dispatch<React.SetStateAction<FormState>>;
  city: City;
  theme: MapTheme;
  errors: Record<string, string>;
}) {
  const [venues, setVenues] = useState<Venue[] | null>(null);
  const [venueQ, setVenueQ] = useState("");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [searchMsg, setSearchMsg] = useState<string | null>(null);
  const [fly, setFly] = useState<{ lng: number; lat: number; key: number } | null>(null);

  useEffect(() => {
    api.venues().then(setVenues).catch(() => setVenues([]));
  }, []);

  useEffect(() => {
    if (q.trim().length < 3) {
      setResults([]);
      setSearchMsg(null);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      api
        .geocode(q, ctrl.signal)
        .then((r) => {
          setResults(r.results);
          setSearchMsg(r.error ?? (r.results.length ? null : `No matches in ${city.name}. Place the pin by hand.`));
        })
        .catch(() => undefined);
    }, 300);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q, city.name]);

  const shownVenues = (venues ?? []).filter((v) => !venueQ || `${v.name} ${v.neighborhood ?? ""}`.toLowerCase().includes(venueQ.toLowerCase()));
  const picked = venues?.find((v) => v.id === s.venueId);

  return (
    <>
      <Segmented
        label="Location type"
        options={[
          { id: "venue", label: "Listed venue" },
          { id: "address", label: "Address or DIY spot" },
        ]}
        value={s.where}
        onChange={(where) => setS((c) => ({ ...c, where }))}
      />

      {s.where === "venue" ? (
        <div className={`field ${errors.venueId ? "has-error" : ""}`}>
          <span className="field-label">Venue</span>
          <input value={venueQ} onChange={(e) => setVenueQ(e.target.value)} placeholder="Search venues" aria-label="Search venues" />
          <div className="venue-list" role="radiogroup" aria-label="Venues">
            {venues === null && <span className="note">Loading venues…</span>}
            {venues && shownVenues.length === 0 && (
              <span className="note">
                Not listed?{" "}
                <button type="button" className="link" onClick={() => setS((c) => ({ ...c, where: "address" }))}>
                  Use an address →
                </button>
              </span>
            )}
            {shownVenues.map((v) => (
              <button
                type="button"
                role="radio"
                aria-checked={s.venueId === v.id}
                key={v.id}
                className="venue-option"
                onClick={() => setS((c) => ({ ...c, venueId: v.id }))}
              >
                <span className="venue-name">{v.name}</span>
                <span className="dim">
                  {v.type} / {v.neighborhood ?? v.address}
                </span>
              </button>
            ))}
          </div>
          {errors.venueId && <span className="field-error">{errors.venueId}</span>}
          {picked && <span className="field-hint">{picked.address}</span>}
        </div>
      ) : (
        <>
          <div className="field geo">
            <span className="field-label">Find the address</span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Street address or place name" aria-label="Find the address" />
            {results.length > 0 && (
              <ul className="geo-results">
                {results.map((r) => (
                  <li key={`${r.lat},${r.lng}`}>
                    <button
                      type="button"
                      onClick={() => {
                        setS((c) => ({ ...c, address: r.address, neighborhood: r.neighborhood ?? c.neighborhood, lat: r.lat, lng: r.lng }));
                        setFly({ lng: r.lng, lat: r.lat, key: Date.now() });
                        setResults([]);
                        setQ("");
                      }}
                    >
                      {r.label}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {searchMsg && <span className="field-hint">{searchMsg}</span>}
          </div>
          <div className={`field ${errors.location ? "has-error" : ""}`}>
            <span className="field-label">
              Pin
              {s.lat != null && <span className="field-count num">{s.lat.toFixed(4)}, {s.lng!.toFixed(4)}</span>}
            </span>
            <PinPicker
              start={s.lat != null && s.lng != null ? [s.lng, s.lat] : city.center}
              fly={fly}
              theme={theme}
              onMove={(lng, lat) => setS((c) => ({ ...c, lng, lat }))}
            />
            {errors.location ? <span className="field-error">{errors.location}</span> : <span className="field-hint">Drag the map so the pin sits on the door people should use.</span>}
          </div>
          <div className="field-row">
            <Field label="Address" error={errors.address}>
              <input value={s.address} maxLength={160} onChange={(e) => setS((c) => ({ ...c, address: e.target.value }))} placeholder="1234 Example Ave" />
            </Field>
            <Field label="Neighborhood">
              <input value={s.neighborhood} maxLength={60} onChange={(e) => setS((c) => ({ ...c, neighborhood: e.target.value }))} placeholder="Midtown" />
            </Field>
          </div>
        </>
      )}
      <Field label="Getting there" hint="Optional. Which door, parking, buzzer, accessibility." count={[s.gettingThere.length, 280]}>
        <textarea rows={2} value={s.gettingThere} maxLength={280} onChange={(e) => setS((c) => ({ ...c, gettingThere: e.target.value }))} placeholder="Side door off the alley. Ramp at the back." />
      </Field>
    </>
  );
}

/* ---------- Lineup ---------- */

function LineupField({ rows, onChange, errors }: { rows: Row[]; onChange: (rows: Row[]) => void; errors: Record<string, string> }) {
  const update = (key: string, patch: Partial<Row>) => onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const move = (i: number, d: -1 | 1) => {
    const next = [...rows];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    onChange(next);
  };
  return (
    <div className="lineup-builder">
      {errors.lineup && <span className="field-error">{errors.lineup}</span>}
      <ol>
        {rows.map((r, i) => (
          <LineupRow
            key={r.key}
            row={r}
            index={i}
            count={rows.length}
            error={errors[`lineup.${i}.name`] ?? errors[`lineup.${i}`]}
            linkErrors={Object.fromEntries(
              Object.entries(errors)
                .filter(([k]) => k.startsWith(`lineup.${i}.links.`))
                .map(([k, v]) => [k.split(".").pop()!, v]),
            )}
            onUpdate={(patch) => update(r.key, patch)}
            onMove={(d) => move(i, d)}
            onRemove={() => onChange(rows.length > 1 ? rows.filter((x) => x.key !== r.key) : [newRow()])}
          />
        ))}
      </ol>
      {rows.length < 30 && (
        <Button type="button" size="sm" onClick={() => onChange([...rows, newRow()])}>
          + Add artist
        </Button>
      )}
      <p className="note">Leave it empty and the event shows "Lineup to be announced."</p>
    </div>
  );
}

function LineupRow({
  row,
  index,
  count,
  error,
  linkErrors,
  onUpdate,
  onMove,
  onRemove,
}: {
  row: Row;
  index: number;
  count: number;
  error?: string;
  linkErrors: Record<string, string>;
  onUpdate: (p: Partial<Row>) => void;
  onMove: (d: -1 | 1) => void;
  onRemove: () => void;
}) {
  const [matches, setMatches] = useState<ArtistMatch[]>([]);
  const [focused, setFocused] = useState(false);
  const [showLinks, setShowLinks] = useState(() => Object.values(row.links).some(Boolean));
  const hasLinkError = Object.keys(linkErrors).length > 0;
  useEffect(() => {
    if (hasLinkError) setShowLinks(true);
  }, [hasLinkError]);
  const linkCount = Object.values(row.links).filter(Boolean).length;

  useEffect(() => {
    if (!focused || row.artistId || row.name.trim().length < 2) {
      setMatches([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => api.artists(row.name.trim(), ctrl.signal).then(setMatches).catch(() => undefined), 200);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [row.name, row.artistId, focused]);

  return (
    <li className={`lineup-row ${error ? "has-error" : ""}`}>
      <div className="lineup-row-main">
        <span className="lineup-index num">N.{String(index + 1).padStart(2, "0")}</span>
        <div className="artist-input">
          <input
            value={row.name}
            maxLength={60}
            placeholder="Artist or DJ name"
            aria-label={`Artist ${index + 1} name`}
            autoComplete="off"
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 150)}
            onChange={(e) => onUpdate({ name: e.target.value, artistId: undefined })}
          />
          {row.artistId && <Tag>On Assembly</Tag>}
          {matches.length > 0 && (
            <ul className="artist-matches" role="listbox">
              {matches.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      onUpdate({ artistId: m.id, name: m.name, links: { ...Object.fromEntries(Object.entries(m.links).filter((kv): kv is [string, string] => !!kv[1])), ...Object.fromEntries(Object.entries(row.links).filter(([, v]) => v)) } });
                      setMatches([]);
                    }}
                  >
                    {m.name}
                    <span className="dim">{Object.keys(m.links).length ? ` · ${Object.keys(m.links).length} links` : ""}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <input className="set-time" value={row.setStart} maxLength={20} placeholder="11 pm" aria-label={`Artist ${index + 1} set time`} onChange={(e) => onUpdate({ setStart: e.target.value })} />
        <span className="row-tools">
          <button type="button" className="icon-btn" onClick={() => onMove(-1)} disabled={index === 0} aria-label="Move up">
            ↑
          </button>
          <button type="button" className="icon-btn" onClick={() => onMove(1)} disabled={index === count - 1} aria-label="Move down">
            ↓
          </button>
          <button type="button" className="icon-btn" onClick={onRemove} aria-label={`Remove artist ${index + 1}`}>
            ×
          </button>
        </span>
      </div>
      {error && <span className="field-error">{error}</span>}
      <div className="lineup-row-extra">
        <input value={row.room} maxLength={40} placeholder="Room (optional)" aria-label={`Artist ${index + 1} room`} onChange={(e) => onUpdate({ room: e.target.value })} />
        <input value={row.note} maxLength={80} placeholder="Note: live set, b2b, debut…" aria-label={`Artist ${index + 1} note`} onChange={(e) => onUpdate({ note: e.target.value })} />
        <button type="button" className="link" aria-expanded={showLinks} onClick={() => setShowLinks((x) => !x)}>
          {showLinks ? "Hide links" : linkCount ? `Links (${linkCount})` : "+ Links"}
        </button>
      </div>
      {showLinks && (
        <div className="artist-links-edit">
          {LINK_FIELDS.map((f) => (
            <label key={f.key} className={linkErrors[f.key] ? "has-error" : ""}>
              <span>{f.label}</span>
              <input value={row.links[f.key] ?? ""} inputMode="url" placeholder={f.placeholder} onChange={(e) => onUpdate({ links: { ...row.links, [f.key]: e.target.value } })} />
              {linkErrors[f.key] && <em className="field-error">{linkErrors[f.key]}</em>}
            </label>
          ))}
          {row.artistId && <p className="note">Links you add fill in this artist's profile where it's empty. Existing links aren't changed.</p>}
        </div>
      )}
    </li>
  );
}

/* ---------- Promo video ---------- */

type VideoPhase = { kind: "idle" } | { kind: "checking" } | { kind: "uploading"; progress: number } | { kind: "processing" } | { kind: "ready" } | { kind: "error"; message: string };

function VideoField({
  enabled,
  customerCode,
  value,
  onChange,
  error,
}: {
  enabled: boolean;
  customerCode: string | null;
  value: { uid: string; seconds: number | null } | null;
  onChange: (v: { uid: string; seconds: number | null } | null) => void;
  error?: string;
}) {
  const [phase, setPhase] = useState<VideoPhase>(value ? { kind: "processing" } : { kind: "idle" });
  const input = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Poll Stream until the video is ready to play.
  useEffect(() => {
    if (!value || !enabled || phase.kind !== "processing") return;
    let stop = false;
    let delay = 2000;
    const tick = async () => {
      try {
        const st = await api.videoStatus(value.uid);
        if (stop) return;
        if (st.state === "ready") return setPhase({ kind: "ready" });
        if (st.state === "error") {
          setPhase({ kind: "error", message: st.message ?? "That video couldn't be processed." });
          onChangeRef.current(null);
          return;
        }
      } catch {
        // Keep polling; status checks are cheap.
      }
      delay = Math.min(delay * 1.4, 10000);
      if (!stop) setTimeout(tick, delay);
    };
    tick();
    return () => {
      stop = true;
    };
  }, [value, enabled, phase.kind]);

  useEffect(() => () => abort.current?.abort(), []);

  async function take(file: File | undefined) {
    if (!file) return;
    if (input.current) input.current.value = "";
    setPhase({ kind: "checking" });
    try {
      if (file.size > VIDEO_MAX_BYTES) throw new MediaError("That file is over 200 MB. Export it smaller and try again.");
      const seconds = await videoDuration(file);
      if (seconds > VIDEO_MAX_SECONDS + 0.5) throw new MediaError(`That video is ${formatDuration(seconds)}. Promo videos can be up to 1:30.`);
      const { uploadURL, uid } = await api.videoUploadUrl(seconds, file.size);
      abort.current = new AbortController();
      setPhase({ kind: "uploading", progress: 0 });
      await uploadToStream(uploadURL, file, (p) => setPhase({ kind: "uploading", progress: p }), abort.current.signal);
      onChange({ uid, seconds });
      setPhase({ kind: "processing" });
    } catch (err) {
      if ((err as DOMException)?.name === "AbortError") return setPhase({ kind: "idle" });
      setPhase({ kind: "error", message: err instanceof MediaError || err instanceof ApiError ? err.message : "Couldn't upload that video." });
    }
  }

  if (!enabled) {
    return <p className="note">Video uploads aren't set up on this server yet. You can add one later by editing the event.</p>;
  }

  return (
    <div className={`field ${phase.kind === "error" || error ? "has-error" : ""}`}>
      {value && phase.kind === "ready" && (
        <div className="video-frame">
          <iframe src={videoPlayerUrl(value.uid, customerCode)} title="Promo video" allow="accelerometer; gyroscope; encrypted-media; picture-in-picture" allowFullScreen loading="lazy" />
        </div>
      )}
      {phase.kind === "uploading" && (
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(phase.progress * 100)}>
          <span style={{ width: `${phase.progress * 100}%` }} />
          <em className="num">Uploading {Math.round(phase.progress * 100)}%</em>
        </div>
      )}
      {phase.kind === "checking" && <p className="note">Checking the video…</p>}
      {phase.kind === "processing" && value && <p className="note">Uploaded. Processing so it plays everywhere; you can post now.</p>}
      <div className="inline-actions">
        {phase.kind === "uploading" ? (
          <Button type="button" size="sm" variant="ghost" onClick={() => abort.current?.abort()}>
            Stop upload
          </Button>
        ) : (
          <Button type="button" size="sm" onClick={() => input.current?.click()} disabled={phase.kind === "checking"}>
            {value ? "Replace video" : "Choose video"}
          </Button>
        )}
        {value && phase.kind !== "uploading" && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              onChange(null);
              setPhase({ kind: "idle" });
            }}
          >
            Remove
          </Button>
        )}
        <span className="dim note">Up to 1:30 and 200 MB. MP4 or MOV.</span>
        <input ref={input} type="file" accept="video/mp4,video/quicktime,video/webm,video/*" hidden onChange={(e) => take(e.target.files?.[0])} />
      </div>
      {(phase.kind === "error" || error) && <span className="field-error">{phase.kind === "error" ? phase.message : error}</span>}
    </div>
  );
}
