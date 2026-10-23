-- Assembly launch schema: the ten tables from the PRD data model.
-- Times are ISO 8601 UTC strings. JSON columns hold arrays or objects as text.

CREATE TABLE cities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  timezone TEXT NOT NULL,
  center_lat REAL NOT NULL,
  center_lng REAL NOT NULL,
  default_zoom REAL NOT NULL DEFAULT 12
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  pronouns TEXT,
  bio TEXT,
  scenes TEXT NOT NULL DEFAULT '[]',
  links TEXT NOT NULL DEFAULT '{}',
  show_attendance INTEGER NOT NULL DEFAULT 0,
  is_verified_organizer INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE identities (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('google', 'apple')),
  provider_subject TEXT NOT NULL,
  email TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (provider, provider_subject)
);
CREATE INDEX identities_user ON identities(user_id);

CREATE TABLE venues (
  id TEXT PRIMARY KEY,
  city_id TEXT NOT NULL REFERENCES cities(id),
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('diy', 'warehouse', 'bar', 'club', 'outdoor', 'other')),
  address TEXT NOT NULL,
  neighborhood TEXT,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  claimed_by TEXT REFERENCES users(id)
);
CREATE INDEX venues_city ON venues(city_id);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  city_id TEXT NOT NULL REFERENCES cities(id),
  venue_id TEXT REFERENCES venues(id),
  title TEXT NOT NULL,
  pitch TEXT,
  description TEXT,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  address TEXT NOT NULL,
  neighborhood TEXT,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  getting_there TEXT,
  door_price TEXT,
  ticket_url TEXT,
  policy_tags TEXT NOT NULL DEFAULT '[]',
  scenes TEXT NOT NULL DEFAULT '[]',
  flyer_key TEXT,
  video_id TEXT,
  status TEXT NOT NULL DEFAULT 'live' CHECK (status IN ('draft', 'live', 'cancelled', 'hidden')),
  is_sample INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX events_city_time ON events(city_id, status, starts_at);
CREATE INDEX events_geo ON events(lat, lng);

CREATE TABLE event_hosts (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'cohost')),
  PRIMARY KEY (event_id, user_id)
);
CREATE INDEX event_hosts_user ON event_hosts(user_id);

CREATE TABLE artists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  links TEXT NOT NULL DEFAULT '{}',
  claimed_by TEXT REFERENCES users(id)
);

CREATE TABLE lineup_slots (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  artist_id TEXT NOT NULL REFERENCES artists(id),
  set_start TEXT,
  set_end TEXT,
  room TEXT,
  note TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (event_id, artist_id)
);

CREATE TABLE rsvps (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('going', 'interested')),
  visible INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (event_id, user_id)
);
CREATE INDEX rsvps_user ON rsvps(user_id);

CREATE TABLE reports (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL CHECK (target_type IN ('event', 'user')),
  target_id TEXT NOT NULL,
  reporter_id TEXT NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'actioned', 'dismissed')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX reports_target ON reports(target_type, target_id);
