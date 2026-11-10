-- Check-in achievements. A mark is earned from check-ins only, computed on the server (worker/achievements.ts).
-- One row per person, mark and the event that completed it. The rows follow the check-in: if it is removed
-- (or the event or account goes), the mark is recomputed or goes with it.
CREATE TABLE IF NOT EXISTS achievements (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  achievement_id TEXT NOT NULL,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  earned_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  -- The person hid this one: friends never see it.
  hidden INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, achievement_id, event_id)
);
CREATE INDEX IF NOT EXISTS achievements_event ON achievements(event_id);

-- Hidden-marks setting: 1 hides every mark from friends. Friends otherwise see only a mark's name and date.
ALTER TABLE users ADD COLUMN marks_hidden INTEGER NOT NULL DEFAULT 0;
-- Opt-in: also show friends the venue and the time of day each visible mark was earned.
ALTER TABLE users ADD COLUMN marks_share_detail INTEGER NOT NULL DEFAULT 0;
