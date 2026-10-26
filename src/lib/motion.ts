// The one motion module (design review: "one motion module, every tween through useGSAP").
// Shared durations and easings, reduced motion read from one place, transform and opacity only (the RSVP stamp's
// ring is the one exception, noted there), every tween interruptible. Components import from here, never from gsap.
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP);

/** Run GSAP inside a component: tweens made in the callback are reverted on unmount. Re-exported so components only import motion.ts. */
export { useGSAP };

/** Seconds. Feedback is a response to a touch; transition moves something to a new place; reveal brings content in. */
export const DUR = { feedback: 0.2, transition: 0.36, reveal: 0.42, count: 0.5 } as const;
export const EASE = { out: "power3.out", soft: "power2.out", settle: "expo.out" } as const;

let reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
if (typeof window !== "undefined") {
  const mm = gsap.matchMedia();
  mm.add({ reduce: "(prefers-reduced-motion: reduce)", ok: "(prefers-reduced-motion: no-preference)" }, (ctx) => {
    reduce = !!ctx.conditions?.reduce;
  });
}
/** True when the person asked their device for less motion. Every animation in the app asks here, not the media query. */
export const reducedMotion = () => reduce;

/** Children of `root` marked [data-reveal] rise in one after another. Content is visible at rest. */
export function revealChildren(root: Element | null, opts: { y?: number; stagger?: number } = {}) {
  if (!root || reduce) return;
  const items = root.querySelectorAll("[data-reveal]");
  if (!items.length) return;
  return gsap.fromTo(
    items,
    { y: opts.y ?? 10, opacity: 0 },
    { y: 0, opacity: 1, duration: DUR.reveal, ease: EASE.out, stagger: opts.stagger ?? 0.045, clearProps: "transform,opacity" },
  );
}

/** Rail cards slide in from the right when the filter changes. */
export function revealCards(root: Element | null) {
  if (!root || reduce) return;
  const cards = root.querySelectorAll(".card");
  if (!cards.length) return;
  return gsap.fromTo(
    cards,
    { x: 24, opacity: 0 },
    { x: 0, opacity: 1, duration: DUR.transition, ease: EASE.soft, stagger: 0.035, clearProps: "transform,opacity" },
  );
}

/**
 * A rubber-stamp hit on the RSVP button: overshoot, settle, and a magenta ring that fades.
 * The ring animates box-shadow, the one place this module goes beyond transform and opacity: it is a single
 * 0.6 s ring on one button, and a pseudo-element ring would need markup in every place a stamp is used.
 */
export function stamp(el: Element | null) {
  if (!el || reduce) return;
  return gsap
    .timeline()
    .fromTo(el, { scale: 1.12, rotate: -3 }, { scale: 1, rotate: 0, duration: DUR.count, ease: "elastic.out(1, 0.45)" })
    .fromTo(
      el,
      { boxShadow: "0 0 0 0 rgba(255,61,242,0.6)" },
      { boxShadow: "0 0 0 14px rgba(255,61,242,0)", duration: 0.6, ease: EASE.soft, clearProps: "boxShadow" },
      0,
    );
}

const counting = new WeakMap<Element, gsap.core.Tween>();

/** Count a number up into an element, e.g. RSVP totals. A new count replaces one still running on the same element. */
export function countTo(el: Element | null, to: number) {
  if (!el) return;
  counting.get(el)?.kill();
  if (reduce) {
    el.textContent = String(to);
    return;
  }
  const state = { n: Number(el.textContent) || 0 };
  const tween = gsap.to(state, { n: to, duration: DUR.count, ease: EASE.soft, onUpdate: () => (el.textContent = String(Math.round(state.n))) });
  counting.set(el, tween);
  return tween;
}

/** Move an element to y (px), with velocity carried in from a flick. Instant under reduced motion. */
export function slideTo(el: HTMLElement, y: number, velocity = 0) {
  gsap.killTweensOf(el);
  if (reduce) {
    gsap.set(el, { y });
    return;
  }
  // Faster flicks finish sooner; never slower than a transition, never a snap.
  const duration = Math.max(0.22, Math.min(DUR.transition + 0.1, DUR.transition - Math.abs(velocity) / 12000));
  gsap.to(el, { y, duration, ease: EASE.settle, overwrite: true });
}

export const setY = (el: HTMLElement, y: number) => gsap.set(el, { y });
export const currentY = (el: HTMLElement) => Number(gsap.getProperty(el, "y")) || 0;
/** Stop whatever is moving this element, for when its component goes away mid-tween. */
export const stopMotion = (el: Element | null) => {
  if (el) gsap.killTweensOf(el);
};

/* ---------- Header logo ----------
   Short, decorative moves on the mark's separate parts (src/components/Logo.tsx): the A, its pink echo
   (the misregistration), and the violet dot. Each is 0.6–1.2 s, transform and opacity only, and ends exactly
   where it started, so the resting logo never shifts. Callers check reducedMotion() first. */
export type LogoParts = { mark: Element; a: Element; echo: Element; dot: Element; ring: Element };
export type LogoMove = "stamp" | "misregister" | "wink" | "hop" | "ring";
export const LOGO_MOVES: LogoMove[] = ["stamp", "misregister", "wink", "hop", "ring"];

export function playLogo(p: LogoParts, move: LogoMove) {
  const tl = gsap.timeline({ defaults: { ease: EASE.out } });
  const origin = { transformOrigin: "50% 50%" };
  switch (move) {
    case "stamp": // pressed onto the page, like the RSVP stamp
      tl.fromTo(p.mark, { scale: 1.3, rotate: -10, ...origin }, { scale: 1, rotate: 0, duration: 0.8, ease: "elastic.out(1, 0.45)" });
      break;
    case "misregister": // the print slips out of register and snaps back, twice
      // Units are the 512 box: 60 is about 2.5 px at header size, enough to read as a slip.
      tl.to(p.echo, { x: 60, y: 36, duration: 0.09 })
        .to(p.echo, { x: -24, y: -14, duration: 0.07 })
        .to(p.echo, { x: 0, y: 0, duration: 0.12 })
        .to(p.a, { x: -18, duration: 0.05 }, 0.12)
        .to(p.a, { x: 0, duration: 0.08 })
        .to(p.echo, { x: 80, duration: 0.06 }, 0.42)
        .to(p.echo, { x: 0, duration: 0.16, ease: EASE.settle });
      break;
    case "wink": // the dot blinks
      tl.to(p.dot, { scaleY: 0.1, duration: 0.09, ...origin, ease: "power2.in" })
        .to(p.dot, { scaleY: 1, duration: 0.16, ease: EASE.soft })
        .to(p.dot, { scaleY: 0.1, duration: 0.08, delay: 0.12, ease: "power2.in" })
        .to(p.dot, { scaleY: 1, duration: 0.2, ease: EASE.soft });
      break;
    case "hop": // the dot jumps off the A's shoulder and lands
      tl.to(p.dot, { y: -150, duration: 0.28, ease: "power2.out" })
        .to(p.dot, { y: 0, duration: 0.32, ease: "bounce.out" })
        .fromTo(p.a, { scaleY: 1, transformOrigin: "50% 100%" }, { scaleY: 0.94, duration: 0.08, yoyo: true, repeat: 1 }, 0.55);
      break;
    case "ring": // a ring leaves the dot, the system's ring language
      tl.fromTo(p.ring, { scale: 0.6, opacity: 0.9, ...origin }, { scale: 3, opacity: 0, duration: 0.9, ease: EASE.soft });
      break;
  }
  return tl;
}

/* ---------- Card to event page ----------
   The art travels from the card you tapped into the event page's hero, and back to its card on close, so the
   page visibly comes from somewhere. A ghost copy flies (transform and opacity only) while the real hero waits
   underneath; nothing flies under reduced motion or when the card isn't on screen. */
type Origin = { id: string; rect: DOMRect; radius: string; el: HTMLElement };
let origin: Origin | null = null;

/** Where an event's art sits right now: a rail card, a feed card, or nothing (a pin or a link). */
export function artFor(id: string): HTMLElement | null {
  const sel = `[data-id="${CSS.escape(id)}"]`;
  return document.querySelector<HTMLElement>(`.card${sel} .card-art, .feed-card${sel} .feed-flyer`);
}

function onScreen(r: DOMRect) {
  return r.width > 0 && r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
}

/** Call as a card is tapped, before the event page renders. */
export function markFlipOrigin(id: string) {
  const el = artFor(id);
  const rect = el?.getBoundingClientRect();
  origin = el && rect && onScreen(rect) && !reduce ? { id, rect, radius: getComputedStyle(el).borderRadius, el } : null;
}

/** Was this event opened from a card? The event sheet then skips its own slide so the art can lead. */
export const hasFlipOrigin = (id: string) => origin?.id === id;

function ghostOf(src: HTMLElement, rect: DOMRect, radius: string) {
  const g = document.createElement("div");
  g.className = "flip-ghost";
  g.setAttribute("aria-hidden", "true");
  Object.assign(g.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`, borderRadius: radius });
  const img = src.querySelector("img");
  const canvas = src.querySelector("canvas");
  if (img?.currentSrc || img?.src) {
    const i = document.createElement("img");
    i.src = img.currentSrc || img.src;
    i.alt = "";
    g.append(i);
  } else if (canvas && canvas.width) {
    const c = document.createElement("canvas");
    c.width = canvas.width;
    c.height = canvas.height;
    c.getContext("2d")?.drawImage(canvas, 0, 0);
    g.append(c);
  } else {
    g.style.background = getComputedStyle(src).backgroundColor || "var(--color-surface)";
  }
  document.body.append(g);
  return g;
}

/** Transform that makes a box at `to` look like it sits at `from`. */
const fromBox = (from: DOMRect, to: DOMRect) => ({
  x: from.left - to.left,
  y: from.top - to.top,
  scaleX: from.width / to.width,
  scaleY: from.height / to.height,
  transformOrigin: "0 0",
});

/** Fly the remembered card art into the hero. The hero is hidden until the ghost lands on it. */
export function flipIn(id: string, hero: HTMLElement | null) {
  const o = origin;
  origin = null;
  if (!o || o.id !== id || !hero || reduce) return;
  const to = hero.getBoundingClientRect();
  // The full flyer if the hero has one; otherwise the card's own art (generated art draws there first).
  const g = ghostOf(hero.querySelector("img") ? hero : o.el, to, getComputedStyle(hero).borderRadius);
  gsap.set(hero, { opacity: 0 });
  gsap.set(g, fromBox(o.rect, to));
  // Start on the next frame, after the page's first paint, so the opening frames aren't spent on mounting.
  requestAnimationFrame(() => gsap.to(g, {
    x: 0,
    y: 0,
    scaleX: 1,
    scaleY: 1,
    duration: DUR.reveal + 0.06,
    ease: "power3.inOut",
    onComplete: () => {
      gsap.set(hero, { clearProps: "opacity" });
      gsap.to(g, { opacity: 0, duration: 0.12, onComplete: () => g.remove() });
    },
  }));
}

/** On close: the hero's art flies back to its card, if that card is on screen. Call before the page unmounts. */
export function flipOut(id: string, hero: HTMLElement | null) {
  if (!hero || reduce) return;
  const from = hero.getBoundingClientRect();
  if (!onScreen(from)) return;
  const g = ghostOf(hero, from, getComputedStyle(hero).borderRadius);
  requestAnimationFrame(() => {
    const card = artFor(id);
    const to = card?.getBoundingClientRect();
    if (!card || !to || !onScreen(to)) {
      gsap.to(g, { opacity: 0, duration: DUR.feedback, onComplete: () => g.remove() });
      return;
    }
    // The ghost keeps its box; a transform carries it down to the card.
    gsap.to(g, {
      ...fromBox(to, from),
      duration: DUR.transition,
      ease: EASE.out,
      onComplete: () => gsap.to(g, { opacity: 0, duration: 0.1, onComplete: () => g.remove() }),
    });
  });
}
