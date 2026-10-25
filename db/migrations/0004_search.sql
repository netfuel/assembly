-- Full-text search across events, artists, and venues (SQLite FTS5).
-- One index table; triggers keep it in step with every write path, including imports.
-- kind: 'event' | 'artist' | 'venue'. city_id is null for artists (they aren't tied to one city).
CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
  kind UNINDEXED,
  ref_id UNINDEXED,
  city_id UNINDEXED,
  name,
  body,
  tokenize = 'unicode61 remove_diacritics 2',
  prefix = '2 3'
);

-- Events: title as the name; pitch, venue, address, neighborhood, and lineup in the body.
-- Only public events are indexed: drafts and hidden events drop out.
CREATE TRIGGER IF NOT EXISTS search_event_insert AFTER INSERT ON events BEGIN
  INSERT INTO search_index (kind, ref_id, city_id, name, body)
  SELECT 'event', e.id, e.city_id, e.title,
         coalesce(e.pitch, '') || ' ' || coalesce(v.name, '') || ' ' || e.address || ' ' || coalesce(e.neighborhood, '') || ' ' ||
         coalesce((SELECT group_concat(a.name, ' ') FROM lineup_slots ls JOIN artists a ON a.id = ls.artist_id WHERE ls.event_id = e.id), '')
  FROM events e LEFT JOIN venues v ON v.id = e.venue_id
  WHERE e.id = NEW.id AND e.status IN ('live', 'cancelled');
END;

CREATE TRIGGER IF NOT EXISTS search_event_update AFTER UPDATE ON events BEGIN
  DELETE FROM search_index WHERE kind = 'event' AND ref_id = OLD.id;
  INSERT INTO search_index (kind, ref_id, city_id, name, body)
  SELECT 'event', e.id, e.city_id, e.title,
         coalesce(e.pitch, '') || ' ' || coalesce(v.name, '') || ' ' || e.address || ' ' || coalesce(e.neighborhood, '') || ' ' ||
         coalesce((SELECT group_concat(a.name, ' ') FROM lineup_slots ls JOIN artists a ON a.id = ls.artist_id WHERE ls.event_id = e.id), '')
  FROM events e LEFT JOIN venues v ON v.id = e.venue_id
  WHERE e.id = NEW.id AND e.status IN ('live', 'cancelled');
END;

CREATE TRIGGER IF NOT EXISTS search_event_delete AFTER DELETE ON events BEGIN
  DELETE FROM search_index WHERE kind = 'event' AND ref_id = OLD.id;
END;

-- Lineup changes rewrite the event's row so artist names stay searchable on it.
CREATE TRIGGER IF NOT EXISTS search_lineup_insert AFTER INSERT ON lineup_slots BEGIN
  DELETE FROM search_index WHERE kind = 'event' AND ref_id = NEW.event_id;
  INSERT INTO search_index (kind, ref_id, city_id, name, body)
  SELECT 'event', e.id, e.city_id, e.title,
         coalesce(e.pitch, '') || ' ' || coalesce(v.name, '') || ' ' || e.address || ' ' || coalesce(e.neighborhood, '') || ' ' ||
         coalesce((SELECT group_concat(a.name, ' ') FROM lineup_slots ls JOIN artists a ON a.id = ls.artist_id WHERE ls.event_id = e.id), '')
  FROM events e LEFT JOIN venues v ON v.id = e.venue_id
  WHERE e.id = NEW.event_id AND e.status IN ('live', 'cancelled');
END;

CREATE TRIGGER IF NOT EXISTS search_lineup_delete AFTER DELETE ON lineup_slots BEGIN
  DELETE FROM search_index WHERE kind = 'event' AND ref_id = OLD.event_id;
  INSERT INTO search_index (kind, ref_id, city_id, name, body)
  SELECT 'event', e.id, e.city_id, e.title,
         coalesce(e.pitch, '') || ' ' || coalesce(v.name, '') || ' ' || e.address || ' ' || coalesce(e.neighborhood, '') || ' ' ||
         coalesce((SELECT group_concat(a.name, ' ') FROM lineup_slots ls JOIN artists a ON a.id = ls.artist_id WHERE ls.event_id = e.id), '')
  FROM events e LEFT JOIN venues v ON v.id = e.venue_id
  WHERE e.id = OLD.event_id AND e.status IN ('live', 'cancelled');
END;

CREATE TRIGGER IF NOT EXISTS search_artist_insert AFTER INSERT ON artists BEGIN
  INSERT INTO search_index (kind, ref_id, city_id, name, body) VALUES ('artist', NEW.id, NULL, NEW.name, '');
END;
CREATE TRIGGER IF NOT EXISTS search_artist_update AFTER UPDATE OF name ON artists BEGIN
  DELETE FROM search_index WHERE kind = 'artist' AND ref_id = OLD.id;
  INSERT INTO search_index (kind, ref_id, city_id, name, body) VALUES ('artist', NEW.id, NULL, NEW.name, '');
END;
CREATE TRIGGER IF NOT EXISTS search_artist_delete AFTER DELETE ON artists BEGIN
  DELETE FROM search_index WHERE kind = 'artist' AND ref_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS search_venue_insert AFTER INSERT ON venues BEGIN
  INSERT INTO search_index (kind, ref_id, city_id, name, body)
  VALUES ('venue', NEW.id, NEW.city_id, NEW.name, NEW.address || ' ' || coalesce(NEW.neighborhood, '') || ' ' || NEW.type);
END;
CREATE TRIGGER IF NOT EXISTS search_venue_update AFTER UPDATE ON venues BEGIN
  DELETE FROM search_index WHERE kind = 'venue' AND ref_id = OLD.id;
  INSERT INTO search_index (kind, ref_id, city_id, name, body)
  VALUES ('venue', NEW.id, NEW.city_id, NEW.name, NEW.address || ' ' || coalesce(NEW.neighborhood, '') || ' ' || NEW.type);
END;
CREATE TRIGGER IF NOT EXISTS search_venue_delete AFTER DELETE ON venues BEGIN
  DELETE FROM search_index WHERE kind = 'venue' AND ref_id = OLD.id;
END;

-- Backfill what's already there.
DELETE FROM search_index;
INSERT INTO search_index (kind, ref_id, city_id, name, body)
SELECT 'event', e.id, e.city_id, e.title,
       coalesce(e.pitch, '') || ' ' || coalesce(v.name, '') || ' ' || e.address || ' ' || coalesce(e.neighborhood, '') || ' ' ||
       coalesce((SELECT group_concat(a.name, ' ') FROM lineup_slots ls JOIN artists a ON a.id = ls.artist_id WHERE ls.event_id = e.id), '')
FROM events e LEFT JOIN venues v ON v.id = e.venue_id
WHERE e.status IN ('live', 'cancelled');
INSERT INTO search_index (kind, ref_id, city_id, name, body) SELECT 'artist', id, NULL, name, '' FROM artists;
INSERT INTO search_index (kind, ref_id, city_id, name, body)
SELECT 'venue', id, city_id, name, address || ' ' || coalesce(neighborhood, '') || ' ' || type FROM venues;
