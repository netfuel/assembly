import { gsap } from "gsap";

export function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Children of `root` marked [data-reveal] rise in one after another. Content is visible at rest. */
export function revealChildren(root: Element | null, opts: { y?: number; stagger?: number } = {}) {
  if (!root || prefersReducedMotion()) return;
  const items = root.querySelectorAll("[data-reveal]");
  if (!items.length) return;
  gsap.fromTo(
    items,
    { y: opts.y ?? 10, opacity: 0 },
    { y: 0, opacity: 1, duration: 0.42, ease: "power3.out", stagger: opts.stagger ?? 0.045, clearProps: "transform,opacity" },
  );
}

/** Rail cards slide in from the right when the filter changes. */
export function revealCards(root: Element | null) {
  if (!root || prefersReducedMotion()) return;
  const cards = root.querySelectorAll(".card");
  if (!cards.length) return;
  gsap.fromTo(
    cards,
    { x: 24, opacity: 0 },
    { x: 0, opacity: 1, duration: 0.38, ease: "power2.out", stagger: 0.035, clearProps: "transform,opacity" },
  );
}

/** A rubber-stamp hit on the RSVP button: overshoot, settle, and a magenta ring that fades. */
export function stamp(el: Element | null) {
  if (!el || prefersReducedMotion()) return;
  gsap
    .timeline()
    .fromTo(el, { scale: 1.12, rotate: -3 }, { scale: 1, rotate: 0, duration: 0.5, ease: "elastic.out(1, 0.45)" })
    .fromTo(
      el,
      { boxShadow: "0 0 0 0 rgba(255,61,242,0.6)" },
      { boxShadow: "0 0 0 14px rgba(255,61,242,0)", duration: 0.6, ease: "power2.out", clearProps: "boxShadow" },
      0,
    );
}

/** Count a number up into an element, e.g. RSVP totals. */
export function countTo(el: Element | null, to: number) {
  if (!el) return;
  if (prefersReducedMotion()) {
    el.textContent = String(to);
    return;
  }
  const state = { n: Number(el.textContent) || 0 };
  gsap.to(state, { n: to, duration: 0.5, ease: "power1.out", onUpdate: () => (el.textContent = String(Math.round(state.n))) });
}
