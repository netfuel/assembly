-- Check-in and the event wall.

-- Door code: a short code (and QR) the host shows at the entrance, for check-in without GPS.
-- wall_enabled: the host can turn an event's wall off.
ALTER TABLE events ADD COLUMN door_code TEXT;
ALTER TABLE events ADD COLUMN wall_enabled INTEGER NOT NULL DEFAULT 1;

-- Who checked in, how, and when. Never where: the location check happens on the phone,
-- which sends only "near the event" or not.
CREATE TABLE IF NOT EXISTS checkins (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  method TEXT NOT NULL CHECK (method IN ('gps', 'code', 'host')),
  visibility TEXT NOT NULL DEFAULT 'me' CHECK (visibility IN ('me', 'event')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  checked_out_at TEXT,
  PRIMARY KEY (event_id, user_id)
);
CREATE INDEX IF NOT EXISTS checkins_user ON checkins(user_id);

-- Photos posted to an event's wall. Media lives in R2 under wall/<user id>/<event id>/.
CREATE TABLE IF NOT EXISTS wall_posts (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  media_key TEXT NOT NULL,
  thumb_key TEXT,
  width INTEGER,
  height INTEGER,
  caption TEXT,
  anonymous INTEGER NOT NULL DEFAULT 0,
  -- The host picked it as a public highlight: visible to anyone with the event link.
  highlight INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'live' CHECK (status IN ('live', 'hidden', 'removed')),
  removed_by TEXT CHECK (removed_by IN ('author', 'host', 'moderator')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS wall_posts_event ON wall_posts(event_id, status, created_at);
CREATE INDEX IF NOT EXISTS wall_posts_user ON wall_posts(user_id);

-- Reports on wall posts. "remove-me" (someone shown in the photo) hides the post right away;
-- three reports of any kind hide it until a moderator looks.
CREATE TABLE IF NOT EXISTS wall_reports (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES wall_posts(id) ON DELETE CASCADE,
  reporter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'actioned', 'dismissed')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (post_id, reporter_id)
);
