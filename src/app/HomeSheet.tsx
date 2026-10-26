import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { currentY, setY, slideTo, stopMotion } from "../lib/motion";

export type Detent = "peek" | "half" | "full";

/** Phones: a bottom sheet with three heights. Wide screens: a left panel that always shows the list. */
export function useWide() {
  const q = "(min-width: 900px)";
  const [wide, setWide] = useState(() => typeof window !== "undefined" && window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setWide(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return wide;
}

const TOP_GAP = 84; // the quiet top bar stays visible above the full sheet
function heights(vh: number) {
  return { peek: 148, half: Math.round(Math.min(440, Math.max(340, vh * 0.5))), full: vh - TOP_GAP };
}
const yFor = (d: Detent, vh: number) => vh - heights(vh)[d];

/**
 * The home sheet, like a maps app: drag the header (or the content, from its top) between peek, half, and full.
 * Peek shows the search row; half shows tonight's cards; full is the feed. A flick goes one step in its direction.
 */
export function HomeSheet({
  detent,
  onDetent,
  header,
  peekExtra,
  half,
  full,
  floating,
  hidden = false,
}: {
  detent: Detent;
  onDetent: (d: Detent) => void;
  /** Search, date, and Filters: always visible. */
  header: ReactNode;
  /** Shown under the header in half (friends tonight). */
  peekExtra?: ReactNode;
  /** The card rail, in peek and half. */
  half: ReactNode;
  /** The feed, in full (and always on wide screens). */
  full: ReactNode;
  /** Controls that ride just above the sheet's top edge (locate). */
  floating?: ReactNode;
  /** An event sheet is open over it. */
  hidden?: boolean;
}) {
  const wide = useWide();
  const el = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const [headH, setHeadH] = useState(120);
  useLayoutEffect(() => {
    const h = head.current;
    if (!h) return;
    const ro = new ResizeObserver(() => setHeadH(h.getBoundingClientRect().height));
    ro.observe(h);
    return () => ro.disconnect();
  }, []);
  const [vh, setVh] = useState(() => (typeof window !== "undefined" ? window.innerHeight : 800));
  const drag = useRef<{ startY: number; startSheet: number; lastY: number; lastT: number; v: number; active: boolean; fromBody: boolean } | null>(null);

  useEffect(() => {
    const on = () => setVh(window.innerHeight);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);

  // If the sheet goes away mid-slide, stop the tween.
  useEffect(() => {
    const node = el.current;
    return () => stopMotion(node);
  }, []);

  // Place the sheet without animation on first paint and on resize; animate on detent changes.
  const first = useRef(true);
  useLayoutEffect(() => {
    const node = el.current;
    if (!node || wide) return;
    const y = yFor(detent, vh);
    if (first.current) {
      setY(node, y);
      first.current = false;
    } else slideTo(node, y);
  }, [detent, vh, wide]);

  // Drags. Native listeners so a drag that starts on the content can stop it scrolling (React's are passive).
  useEffect(() => {
    const node = el.current;
    if (!node || wide) return;
    const ys = () => (["peek", "half", "full"] as Detent[]).map((d) => [d, yFor(d, vh)] as const);
    const nearest = (y: number, v: number): Detent => {
      const list = ys();
      const cur = list.reduce((a, b) => (Math.abs(b[1] - y) < Math.abs(a[1] - y) ? b : a));
      // A clear flick moves one step in its direction from where the drag began.
      if (Math.abs(v) > 600 && drag.current) {
        const startIdx = list.findIndex((d) => d[0] === detent);
        const idx = Math.max(0, Math.min(2, startIdx + (v < 0 ? 1 : -1)));
        return list[idx][0];
      }
      return cur[0];
    };
    const start = (y: number, target: EventTarget | null) => {
      const t = target as HTMLElement | null;
      if (t?.closest("input, textarea, select, .date-menu")) return;
      const inBody = !!t?.closest(".home-sheet-body");
      // In the feed, the content scrolls; it hands off to the sheet only when it's already at the top.
      if (inBody && detent === "full" && (body.current?.scrollTop ?? 0) > 0) return;
      drag.current = { startY: y, startSheet: currentY(node), lastY: y, lastT: performance.now(), v: 0, active: false, fromBody: inBody };
    };
    const move = (y: number, x0: number, x1: number, ev: Event) => {
      const d = drag.current;
      if (!d) return;
      const dy = y - d.startY;
      if (!d.active) {
        if (Math.abs(dy) < 8) return;
        // Sideways swipes on the card rail stay with the rail.
        if (Math.abs(x1 - x0) > Math.abs(dy)) {
          drag.current = null;
          return;
        }
        // From the feed content, only a pull down takes the sheet.
        if (d.fromBody && detent === "full" && dy < 0) {
          drag.current = null;
          return;
        }
        d.active = true;
      }
      ev.preventDefault();
      const now = performance.now();
      d.v = ((y - d.lastY) / Math.max(1, now - d.lastT)) * 1000;
      d.lastY = y;
      d.lastT = now;
      const min = yFor("full", vh);
      const max = yFor("peek", vh);
      let next = d.startSheet + dy;
      // Rubber band past the ends.
      if (next < min) next = min - (min - next) * 0.25;
      if (next > max) next = max + (next - max) * 0.25;
      setY(node, next);
    };
    const end = () => {
      const d = drag.current;
      drag.current = null;
      if (!d?.active) return;
      const target = nearest(currentY(node), d.v);
      if (target === detent) slideTo(node, yFor(target, vh), d.v);
      else onDetent(target);
    };
    let x0 = 0;
    const ts = (e: TouchEvent) => {
      x0 = e.touches[0].clientX;
      start(e.touches[0].clientY, e.target);
    };
    const tm = (e: TouchEvent) => move(e.touches[0].clientY, x0, e.touches[0].clientX, e);
    const pd = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || !(e.target as HTMLElement).closest(".home-sheet-grab, .home-sheet-head")) return;
      x0 = e.clientX;
      start(e.clientY, e.target);
    };
    const pm = (e: PointerEvent) => e.pointerType === "mouse" && move(e.clientY, x0, e.clientX, e);
    const pu = (e: PointerEvent) => e.pointerType === "mouse" && end();
    node.addEventListener("touchstart", ts, { passive: true });
    node.addEventListener("touchmove", tm, { passive: false });
    node.addEventListener("touchend", end);
    node.addEventListener("touchcancel", end);
    node.addEventListener("pointerdown", pd);
    window.addEventListener("pointermove", pm);
    window.addEventListener("pointerup", pu);
    return () => {
      node.removeEventListener("touchstart", ts);
      node.removeEventListener("touchmove", tm);
      node.removeEventListener("touchend", end);
      node.removeEventListener("touchcancel", end);
      node.removeEventListener("pointerdown", pd);
      window.removeEventListener("pointermove", pm);
      window.removeEventListener("pointerup", pu);
    };
  }, [detent, vh, wide, onDetent]);

  const showFull = wide || detent === "full";
  return (
    <section
      ref={el}
      className={`home-sheet is-${wide ? "panel" : detent} ${hidden ? "is-hidden" : ""}`}
      aria-label="Events"
      style={wide ? undefined : { height: vh }}
    >
      {!wide && floating && <div className={`home-sheet-float ${detent === "full" ? "is-gone" : ""}`}>{floating}</div>}
      <div ref={head} className="home-sheet-head">
        {!wide && (
          <button
            type="button"
            className="home-sheet-grab"
            aria-label={detent === "full" ? "Show the map" : "Show the list"}
            onClick={() => onDetent(detent === "full" ? "half" : "full")}
          >
            <span aria-hidden="true" />
          </button>
        )}
        {header}
      </div>
      <div ref={body} className="home-sheet-body" style={wide ? undefined : { height: Math.max(0, heights(vh)[detent] - headH) }}>
        {showFull ? (
          full
        ) : (
          <>
            {peekExtra}
            {half}
          </>
        )}
      </div>
    </section>
  );
}
