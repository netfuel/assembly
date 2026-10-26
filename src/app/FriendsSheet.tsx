import { useEffect, useState } from "react";
import { Button, Label, Segmented, Skeleton, Tag } from "../components/ui";
import { QrCode, smsHref } from "../components/ShareSheet";
import { api, ApiError } from "../lib/api";
import type { FriendPerson, FriendsState, UserRelation } from "../../shared/types";

export const inviteUrl = (token: string) => `${location.origin}/f/${token}`;

function Avatar({ p, size = 36 }: { p: { displayName: string; avatarUrl: string | null }; size?: number }) {
  return (
    <span className="friend-avatar" style={{ width: size, height: size }} aria-hidden="true">
      {p.avatarUrl ? <img src={p.avatarUrl} alt="" referrerPolicy="no-referrer" /> : p.displayName.slice(0, 1).toUpperCase()}
    </span>
  );
}
export { Avatar as FriendAvatar };

/**
 * Friends: the explainer and switch the first time, then your username, invite link, requests, friends, and blocks.
 * Friends see you only as "going" or "here now" at an event, never a location.
 */
export function FriendsSheet({ state, onState, toast }: { state: FriendsState | null; onState: (s: FriendsState) => void; toast: (m: string) => void }) {
  const [token, setToken] = useState<string | null>(null);
  const [username, setUsername] = useState(state?.me.username ?? "");
  const [nameError, setNameError] = useState<string | null>(null);
  const [lookup, setLookup] = useState("");
  const [found, setFound] = useState<{ person: FriendPerson; relation: UserRelation } | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [confirmBlock, setConfirmBlock] = useState<string | null>(null);
  const [def, setDef] = useState<"friends" | "me">(state?.me.presenceDefault ?? "friends");

  useEffect(() => {
    setUsername(state?.me.username ?? "");
    setDef(state?.me.presenceDefault ?? "friends");
  }, [state?.me.username, state?.me.presenceDefault]);
  useEffect(() => {
    if (state?.me.friendsOn) api.inviteToken().then((r) => setToken(r.token)).catch(() => undefined);
  }, [state?.me.friendsOn]);

  async function run(fn: () => Promise<FriendsState>, done?: string) {
    try {
      onState(await fn());
      if (done) toast(done);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "That didn't go through. Try again.");
    }
  }

  if (!state)
    return (
      <div className="small-sheet friends">
        <Skeleton w="60%" h={28} />
        <Skeleton w="100%" h={80} />
      </div>
    );

  // First time: say exactly who sees what, then let them choose.
  if (!state.me.friendsOn)
    return (
      <div className="small-sheet friends">
        <div className="stack" data-reveal>
          <Label glyph="◎">Friends</Label>
          <h1 className="sheet-title">See who's going.</h1>
        </div>
        <ul className="friends-explain" data-reveal>
          <li>
            <strong>Friends are mutual.</strong> You both say yes, by invite link or @username.
          </li>
          <li>
            <strong>They see events, never a location.</strong> Only "going" (you RSVP'd Going) or "here now" (you checked in), on the map, the feed, and the event page.
          </li>
          <li>
            <strong>You choose per night.</strong> Any event can be just for you, and you can hide yourself from one friend without removing them.
          </li>
          <li>
            <strong>Nobody sees your friend list.</strong> Not friends, not hosts, not the public.
          </li>
          <li>
            <strong>Off is one tap.</strong> Turning friends off hides you from everyone right away. You'll see friends only while yours is on.
          </li>
        </ul>
        <fieldset className="filter-group" data-reveal>
          <legend className="field-label">When you RSVP Going or check in</legend>
          <Segmented
            label="Default"
            options={[
              { id: "friends", label: "Friends see it" },
              { id: "me", label: "Only me" },
            ]}
            value={def}
            onChange={(v) => setDef(v as "friends" | "me")}
          />
          <p className="note">{def === "friends" ? "You can still hide any single night." : "You can still show any single night to friends."}</p>
        </fieldset>
        <Button size="lg" variant="primary" onClick={() => run(() => api.friendSettings(true, def), "Friends are on.")} data-reveal>
          Turn on friends
        </Button>
      </div>
    );

  const url = token ? inviteUrl(token) : "";
  const shareInvite = async () => {
    if (!url) return;
    try {
      if (navigator.share) await navigator.share({ title: "Add me on Assembly", text: "Add me on Assembly so we can see who's going out:", url });
      else {
        await navigator.clipboard.writeText(url);
        toast("Invite link copied.");
      }
    } catch {
      // Cancelled.
    }
  };

  return (
    <div className="small-sheet friends">
      <div className="stack" data-reveal>
        <Label glyph="◎">Friends</Label>
        <h1 className="sheet-title">Friends</h1>
      </div>

      {state.incoming.length > 0 && (
        <section className="stack" aria-label="Requests" data-reveal>
          <span className="field-label">Requests</span>
          <ul className="friend-list">
            {state.incoming.map((p) => (
              <li key={p.id}>
                <Avatar p={p} />
                <span className="friend-name">
                  {p.displayName}
                  {p.username && <span className="dim"> @{p.username}</span>}
                </span>
                <Button size="sm" variant="solid" onClick={() => run(() => api.acceptFriend(p.id), `You and ${p.displayName} are friends.`)}>
                  Accept
                </Button>
                <Button size="sm" variant="ghost" onClick={() => run(() => api.removeFriend(p.id))}>
                  Decline
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="stack friends-invite" aria-label="Invite" data-reveal>
        <span className="field-label">Your invite link</span>
        {url ? (
          <div className="friends-invite-row">
            <QrCode url={url} label="Your friend invite QR code" />
            <div className="stack">
              <p className="note">Anyone who opens this link and taps Add becomes your friend. Share it with people you trust.</p>
              <div className="inline-actions">
                <Button size="sm" variant="solid" onClick={shareInvite}>
                  Share link
                </Button>
                {/iphone|ipad|android/i.test(navigator.userAgent) && (
                  <a className="btn btn-default btn-sm" href={smsHref(`Add me on Assembly: ${url}`)}>
                    Text it
                  </a>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    try {
                      setToken((await api.inviteToken(true)).token);
                      toast("New link. The old one stopped working.");
                    } catch (err) {
                      toast(err instanceof ApiError ? err.message : "Couldn't make a new link.");
                    }
                  }}
                >
                  New link
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <Skeleton w="100%" h={96} />
        )}
      </section>

      <form
        className="stack"
        data-reveal
        onSubmit={async (ev) => {
          ev.preventDefault();
          setNameError(null);
          try {
            onState(await api.setUsername(username.trim() || null));
            toast(username.trim() ? `You're @${username.trim().replace(/^@/, "").toLowerCase()}.` : "Username removed.");
          } catch (err) {
            setNameError(err instanceof ApiError ? err.message : "Couldn't save that.");
          }
        }}
      >
        <label className={`field ${nameError ? "has-error" : ""}`}>
          <span className="field-label">Your username</span>
          <span className="username-field">
            <span className="dim">@</span>
            <input value={username.replace(/^@/, "")} onChange={(ev) => setUsername(ev.target.value)} maxLength={24} autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="choose one" />
            <Button type="submit" size="sm" disabled={(username.replace(/^@/, "").toLowerCase() || "") === (state.me.username ?? "")}>
              Save
            </Button>
          </span>
          {nameError ? <span className="field-error">{nameError}</span> : <span className="note">Friends can add you by it. Nobody can browse usernames.</span>}
        </label>
      </form>

      <form
        className="stack"
        data-reveal
        onSubmit={async (ev) => {
          ev.preventDefault();
          setLookupError(null);
          setFound(null);
          if (!lookup.trim()) return;
          try {
            setFound(await api.lookupUsername(lookup.trim()));
          } catch (err) {
            setLookupError(err instanceof ApiError ? err.message : "Couldn't look that up.");
          }
        }}
      >
        <label className="field">
          <span className="field-label">Add by username</span>
          <span className="username-field">
            <span className="dim">@</span>
            <input value={lookup} onChange={(ev) => setLookup(ev.target.value.replace(/^@/, ""))} autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="their username" />
            <Button type="submit" size="sm" disabled={!lookup.trim()}>
              Find
            </Button>
          </span>
        </label>
        {lookupError && <p className="field-error">{lookupError}</p>}
        {found && (
          <div className="friend-found">
            <Avatar p={found.person} />
            <span className="friend-name">
              {found.person.displayName} <span className="dim">@{found.person.username}</span>
            </span>
            {found.relation === "none" && (
              <Button size="sm" variant="solid" onClick={() => run(() => api.requestFriend(found.person.id), "Request sent.").then(() => setFound(null))}>
                Add friend
              </Button>
            )}
            {found.relation === "incoming" && (
              <Button size="sm" variant="solid" onClick={() => run(() => api.acceptFriend(found.person.id), "You're friends now.").then(() => setFound(null))}>
                Accept
              </Button>
            )}
            {found.relation === "outgoing" && <Tag>Requested</Tag>}
            {found.relation === "friends" && <Tag>Friends</Tag>}
            {found.relation === "self" && <Tag>That's you</Tag>}
          </div>
        )}
      </form>

      <section className="stack" aria-label="Your friends" data-reveal>
        <span className="field-label">
          Your friends <span className="num dim">{state.friends.length}</span>
        </span>
        {state.friends.length === 0 && <p className="note">No friends yet. Send your invite link to someone you go out with.</p>}
        <ul className="friend-list">
          {state.friends.map((p) => (
            <li key={p.id} className={confirmBlock === p.id ? "is-confirming" : ""}>
              <Avatar p={p} />
              <span className="friend-name">
                {p.displayName}
                {p.username && <span className="dim"> @{p.username}</span>}
                {p.hidden && <span className="friend-hidden">Can't see your nights</span>}
              </span>
              {confirmBlock === p.id ? (
                <>
                  <Button size="sm" onClick={() => run(() => api.blockUser(p.id), `Blocked. ${p.displayName} won't be told.`).then(() => setConfirmBlock(null))}>
                    Block
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmBlock(null)}>
                    Cancel
                  </Button>
                </>
              ) : (
                <details className="friend-menu">
                  <summary aria-label={`Options for ${p.displayName}`}>•••</summary>
                  <div className="friend-menu-items">
                    <button onClick={() => run(() => api.hideFromFriend(p.id, !p.hidden), p.hidden ? `${p.displayName} can see your nights again.` : `Hidden from ${p.displayName}.`)}>
                      {p.hidden ? "Let them see my nights" : "Hide my nights from them"}
                    </button>
                    <button onClick={() => run(() => api.removeFriend(p.id), "Removed. They won't be told.")}>Remove friend</button>
                    <button onClick={() => setConfirmBlock(p.id)}>Block…</button>
                  </div>
                </details>
              )}
            </li>
          ))}
        </ul>
      </section>

      {state.outgoing.length > 0 && (
        <section className="stack" aria-label="Sent requests" data-reveal>
          <span className="field-label">Sent</span>
          <ul className="friend-list">
            {state.outgoing.map((p) => (
              <li key={p.id}>
                <Avatar p={p} />
                <span className="friend-name">{p.displayName}</span>
                <Button size="sm" variant="ghost" onClick={() => run(() => api.removeFriend(p.id))}>
                  Cancel
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="stack" aria-label="Settings" data-reveal>
        <span className="field-label">When you RSVP Going or check in</span>
        <Segmented
          label="Default"
          options={[
            { id: "friends", label: "Friends see it" },
            { id: "me", label: "Only me" },
          ]}
          value={state.me.presenceDefault}
          onChange={(v) => run(() => api.friendSettings(true, v as "friends" | "me"), "Saved.")}
        />
        {state.blocked.length > 0 && (
          <details className="friends-blocked">
            <summary>Blocked ({state.blocked.length})</summary>
            <ul className="friend-list">
              {state.blocked.map((p) => (
                <li key={p.id}>
                  <Avatar p={p} />
                  <span className="friend-name">{p.displayName}</span>
                  <Button size="sm" variant="ghost" onClick={() => run(() => api.unblockUser(p.id), "Unblocked.")}>
                    Unblock
                  </Button>
                </li>
              ))}
            </ul>
          </details>
        )}
        <Button variant="ghost" onClick={() => run(() => api.friendSettings(false, state.me.presenceDefault), "Friends are off. Nobody sees your nights.")}>
          Turn friends off
        </Button>
      </section>
    </div>
  );
}

/** /f/<token>: someone's invite link. Shows who sent it and adds them with one tap. */
export function InviteSheet({
  token,
  signedIn,
  onNeedSignIn,
  onDone,
  toast,
}: {
  token: string;
  signedIn: boolean;
  onNeedSignIn: () => void;
  onDone: (s: FriendsState | null) => void;
  toast: (m: string) => void;
}) {
  const [data, setData] = useState<{ person: FriendPerson; relation: UserRelation } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api
      .invitePreview(token)
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : "This invite link doesn't work."));
  }, [token, signedIn]);

  return (
    <div className="small-sheet friends invite">
      <Label glyph="◎">Friend invite</Label>
      {error && <p className="note">{error}</p>}
      {!data && !error && <Skeleton w="70%" h={28} />}
      {data && (
        <>
          <div className="invite-person">
            <Avatar p={data.person} size={64} />
            <h1 className="sheet-title">{data.person.displayName}</h1>
            {data.person.username && <span className="dim">@{data.person.username}</span>}
          </div>
          <p className="note serif-text">wants to be friends on Assembly. Friends see which nights each other are going to, never a location.</p>
          {data.relation === "friends" ? (
            <Button size="lg" onClick={() => onDone(null)}>
              You're already friends
            </Button>
          ) : data.relation === "self" ? (
            <p className="note">This is your own link. Send it to a friend.</p>
          ) : (
            <Button
              size="lg"
              variant="primary"
              disabled={busy}
              onClick={async () => {
                if (!signedIn) return onNeedSignIn();
                setBusy(true);
                try {
                  const s = await api.acceptInvite(token);
                  toast(`You and ${data.person.displayName} are friends.`);
                  onDone(s);
                } catch (err) {
                  toast(err instanceof ApiError ? err.message : "Couldn't add them. Try again.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              {signedIn ? `Add ${data.person.displayName}` : "Sign in to add"}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
