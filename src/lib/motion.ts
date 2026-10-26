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
