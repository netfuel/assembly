// Add to Home Screen. Chrome/Edge/Android fire `beforeinstallprompt`, which we hold until a good moment
// (after someone's first "Going"). iPhone Safari has no prompt, so we show the Share > Add to Home Screen steps.
type BIPEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

let deferred: BIPEvent | null = null;
const KEY = "assembly:install-dismissed";
const WELCOMED = "assembly:install-welcomed";

export function captureInstallPrompt() {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as BIPEvent;
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    remember();
  });
}

export const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

function dismissed() {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}
export function remember() {
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    // Private mode: it'll ask again next visit, which is fine.
  }
}

const flag = (k: string) => {
  try {
    return localStorage.getItem(k) === "1";
  } catch {
    return false;
  }
};

/**
 * The first-sign-in version of the prompt: once per device, and only where there is something to do (an install
 * prompt to run, or iPhone steps to show). Showing it counts as asking, so the post-RSVP card stays quiet afterwards.
 */
export function welcomeMode(): "prompt" | "ios" | null {
  const mode = installMode();
  if (!mode || flag(WELCOMED)) return null;
  try {
    localStorage.setItem(WELCOMED, "1");
  } catch {
    // Private mode: it may show again next sign-in, which is fine.
  }
  return mode;
}

/** Which kind of prompt to show right now, or null. */
export function installMode(): "prompt" | "ios" | null {
  if (isStandalone() || dismissed()) return null;
  if (deferred) return "prompt";
  if (isIOS()) return "ios";
  return null;
}

export async function runInstallPrompt() {
  const e = deferred;
  deferred = null;
  if (!e) return false;
  await e.prompt();
  const { outcome } = await e.userChoice;
  remember();
  return outcome === "accepted";
}

/** EventSheet calls this after a successful "Going". */
export const announceGoing = () => window.dispatchEvent(new Event("assembly:going"));
