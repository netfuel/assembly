-- An organizer can end a live event early. The end time moves to that moment, and this row says "no grace
-- period": without it, an event stays live for 30 minutes after its end time, for doors that run late.
CREATE TABLE IF NOT EXISTS event_ended (
  event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  ended_at TEXT NOT NULL,
  ended_by TEXT
);

-- Flyer downloads are on unless the organizer turns them off for an event (a row here means off).
CREATE TABLE IF NOT EXISTS flyer_downloads_off (
  event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE
);

-- Which Terms and Privacy policy version someone agreed to by signing in, and when.
ALTER TABLE users ADD COLUMN terms_version TEXT;
ALTER TABLE users ADD COLUMN terms_accepted_at TEXT;
