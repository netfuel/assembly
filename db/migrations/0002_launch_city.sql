-- Launch city. Real data, not sample: production needs it for map center, zoom, and timezone.
INSERT OR IGNORE INTO cities (id, name, slug, timezone, center_lat, center_lng, default_zoom)
VALUES ('memphis', 'Memphis', 'memphis', 'America/Chicago', 35.1400, -90.0100, 12.2);
