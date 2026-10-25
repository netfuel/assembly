import { useEffect, useRef } from "react";
import { Map as MapLibre, setWorkerUrl, type MapLayerMouseEvent } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import "maplibre-gl/dist/maplibre-gl.css";
import { mapPalette, mapStyle, type MapTheme } from "./mapStyle";
import { isLive } from "../lib/time";
import type { EventSummary } from "../../shared/types";
import { hasThumb, syncThumbs, thumbImageId } from "./thumbPins";
import "./map.css";

// MapLibre 6 computes its worker path at runtime, which bundlers can't follow. Point it at the emitted file.
setWorkerUrl(workerUrl);

const SOURCE = "events";

function toGeoJSON(events: EventSummary[], now: Date): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: events.map((e) => ({
      type: "Feature",
      id: e.id,
      geometry: { type: "Point", coordinates: [e.lng, e.lat] },
      properties: {
        id: e.id,
        title: e.title,
        queer: e.scenes.includes("queer"),
        cancelled: e.status === "cancelled",
        live: e.status !== "cancelled" && isLive(e.startsAt, e.endsAt, now),
        going: e.goingCount,
        // Empty until the thumbnail has loaded; the symbol layer only draws pins that have one.
        thumb: hasThumb(e.id) ? thumbImageId(e.id) : "",
      },
    })),
  };
}

type GeoSource = { setData(data: GeoJSON.GeoJSON): unknown };

export function MapView({
  events,
  center,
  zoom,
  selectedId,
  onSelect,
  focus,
  theme,
}: {
  events: EventSummary[];
  center: [number, number];
  zoom: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** When this changes, the map flies to the coordinate. */
  focus: { lng: number; lat: number; key: number } | null;
  theme: MapTheme;
}) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibre | null>(null);
  const ready = useRef(false);
  const loadThumbsRef = useRef<(() => void) | null>(null);
  const latest = useRef({ events, selectedId, onSelect, theme });
  latest.current = { events, selectedId, onSelect, theme };

  // Create the map once.
  useEffect(() => {
    if (!container.current) return;
    const map = new MapLibre({
      container: container.current,
      style: mapStyle(theme),
      center,
      zoom,
      minZoom: 9,
      maxZoom: 18,
      attributionControl: { compact: true },
      pitchWithRotate: false,
      dragRotate: false,
    });
    map.touchZoomRotate.disableRotation();
    mapRef.current = map;

    // Event layers are added on every style load, so they come back after a theme switch.
    map.on("style.load", () => {
      const MAP_COLORS = mapPalette(latest.current.theme);
      map.addSource(SOURCE, { type: "geojson", data: toGeoJSON(latest.current.events, new Date()), promoteId: "id" });

      const color: unknown = ["case", ["get", "queer"], MAP_COLORS.uv, MAP_COLORS.sodium];
      // Pin size grows with RSVPs, capped so a big party doesn't swallow the block.
      const haloRadius: unknown = ["interpolate", ["linear"], ["get", "going"], 0, 12, 100, 18, 400, 26];

      map.addLayer({
        id: "event-halo",
        type: "circle",
        source: SOURCE,
        paint: {
          "circle-radius": haloRadius as never,
          "circle-color": ["case", ["get", "live"], MAP_COLORS.live, color] as never,
          "circle-opacity": ["case", ["get", "live"], 0.35, ["get", "cancelled"], 0, 0.2],
          "circle-blur": 0.4,
        },
      });
      map.addLayer({
        id: "event-selected",
        type: "circle",
        source: SOURCE,
        filter: ["==", ["get", "id"], ""],
        paint: { "circle-radius": 14, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": MAP_COLORS.accent, "circle-stroke-width": 1.5 },
      });
      map.addLayer({
        id: "event-core",
        type: "circle",
        source: SOURCE,
        paint: {
          "circle-radius": 6,
          "circle-color": color as never,
          "circle-opacity": ["case", ["get", "cancelled"], 0.35, 1],
          "circle-stroke-opacity": ["case", ["get", "cancelled"], 0.35, 1],
          "circle-stroke-color": MAP_COLORS.halo,
          "circle-stroke-width": 2,
        },
      });
      // Zoomed in, events with a flyer show it as the pin.
      map.addLayer({
        id: "event-thumb",
        type: "symbol",
        source: SOURCE,
        minzoom: 13,
        filter: ["!=", ["get", "thumb"], ""],
        layout: {
          "icon-image": ["get", "thumb"],
          "icon-size": ["interpolate", ["linear"], ["zoom"], 13, 0.75, 16, 1.15],
          "icon-allow-overlap": true,
          "icon-anchor": "center",
        },
        paint: { "icon-opacity": ["case", ["get", "cancelled"], 0.4, 1] },
      });
      map.addLayer({
        id: "event-label",
        type: "symbol",
        source: SOURCE,
        minzoom: 14,
        layout: {
          "text-field": ["get", "title"],
          "text-font": ["Noto Sans Regular"],
          "text-size": 12,
          "text-offset": ["case", ["!=", ["get", "thumb"], ""], ["literal", [0, -2.4]], ["literal", [0, -1.6]]],
          "text-anchor": "bottom",
          "text-allow-overlap": false,
        },
        paint: { "text-color": MAP_COLORS.fg, "text-halo-color": MAP_COLORS.halo, "text-halo-width": 2 },
      });

      ready.current = true;
      applySelection(map, latest.current.selectedId);
      loadThumbs();
    });

    // Thumbnails load in the background; refresh the pins as each one arrives.
    let refresh = 0;
    const loadThumbs = () =>
      syncThumbs(map, latest.current.events, mapPalette(latest.current.theme), () => {
        cancelAnimationFrame(refresh);
        refresh = requestAnimationFrame(() => {
          (map.getSource(SOURCE) as unknown as GeoSource | undefined)?.setData(toGeoJSON(latest.current.events, new Date()));
        });
      });
    loadThumbsRef.current = loadThumbs;

    // Layer-scoped listeners live on the map, so they survive style changes. Register once.
    const pick = (e: MapLayerMouseEvent) => {
      const id = e.features?.[0]?.properties?.id as string | undefined;
      if (id) latest.current.onSelect(id);
    };
    map.on("click", "event-halo", pick);
    map.on("click", "event-core", pick);
    map.on("click", "event-thumb", pick);
    for (const layer of ["event-halo", "event-core", "event-thumb"]) {
      map.on("mouseenter", layer, () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", layer, () => (map.getCanvas().style.cursor = ""));
    }

    // Live pins breathe. Skipped when the viewer prefers reduced motion.
    let raf = 0;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduce) {
      const tick = (t: number) => {
        if (ready.current && map.getLayer("event-halo")) {
          const phase = (Math.sin(t / 450) + 1) / 2;
          map.setPaintProperty("event-halo", "circle-opacity", ["case", ["get", "live"], 0.15 + phase * 0.4, ["get", "cancelled"], 0, 0.2]);
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }

    return () => {
      cancelAnimationFrame(raf);
      ready.current = false;
      map.remove();
      mapRef.current = null;
    };
    // The map is created once; center and zoom only seed it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Swap the basemap when the theme changes; style.load re-adds the event layers.
  const firstTheme = useRef(theme);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || theme === firstTheme.current) return;
    firstTheme.current = theme;
    ready.current = false;
    map.setStyle(mapStyle(theme), { diff: false });
  }, [theme]);

  // Keep pins in sync with filters and data.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready.current) return;
    (map.getSource(SOURCE) as unknown as GeoSource | undefined)?.setData(toGeoJSON(events, new Date()));
    loadThumbsRef.current?.();
  }, [events]);

  useEffect(() => {
    const map = mapRef.current;
    if (map && ready.current) applySelection(map, selectedId);
  }, [selectedId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focus) return;
    const wide = window.matchMedia("(min-width: 900px)").matches;
    map.flyTo({
      center: [focus.lng, focus.lat],
      zoom: Math.max(map.getZoom(), 14),
      // Keep the pin visible beside the side panel or above the bottom sheet.
      padding: wide ? { right: 440, left: 0, top: 0, bottom: 0 } : { bottom: window.innerHeight * 0.45, top: 0, left: 0, right: 0 },
      duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 700,
    });
  }, [focus]);

  return <div ref={container} className="map" role="region" aria-label="Map of events" />;
}

function applySelection(map: MapLibre, id: string | null) {
  if (map.getLayer("event-selected")) map.setFilter("event-selected", ["==", ["get", "id"], id ?? ""]);
  // The open event's flyer pin sits on top and a little larger.
  if (map.getLayer("event-thumb")) {
    map.setLayoutProperty("event-thumb", "symbol-sort-key", ["case", ["==", ["get", "id"], id ?? ""], 1, 0]);
    map.setLayoutProperty("event-thumb", "icon-size", [
      "interpolate", ["linear"], ["zoom"],
      13, ["case", ["==", ["get", "id"], id ?? ""], 0.95, 0.75],
      16, ["case", ["==", ["get", "id"], id ?? ""], 1.4, 1.15],
    ]);
  }
}
