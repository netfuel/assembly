-- Reactions: a small fixed set (heart, fire, smiley, rainbow, "see you there"), one of each per person per thing.
-- Events first; comments and flyers can reuse the table with their own target_type.
CREATE TABLE IF NOT EXISTS reactions (
  target_type TEXT NOT NULL CHECK (target_type IN ('event')),
  target_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('heart', 'fire', 'smiley', 'rainbow', 'see-you')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (target_type, target_id, user_id, kind)
);
CREATE INDEX IF NOT EXISTS reactions_target ON reactions(target_type, target_id);
