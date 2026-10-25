import { useCallback, useEffect, useState } from "react";
import { Button, Label, Tag } from "../components/ui";
import { api, ApiError } from "../lib/api";
import { clock, dayLabel } from "../lib/time";
import { VarsityMark } from "./EventSheet";
import type { ModItem } from "../../shared/types";

const REASON_LABELS: Record<string, string> = {
  unsafe: "Unsafe",
  hateful: "Hateful",
  spam: "Spam",
  "wrong-info": "Wrong info",
  impersonation: "Impersonation",
  other: "Other",
};

/** "spam: they posted 5 times" → { reason: "spam", note: "they posted 5 times" } */
function splitReason(r: string) {
  const i = r.indexOf(": ");
  return i === -1 ? { reason: r, note: null } : { reason: r.slice(0, i), note: r.slice(i + 2) };
}

export function ModerationSheet({ tz, onOpenEvent, toast }: { tz: string; onOpenEvent: (id: string) => void; toast: (m: string) => void }) {
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
                  <Tag tone="strong">{it.type === "event" ? "Event" : "Person"}</Tag>
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
