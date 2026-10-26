import { useEffect, useRef } from "react";
import { LOGO_MOVES, playLogo, reducedMotion, type LogoMove, type LogoParts } from "../lib/motion";

// The Timeless Serif A from public/icons/favicon.svg (scripts/make-icons.py), as separate parts so they can move.
const A = "M131.2 381.7 246.6 102H266.3L379.5 380Q385 393.4 390.8 399.8Q396.6 406.3 403.9 408.8Q411.3 411.4 425.9 413.3V426H283.7V413.3Q302.9 411.6 310.1 408.4Q317.4 405.1 317.7 399.1Q318 393.1 313.3 381L289.7 320.5H176.9L152.7 382.2Q148.3 393.4 150 399.3Q151.7 405.3 160.2 408.5Q168.8 411.6 188.7 413.3V426H86.1V413.3Q99.8 411.5 106.9 409.2Q114 406.9 120.1 400.8Q126.1 394.7 131.2 381.7ZM283 301.5 234.4 178.9 185 301.5Z";

const QUIET_MS = [45_000, 90_000] as const; // quiet spell before it moves on its own, then again after the same
const TAP_COOLDOWN_MS = 4000;

/**
 * The header logo. At rest it's the static mark. It moves once just after the splash, every so often after a
 * quiet spell (45–90 s with no touch, scroll, typing, or map drag, and only while the tab is visible, then again
 * after another), on hover or tap (with a cooldown), and when you RSVP. Never the same move twice in a row; nothing under reduced motion.
 */
export function Logo() {
  const svg = useRef<SVGSVGElement>(null);
  const last = useRef<LogoMove | null>(null);
  const playing = useRef<gsap.core.Timeline | null>(null);
  const lastTap = useRef(0);

  const play = (move?: LogoMove) => {
    const s = svg.current;
    if (!s || reducedMotion() || playing.current?.isActive()) return;
    const parts: LogoParts = {
      mark: s.querySelector(".logo-mark")!,
      a: s.querySelector(".logo-a")!,
      echo: s.querySelector(".logo-echo")!,
      dot: s.querySelector(".logo-dot")!,
      ring: s.querySelector(".logo-ring")!,
    };
    const pool = LOGO_MOVES.filter((m) => m !== last.current);
    const next = move && move !== last.current ? move : pool[Math.floor(Math.random() * pool.length)];
    last.current = next;
    playing.current = playLogo(parts, next);
  };

  useEffect(() => {
    if (reducedMotion()) return;
    // Once as the splash clears; the splash fires this when its zoom finishes (or right away if it was skipped).
    const intro = () => window.setTimeout(() => play("stamp"), 250);
    window.addEventListener("assembly:splash-done", intro, { once: true });
    const going = () => play("ring");
    window.addEventListener("assembly:going", going);

    // Moves on its own at quiet moments, again and again. Any touch, scroll or key press restarts the wait, and it
    // never plays over a typing field or in a hidden tab.
    let idle = 0;
    const arm = () => {
      window.clearTimeout(idle);
      idle = window.setTimeout(
        () => {
          if (document.visibilityState === "visible" && !document.activeElement?.matches("input, textarea")) play();
          arm();
        },
        QUIET_MS[0] + Math.random() * (QUIET_MS[1] - QUIET_MS[0]),
      );
    };
    const busy = ["pointerdown", "wheel", "keydown", "touchmove", "scroll"] as const;
    for (const t of busy) window.addEventListener(t, arm, { passive: true, capture: true });
    document.addEventListener("visibilitychange", arm);
    arm();
    return () => {
      window.clearTimeout(idle);
      window.removeEventListener("assembly:splash-done", intro);
      window.removeEventListener("assembly:going", going);
      for (const t of busy) window.removeEventListener(t, arm, { capture: true });
      document.removeEventListener("visibilitychange", arm);
      playing.current?.progress(1).kill();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const respond = () => {
    const now = Date.now();
    if (now - lastTap.current < TAP_COOLDOWN_MS) return;
    lastTap.current = now;
    play();
  };

  return (
    <a className="logo" href="/" aria-label="Assembly home" onPointerEnter={(e) => e.pointerType === "mouse" && respond()} onPointerDown={(e) => e.pointerType !== "mouse" && respond()}>
      <svg ref={svg} className="logo-svg" viewBox="0 0 512 512" width="22" height="22" aria-hidden="true" focusable="false">
        <rect className="logo-tile" width="512" height="512" rx="112" />
        <g className="logo-mark">
          <path className="logo-echo" d={A} transform="translate(14 12)" />
          <path className="logo-a" d={A} />
          <circle className="logo-ring" cx="404" cy="118" r="30" />
          <circle className="logo-dot" cx="404" cy="118" r="30" />
        </g>
      </svg>
      <span className="logo-word">Assembly</span>
    </a>
  );
}
