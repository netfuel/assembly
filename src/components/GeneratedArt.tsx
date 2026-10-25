import { lazy, Suspense, useEffect, useMemo, useRef } from "react";
import { artNumber, artStyle, artSvg } from "../lib/flyerArt";
import { prefersReducedMotion } from "../lib/motion";

// three.js loads only for the "print" style on the event page.
const FlyerShader = lazy(() => import("./FlyerShader"));

/**
 * Generated flyer for an event without uploaded art: seeded artwork, plus the title, date, and venue
 * set like a flyer, and a small "Generated" mark so it never passes for the organizer's own flyer.
 * Animates only while on screen; still under reduced motion.
 */
export function GeneratedArt({
  id,
  queer,
  title,
  when,
  venue,
  hero = false,
  compact = false,
  className = "",
}: {
  id: string;
  queer: boolean;
  title?: string;
  /** Already formatted in the city's timezone, e.g. "Sat Oct 31 / 9 PM". */
  when?: string;
  venue?: string | null;
  /** Event page: the print style runs as the live WebGL shader. */
  hero?: boolean;
  /** Art only, no type (thumbnails). */
  compact?: boolean;
  className?: string;
}) {
  const style = artStyle(id);
  const svg = useMemo(() => artSvg(id, queer), [id, queer]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || compact || prefersReducedMotion()) return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) el.dataset.play = "true";
      else delete el.dataset.play;
    });
    io.observe(el);
    return () => io.disconnect();
  }, [compact]);

  const shader = hero && style === "print";
  return (
    <div ref={ref} className={`gen-art gen-${style} ${queer ? "is-queer" : ""} ${compact ? "is-compact" : ""} ${className}`}>
      {shader ? (
        <Suspense fallback={<div className="gen-svg-host" aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />}>
          <FlyerShader id={id} queer={queer} />
        </Suspense>
      ) : (
        // Built from numbers only (no user text), so it's safe to inject.
        <div className="gen-svg-host" aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />
      )}
      {!compact && (
        <>
          <span className="gen-mark num" title="Generated art: this event has no flyer yet">
            Gen {artNumber(id)}
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
