-- Friends on the map. Friends are mutual (both accept). Presence is only ever shown as "going" or "here now"
-- at an event, never a position, and only after a person turns friends on.

ALTER TABLE users ADD COLUMN username TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS users_username ON users(lower(username)) WHERE username IS NOT NULL;
-- 1 once the person has seen the explainer and turned friends on. Until then, nobody sees their presence.
ALTER TABLE users ADD COLUMN friends_on INTEGER NOT NULL DEFAULT 0;
-- What friends see for a new Going or check-in: 'friends' or 'me'. Each event can override it.
ALTER TABLE users ADD COLUMN presence_default TEXT NOT NULL DEFAULT 'friends';
-- Secret in the person's invite link (/f/<token>). Rotating it kills old links.
ALTER TABLE users ADD COLUMN invite_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS users_invite_token ON users(invite_token) WHERE invite_token IS NOT NULL;

-- One row per pair, smaller id first, so a pair can't exist twice.
CREATE TABLE IF NOT EXISTS friendships (
  user_a TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted')),
  requested_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  accepted_at TEXT,
  PRIMARY KEY (user_a, user_b),
  CHECK (user_a < user_b)
);
CREATE INDEX IF NOT EXISTS friendships_b ON friendships(user_b);

-- Blocking ends any friendship and stops requests both ways. The blocked person isn't told.
CREATE TABLE IF NOT EXISTS blocks (
  blocker_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (blocker_id, blocked_id)
);
CREATE INDEX IF NOT EXISTS blocks_blocked ON blocks(blocked_id);

-- "Hide me from this friend": they stay a friend but never see where you're going.
CREATE TABLE IF NOT EXISTS presence_hidden (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, friend_id)
);

-- Per-event choice, overriding presence_default: 'friends' or 'me'.
CREATE TABLE IF NOT EXISTS event_presence (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  visibility TEXT NOT NULL CHECK (visibility IN ('friends', 'me')),
  PRIMARY KEY (event_id, user_id)
);
