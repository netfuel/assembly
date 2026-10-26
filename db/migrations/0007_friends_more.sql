-- Friends, continued: a third visibility, check-in alerts, event invites, and finding friends from contacts.

-- event_presence gains 'event': friends see you, and so does anyone checked in to the same event.
CREATE TABLE IF NOT EXISTS event_presence_new (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  visibility TEXT NOT NULL CHECK (visibility IN ('friends', 'me', 'event')),
  PRIMARY KEY (event_id, user_id)
);
INSERT OR IGNORE INTO event_presence_new SELECT event_id, user_id, visibility FROM event_presence;
DROP TABLE event_presence;
ALTER TABLE event_presence_new RENAME TO event_presence;

-- "Tell me when this friend checks in." Opt-in, per friend.
CREATE TABLE IF NOT EXISTS friend_alerts (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, friend_id)
);
CREATE INDEX IF NOT EXISTS friend_alerts_friend ON friend_alerts(friend_id);

-- A friend invited you to an event.
CREATE TABLE IF NOT EXISTS event_invites (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  from_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  seen_at TEXT,
  PRIMARY KEY (event_id, from_id, to_id)
);
CREATE INDEX IF NOT EXISTS event_invites_to ON event_invites(to_id, created_at);

-- Finding friends from contacts. Only people who switch on "Let friends find me by email" are listed.
-- The phone sends only the first 5 hex characters of each contact's email hash and compares full hashes
-- itself, so the server never learns which contacts someone has.
ALTER TABLE users ADD COLUMN findable INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS email_hashes (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hash TEXT NOT NULL,
  prefix TEXT NOT NULL,
  PRIMARY KEY (user_id, hash)
);
CREATE INDEX IF NOT EXISTS email_hashes_prefix ON email_hashes(prefix);
