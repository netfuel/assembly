-- Sample data for local development and demos.
-- Venues, artists, and addresses are fictional. Neighborhood names are real Memphis areas.
-- Event times are relative to when the seed runs; re-run `npm run db:seed:local` to refresh them.

DELETE FROM lineup_slots WHERE event_id IN (SELECT id FROM events WHERE is_sample = 1);
DELETE FROM rsvps WHERE event_id IN (SELECT id FROM events WHERE is_sample = 1);
DELETE FROM events WHERE is_sample = 1;
DELETE FROM artists WHERE id LIKE 'sample-%';
DELETE FROM venues WHERE id LIKE 'sample-%';

INSERT OR IGNORE INTO cities (id, name, slug, timezone, center_lat, center_lng, default_zoom)
VALUES ('memphis', 'Memphis', 'memphis', 'America/Chicago', 35.1400, -90.0100, 12.2);

INSERT INTO venues (id, city_id, name, type, address, neighborhood, lat, lng) VALUES
('sample-static-annex', 'memphis', 'Static Annex', 'warehouse', 'Sample address, rear loading dock', 'South Main', 35.1318, -90.0566),
('sample-moth-house', 'memphis', 'Moth House', 'diy', 'Sample address, basement entrance on the side', 'Cooper-Young', 35.1188, -89.9912),
('sample-velvet-ditch', 'memphis', 'Velvet Ditch', 'bar', 'Sample address, upstairs', 'Midtown', 35.1372, -90.0035),
('sample-room-9', 'memphis', 'Room 9', 'club', 'Sample address, below the record shop', 'Overton Square', 35.1497, -89.9929),
('sample-pulp', 'memphis', 'Pulp Warehouse', 'warehouse', 'Sample address, gate on the north side', 'Crosstown', 35.1523, -90.0128),
('sample-low-ceiling', 'memphis', 'Low Ceiling', 'club', 'Sample address, stairs behind the diner', 'Downtown', 35.1452, -90.0505),
('sample-greenhouse', 'memphis', 'Greenhouse Lot', 'outdoor', 'Sample address, enter through the garden gate', 'Binghampton', 35.1441, -89.9489),
('sample-lantern', 'memphis', 'The Lantern', 'bar', 'Sample address, back patio', 'Broad Ave', 35.1479, -89.9651);

INSERT INTO artists (id, name, slug, links) VALUES
('sample-juno-ray', 'Juno Ray', 'juno-ray', '{"soundcloud":"https://soundcloud.com/","instagram":"https://instagram.com/"}'),
('sample-kitten-static', 'Kitten Static', 'kitten-static', '{"mixcloud":"https://www.mixcloud.com/"}'),
('sample-mister-ozone', 'Mister Ozone', 'mister-ozone', '{"bandcamp":"https://bandcamp.com/","ra":"https://ra.co/"}'),
('sample-soft-ditch', 'Soft Ditch', 'soft-ditch', '{"bandcamp":"https://bandcamp.com/"}'),
('sample-gravel-saints', 'Gravel Saints', 'gravel-saints', '{"instagram":"https://instagram.com/"}'),
('sample-dalia-k', 'Dalia K', 'dalia-k', '{"soundcloud":"https://soundcloud.com/","ra":"https://ra.co/"}'),
('sample-form-three', 'Form Three', 'form-three', '{"soundcloud":"https://soundcloud.com/"}'),
('sample-tuff-gong-jr', 'Tuff Gong Jr', 'tuff-gong-jr', '{"mixcloud":"https://www.mixcloud.com/"}'),
('sample-dj-pallet', 'DJ Pallet', 'dj-pallet', '{"soundcloud":"https://soundcloud.com/"}'),
('sample-petal-grip', 'Petal Grip', 'petal-grip', '{"bandcamp":"https://bandcamp.com/"}'),
('sample-big-aunt', 'Big Aunt', 'big-aunt', '{"instagram":"https://instagram.com/"}'),
('sample-lou-vega', 'Lou Vega', 'lou-vega', '{"spotify":"https://open.spotify.com/"}'),
('sample-neon-debt', 'Neon Debt', 'neon-debt', '{"soundcloud":"https://soundcloud.com/"}'),
('sample-halle-burn', 'Halle Burn', 'halle-burn', '{"ra":"https://ra.co/"}');

-- strftime offsets: 'start of day' is midnight UTC; +27 hours is about 9 to 10 pm in Memphis the same evening.
INSERT INTO events (id, city_id, venue_id, title, pitch, starts_at, ends_at, address, neighborhood, lat, lng, getting_there, door_price, ticket_url, policy_tags, scenes, status, is_sample)
SELECT 'sample-wet-paint', 'memphis', v.id, 'Wet Paint', 'Queer house all night',
  strftime('%Y-%m-%dT%H:%M:%SZ', 'now', 'start of day', '+27 hours'),
  strftime('%Y-%m-%dT%H:%M:%SZ', 'now', 'start of day', '+32 hours'),
  v.address, v.neighborhood, v.lat, v.lng, 'Street parking on the square; rideshare drop at the corner', '$10 door, $8 advance', 'https://example.com/tickets/wet-paint',
  '["21+","queer-centered","no-photos"]', '["queer","house","bar"]', 'live', 1
FROM venues v WHERE v.id = 'sample-room-9';

INSERT INTO events (id, city_id, venue_id, title, pitch, starts_at, ends_at, address, neighborhood, lat, lng, getting_there, door_price, ticket_url, policy_tags, scenes, status, is_sample)
SELECT 'sample-moth-house', 'memphis', v.id, 'Moth House show', 'Three bands in a basement',
  strftime('%Y-%m-%dT%H:%M:%SZ', 'now', 'start of day', '+25 hours'),
  strftime('%Y-%m-%dT%H:%M:%SZ', 'now', 'start of day', '+28 hours'),
  v.address, v.neighborhood, v.lat, v.lng, 'Bike rack out front; please keep it quiet on the porch', 'Sliding scale $5 to $15', NULL,
  '["all-ages","sliding-scale","byob"]', '["diy","live"]', 'live', 1
FROM venues v WHERE v.id = 'sample-moth-house';

INSERT INTO events (id, city_id, venue_id, title, pitch, starts_at, ends_at, address, neighborhood, lat, lng, getting_there, door_price, ticket_url, policy_tags, scenes, status, is_sample)
SELECT 'sample-static', 'memphis', v.id, 'Static: six hours', 'Warehouse techno, one room',
  strftime('%Y-%m-%dT%H:%M:%SZ', 'now', 'start of day', '+52 hours'),
  strftime('%Y-%m-%dT%H:%M:%SZ', 'now', 'start of day', '+58 hours'),
  v.address, v.neighborhood, v.lat, v.lng, 'Lot behind the building; trolley stop two blocks north', '$20 advance', 'https://example.com/tickets/static',
  '["21+","harm-reduction"]', '["rave","techno"]', 'live', 1
FROM venues v WHERE v.id = 'sample-static-annex';

INSERT INTO events (id, city_id, venue_id, title, pitch, starts_at, ends_at, address, neighborhood, lat, lng, getting_there, door_price, ticket_url, policy_tags, scenes, status, is_sample)
SELECT 'sample-low-ceiling', 'memphis', v.id, 'Low Ceiling', 'Jungle, footwork, Memphis rap edits',
  strftime('%Y-%m-%dT%H:%M:%SZ', 'now', 'start of day', '+51 hours'),
  strftime('%Y-%m-%dT%H:%M:%SZ', 'now', 'start of day', '+55 hours'),
  v.address, v.neighborhood, v.lat, v.lng, NULL, '$5 before 11', NULL,
  '["21+"]', '["rave","bass","bar"]', 'live', 1
FROM venues v WHERE v.id = 'sample-low-ceiling';

INSERT INTO events (id, city_id, venue_id, title, pitch, starts_at, ends_at, address, neighborhood, lat, lng, getting_there, door_price, ticket_url, policy_tags, scenes, status, is_sample)
SELECT 'sample-greenhouse', 'memphis', v.id, 'Greenhouse Sundays', 'Open-air disco until dark',
  strftime('%Y-%m-%dT%H:%M:%SZ', 'now', 'start of day', '+68 hours'),
  strftime('%Y-%m-%dT%H:%M:%SZ', 'now', 'start of day', '+74 hours'),
  v.address, v.neighborhood, v.lat, v.lng, 'Bring water and a layer for after sunset', 'Free with RSVP', NULL,
  '["all-ages","queer-centered","accessible-entrance"]', '["queer","house","diy"]', 'live', 1
FROM venues v WHERE v.id = 'sample-greenhouse';

INSERT INTO events (id, city_id, venue_id, title, pitch, starts_at, ends_at, address, neighborhood, lat, lng, getting_there, door_price, ticket_url, policy_tags, scenes, status, is_sample)
SELECT 'sample-tender-tuesdays', 'memphis', v.id, 'Tender Tuesdays', 'Disco edits at the bar',
  strftime('%Y-%m-%dT%H:%M:%SZ', 'now', 'start of day', '+122 hours'),
  strftime('%Y-%m-%dT%H:%M:%SZ', 'now', 'start of day', '+126 hours'),
  v.address, v.neighborhood, v.lat, v.lng, NULL, 'Free', NULL,
  '["21+"]', '["house","bar"]', 'live', 1
FROM venues v WHERE v.id = 'sample-velvet-ditch';

INSERT INTO events (id, city_id, venue_id, title, pitch, starts_at, ends_at, address, neighborhood, lat, lng, getting_there, door_price, ticket_url, policy_tags, scenes, status, is_sample)
SELECT 'sample-pulp', 'memphis', v.id, 'Pulp After Dark', 'Costume rave, two rooms',
  strftime('%Y-%m-%dT%H:%M:%SZ', 'now', 'start of day', '+219 hours'),
  strftime('%Y-%m-%dT%H:%M:%SZ', 'now', 'start of day', '+226 hours'),
  v.address, v.neighborhood, v.lat, v.lng, 'Rideshare strongly recommended; no parking on the street', '$25 advance, $35 door', 'https://example.com/tickets/pulp',
  '["21+","harm-reduction","queer-centered"]', '["rave","techno","queer","diy"]', 'live', 1
FROM venues v WHERE v.id = 'sample-pulp';

INSERT INTO events (id, city_id, venue_id, title, pitch, starts_at, ends_at, address, neighborhood, lat, lng, getting_there, door_price, ticket_url, policy_tags, scenes, status, is_sample)
SELECT 'sample-lantern', 'memphis', v.id, 'Lantern vinyl hour', '45s and cheap beer',
  strftime('%Y-%m-%dT%H:%M:%SZ', 'now', 'start of day', '+22 hours'),
  strftime('%Y-%m-%dT%H:%M:%SZ', 'now', 'start of day', '+29 hours'),
  v.address, v.neighborhood, v.lat, v.lng, NULL, 'Free', NULL,
  '["21+"]', '["bar","house"]', 'live', 1
FROM venues v WHERE v.id = 'sample-lantern';

INSERT INTO lineup_slots (event_id, artist_id, set_start, room, note, position) VALUES
('sample-wet-paint', 'sample-juno-ray', '10:00 pm', NULL, 'warmup, disco', 0),
('sample-wet-paint', 'sample-kitten-static', '12:00 am', NULL, 'house', 1),
('sample-wet-paint', 'sample-mister-ozone', '1:30 am', NULL, 'acid and ghetto house', 2),
('sample-moth-house', 'sample-soft-ditch', '8:00 pm', NULL, 'noise pop', 0),
('sample-moth-house', 'sample-gravel-saints', '9:00 pm', NULL, 'post-punk', 1),
('sample-static', 'sample-dalia-k', '11:00 pm', NULL, 'hypnotic', 0),
('sample-static', 'sample-form-three', '1:00 am', NULL, 'hardgroove', 1),
('sample-low-ceiling', 'sample-tuff-gong-jr', '10:00 pm', NULL, 'jungle', 0),
('sample-low-ceiling', 'sample-dj-pallet', '12:00 am', NULL, 'footwork and phonk', 1),
('sample-greenhouse', 'sample-petal-grip', '3:00 pm', NULL, 'balearic', 0),
('sample-greenhouse', 'sample-big-aunt', '5:30 pm', NULL, 'disco', 1),
('sample-tender-tuesdays', 'sample-lou-vega', '9:00 pm', NULL, 'edits all night', 0),
('sample-pulp', 'sample-neon-debt', '10:00 pm', 'Room A', 'electro', 0),
('sample-pulp', 'sample-halle-burn', '12:00 am', 'Room A', 'techno', 1),
('sample-pulp', 'sample-dalia-k', '2:00 am', 'Room B', 'trance', 2);
