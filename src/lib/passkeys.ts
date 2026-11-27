// Passkeys: sign in with Face ID, Touch ID or a phone (worker/passkeys.ts). On the web the browser's own prompt
// runs (@simplewebauthn/browser, loaded only when needed). In the bundled iOS app, Apple's passkey sheet runs
// through the AssemblyAuth plugin, for the same relying party (assembly.rsvp), so one passkey works in both.
import { registerPlugin } from "@capacitor/core";
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/browser";
import { api, ApiError } from "./api";
import { landing, saveAppSession, usesAppSession } from "./nativeAuth";

interface PasskeyPlugin {
  passkeyRegister(o: { options: PublicKeyCredentialCreationOptionsJSON }): Promise<{ response?: RegistrationResponseJSON; cancelled?: boolean }>;
  passkeySignIn(o: { options: PublicKeyCredentialRequestOptionsJSON }): Promise<{ response?: AuthenticationResponseJSON; cancelled?: boolean }>;
}
const AssemblyAuth = registerPlugin<PasskeyPlugin>("AssemblyAuth");

/** Whether this device can make and use a passkey here. The app always can (iOS 16+); the web asks the browser. */
export async function passkeysAvailable(): Promise<boolean> {
  if (usesAppSession) return true;
  if (typeof window === "undefined" || !window.PublicKeyCredential || !window.isSecureContext) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/** The person closed the prompt: not an error, say nothing. */
export class PasskeyCancelled extends Error {}

const cancelledOnWeb = (err: unknown) => err instanceof Error && (err.name === "NotAllowedError" || err.name === "AbortError");

/** Adds a passkey to the signed-in account. Resolves with the updated list. */
export async function addPasskey() {
  const { options } = await api.passkeyAddOptions();
  let response: RegistrationResponseJSON;
  if (usesAppSession) {
    const r = await AssemblyAuth.passkeyRegister({ options });
    if (r.cancelled || !r.response) throw new PasskeyCancelled();
    response = r.response;
  } else {
    const { startRegistration } = await import("@simplewebauthn/browser");
    try {
      response = await startRegistration({ optionsJSON: options });
    } catch (err) {
      if (cancelledOnWeb(err)) throw new PasskeyCancelled();
      if (err instanceof Error && err.name === "InvalidStateError") throw new ApiError("This device already has a passkey for your account.", 409);
      throw err;
    }
  }
  return api.passkeyAdd(response);
}

/**
 * Signs in with any passkey on this device, then lands where the other sign-ins do (?signin=ok, or the gate's
 * waitlist). Resolves without navigating if the person closes the prompt.
 */
export async function signInWithPasskey(returnTo: string): Promise<void> {
  const { options, flow } = await api.passkeyOptions();
  let response: AuthenticationResponseJSON;
  if (usesAppSession) {
    const r = await AssemblyAuth.passkeySignIn({ options });
    if (r.cancelled || !r.response) return;
    response = r.response;
  } else {
    const { startAuthentication } = await import("@simplewebauthn/browser");
    try {
      response = await startAuthentication({ optionsJSON: options });
    } catch (err) {
      if (cancelledOnWeb(err)) return;
      throw err;
    }
  }
  const r = await api.passkeyVerify(flow, response);
  if (r.token) await saveAppSession(r.token);
  location.assign(landing(returnTo, r.result));
}
