import type { GateState, ServerConfig } from "../../shared/types";

/**
 * Decides what the page mounts. Policy pages render on their own; a gated visitor gets the launch gate;
 * everyone else gets the app. Offline or a failed config fetch means the app: someone who installed the
 * PWA and has a session must not be walled off by a flaky network, and the API gates itself anyway.
 */
export type Mount = "legal" | "gate" | "app";

export function mountFor(config: Pick<ServerConfig, "gate"> | null, pathname: string, search = ""): Mount {
  if (/^\/(terms|privacy|guidelines)\/?$/.test(pathname)) return "legal";
  if (config?.gate === "on" || isPreview(search)) return "gate";
  return "app";
}

/** `?gate=preview` shows the gate to anyone, gate on or off, so it can be reviewed on a phone without gating the site. */
export function isPreview(search: string): boolean {
  return new URLSearchParams(search).get("gate") === "preview";
}

export const isGated = (gate: GateState | undefined) => gate === "on";

const DONE_KEY = "assembly-interest";

/** The address left on the gate, so a return visit shows "you're on the list" instead of the form. */
export function rememberInterest(email: string) {
  try {
    localStorage.setItem(DONE_KEY, email);
  } catch {
    // Private mode or storage off: the form just shows again next time.
  }
}

export function rememberedInterest(): string | null {
  try {
    return localStorage.getItem(DONE_KEY);
  } catch {
    return null;
  }
}

/** The same practical check the Worker applies, so the button enables only for an address that will go through. */
export function looksLikeEmail(raw: string): boolean {
  const email = raw.trim();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

/** Where the Google round-trip should land: the current path, or the event a shared link pointed at. */
export function gateReturnTo(search: string): string {
  const from = new URLSearchParams(search).get("from");
  return from && /^\/[a-z0-9/_-]*$/i.test(from) ? from : "/";
}
