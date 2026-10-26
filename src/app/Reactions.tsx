import { useEffect, useRef, useState, type ReactElement } from "react";
import { api, ApiError } from "../lib/api";
import { pop } from "../lib/motion";
import { REACTIONS, type ReactionKind, type Reactions as ReactionState } from "../../shared/types";

/** Monoline icons in currentColor, so they sit with the rest of the type instead of as colour emoji. */
const ICON: Record<Exclude<ReactionKind, "see-you">, ReactElement> = {
  heart: <path d="M10 16.5S3 12.3 3 7.6A3.6 3.6 0 0 1 10 6a3.6 3.6 0 0 1 7 1.6c0 4.7-7 8.9-7 8.9Z" />,
  fire: <path d="M10 18c-3.3 0-5.5-2.3-5.5-5.3 0-2.2 1.2-3.9 2.5-5.2.2 1.3.8 2.3 1.8 2.8C8.4 7.5 9.6 4.4 12 2.5c.1 2.6 1.3 4 2.5 5.6 1 1.3 1.5 2.8 1.5 4.6 0 3-2.7 5.3-6 5.3Z" />,
  smiley: (
    <>
      <circle cx="10" cy="10" r="7" />
      <path d="M7 11.6c.7 1.2 1.8 1.8 3 1.8s2.3-.6 3-1.8M7.6 8h.01M12.4 8h.01" />
    </>
  ),
  rainbow: <path d="M2 15a8 8 0 0 1 16 0M5 15a5 5 0 0 1 10 0M8 15a2 2 0 0 1 4 0" />,
};

/**
 * Five reactions under the event title. Tap to add, tap again to take it back; the count moves at once and
 * settles to what the server says. Signed-out taps go to sign-in.
 */
export function ReactionBar({
  eventId,
  initial,
  signedIn,
  onNeedSignIn,
  toast,
}: {
  eventId: string;
  initial: ReactionState;
  signedIn: boolean;
  onNeedSignIn: () => void;
  toast: (m: string) => void;
}) {
  const [state, setState] = useState(initial);
  const pending = useRef(0);
  const buttons = useRef<Partial<Record<ReactionKind, HTMLButtonElement | null>>>({});
  // A fresh load of the event replaces local state, unless a tap is still in flight.
  useEffect(() => {
    if (!pending.current) setState(initial);
  }, [initial]);

  const toggle = (kind: ReactionKind) => {
    if (!signedIn) return onNeedSignIn();
    const on = !state.mine.includes(kind);
    const before = state;
    setState({
      counts: { ...state.counts, [kind]: Math.max(0, (state.counts[kind] ?? 0) + (on ? 1 : -1)) },
      mine: on ? [...state.mine, kind] : state.mine.filter((k) => k !== kind),
    });
    if (on) pop(buttons.current[kind]?.firstElementChild ?? null);
    pending.current++;
    api
      .react(eventId, kind, on)
      .then((r) => {
        if (pending.current === 1) setState(r);
      })
      .catch((err) => {
        setState(before);
        toast(err instanceof ApiError ? err.message : "That didn't go through. Try again.");
      })
      .finally(() => pending.current--);
  };

  const button = (id: ReactionKind, label: string) => {
    const n = state.counts[id] ?? 0;
    const mine = state.mine.includes(id);
    return (
      <button
        ref={(el) => {
          buttons.current[id] = el;
        }}
        className={`reaction ${mine ? "is-mine" : ""} ${id === "see-you" ? "is-text" : ""} ${id === "heart" || id === "fire" ? "is-solid" : ""}`}
        aria-pressed={mine}
        aria-label={`${label}${n ? `, ${n}` : ""}`}
        onClick={() => toggle(id)}
      >
        {id === "see-you" ? (
          <span className="reaction-text">See you there</span>
        ) : (
          <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            {ICON[id]}
          </svg>
        )}
        {n > 0 && <span className="reaction-count num">{n}</span>}
      </button>
    );
  };

  // Four icons as one joined strip, then "See you there" on its own: it can drop to a second line on narrow phones.
  return (
    <div className="reactions" role="group" aria-label="Reactions">
      <div className="reaction-strip">{REACTIONS.filter((r) => r.id !== "see-you").map((r) => <span key={r.id}>{button(r.id, r.label)}</span>)}</div>
      {button("see-you", "See you there")}
    </div>
  );
}
