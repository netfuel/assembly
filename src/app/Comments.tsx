import { useEffect, useRef, useState } from "react";
import { Button, Skeleton, Tag } from "../components/ui";
import { api, ApiError } from "../lib/api";
import { ago } from "../lib/time";
import { Avatar } from "./ProfileSheet";
import { COMMENT_MAX, COMMENT_REPORT_REASONS, type CommentThread, type EventComment, type MeProfile } from "../../shared/types";

/**
 * Comments on the event page: pinned first, then oldest to newest, replies one level deep under their comment.
 * Anyone signed in can comment. Authors, hosts and moderators can remove; hosts can pin one; anyone can report.
 */
export function Comments({
  eventId,
  me,
  onNeedSignIn,
  toast,
  onCount,
}: {
  eventId: string;
  me: MeProfile | null;
  tz: string;
  onNeedSignIn: () => void;
  toast: (m: string) => void;
  /** Live comments, for the section's summary row. */
  onCount: (n: number) => void;
}) {
  const [thread, setThread] = useState<CommentThread | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<EventComment | null>(null);

  const apply = (t: CommentThread) => {
    setThread(t);
    onCount(t.comments.filter((c) => c.status === "live").length);
  };

  useEffect(() => {
    let gone = false;
    api
      .comments(eventId)
      .then((t) => !gone && apply(t))
      .catch((err) => !gone && setError(err instanceof ApiError ? err.message : "Comments didn't load. Pull to refresh."));
    return () => {
      gone = true;
    };
    // apply is stable enough: it only calls setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, me?.id]);

  if (error) return <p className="note">{error}</p>;
  if (!thread)
    return (
      <div className="skel-list" role="status" aria-label="Loading comments">
        {[0, 1].map((i) => (
          <div key={i} className="comment-skel">
            <Skeleton w={32} h={32} />
            <span className="skel-stack">
              <Skeleton w="30%" h={10} />
              <Skeleton w={`${80 - i * 20}%`} h={14} />
            </span>
          </div>
        ))}
      </div>
    );

  const top = thread.comments.filter((c) => !c.parentId);
  const ordered = [...top.filter((c) => c.pinned), ...top.filter((c) => !c.pinned)];
  const repliesTo = (id: string) => thread.comments.filter((c) => c.parentId === id);

  const run = async (p: Promise<CommentThread>, done?: string) => {
    try {
      apply(await p);
      if (done) toast(done);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "That didn't go through. Try again.");
    }
  };
  const actions = {
    reply: (c: EventComment) => (me ? setReplyTo(c) : onNeedSignIn()),
    remove: (c: EventComment) => run(api.removeComment(c.id), "Comment removed."),
    pin: (c: EventComment) => run(api.pinComment(c.id, !c.pinned), c.pinned ? "Unpinned." : "Pinned to the top."),
  };

  return (
    <div className="comments">
      {ordered.length === 0 && <p className="note">No comments yet. Ask the host a question, or say you're coming.</p>}
      {ordered.length > 0 && (
        <ol className="comment-list" aria-label="Comments">
          {ordered.map((c) => (
            <li key={c.id}>
              <CommentItem c={c} me={me} canModerate={thread.canModerate} actions={actions} onNeedSignIn={onNeedSignIn} toast={toast} />
              {repliesTo(c.id).length > 0 && (
                <ol className="comment-replies" aria-label={`Replies to ${c.author?.displayName ?? "a removed comment"}`}>
                  {repliesTo(c.id).map((r) => (
                    <li key={r.id}>
                      <CommentItem c={r} me={me} canModerate={thread.canModerate} actions={actions} onNeedSignIn={onNeedSignIn} toast={toast} />
                    </li>
                  ))}
                </ol>
              )}
              {replyTo?.id === c.id && (
                <Composer
                  eventId={eventId}
                  parent={c}
                  onCancel={() => setReplyTo(null)}
                  onPosted={(t) => {
                    apply(t);
                    setReplyTo(null);
                  }}
                  toast={toast}
                />
              )}
            </li>
          ))}
        </ol>
      )}
      {thread.canComment ? (
        <Composer eventId={eventId} parent={null} onPosted={apply} toast={toast} />
      ) : !me ? (
        <Button className="comment-signin" onClick={onNeedSignIn}>
          Sign in to comment
        </Button>
      ) : (
        thread.note && <p className="note">{thread.note}</p>
      )}
    </div>
  );
}

type Actions = { reply: (c: EventComment) => void; remove: (c: EventComment) => void; pin: (c: EventComment) => void };

function CommentItem({
  c,
  me,
  canModerate,
  actions,
  onNeedSignIn,
  toast,
}: {
  c: EventComment;
  me: MeProfile | null;
  canModerate: boolean;
  actions: Actions;
  onNeedSignIn: () => void;
  toast: (m: string) => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reported, setReported] = useState(false);
  const [more, setMore] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  if (c.status === "removed")
    return (
      <article className="comment is-removed">
        <p className="comment-body dim">Comment removed.</p>
      </article>
    );
  const a = c.author!;
  const hasMore = (canModerate && !c.parentId && c.status === "live") || c.canDelete || (!c.mine && !reported);
  // Two taps to remove, so a stray thumb doesn't delete anything (and no browser dialog).
  const remove = () => {
    if (confirm) return actions.remove(c);
    setConfirm(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setConfirm(false), 3000);
  };
  return (
    <article className={`comment ${c.pinned ? "is-pinned" : ""} ${c.status === "hidden" ? "is-hidden" : ""}`}>
      <Avatar user={a} size={32} />
      <div className="comment-main">
        <p className="comment-head">
          <span className="comment-name">{a.displayName}</span>
          {c.host && <Tag tone="strong">Host</Tag>}
          {c.verified && !c.host && <Tag>Verified</Tag>}
          <span className="comment-time num">{ago(c.createdAt)}</span>
        </p>
        {c.pinned && <p className="comment-flag">Pinned by the host</p>}
        {c.status === "hidden" && <p className="comment-flag is-warn">Hidden after reports. Only you{canModerate ? " and staff" : ""} can see it while we review.</p>}
        <p className="comment-body">{c.body}</p>
        {/* Reply stays in view; pin, remove and report sit behind More so each comment carries one action. */}
        <div className="comment-actions">
          {c.status === "live" && (
            <button className="comment-action" onClick={() => actions.reply(c)}>
              Reply
            </button>
          )}
          {more && canModerate && !c.parentId && c.status === "live" && (
            <button className="comment-action" onClick={() => actions.pin(c)}>
              {c.pinned ? "Unpin" : "Pin to top"}
            </button>
          )}
          {more && c.canDelete && (
            <button className={`comment-action ${confirm ? "is-danger" : ""}`} onClick={remove}>
              {confirm ? "Tap again to remove" : "Remove"}
            </button>
          )}
          {more && !c.mine && !reported && (
            <button className="comment-action" onClick={() => (me ? setReporting((r) => !r) : onNeedSignIn())} aria-expanded={reporting}>
              Report
            </button>
          )}
          {reported && <span className="comment-action-note">Reported. Thanks.</span>}
          {hasMore && (
            <button className="comment-action comment-more" aria-expanded={more} aria-label={more ? "Fewer actions" : "More actions"} onClick={() => setMore((m) => !m)}>
              {more ? "×" : "⋯"}
            </button>
          )}
        </div>
        {reporting && (
          <ReportComment
            id={c.id}
            onDone={() => {
              setReporting(false);
              setReported(true);
            }}
            onCancel={() => setReporting(false)}
            toast={toast}
          />
        )}
      </div>
    </article>
  );
}

function ReportComment({ id, onDone, onCancel, toast }: { id: string; onDone: () => void; onCancel: () => void; toast: (m: string) => void }) {
  const [reason, setReason] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="comment-report" role="group" aria-label="Report this comment">
      <div className="report-reasons" role="radiogroup" aria-label="Reason">
        {COMMENT_REPORT_REASONS.map((r) => (
          <button key={r.id} type="button" role="radio" aria-checked={reason === r.id} className="chip" aria-pressed={reason === r.id} onClick={() => setReason(r.id)}>
            {r.label}
          </button>
        ))}
      </div>
      <div className="report-actions">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Never mind
        </Button>
        <Button
          size="sm"
          disabled={!reason || busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api.reportComment(id, reason!, "");
              onDone();
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
      <p className="note">Reports are private. The person doesn't see who sent them.</p>
    </div>
  );
}

function Composer({
  eventId,
  parent,
  onPosted,
  onCancel,
  toast,
}: {
  eventId: string;
  parent: EventComment | null;
  onPosted: (t: CommentThread) => void;
  onCancel?: () => void;
  toast: (m: string) => void;
}) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (parent) field.current?.focus();
  }, [parent]);
  const left = COMMENT_MAX - body.length;
  const send = async () => {
    const v = body.trim();
    if (!v || busy) return;
    setBusy(true);
    try {
      const r = await api.comment(eventId, v, parent?.id ?? null);
      setBody("");
      onPosted(r.thread);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Your comment didn't post. Try again.");
    } finally {
      setBusy(false);
    }
  };
  const label = parent ? `Reply to ${parent.author?.displayName ?? "this comment"}` : "Add a comment";
  return (
    <form
      className={`comment-compose ${parent ? "is-reply" : ""}`}
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <textarea
        ref={field}
        rows={2}
        value={body}
        maxLength={COMMENT_MAX}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
          if (e.key === "Escape" && onCancel) onCancel();
        }}
        placeholder={parent ? "Write a reply" : "Ask a question, or say you're coming"}
        aria-label={label}
      />
      <div className="comment-compose-row">
        {left <= 80 ? <span className={`comment-left num ${left <= 0 ? "is-over" : ""}`}>{left} left</span> : <span />}
        <span className="comment-compose-actions">
          {onCancel && (
            <Button size="sm" variant="ghost" type="button" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button size="sm" type="submit" disabled={!body.trim() || busy}>
            {parent ? "Reply" : "Post"}
          </Button>
        </span>
      </div>
    </form>
  );
}
