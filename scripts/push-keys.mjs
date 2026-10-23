// Generates a VAPID key pair for web push. Run: npm run push:keys
// Put the values in .dev.vars for local work, and in production run:
//   npx wrangler secret put VAPID_PUBLIC_KEY
//   npx wrangler secret put VAPID_PRIVATE_KEY
const { subtle } = globalThis.crypto;
const b64url = (buf) => Buffer.from(buf).toString("base64url");
const pair = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const pub = await subtle.exportKey("raw", pair.publicKey);
const jwk = await subtle.exportKey("jwk", pair.privateKey);
console.log(`VAPID_PUBLIC_KEY=${b64url(pub)}`);
console.log(`VAPID_PRIVATE_KEY=${jwk.d}`);
console.log("VAPID_SUBJECT=mailto:hello@assembly.rsvp");
console.log("\nKeep the private key secret. Changing keys later means everyone has to turn notifications on again.");
