-- Search and page lookups by artist or venue. lineup_slots is keyed (event_id, artist_id), so "every slot for this
-- artist" scanned the whole table; events had no index on venue_id. Same results, found by index instead of by scan.
CREATE INDEX IF NOT EXISTS lineup_slots_artist ON lineup_slots(artist_id, event_id);
CREATE INDEX IF NOT EXISTS events_venue ON events(venue_id, ends_at);
