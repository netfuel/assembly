// Turning push notifications on and off in this browser.
import { useEffect, useState } from "react";

export type PushState = "unsupported" | "needs-install" | "blocked" | "off" | "on";

const DISMISS_KEY = "assembly-push-prompt-dismissed";

function isIos() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}
function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

function keyBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64url.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function getPushState(): Promise<PushState> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    // iOS only offers web push to apps added to the Home Screen.
    return isIos() && !isStandalone() ? "needs-install" : "unsupported";
  }
  if (Notification.permission === "denied") return "blocked";
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === "granted" ? "on" : "off";
}

/** Asks for permission (must run from a tap), subscribes, and registers with the server. */
export async function enablePush(vapidPublicKey: string): Promise<PushState> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "blocked" : "off";
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(vapidPublicKey) });
  const json = sub.toJSON();
  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
  });
  if (!res.ok) {
    await sub.unsubscribe().catch(() => undefined);
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Couldn't turn on notifications.");
  }
  return "on";
}

export async function disablePush(): Promise<PushState> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await fetch("/api/push/unsubscribe", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    }).catch(() => undefined);
    await sub.unsubscribe().catch(() => undefined);
  }
  return "off";
}

export function usePushState(enabled: boolean) {
  const [state, setState] = useState<PushState | null>(null);
  useEffect(() => {
    if (!enabled) return;
    getPushState().then(setState).catch(() => setState("unsupported"));
  }, [enabled]);
  return [state, setState] as const;
}

export function promptDismissed() {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}
export function dismissPrompt() {
  try {
    localStorage.setItem(DISMISS_KEY, "1");
  } catch {
    // Fine: the prompt just shows again next time.
  }
}

export const PUSH_COPY: Record<PushState, string> = {
  unsupported: "This browser can't show notifications.",
  "needs-install": "On iPhone, add Assembly to your Home Screen (Share, then Add to Home Screen), open it from there, and turn notifications on.",
  blocked: "Notifications are blocked for this site. Allow them in your browser's site settings.",
  off: "Get told when a night you saved changes or is cancelled, and an hour before doors.",
  on: "On for this device: changes, cancellations, and an hour before doors.",
};
