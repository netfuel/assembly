import { useCallback, useEffect, useState } from "react";
import { Button, Label, Tag, Skeleton } from "../components/ui";
import { api, ApiError, type ModWallItem } from "../lib/api";
import { clock, dayLabel } from "../lib/time";
import { VarsityMark } from "./EventSheet";
import type { ModItem, PageClaim } from "../../shared/types";

const REASON_LABELS: Record<string, string> = {
  unsafe: "Unsafe",
  hateful: "Hateful",
  spam: "Spam",
  "wrong-info": "Wrong info",
  impersonation: "Impersonation",
  wrong: "Wrong details",
  other: "Other",
};

/** "spam: they posted 5 times" → { reason: "spam", note: "they posted 5 times" } */
function splitReason(r: string) {
  const i = r.indexOf(": ");
  return i === -1 ? { reason: r, note: null } : { reason: r.slice(0, i), note: r.slice(i + 2) };
}

export function ModerationSheet({
  tz,
  onOpenEvent,
  onOpenPage,
  toast,
}: {
  tz: string;
  onOpenEvent: (id: string) => void;
  onOpenPage: (kind: "artist" | "venue", slug: string) => void;
  toast: (m: string) => void;
}) {
  const [items, setItems] = useState<ModItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .modQueue()
      .then((list) => {
        setItems(list);
        setError(null);
      })
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : "Couldn't load the queue."));
  }, []);
  useEffect(load, [load]);
  const [stats, setStats] = useState<Record<string, number> | null>(null);
  useEffect(() => {
    api.modStats().then(setStats).catch(() => undefined);
  }, [items]);

  async function act(key: string, fn: () => Promise<unknown>, done: string) {
    setBusy(key);
    try {
      await fn();
      toast(done);
      load();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "That didn't go through. Try again.");
    } finally {
      setBusy(null);
    }
  }

  const now = new Date();
  return (
    <div className="mod">
      <div className="stack" data-reveal>
        <Label glyph="!">Review</Label>
        <h1 className="sheet-title">Reports.</h1>
        <p className="note serif-text">New organizers' first events wait here for approval. Events with three reports are hidden until someone here restores or removes them. Reports on people never hide anything on their own.</p>
      </div>
      {stats && (
        <section className="mod-stats" aria-label="Launch numbers" data-reveal>
          <Stat label="Events posted, 7 days" value={stats.events_week} target={25} />
          <Stat label="Active organizers, 30 days" value={stats.organizers_month} target={40} />
          <Stat label="New members, 7 days" value={stats.members_week} />
          <Stat label="RSVPs, 7 days" value={stats.rsvps_week} />
          <Stat label="Upcoming events" value={stats.upcoming} />
          <Stat label="Members" value={stats.members} />
        </section>
      )}
      {error && <p className="note">{error}</p>}
      {!items && !error && (
        <div className="skel-list" role="status" aria-label="Loading the queue">
          {[0, 1, 2].map((i) => (
            <div key={i} className="mod-skel">
              <Skeleton w={`${65 - i * 10}%`} h={16} />
              <Skeleton w="40%" h={10} />
              <span className="mod-skel-actions">
                <Skeleton w={72} h={28} />
                <Skeleton w={72} h={28} />
              </span>
            </div>
          ))}
        </div>
      )}
      {items && items.length === 0 && <p className="note">Nothing to review. The queue is clear.</p>}
      {items && items.length > 0 && (
        <ul className="mod-list">
          {items.map((it) => {
            const key = `${it.type}:${it.id}`;
            const counts = new Map<string, number>();
            const notes: string[] = [];
            for (const r of it.reasons) {
              const { reason, note } = splitReason(r);
              counts.set(reason, (counts.get(reason) ?? 0) + 1);
              if (note) notes.push(note);
            }
            return (
              <li key={key} className="mod-item">
                <div className="mod-head">
                  <Tag tone="strong">{it.type === "event" ? "Event" : it.type === "page" ? (it.kind === "artist" ? "Artist page" : "Venue page") : "Person"}</Tag>
                  {it.type === "event" && it.status !== "live" && <Tag tone={it.status === "hidden" ? "accent" : "default"}>{it.status === "hidden" ? "Hidden" : it.status === "draft" ? "First post: needs review" : it.status === "cancelled" ? "Cancelled" : it.status}</Tag>}
                  {it.reasons.length > 0 && (
                    <span className="dim num">
                      {it.reasons.length} report{it.reasons.length === 1 ? "" : "s"}
                    </span>
                  )}
                </div>
                <p className="mod-title">{it.title}</p>
                <p className="note">
                  {it.type === "event" ? (
                    <>
                      {dayLabel(it.startsAt, now, tz)} / {clock(it.startsAt, tz)}
                      {it.host && (
                        <>
                          {" "}
                          · by {it.host.displayName} {it.host.verified && <VarsityMark />}
                        </>
                      )}
                    </>
                  ) : it.type === "page" ? (
                    <>{it.claimed ? "Claimed by its owner" : "Not claimed"}</>
                  ) : (
                    <>
                      Hosts {it.hosted} event{it.hosted === 1 ? "" : "s"} {it.verified && <VarsityMark />}
                    </>
                  )}
                </p>
                {counts.size > 0 && (
                  <div className="mod-reasons">
                    {[...counts].map(([r, n]) => (
                      <Tag key={r}>
                        {REASON_LABELS[r] ?? r}
                        {n > 1 ? ` ×${n}` : ""}
                      </Tag>
                    ))}
                  </div>
                )}
                {notes.length > 0 && (
                  <ul className="mod-notes">
                    {notes.slice(0, 5).map((n, i) => (
                      <li key={i}>"{n}"</li>
                    ))}
                  </ul>
                )}
                <div className="inline-actions">
                  {it.type === "event" ? (
                    <>
                      <Button size="sm" onClick={() => onOpenEvent(it.id)}>
                        Open
                      </Button>
                      {it.status === "draft" && (
                        <>
                          <Button size="sm" variant="primary" disabled={busy === key} onClick={() => act(key, () => api.modEvent(it.id, "approve"), "Approved. It's on the map.")}>
                            Approve
                          </Button>
                          <Button size="sm" disabled={busy === key} onClick={() => act(key, () => api.modEvent(it.id, "reject"), "Rejected.")}>
                            Reject
                          </Button>
                        </>
                      )}
                      {it.status === "hidden" && (
                        <Button size="sm" disabled={busy === key} onClick={() => act(key, () => api.modEvent(it.id, "restore"), "Restored to the map.")}>
                          Restore
                        </Button>
                      )}
                      {it.status !== "draft" && (
                        <Button size="sm" disabled={busy === key} onClick={() => act(key, () => api.modEvent(it.id, "remove"), "Removed from the map.")}>
                          Remove
                        </Button>
                      )}
                      {it.reasons.length > 0 && it.status !== "hidden" && (
                        <Button size="sm" variant="ghost" disabled={busy === key} onClick={() => act(key, () => api.modEvent(it.id, "dismiss"), "Reports dismissed.")}>
                          Dismiss
                        </Button>
                      )}
                    </>
                  ) : it.type === "page" ? (
                    <>
                      <Button size="sm" onClick={() => onOpenPage(it.kind, it.slug)}>
                        Open
                      </Button>
                      <Button size="sm" disabled={busy === key} onClick={() => act(key, () => api.modPage(it.kind, it.id, "clear"), "Cleared: bio, photo, links and owner.")}>
                        Clear page
                      </Button>
                      <Button size="sm" variant="ghost" disabled={busy === key} onClick={() => act(key, () => api.modPage(it.kind, it.id, "dismiss"), "Reports dismissed.")}>
                        Dismiss
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button size="sm" disabled={busy === key} onClick={() => act(key, () => api.modUser(it.id, "hide-events"), "Their events are off the map.")}>
                        Hide their events
                      </Button>
                      <Button size="sm" variant="ghost" disabled={busy === key} onClick={() => act(key, () => api.modUser(it.id, "dismiss"), "Reports dismissed.")}>
                        Dismiss
                      </Button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <ClaimQueue onOpenPage={onOpenPage} toast={toast} />
      <WallQueue onOpenEvent={onOpenEvent} toast={toast} />
    </div>
  );
}

/** One number, with the PRD target when there is one. */
function Stat({ label, value, target }: { label: string; value: number; target?: number }) {
  const met = target !== undefined && value >= target;
  return (
    <div className={`stat ${met ? "is-met" : ""}`}>
      <span className="stat-value num">{value}</span>
      <span className="stat-label">{label}</span>
      {target !== undefined && <span className="stat-target num">{met ? "Target met" : `Target ${target}+`}</span>}
    </div>
  );
}

/** Artists and venues asking to own their page. Approve makes them the owner; their message says how to check. */
function ClaimQueue({ onOpenPage, toast }: { onOpenPage: (kind: "artist" | "venue", slug: string) => void; toast: (m: string) => void }) {
  const [claims, setClaims] = useState<PageClaim[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => {
    api.modClaims().then(setClaims).catch(() => setClaims(null));
  }, []);
  useEffect(load, [load]);
  if (!claims) return null;
  const decide = async (id: string, action: "approve" | "decline") => {
    setBusy(id);
    try {
      await api.decideClaim(id, action);
      toast(action === "approve" ? "Approved. They can edit the page now." : "Declined.");
      load();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "That didn't go through.");
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="stack" aria-label="Page claims">
      <Label glyph="◇">Page claims</Label>
      {claims.length === 0 && <p className="note">No one is waiting to claim a page.</p>}
      <ul className="mod-list">
        {claims.map((cl) => (
          <li key={cl.id} className="mod-item">
            <div className="mod-head">
              <Tag tone="strong">{cl.kind === "artist" ? "Artist" : "Venue"}</Tag>
            </div>
            <p className="mod-title">{cl.name}</p>
            <p className="note">
              {cl.user.displayName}
              {cl.user.email && <span className="dim"> · {cl.user.email}</span>}
            </p>
            <ul className="mod-notes">
              <li>"{cl.message}"</li>
            </ul>
            <div className="inline-actions">
              <Button size="sm" onClick={() => onOpenPage(cl.kind, cl.slug)}>
                Open page
              </Button>
              <Button size="sm" variant="primary" disabled={busy === cl.id} onClick={() => decide(cl.id, "approve")}>
                Approve
              </Button>
              <Button size="sm" disabled={busy === cl.id} onClick={() => decide(cl.id, "decline")}>
                Decline
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

const WALL_REASONS: Record<string, string> = {
  "remove-me": "Someone in it asked",
  minor: "Under age",
  nudity: "Nudity",
  drugs: "Drug use",
  "private-area": "Private area",
  harassment: "Harassment",
  other: "Other",
};

/** Wall photos that were reported or hidden. Restore puts one back; Remove deletes the image. */
function WallQueue({ onOpenEvent, toast }: { onOpenEvent: (id: string) => void; toast: (m: string) => void }) {
  const [items, setItems] = useState<ModWallItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(() => {
    api
      .modWall()
      .then(setItems)
      .catch(() => setFailed(true));
  }, []);
  useEffect(load, [load]);
  if (failed || !items) return null;
  return (
    <section className="stack" aria-label="Wall photos">
      <Label glyph="▦">Wall photos</Label>
      {items.length === 0 && <p className="note">No reported photos.</p>}
      <ul className="mod-wall">
        {items.map((it) => (
          <li key={it.id} className="mod-wall-item">
            <img src={it.thumbUrl} alt="" loading="lazy" />
            <div className="stack">
              <button className="link" onClick={() => onOpenEvent(it.eventId)}>
                {it.eventTitle}
              </button>
              <span className="note">
                {it.author}
                {it.anonymous && " (posted without name)"}
                {it.caption && ` · “${it.caption}”`}
              </span>
              <span className="tags">
                {it.status === "hidden" && <Tag>Hidden</Tag>}
                {it.reasons.map((r, i) => (
                  <Tag key={i} tone={r === "remove-me" || r === "minor" ? "accent" : "default"}>
                    {WALL_REASONS[r] ?? r}
                  </Tag>
                ))}
              </span>
              <span className="inline-actions">
                <Button
                  size="sm"
                  onClick={async () => {
                    try {
                      await api.modWallAction(it.id, "restore");
                      toast("Restored to the wall.");
                      load();
                    } catch (err) {
                      toast(err instanceof ApiError ? err.message : "That didn't go through.");
                    }
                  }}
                >
                  Restore
                </Button>
                <Button
                  size="sm"
                  onClick={async () => {
                    try {
                      await api.modWallAction(it.id, "remove");
                      toast("Removed and deleted.");
                      load();
                    } catch (err) {
                      toast(err instanceof ApiError ? err.message : "That didn't go through.");
                    }
                  }}
                >
                  Remove
                </Button>
              </span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
