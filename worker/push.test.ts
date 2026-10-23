import { describe, expect, it } from "vitest";
import { b64url, encryptPayload, fromB64url, isPushEndpoint, vapidAuthorization } from "./push";

// RFC 8291, section 5 and appendix A.
const RFC = {
  plaintext: "When I grow up, I want to be a watermelon",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  asPublic: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  cek: "oIhVW04MRdy2XN9CiKLxTg",
  nonce: "4h_95klXJ5E_qnoN",
  header: "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  ciphertext: "8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ",
};

describe("web push encryption (RFC 8291)", () => {
  it("reproduces the RFC example", async () => {
    const { body, intermediate } = await encryptPayload(
      new TextEncoder().encode(RFC.plaintext),
      { p256dh: RFC.uaPublic, auth: RFC.auth },
      { salt: fromB64url(RFC.salt), sender: { privateKey: fromB64url(RFC.asPrivate), publicKey: fromB64url(RFC.asPublic) } },
    );
    expect(b64url(intermediate.cek)).toBe(RFC.cek);
    expect(b64url(intermediate.nonce)).toBe(RFC.nonce);
    const header = fromB64url(RFC.header);
    expect(header.length).toBe(86);
    expect(b64url(body.slice(0, 86))).toBe(RFC.header);
    expect(b64url(body.slice(86))).toBe(RFC.ciphertext);
  });

  it("uses a fresh salt and key for each message", async () => {
    const a = await encryptPayload(new Uint8Array([1]), { p256dh: RFC.uaPublic, auth: RFC.auth });
    const b = await encryptPayload(new Uint8Array([1]), { p256dh: RFC.uaPublic, auth: RFC.auth });
    expect(b64url(a.body.slice(0, 16))).not.toBe(b64url(b.body.slice(0, 16)));
    expect(a.body.length).toBe(86 + 1 + 1 + 16);
  });
});

describe("VAPID", () => {
  it("signs a JWT the public key verifies", async () => {
    const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
    const pub = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
    const header = await vapidAuthorization("https://fcm.googleapis.com/fcm/send/abc", {
      publicKey: b64url(pub),
      privateKey: (jwk as JsonWebKey).d!,
      subject: "mailto:hello@assembly.rsvp",
    }, Date.UTC(2026, 9, 23));
    const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header)!;
    expect(m[4]).toBe(b64url(pub));
    const claims = JSON.parse(new TextDecoder().decode(fromB64url(m[2])));
    expect(claims).toEqual({ aud: "https://fcm.googleapis.com", exp: Date.UTC(2026, 9, 23) / 1000 + 12 * 3600, sub: "mailto:hello@assembly.rsvp" });
    const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pair.publicKey, fromB64url(m[3]), new TextEncoder().encode(`${m[1]}.${m[2]}`));
    expect(ok).toBe(true);
  });
});

describe("push endpoints", () => {
  it("accepts real push services only", () => {
    expect(isPushEndpoint("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    expect(isPushEndpoint("https://web.push.apple.com/QGx")).toBe(true);
    expect(isPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/x")).toBe(true);
    expect(isPushEndpoint("https://evil.example/push")).toBe(false);
    expect(isPushEndpoint("http://fcm.googleapis.com/x")).toBe(false);
    expect(isPushEndpoint("https://push.apple.com.evil.example/x")).toBe(false);
    expect(isPushEndpoint("http://localhost:8899/push")).toBe(false);
    expect(isPushEndpoint("http://localhost:8899/push", true)).toBe(true);
  });
});

import { describeChange } from "./notify";
describe("change notices", () => {
  const tz = "America/Chicago";
  const before = { starts_at: "2026-10-25T03:00:00.000Z", ends_at: "2026-10-25T08:00:00.000Z", address: "1 Main St", venue_id: null };
  it("says when the start moves on the same night", () => {
    expect(describeChange(before, { startsAt: "2026-10-25T04:00:00.000Z", endsAt: before.ends_at, address: "1 Main St", venueId: null }, tz)).toBe("Now starts at 11 pm.");
  });
  it("says when it moves to another day and place", () => {
    expect(describeChange(before, { startsAt: "2026-10-26T03:00:00.000Z", endsAt: "2026-10-26T08:00:00.000Z", address: "9 Elm St", venueId: null }, tz)).toBe(
      "Moved to Sun, Oct 25 at 10 pm. New location: 9 Elm St.",
    );
  });
  it("stays quiet for edits that don't change the plan", () => {
    expect(describeChange(before, { startsAt: before.starts_at, endsAt: before.ends_at, address: " 1 Main St ", venueId: null }, tz)).toBeNull();
  });
});
