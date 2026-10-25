import { useEffect, useRef, useState } from "react";
import { Button, Chip, Label, Tag, Skeleton } from "../components/ui";
import { api, ApiError } from "../lib/api";
import { MediaError, prepareAvatar } from "../lib/media";
import { clock, dayLabel } from "../lib/time";
import { SCENES, type MeProfile, type MyEvent, type ServerConfig } from "../../shared/types";
import { PushControl } from "../components/PushControl";
import { VarsityMark } from "./EventSheet";
import "./announce.css";

const LINKS: { key: string; label: string; placeholder: string }[] = [
  { key: "instagram", label: "Instagram", placeholder: "instagram.com/you" },
  { key: "soundcloud", label: "SoundCloud", placeholder: "soundcloud.com/you" },
  { key: "bandcamp", label: "Bandcamp", placeholder: "you.bandcamp.com" },
  { key: "mixcloud", label: "Mixcloud", placeholder: "mixcloud.com/you" },
  { key: "ra", label: "RA", placeholder: "ra.co/dj/you" },
  { key: "spotify", label: "Spotify", placeholder: "open.spotify.com/artist/…" },
  { key: "site", label: "Website", placeholder: "you.com" },
];

export function Avatar({ user, size = 56 }: { user: Pick<MeProfile, "displayName" | "avatarUrl">; size?: number }) {
  return (
    <span className="avatar-lg" style={{ width: size, height: size, fontSize: size * 0.42 }} aria-hidden="true">
      {user.avatarUrl ? <img src={user.avatarUrl} alt="" referrerPolicy="no-referrer" /> : user.displayName.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function ProfileSheet({
  me,
  tz,
  onChange,
  onSignedOut,
  onOpenEvent,
  onAnnounce,
  onModerate,
  config,
  toast,
}: {
  config: ServerConfig;
  me: MeProfile;
  onModerate: () => void;
  tz: string;
  onChange: (me: MeProfile) => void;
  onSignedOut: (message: string) => void;
  onOpenEvent: (id: string) => void;
  onAnnounce: () => void;
  toast: (m: string) => void;
}) {
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [mine, setMine] = useState<{ hosting: MyEvent[]; going: MyEvent[] } | null>(null);

  useEffect(() => {
    api.myEvents().then(setMine).catch(() => setMine({ hosting: [], going: [] }));
  }, []);

  if (mode === "edit") {
    return (
      <EditProfile
        me={me}
        onCancel={() => setMode("view")}
        onSaved={(u) => {
          onChange(u);
          setMode("view");
          toast("Profile saved.");
        }}
        onPhoto={onChange}
        onDeleted={() => onSignedOut("Your account is deleted.")}
        toast={toast}
      />
    );
  }

  const links = LINKS.filter((l) => me.links[l.key as keyof typeof me.links]);
  return (
    <>
      <div className="profile-head" data-reveal>
        <Avatar user={me} size={64} />
        <div className="stack">
          <Label glyph="◇">Profile</Label>
          <h1 className="sheet-title">
            {me.displayName}
            {me.verified && (
              <span className="verified">
                <VarsityMark /> Verified
              </span>
            )}
          </h1>
          {me.pronouns && <p className="note">{me.pronouns}</p>}
        </div>
      </div>
      {me.bio && (
        <p className="serif-text profile-bio" data-reveal>
          {me.bio}
        </p>
      )}
      {(links.length > 0 || me.scenes.length > 0) && (
        <div className="profile-meta" data-reveal>
          {me.scenes.map((s) => (
            <Tag key={s}>{SCENES.find((x) => x.id === s)?.label ?? s}</Tag>
          ))}
          {links.map((l) => (
            <a key={l.key} href={me.links[l.key as keyof typeof me.links]} target="_blank" rel="noopener noreferrer">
              {l.label} ↗
            </a>
          ))}
        </div>
      )}
      <div className="inline-actions" data-reveal>
        <Button size="sm" onClick={() => setMode("edit")}>
          Edit profile
        </Button>
        {me.moderator && (
          <Button size="sm" onClick={onModerate}>
            Review reports
          </Button>
        )}
        <span className="note">{me.showAttendance ? "You show up on who's going lists." : "Your RSVPs are private."}</span>
      </div>

      {config.push && (
        <section className="stack" data-reveal aria-label="Notifications">
          <Label glyph="◉">Notifications</Label>
          <PushControl config={config} toast={toast} />
        </section>
      )}

      <section className="stack" data-reveal aria-label="Going">
        <Label glyph="✓">Going</Label>
        {!mine && (
          <div className="skel-list" role="status" aria-label="Loading">
            <Skeleton w="70%" h={14} />
            <Skeleton w="50%" h={14} />
          </div>
        )}
        {mine && mine.going.length === 0 && <p className="note">Nothing yet. RSVP to a night and it shows up here.</p>}
        {mine && mine.going.length > 0 && <MyList items={mine.going} tz={tz} onOpen={onOpenEvent} />}
      </section>
      <section className="stack" data-reveal aria-label="Hosting">
        <Label glyph="▶">Hosting</Label>
        {!mine && (
          <div className="skel-list" role="status" aria-label="Loading">
            <Skeleton w="70%" h={14} />
            <Skeleton w="50%" h={14} />
          </div>
        )}
        {mine && mine.hosting.length === 0 && (
          <p className="note">
            You haven't posted anything.{" "}
            <button className="link" onClick={onAnnounce}>
              Make an announcement →
            </button>
          </p>
        )}
        {mine && mine.hosting.length > 0 && <MyList items={mine.hosting} tz={tz} onOpen={onOpenEvent} />}
      </section>
      <p className="note policy-links" data-reveal>
        <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a> · <a href="/guidelines">Community guidelines</a> ·{" "}
        <a href="mailto:hello@assembly.rsvp">Contact</a>
      </p>
      <Button
        data-reveal
        onClick={async () => {
          await api.logout().catch(() => undefined);
          onSignedOut("Signed out.");
        }}
      >
        Sign out
      </Button>
    </>
  );
}

function MyList({ items, tz, onOpen }: { items: MyEvent[]; tz: string; onOpen: (id: string) => void }) {
  const now = new Date();
  return (
    <ul className="my-list">
      {items.map((e) => (
        <li key={e.id}>
          <button onClick={() => onOpen(e.id)}>
            <span className="my-title">{e.title}</span>
            <span className="my-when num">
              {dayLabel(e.starts_at, now, tz)} / {clock(e.starts_at, tz)}
            </span>
            {e.status === "cancelled" ? <Tag>Cancelled</Tag> : e.status === "hidden" ? <Tag>Hidden</Tag> : e.status === "draft" ? <Tag>In review</Tag> : e.rsvp === "interested" ? <Tag>Interested</Tag> : null}
          </button>
        </li>
      ))}
    </ul>
  );
}

function EditProfile({
  me,
  onCancel,
  onSaved,
  onPhoto,
  onDeleted,
  toast,
}: {
  me: MeProfile;
  onCancel: () => void;
  onSaved: (u: MeProfile) => void;
  onPhoto: (u: MeProfile) => void;
  onDeleted: () => void;
  toast: (m: string) => void;
}) {
  const [name, setName] = useState(me.displayName);
  const [pronouns, setPronouns] = useState(me.pronouns ?? "");
  const [bio, setBio] = useState(me.bio ?? "");
  const [scenes, setScenes] = useState<string[]>(me.scenes);
  const [links, setLinks] = useState<Record<string, string>>({ ...(me.links as Record<string, string>) });
  const [show, setShow] = useState(me.showAttendance);
  const [avatar, setAvatar] = useState(me.avatarUrl);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<null | "save" | "photo" | "delete">(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteText, setDeleteText] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  async function photo(file: File | undefined) {
    if (!file) return;
    setBusy("photo");
    try {
      const u = await api.uploadAvatar(await prepareAvatar(file));
      setAvatar(u.avatarUrl);
      onPhoto(u); // Photo changes save right away.
    } catch (err) {
      toast(err instanceof MediaError || err instanceof ApiError ? err.message : "Couldn't upload that photo.");
    } finally {
      setBusy(null);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy("save");
    setErrors({});
    try {
      const u = await api.updateProfile({ displayName: name, pronouns, bio, scenes, links, showAttendance: show });
      onSaved(u);
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fields);
        if (!Object.keys(err.fields).length) toast(err.message);
      } else toast("Couldn't save. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function del() {
    setBusy("delete");
    try {
      await api.deleteAccount(deleteText);
      onDeleted();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Couldn't delete the account. Try again.");
      setBusy(null);
    }
  }

  return (
    <form className="compose profile-edit" onSubmit={save} noValidate>
      <div className="stack" data-reveal>
        <Label glyph="◇">Edit profile</Label>
        <h1 className="sheet-title">How you show up.</h1>
      </div>

      <div className="profile-photo" data-reveal>
        <Avatar user={{ displayName: name || me.displayName, avatarUrl: avatar }} size={72} />
        <div className="inline-actions">
          <Button type="button" size="sm" onClick={() => fileInput.current?.click()} disabled={busy === "photo"}>
            {busy === "photo" ? "Uploading…" : avatar ? "Change photo" : "Add photo"}
          </Button>
          {avatar && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={async () => {
                setBusy("photo");
                try {
                  const u = await api.removeAvatar();
                  setAvatar(u.avatarUrl);
                  onPhoto(u);
                } catch {
                  toast("Couldn't remove the photo.");
                } finally {
                  setBusy(null);
                }
              }}
            >
              Remove
            </Button>
          )}
          <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,image/heic" hidden onChange={(e) => photo(e.target.files?.[0])} />
        </div>
      </div>

      <div className="compose-fields" data-reveal>
        <label className={`field ${errors.displayName ? "has-error" : ""}`}>
          <span className="field-label">Name</span>
          <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} autoComplete="nickname" />
          {errors.displayName && <span className="field-error">{errors.displayName}</span>}
        </label>
        <label className="field">
          <span className="field-label">Pronouns</span>
          <input value={pronouns} maxLength={24} onChange={(e) => setPronouns(e.target.value)} placeholder="she/they" />
        </label>
        <label className="field">
          <span className="field-label">
            Bio <span className="field-count num">{bio.length}/280</span>
          </span>
          <textarea rows={3} value={bio} maxLength={280} onChange={(e) => setBio(e.target.value)} placeholder="Crews, residencies, what you're into." />
        </label>
        <div className="field">
          <span className="field-label">Scenes</span>
          <div className="chips">
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
        </div>
        <div className="field">
          <span className="field-label">Links</span>
          <div className="artist-links-edit profile-links">
            {LINKS.map((l) => (
              <label key={l.key} className={errors[`links.${l.key}`] ? "has-error" : ""}>
                <span>{l.label}</span>
                <input value={links[l.key] ?? ""} inputMode="url" placeholder={l.placeholder} onChange={(e) => setLinks((c) => ({ ...c, [l.key]: e.target.value }))} />
                {errors[`links.${l.key}`] && <em className="field-error">{errors[`links.${l.key}`]}</em>}
              </label>
            ))}
          </div>
        </div>
        <label className="toggle">
          <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
          <span>
            <strong>Show me on who's going lists</strong>
            <span className="field-hint">Off by default. When it's off, your RSVPs only count toward the number.</span>
          </span>
        </label>
      </div>

      <section className="danger" data-reveal>
        <Label glyph="!">Delete account</Label>
        {!confirmDelete ? (
          <p className="note">
            Removes your profile, RSVPs, photos, and events you host alone.{" "}
            <button type="button" className="link" onClick={() => setConfirmDelete(true)}>
              Delete my account…
            </button>
          </p>
        ) : (
          <div className="field">
            <span className="field-hint">This can't be undone. Type "delete" to confirm.</span>
            <div className="inline-actions">
              <input value={deleteText} onChange={(e) => setDeleteText(e.target.value)} aria-label='Type "delete" to confirm' autoComplete="off" />
              <Button type="button" size="sm" onClick={del} disabled={deleteText.trim().toLowerCase() !== "delete" || busy === "delete"}>
                {busy === "delete" ? "Deleting…" : "Delete forever"}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                Keep it
              </Button>
            </div>
          </div>
        )}
      </section>

      <footer className="compose-foot">
        <div className="compose-actions">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <span className="spacer" />
          <Button type="submit" variant="primary" size="lg" disabled={busy === "save"}>
            {busy === "save" ? "Saving…" : "Save profile"}
          </Button>
        </div>
      </footer>
    </form>
  );
}
