import { useEffect, useRef, useState } from "react";
import { videoPlayerUrl, videoThumbnailUrl } from "../lib/api";
import { reducedMotion } from "../lib/motion";

/**
 * Promo video that plays muted while it's on screen, like a story.
 * The Stream player mounts when the frame is mostly in view and unmounts when it leaves, which pauses it and saves data.
 * With reduced motion it waits for a tap.
 */
export function PromoVideo({ uid, customerCode, title }: { uid: string; customerCode: string | null; title: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  const [tapped, setTapped] = useState(false);
  const reduce = reducedMotion();

  useEffect(() => {
    const el = box.current;
    if (!el || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(([entry]) => setInView(entry.intersectionRatio >= 0.6), { threshold: [0, 0.6, 1] });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const mounted = reduce ? tapped : inView || tapped;
  return (
    <div ref={box} className="video-frame promo-video" data-playing={mounted || undefined}>
      <img className="promo-poster" src={videoThumbnailUrl(uid, customerCode)} alt="" loading="lazy" />
      {mounted ? (
        <iframe
          src={videoPlayerUrl(uid, customerCode, { autoplay: !reduce || tapped })}
          title={`Promo video for ${title}`}
          allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
        />
      ) : (
        <button className="promo-play" onClick={() => setTapped(true)} aria-label={`Play promo video for ${title}`}>
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path d="M8 5v14l11-7z" fill="currentColor" />
          </svg>
        </button>
      )}
    </div>
  );
}
