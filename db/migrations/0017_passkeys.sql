-- Passkeys: sign in with Face ID, Touch ID or a phone, synced by iCloud Keychain or another password manager
-- (worker/passkeys.ts). One row per credential. The relying party is the site's host (assembly.rsvp), so a
-- passkey made on the site also works in the iOS app, which is tied to the domain through webcredentials.
CREATE TABLE IF NOT EXISTS passkeys (
  -- The credential ID, base64url, as the authenticator reports it.
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- COSE public key, base64url.
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  -- JSON array of transports ("internal", "hybrid", ...), to help the browser find it.
  transports TEXT,
  -- What made it, for the Profile list: "iCloud Keychain", "Google Password Manager", ... (from the AAGUID).
  label TEXT NOT NULL DEFAULT 'Passkey',
  -- Synced (multi-device) rather than tied to one device.
  backed_up INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_used_at TEXT
);
CREATE INDEX IF NOT EXISTS passkeys_user ON passkeys(user_id);
