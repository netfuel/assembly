// One motion module for the interface (the design review's rule): shared durations and easings, reduced motion
// handled once through gsap.matchMedia, transform and opacity only, every tween interruptible.
import { gsap } from "gsap";

export const DUR = { feedback: 0.2, transition: 0.36 } as const;
export const EASE = { out: "power3.out", settle: "expo.out" } as const;

let reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
if (typeof window !== "undefined") {
  const mm = gsap.matchMedia();
  mm.add({ reduce: "(prefers-reduced-motion: reduce)", ok: "(prefers-reduced-motion: no-preference)" }, (ctx) => {
    reduce = !!ctx.conditions?.reduce;
  });
}
export const reducedMotion = () => reduce;

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
