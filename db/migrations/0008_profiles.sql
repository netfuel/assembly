-- Artist, venue and organizer pages (/a/<slug>, /v/<slug>, /o/<slug>).
-- Pages are created by posting: an organizer's lineup creates artists, and venues come from the venue list.
-- The artist or venue can claim theirs; after that only the owner or a moderator edits it.

-- Artists: a short bio, a photo, and a home city (backfilled from the city of their first show).
ALTER TABLE artists ADD COLUMN bio TEXT;
ALTER TABLE artists ADD COLUMN photo_key TEXT;
ALTER TABLE artists ADD COLUMN city_id TEXT REFERENCES cities(id);
ALTER TABLE artists ADD COLUMN updated_at TEXT;
UPDATE artists SET city_id = (
  SELECT e.city_id FROM lineup_slots s JOIN events e ON e.id = s.event_id
  WHERE s.artist_id = artists.id ORDER BY e.starts_at LIMIT 1
) WHERE city_id IS NULL;
UPDATE artists SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE updated_at IS NULL;

-- Venues: a readable slug, a bio, a photo, links, door and access notes, and house policy tags.
ALTER TABLE venues ADD COLUMN slug TEXT;
ALTER TABLE venues ADD COLUMN bio TEXT;
ALTER TABLE venues ADD COLUMN photo_key TEXT;
ALTER TABLE venues ADD COLUMN links TEXT NOT NULL DEFAULT '{}';
-- Entrance, parking, transit, accessibility: shown on the venue page.
ALTER TABLE venues ADD COLUMN access_notes TEXT;
-- Age policy and other door tags the venue always has (same ids as events.policy_tags).
ALTER TABLE venues ADD COLUMN house_policy TEXT NOT NULL DEFAULT '[]';
ALTER TABLE venues ADD COLUMN updated_at TEXT;
-- Imported and seeded ids already read like slugs ("venue-hi-tone", "sample-room-9"): drop the prefix.
UPDATE venues SET slug = CASE
  WHEN id LIKE 'venue-%' THEN substr(id, 7)
  WHEN id LIKE 'sample-%' THEN substr(id, 8)
  ELSE id END
WHERE slug IS NULL;
-- Any collision left after that keeps the full id, which is unique.
UPDATE venues SET slug = id WHERE slug IN (SELECT slug FROM venues GROUP BY slug HAVING COUNT(*) > 1);
CREATE UNIQUE INDEX IF NOT EXISTS venues_slug ON venues(slug);
UPDATE venues SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE updated_at IS NULL;

-- Claims: someone asks to own an artist or venue page; a moderator approves or declines.
CREATE TABLE IF NOT EXISTS page_claims (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL CHECK (target_type IN ('artist', 'venue')),
  target_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- How to verify them: "DM from our Instagram", "I book the room", a link.
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'approved', 'declined')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  decided_at TEXT,
  decided_by TEXT
);
CREATE INDEX IF NOT EXISTS page_claims_open ON page_claims(status, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS page_claims_one_open ON page_claims(target_type, target_id, user_id) WHERE status = 'open';

-- Reports can now name an artist or venue page. SQLite can't alter a CHECK, so rebuild the table.
CREATE TABLE reports_new (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL CHECK (target_type IN ('event', 'user', 'artist', 'venue')),
  target_id TEXT NOT NULL,
  reporter_id TEXT NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'actioned', 'dismissed')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
INSERT INTO reports_new (id, target_type, target_id, reporter_id, reason, status, created_at)
  SELECT id, target_type, target_id, reporter_id, reason, status, created_at FROM reports;
DROP TABLE reports;
ALTER TABLE reports_new RENAME TO reports;
CREATE INDEX IF NOT EXISTS reports_target ON reports(target_type, target_id);
