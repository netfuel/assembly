import { useEffect, useMemo, useRef } from "react";
import { artFallback, artParams } from "../lib/flyerArt";
import { registerArt } from "../lib/liquidRenderer";
import { reducedMotion } from "../lib/motion";

/**
 * Generated flyer for an event without uploaded art: seeded pixel liquid (lib/flyerArt.ts, drawn by
 * lib/liquidRenderer.ts), plus the title, date, and venue set like a flyer and a small "Gen" mark so it never
 * passes for the organizer's own flyer. Animates while on screen; a still frame under reduced motion and for
 * thumbnails. Without WebGL, a halftone in the event's middle ink.
 */
export function GeneratedArt({
  id,
  title,
  when,
  venue,
  compact = false,
  className = "",
}: {
  id: string;
  title?: string;
  /** Already formatted in the city's timezone, e.g. "Sat Oct 31 / 9 PM". */
  when?: string;
  venue?: string | null;
  /** Art only, no type, no motion (thumbnails). */
  compact?: boolean;
  className?: string;
}) {
  const params = useMemo(() => artParams(id), [id]);
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = host.current;
    const cv = canvas.current;
    if (!el || !cv) return;
    const art = registerArt(cv, params, compact || reducedMotion());
    if (!art.supported()) {
      el.dataset.fallback = "true";
      return art.dispose;
    }
    const size = () => {
      const { width, height } = el.getBoundingClientRect();
      const w = Math.max(1, Math.ceil(width / params.pixel));
      const h = Math.max(1, Math.ceil(height / params.pixel));
      if (cv.width !== w || cv.height !== h) {
        cv.width = w;
        cv.height = h;
        art.resized();
      }
    };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(el);
    const io = new IntersectionObserver(([e]) => art.setVisible(e.isIntersecting), { rootMargin: "100px" });
    io.observe(el);
    return () => {
      ro.disconnect();
      io.disconnect();
      art.dispose();
    };
  }, [params, compact]);

  return (
    <div
      ref={host}
      className={`gen-art ${compact ? "is-compact" : ""} ${className}`}
      style={{ ["--gen-fallback" as string]: artFallback(params) }}
    >
      <canvas ref={canvas} className="gen-canvas" aria-hidden="true" />
      {!compact && (
        <>
          <span className="gen-mark num" title="Generated art: this event has no flyer yet">
            Gen {params.number}
          </span>
          {title && (
            <div className="flyer-type">
              {when && <span className="gen-when num">{when}</span>}
              <span className="flyer-type-title">{title}</span>
              {venue && <span className="flyer-type-sub">{venue}</span>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
