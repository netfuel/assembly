import { useEffect, useRef, useState } from "react";
import { Button, Chip, Label, Segmented, Tag, Skeleton } from "../components/ui";
import { api, ApiError } from "../lib/api";
import { MediaError, prepareAvatar } from "../lib/media";
import { clock, dayLabel } from "../lib/time";
import { SCENES, type BlockedPerson, type FriendsState, type Inbox, type InboxItem, type MeProfile, type MyEvent, type ServerConfig } from "../../shared/types";
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
  friends,
  onFriends,
  onOpenPage,
  inbox,
  onInboxSeen,
  config,
  toast,
}: {
  /** Notifications: built on the server from what happened (requests, invites, changes, friends out). */
  inbox: Inbox | null;
  onInboxSeen: () => void;
  onOpenPage: (p: { kind: "artist" | "venue"; slug: string }) => void;
  /** Null when friends aren't available on this server yet. */
  friends: FriendsState | null;
  onFriends: () => void;
  config: ServerConfig;
  me: MeProfile;
  onModerate: () => void;
  tz: string;
  onChange: (me: MeProfile) => void;
  onSignedOut: (message: string) => void;
  onOpenEvent: (id: string, section?: "comments") => void;
  onAnnounce: () => void;
  toast: (m: string) => void;
}) {
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [mine, setMine] = useState<{ hosting: MyEvent[]; going: MyEvent[] } | null>(null);
  // Opens on Notifications when something's new, otherwise on Saved.
  const [tab, setTab] = useState<"saved" | "inbox" | "profile">(() => ((inbox?.unread ?? 0) > 0 ? "inbox" : "saved"));
  const unread = inbox?.unread ?? 0;
  useEffect(() => {
    if (tab === "inbox" && unread > 0) onInboxSeen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

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
  const going = mine?.going.filter((e) => e.rsvp !== "interested") ?? [];
  const saved = mine?.going.filter((e) => e.rsvp === "interested") ?? [];
  return (
    <>
      <div className="you-head" data-reveal>
        <Avatar user={me} size={40} />
        <span className="you-name">{me.displayName}</span>
      </div>
      <Segmented
        label="You"
        value={tab}
        onChange={setTab}
        options={[
          { id: "saved", label: "Saved" },
          { id: "inbox", label: unread ? `Notifications ${unread}` : "Notifications" },
          { id: "profile", label: "Profile" },
        ]}
      />

      {tab === "saved" && (
        <>
          <section className="stack" aria-label="Going">
            <Label glyph="✓">Going</Label>
            {!mine && <ListSkeleton />}
            {mine && going.length === 0 && <p className="note">Nothing yet. RSVP to a night and it shows up here, saved on this phone for the door.</p>}
            {going.length > 0 && <MyList items={going} tz={tz} onOpen={onOpenEvent} />}
          </section>
          {saved.length > 0 && (
            <section className="stack" aria-label="Saved for later">
              <Label glyph="◇">Saved for later</Label>
              <MyList items={saved} tz={tz} onOpen={onOpenEvent} />
            </section>
          )}
      {friends && (
        <section className="stack" aria-label="Friends">
          <Label glyph="◎">Friends</Label>
          <button className="profile-row" onClick={onFriends}>
            <span>
              {!friends.me.friendsOn
                ? "See which nights your friends are going to"
                : friends.friends.length
                  ? `${friends.friends.length} friend${friends.friends.length === 1 ? "" : "s"}${friends.me.username ? ` · @${friends.me.username}` : ""}`
                  : "Invite your first friend"}
            </span>
            {friends.incoming.length + friends.invites.filter((i) => !i.seen).length > 0 && (
              <Tag tone="accent">{friends.incoming.length + friends.invites.filter((i) => !i.seen).length} new</Tag>
            )}
            <span aria-hidden="true">→</span>
          </button>
        </section>
      )}

          <section className="stack" aria-label="Hosting">
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
        </>
      )}

      {tab === "inbox" && (
        <>
          <InboxList inbox={inbox} tz={tz} onOpenEvent={onOpenEvent} onFriends={onFriends} onOpenPage={onOpenPage} />
      {config.push && (
        <section className="stack" aria-label="Notifications">
          <Label glyph="◉">Notifications</Label>
          <PushControl config={config} toast={toast} />
        </section>
      )}

        </>
      )}

      {tab === "profile" && (
        <>
          {(me.verified || me.pronouns) && (
            <p className="note">
              {me.verified && (
                <span className="verified">
                  <VarsityMark /> Verified
                </span>
              )}{" "}
              {me.pronouns}
            </p>
          )}
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

      <MutedList toast={toast} />

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
      )}
    </>
  );
}

function ListSkeleton() {
  return (
    <div className="skel-list" role="status" aria-label="Loading">
      <Skeleton w="70%" h={14} />
      <Skeleton w="50%" h={14} />
    </div>
  );
}

const INBOX_GLYPH: Record<InboxItem["kind"], string> = {
  "friend-request": "◎",
  invite: "→",
  cancelled: "×",
  updated: "↻",
  "starting-soon": "◷",
  "friend-here": "●",
  claim: "◇",
  reply: "↳",
  comment: "❝",
};

/** Notifications, newest first. Tapping one goes where it's about. */
function InboxList({
  inbox,
  tz,
  onOpenEvent,
  onFriends,
  onOpenPage,
}: {
  inbox: Inbox | null;
  tz: string;
  onOpenEvent: (id: string, section?: "comments") => void;
  onFriends: () => void;
  onOpenPage: (p: { kind: "artist" | "venue"; slug: string }) => void;
}) {
  // What was unread when the tab opened stays marked while you look.
  const [seenBefore] = useState(() => (inbox ? inbox.items.slice(0, inbox.unread).map((i) => i.id) : []));
  if (!inbox) return <ListSkeleton />;
  if (!inbox.items.length) return <p className="note">Nothing new. Friend requests, invites, and changes to nights you're going to show up here.</p>;
  const now = new Date();
  const go = (t: InboxItem["target"]) => {
    if (!t) return;
    if (t.type === "event") onOpenEvent(t.id, t.section);
    else if (t.type === "friends") onFriends();
    else onOpenPage({ kind: t.kind, slug: t.slug });
  };
  return (
    <ul className="inbox" aria-label="Notifications">
      {inbox.items.map((i) => (
        <li key={i.id}>
          <button className={`inbox-item ${seenBefore.includes(i.id) ? "is-new" : ""} is-${i.kind}`} onClick={() => go(i.target)} disabled={!i.target}>
            {i.person ? (
              <Avatar user={i.person} size={32} />
            ) : (
              <span className="inbox-glyph" aria-hidden="true">
                {INBOX_GLYPH[i.kind]}
              </span>
            )}
            <span className="inbox-text">
              <span className="inbox-title">{i.title}</span>
              <span className="inbox-body">{i.body}</span>
            </span>
            <span className="inbox-when num">{dayLabel(i.at, now, tz) === "Tonight" ? clock(i.at, tz) : dayLabel(i.at, now, tz)}</span>
          </button>
        </li>
      ))}
    </ul>
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
            {e.venue_name && <span className="my-venue">{e.venue_name}</span>}
            <span className="my-when num">
              {dayLabel(e.starts_at, now, tz)} / {clock(e.starts_at, tz)}
            </span>
            {e.status === "cancelled" ? <Tag tone="danger">Cancelled</Tag> : e.status === "hidden" ? <Tag>Hidden</Tag> : e.status === "draft" ? <Tag>In review</Tag> : null}
          </button>
          {e.ticket_url && e.status !== "cancelled" && (
            <a className="my-tickets" href={e.ticket_url} target="_blank" rel="noopener noreferrer">
              Tickets ↗
            </a>
          )}
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

/** People you muted or blocked from comments, folded until you open it. Unmute or unblock from here. */
function MutedList({ toast }: { toast: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const [people, setPeople] = useState<BlockedPerson[] | null>(null);
  useEffect(() => {
    if (!open || people) return;
    api
      .blocks()
      .then(setPeople)
      .catch(() => setPeople([]));
  }, [open, people]);
  return (
    <section className="muted-list" aria-label="Muted and blocked" data-reveal>
      <button className="muted-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span>Muted and blocked</span>
        <span className="dim">{open ? "Hide" : "Show"}</span>
      </button>
      {open && !people && <ListSkeleton />}
      {open && people && people.length === 0 && <p className="note">Nobody. Mute or block someone from the ⋯ on their comment.</p>}
      {open && people && people.length > 0 && (
        <ul className="muted-people">
          {people.map((p) => (
            <li key={p.id}>
              <Avatar user={p} size={32} />
              <span className="muted-name">
                {p.displayName}
                <span className="dim"> · {p.kind === "mute" ? "muted" : "blocked"}</span>
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  try {
                    await api.unblock(p.id);
                    setPeople((list) => (list ?? []).filter((x) => x.id !== p.id));
                    toast(p.kind === "mute" ? `Unmuted ${p.displayName}.` : `Unblocked ${p.displayName}.`);
                  } catch (err) {
                    toast(err instanceof ApiError ? err.message : "That didn't go through.");
                  }
                }}
              >
                {p.kind === "mute" ? "Unmute" : "Unblock"}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
