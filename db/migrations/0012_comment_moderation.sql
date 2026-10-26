-- Hosts choose per event: on, locked (read only) or off (hidden from everyone but staff).
ALTER TABLE events ADD COLUMN comments_mode TEXT NOT NULL DEFAULT 'on';

-- Mute: their comments are hidden for you. Block: hidden both ways, and they can't reply to you
-- or comment on events you host.
CREATE TABLE IF NOT EXISTS user_blocks (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('mute', 'block')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (user_id, blocked_id)
);
CREATE INDEX IF NOT EXISTS user_blocks_blocked ON user_blocks(blocked_id);
