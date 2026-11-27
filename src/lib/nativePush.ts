// Push notifications in the iOS app, through APNs (worker/apns.ts) instead of web push. src/lib/push.ts switches
// to these inside the app, so the notifications toggle and the after-RSVP prompt work the same on both.
import type { PluginListenerHandle } from "@capacitor/core";
import { apiCredentials, apiUrl, isNativeApp, openInApp } from "./native";
import { sessionHeaders } from "./nativeAuth";

export type NativePushState = "blocked" | "off" | "on";

/** The device token this phone last registered, kept so the server can be told when it changes or you sign out. */
const TOKEN_KEY = "assembly-apns-token";

function storedToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
function storeToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Without storage the phone just registers again next launch.
  }
}

const plugin = () => import("@capacitor/push-notifications").then((m) => m.PushNotifications);

async function post(path: string, token: string) {
  const res = await fetch(apiUrl(path), {
    method: "POST",
    credentials: apiCredentials,
    headers: { "Content-Type": "application/json", ...sessionHeaders() },
    body: JSON.stringify({ token }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Couldn't turn on notifications.");
  }
}

export async function getNativePushState(): Promise<NativePushState> {
  const { receive } = await (await plugin()).checkPermissions();
  if (receive === "denied") return "blocked";
  return receive === "granted" && storedToken() ? "on" : "off";
}

/** Asks iOS for the device token. Resolves with it, or rejects if registration fails or takes too long. */
async function deviceToken(): Promise<string> {
  const push = await plugin();
  const handles: PluginListenerHandle[] = [];
  try {
    return await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Couldn't reach Apple's notification service. Try again.")), 15000);
      Promise.all([
        push.addListener("registration", (t) => {
          clearTimeout(timer);
          resolve(t.value);
        }),
        push.addListener("registrationError", () => {
          clearTimeout(timer);
          reject(new Error("This phone couldn't register for notifications."));
        }),
      ])
        .then((h) => {
          handles.push(...h);
          return push.register();
        })
        .catch(reject);
    });
  } finally {
    for (const h of handles) void h.remove();
  }
}

/** Shows iOS's permission prompt (first time only), registers the phone, and tells the server. Run from a tap. */
export async function enableNativePush(): Promise<NativePushState> {
  const push = await plugin();
  const { receive } = await push.requestPermissions();
  if (receive !== "granted") return receive === "denied" ? "blocked" : "off";
  const token = await deviceToken();
  await post("/api/push/apns", token);
  storeToken(token);
  return "on";
}

export async function disableNativePush(): Promise<NativePushState> {
  await forgetThisDevice();
  await (await plugin()).unregister().catch(() => undefined);
  return "off";
}

/** Signing out: stop notifications for this account on this phone. Runs while the session still works. */
export async function forgetThisDevice() {
  const token = storedToken();
  storeToken(null);
  if (token) await post("/api/push/apns/remove", token).catch(() => undefined);
}

/** Account deleted: the server already forgot every device. */
export function clearDeviceToken() {
  storeToken(null);
}

/**
 * At launch: a tapped notification opens its event, and a phone with notifications on registers again so a new
 * device token (after a restore or reinstall) reaches the server.
 */
export async function startNativePush() {
  if (!isNativeApp) return;
  const push = await plugin();
  await push.addListener("pushNotificationActionPerformed", ({ notification }) => {
    const url = (notification.data as { url?: unknown } | undefined)?.url;
    if (typeof url === "string" && url.startsWith("/") && !url.startsWith("//")) openInApp(url);
  });
  const old = storedToken();
  if (!old || (await push.checkPermissions()).receive !== "granted") return;
  try {
    const token = await deviceToken();
    if (token === old) return;
    await post("/api/push/apns", token);
    await post("/api/push/apns/remove", old).catch(() => undefined);
    storeToken(token);
  } catch {
    // Offline or signed out: the old token keeps working until Apple retires it; try again next launch.
  }
}
