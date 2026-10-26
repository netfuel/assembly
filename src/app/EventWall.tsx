import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button, Label, Skeleton, Tag } from "../components/ui";
import { ago } from "../lib/time";
import { api, ApiError, postWallPhoto } from "../lib/api";
import { MediaError, preparePhoto } from "../lib/media";
import type { EventSummary, MeProfile, WallPost, WallState } from "../../shared/types";

const REPORT_REASONS: { id: string; label: string }[] = [
  { id: "remove-me", label: "I'm in this photo and want it down" },
  { id: "minor", label: "Shows someone under age" },
  { id: "nudity", label: "Nudity" },
  { id: "drugs", label: "Shows drug use" },
  { id: "private-area", label: "Taken somewhere private (bathroom, backstage)" },
  { id: "harassment", label: "Harassment or mocking someone" },
  { id: "other", label: "Something else" },
];


/**
 * The event wall: photos from people who checked in, newest first. People who RSVP'd see everything;
 * everyone else sees the host's highlights. New photos arrive while the event is on.
 */
export function EventWall({
  event: e,
  me,
  checkedIn,
  onNeedSignIn,
  toast,
}: {
  event: EventSummary;
  me: MeProfile | null;
  /** Bumps when you check in, so the Post button appears without a reload. */
  checkedIn: boolean;
  onNeedSignIn: () => void;
  toast: (msg: string) => void;
}) {
  const [wall, setWall] = useState<WallState | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [pending, setPending] = useState<WallState | null>(null);
  const [viewing, setViewing] = useState<number | null>(null);
  const [composing, setComposing] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(
    () =>
      api
        .wall(e.id)
        .then((w) => {
          setWall(w);
          setFailed(null);
          setPending(null);
        })
        .catch((err) => setFailed(err instanceof ApiError ? err.message : "Couldn't load the wall.")),
    [e.id],
  );
  useEffect(() => {
    void load();
  }, [load, me?.id, checkedIn]);

  // While the event is on (and a little after), look for new photos every 30 seconds and offer them in a pill,
  // rather than shifting the grid under someone's thumb.
  useEffect(() => {
    const end = Date.parse(e.endsAt) + 3600e3;
    if (Date.now() > end || Date.now() < Date.parse(e.startsAt) - 3600e3) return;
    const t = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      api
        .wall(e.id)
        .then((w) => setPending((cur) => (wall && w.posts.some((p) => !wall.posts.some((q) => q.id === p.id)) ? w : cur)))
        .catch(() => undefined);
    }, 30000);
    return () => clearInterval(t);
  }, [e.id, e.startsAt, e.endsAt, wall]);

  if (failed) return null; // Not set up on this server yet, or offline: the rest of the page still works.
  if (!wall)
    return (
      <section className="wall" aria-label="Wall" data-reveal>
        <Label glyph="▦">Wall</Label>
        <div className="wall-grid" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="wall-skel" w="100%" h="auto" />
          ))}
        </div>
      </section>
    );

  if (wall.photoFree)
    return (
      <section className="wall" aria-label="Wall" data-reveal>
        <Label glyph="▦">Wall</Label>
        <p className="note">This night is photo-free, so there's no wall. Phones down, eyes up.</p>
      </section>
    );

  const newCount = pending ? pending.posts.filter((p) => !wall.posts.some((q) => q.id === p.id)).length : 0;
  const hostToggle = wall.viewerIsHost && (
    <label className="wall-toggle">
      <input
        type="checkbox"
        checked={wall.enabled}
        onChange={async (ev) => {
          try {
            setWall(await api.setWallEnabled(e.id, ev.target.checked));
          } catch (err) {
            toast(err instanceof ApiError ? err.message : "Couldn't change the wall.");
          }
        }}
      />
      Wall on
    </label>
  );

  // Before doors with nothing posted, the wall stays out of the way.
  if (!wall.posts.length && !wall.canPost && !wall.viewerIsHost && wall.view === "all" && Date.now() < Date.parse(e.startsAt) - 30 * 60e3) return null;

  return (
    <section className="wall" aria-label="Wall" data-reveal>
      <div className="wall-head">
        <Label glyph="▦">
          Wall {wall.posts.length > 0 && <span className="num dim">{wall.posts.length}</span>}
        </Label>
        <span className="spacer" />
        {hostToggle}
        {wall.canPost && (
          <Button size="sm" variant="solid" onClick={() => fileInput.current?.click()}>
            + Post a photo
          </Button>
        )}
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          hidden
          onChange={(ev) => {
            const f = ev.target.files?.[0];
            ev.target.value = "";
            if (f) setComposing(f);
          }}
        />
      </div>

      {!wall.enabled && <p className="note">{wall.viewerIsHost ? "The wall is off. Nobody can post or see it until you turn it back on." : "The host turned the wall off."}</p>}

      {wall.enabled && (
        <>
          {newCount > 0 && (
            <button className="wall-pill" onClick={() => pending && (setWall(pending), setPending(null))}>
              ↑ {newCount} new photo{newCount === 1 ? "" : "s"}
            </button>
          )}
          {wall.posts.length > 0 ? (
            <ul className="wall-grid">
              {wall.posts.map((post, i) => (
                <li key={post.id}>
                  <button className={`wall-tile ${post.status === "hidden" ? "is-hidden" : ""}`} onClick={() => setViewing(i)} aria-label={post.caption ? `Photo: ${post.caption}` : "Photo"}>
                    <img src={post.thumbUrl} alt="" loading="lazy" decoding="async" />
                    {post.highlight && (
                      <span className="wall-badge" aria-hidden="true">
                        ★
                      </span>
                    )}
                    {post.status === "hidden" && <span className="wall-hidden-tag">Hidden</span>}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="note">{wall.canPost ? "Nothing yet. Be the first to post the room." : wall.view === "all" ? "Nothing posted yet." : "No highlights yet."}</p>
          )}
          {wall.view === "highlights" && wall.hiddenCount > 0 && (
            <p className="note">
              {wall.hiddenCount} more photo{wall.hiddenCount === 1 ? " is" : "s are"} for people who RSVP'd.{" "}
              {!me && (
                <button className="link" onClick={onNeedSignIn}>
                  Sign in →
                </button>
              )}
            </p>
          )}
          {!wall.canPost && wall.postNote && me && <p className="note wall-post-note">{wall.postNote}</p>}
        </>
      )}

      {composing && (
        <WallComposer
          file={composing}
          eventId={e.id}
          onClose={() => setComposing(null)}
          onPosted={(w) => {
            setWall(w);
            setComposing(null);
            toast("Posted to the wall.");
          }}
        />
      )}
      {viewing !== null && wall.posts[viewing] && (
        <WallViewer
          posts={wall.posts}
          index={viewing}
          isHost={wall.viewerIsHost}
          me={me}
          onIndex={setViewing}
          onClose={() => setViewing(null)}
          onChanged={(fn) => setWall((w) => (w ? { ...w, posts: fn(w.posts) } : w))}
          toast={toast}
        />
      )}
    </section>
  );
}

function WallComposer({ file, eventId, onClose, onPosted }: { file: File; eventId: string; onClose: () => void; onPosted: (w: WallState) => void }) {
  const [prepared, setPrepared] = useState<Awaited<ReturnType<typeof preparePhoto>> | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let url: string | null = null;
    preparePhoto(file)
      .then((p) => {
        setPrepared(p);
        url = URL.createObjectURL(p.blob);
        setPreview(url);
      })
      .catch((err) => setError(err instanceof MediaError ? err.message : "Couldn't read that photo."));
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [file]);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape" && progress === null) {
        ev.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, progress]);

  async function post() {
    if (!prepared) return;
    setError(null);
    setProgress(0);
    try {
      onPosted(await postWallPhoto(eventId, prepared, caption, anonymous, setProgress));
    } catch (err) {
      setProgress(null);
      setError(err instanceof ApiError ? err.message : "Couldn't post that photo. Try again.");
    }
  }

  return createPortal(
    <div className="wall-modal" role="dialog" aria-modal="true" aria-label="Post a photo">
      <form
        className="wall-composer"
        onSubmit={(ev) => {
          ev.preventDefault();
          void post();
        }}
      >
        <Label glyph="▦">Post to the wall</Label>
        <div className="wall-preview">{preview ? <img src={preview} alt="Your photo" /> : <Skeleton w="100%" h="100%" />}</div>
        <label className="field">
          <span className="field-label">Caption (optional)</span>
          <input value={caption} onChange={(ev) => setCaption(ev.target.value.slice(0, 200))} maxLength={200} placeholder="Who's on, what's the room like" />
        </label>
        <label className="wall-anon">
          <input type="checkbox" checked={anonymous} onChange={(ev) => setAnonymous(ev.target.checked)} />
          Post without my name
        </label>
        <p className="note wall-rules">
          Ask before you post someone's face. No nudity, drug use, private areas, or anyone under age. Anyone in your photo can ask to take it down.
          Location and camera details are removed before it leaves your phone.
        </p>
        {error && <p className="field-error">{error}</p>}
        {progress !== null && (
          <div className="wall-progress" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
            <span style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        )}
        <div className="wall-composer-actions">
          <Button type="button" variant="ghost" onClick={onClose} disabled={progress !== null}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="lg" disabled={!prepared || progress !== null}>
            {progress !== null ? "Posting…" : "Post"}
          </Button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

function WallViewer({
  posts,
  index,
  isHost,
  me,
  onIndex,
  onClose,
  onChanged,
  toast,
}: {
  posts: WallPost[];
  index: number;
  isHost: boolean;
  me: MeProfile | null;
  onIndex: (i: number) => void;
  onClose: () => void;
  onChanged: (fn: (posts: WallPost[]) => WallPost[]) => void;
  toast: (msg: string) => void;
}) {
  const post = posts[index];
  const [reporting, setReporting] = useState(false);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const go = useCallback((d: number) => onIndex(Math.max(0, Math.min(posts.length - 1, index + d))), [index, posts.length, onIndex]);

  useEffect(() => {
    closeBtn.current?.focus();
  }, []);
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.stopPropagation();
        onClose();
      } else if (ev.key === "ArrowRight") go(1);
      else if (ev.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [go, onClose]);
  useEffect(() => setReporting(false), [index]);

  async function remove() {
    try {
      await api.removeWallPost(post.id);
      onChanged((list) => list.filter((p) => p.id !== post.id));
      toast("Removed from the wall.");
      if (posts.length <= 1) onClose();
      else if (index >= posts.length - 1) onIndex(index - 1);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Couldn't remove it.");
    }
  }
  async function highlight() {
    try {
      await api.setHighlight(post.id, !post.highlight);
      onChanged((list) => list.map((p) => (p.id === post.id ? { ...p, highlight: !post.highlight } : p)));
      toast(post.highlight ? "No longer a highlight." : "Highlighted. Anyone with the link can see it now.");
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Couldn't change that.");
    }
  }
  async function report(reason: string) {
    try {
      const r = await api.reportWallPost(post.id, reason);
      setReporting(false);
      if (r.hidden) {
        onChanged((list) => list.filter((p) => p.id !== post.id));
        if (posts.length <= 1) onClose();
        else if (index >= posts.length - 1) onIndex(index - 1);
      }
      toast(reason === "remove-me" ? "It's down while we take a look. Thanks for telling us." : "Thanks. We'll take a look.");
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Couldn't send that report.");
    }
  }

  return createPortal(
    <div className="wall-viewer" role="dialog" aria-modal="true" aria-label="Wall photo">
      <div
        className="wall-viewer-stage"
        onTouchStart={(ev) => (touch.current = { x: ev.touches[0].clientX, y: ev.touches[0].clientY })}
        onTouchEnd={(ev) => {
          const t = touch.current;
          touch.current = null;
          if (!t) return;
          const dx = ev.changedTouches[0].clientX - t.x;
          const dy = ev.changedTouches[0].clientY - t.y;
          if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1);
          else if (dy > 90 && Math.abs(dy) > Math.abs(dx)) onClose();
        }}
        onClick={(ev) => ev.target === ev.currentTarget && onClose()}
      >
        <img key={post.id} src={post.url} alt={post.caption ?? "Wall photo"} />
        {index > 0 && (
          <button className="wall-nav wall-prev" onClick={() => go(-1)} aria-label="Previous photo">
            ‹
          </button>
        )}
        {index < posts.length - 1 && (
          <button className="wall-nav wall-next" onClick={() => go(1)} aria-label="Next photo">
            ›
          </button>
        )}
      </div>
      <div className="wall-viewer-bar">
        <div className="wall-viewer-info">
          {post.caption && <p className="wall-caption">{post.caption}</p>}
          <p className="wall-byline">
            {post.author ? post.author.displayName : "Someone in the room"}
            {post.mine && post.anonymous && " (posted without your name)"} · {ago(post.createdAt)} · <span className="num">{index + 1}/{posts.length}</span>
            {post.highlight && <Tag tone="accent">Highlight</Tag>}
            {post.status === "hidden" && <Tag>Hidden pending review</Tag>}
          </p>
        </div>
        <div className="wall-viewer-actions">
          {isHost && post.status !== "hidden" && (
            <Button size="sm" onClick={highlight}>
              {post.highlight ? "Unhighlight" : "★ Highlight"}
            </Button>
          )}
          {(post.mine || isHost) && (
            <Button size="sm" onClick={remove}>
              Remove
            </Button>
          )}
          {!post.mine && me && (
            <Button size="sm" variant="ghost" onClick={() => setReporting((r) => !r)} aria-expanded={reporting}>
              Report
            </Button>
          )}
          <Button ref={closeBtn} size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
        {reporting && (
          <ul className="wall-report">
            {REPORT_REASONS.map((r) => (
              <li key={r.id}>
                <button onClick={() => report(r.id)}>{r.label}</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>,
    document.body,
  );
}
