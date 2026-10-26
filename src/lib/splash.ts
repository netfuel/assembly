/**
 * Beat 4 of the cold-start splash in index.html: the zoom through the A and the pin pulse.
 * Beats 1–3 run in CSS from the first paint; the window opens at 2.0s. This reveals as soon as the
 * events are in and MIN_MS has passed, waiting up to MAP_GRACE_MS more for the map's first full draw so
 * the A doesn't linger. HARD_CAP_MS reveals regardless, and a tap anywhere skips straight to the reveal.
 */
import { reducedMotion } from "./motion";

const MIN_MS = 2100;
const MAP_GRACE_MS = 400;
const HARD_CAP_MS = 6000;
const ZOOM_MS = 850; // matches the .sp-zoom transition, minus the fade at its end
const REMOVE_MS = 1700; // after the pin pulse finishes

let eventsReady = false;
let mapReady = false;
let revealed = false;

function el() {
  return document.getElementById("splash");
}

function reveal() {
  const splash = el();
  if (revealed || !splash) return;
  revealed = true;
  const reduce = reducedMotion();
  splash.classList.add("is-reveal");
  window.setTimeout(() => splash.classList.add("is-done"), reduce ? 0 : ZOOM_MS);
  window.setTimeout(() => splash.remove(), reduce ? 400 : REMOVE_MS);
}

let scheduled = false;
function maybeReveal() {
  if (!eventsReady) return;
  if (mapReady) return void window.setTimeout(reveal, Math.max(0, MIN_MS - performance.now()));
  if (scheduled) return;
  scheduled = true;
  window.setTimeout(reveal, Math.max(0, MIN_MS + MAP_GRACE_MS - performance.now()));
}

/** The first events are in (or failed to load: the app shows its own message). */
export function hideSplash() {
  eventsReady = true;
  maybeReveal();
}

/** Remove the splash at once, for pages that don't use it. */
export function skipSplash() {
  revealed = true;
  el()?.remove();
}

(function init() {
  const splash = el();
  if (!splash) return;
  if (document.documentElement.dataset.splash === "skip") return skipSplash();
  splash.addEventListener("pointerdown", reveal, { once: true });
  window.addEventListener("assembly:map-ready", () => {
    mapReady = true;
    maybeReveal();
  }, { once: true });
  window.setTimeout(reveal, Math.max(0, HARD_CAP_MS - performance.now()));
})();
