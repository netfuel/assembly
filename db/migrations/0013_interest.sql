-- Launch interest list: addresses left on the gate screen before launch. One row per address.
-- The address is kept for the launch email; the hash is what the dedupe and the sign-in match use.
CREATE TABLE IF NOT EXISTS interest (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  email_hash TEXT NOT NULL UNIQUE,
  source TEXT,
  referrer TEXT,
  device TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  converted_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  converted_at TEXT
);
CREATE INDEX IF NOT EXISTS interest_created ON interest(created_at);
