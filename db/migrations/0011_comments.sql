-- Comments on event pages: flat, newest last, one level of replies. Anyone signed in can comment.
-- status: live, hidden (three open reports, pending review), removed (deleted; kept as a placeholder when it has replies).
CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES comments(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'live' CHECK (status IN ('live', 'hidden', 'removed')),
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  edited_at TEXT
);
CREATE INDEX IF NOT EXISTS comments_event ON comments(event_id, created_at);
CREATE INDEX IF NOT EXISTS comments_parent ON comments(parent_id);
CREATE INDEX IF NOT EXISTS comments_user ON comments(user_id, created_at);

CREATE TABLE IF NOT EXISTS comment_reports (
  id TEXT PRIMARY KEY,
  comment_id TEXT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  reporter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'dismissed', 'actioned')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (comment_id, reporter_id)
);
CREATE INDEX IF NOT EXISTS comment_reports_open ON comment_reports(status, comment_id);

