import { useEffect, useRef } from "react";
import { Map as MapLibre, setWorkerUrl, type FilterSpecification, type MapLayerMouseEvent } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import "maplibre-gl/dist/maplibre-gl.css";
import { mapPalette, mapStyle, type MapTheme } from "./mapStyle";
import { isLive } from "../lib/time";
import type { EventSummary, FriendAt } from "../../shared/types";
import { FriendMarkers } from "./friendMarkers";
import { hasThumb, syncThumbs, thumbImageId } from "./thumbPins";
import { MyLocationMarker } from "./myLocation";
import type { Position } from "../lib/location";
import "./map.css";

// MapLibre 6 computes its worker path at runtime, which bundlers can't follow. Point it at the emitted file.
setWorkerUrl(workerUrl);

const SOURCE = "events";
const SELECTED_SOURCE = "event-selected";
const HOVER_SOURCE = "event-hover";
/** Pins cluster up to this zoom; flyer pins start one level later. */
const CLUSTER_MAX_ZOOM = 12;
const UNCLUSTERED: FilterSpecification = ["!", ["has", "point_count"]];

function selectedFeature(events: EventSummary[], id: string | null): GeoJSON.FeatureCollection {
  const e = id ? events.find((x) => x.id === id) : null;
  return {
    type: "FeatureCollection",
    features: e ? [{ type: "Feature", geometry: { type: "Point", coordinates: [e.lng, e.lat] }, properties: { id: e.id } }] : [],
  };
}

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
        here: e.hereNow ?? 0,
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
  highlight = null,
  fit = null,
  myPosition = null,
  friends = {},
  followMe = false,
  onUnfollow,
}: {
  /** Friends going to or at events: faces above those pins. */
  friends?: Record<string, FriendAt[]>;
  /** The viewer's own position (stays on the device): drawn as a dot. */
  myPosition?: Position | null;
  /** Keep the map centered on the viewer's dot until they pan away. */
  followMe?: boolean;
  /** The viewer dragged or zoomed the map by hand while following. */
  onUnfollow?: () => void;
  /** When this changes, the map frames all these points (search results). */
  fit?: { key: number; points: [number, number][]; minZoom?: number } | null;
  events: EventSummary[];
  /** A card the person is looking at in the rail: its pin gets a ring. `follow` pans the map to it if it's off screen. */
  highlight?: { id: string; follow: boolean } | null;
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
  const friendMarkers = useRef<FriendMarkers | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const ready = useRef(false);
  const loadThumbsRef = useRef<(() => void) | null>(null);
  const latest = useRef({ events, selectedId, onSelect, theme, highlight, onUnfollow });
  latest.current = { events, selectedId, onSelect, theme, highlight, onUnfollow };
  const meMarker = useRef<MyLocationMarker | null>(null);

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
    meMarker.current = new MyLocationMarker(map);
    // A hand on the map ends follow mode; programmatic moves (flyTo, easeTo) have no originalEvent.
    map.on("dragstart", () => latest.current.onUnfollow?.());
    map.on("zoomstart", (e) => {
      if ((e as { originalEvent?: Event }).originalEvent) latest.current.onUnfollow?.();
    });
    // First full draw (style and visible tiles): the splash waits for this before revealing the app.
    map.once("load", () => window.dispatchEvent(new Event("assembly:map-ready")));

    // Event layers are added on every style load, so they come back after a theme switch.
    map.on("style.load", () => {
      const MAP_COLORS = mapPalette(latest.current.theme);
      // Clustered at city zoom so a busy night reads as a few counts, not a pile of pins.
      map.addSource(SOURCE, {
        type: "geojson",
        data: toGeoJSON(latest.current.events, new Date()),
        promoteId: "id",
        cluster: true,
        clusterMaxZoom: CLUSTER_MAX_ZOOM,
        clusterRadius: 44,
        clusterProperties: {
          queer: ["+", ["case", ["get", "queer"], 1, 0]],
          live: ["+", ["case", ["get", "live"], 1, 0]],
        },
      });
      // The open event keeps its ring even when its pin is inside a cluster.
      map.addSource(SELECTED_SOURCE, { type: "geojson", data: selectedFeature(latest.current.events, latest.current.selectedId) });
      map.addSource(HOVER_SOURCE, { type: "geojson", data: selectedFeature(latest.current.events, latest.current.highlight?.id ?? null) });

      const color: unknown = ["case", ["get", "queer"], MAP_COLORS.uv, MAP_COLORS.sodium];
      // Pin size grows with RSVPs, capped so a big party doesn't swallow the block.
      // A filling room (people checked in) makes the halo bigger still, up to 10 px more.
      const haloRadius: unknown = ["+", ["interpolate", ["linear"], ["get", "going"], 0, 12, 100, 18, 400, 26], ["min", ["*", ["get", "here"], 0.25], 10]];

      map.addLayer({
        id: "event-halo",
        type: "circle",
        source: SOURCE,
        filter: UNCLUSTERED,
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
        source: SELECTED_SOURCE,
        paint: { "circle-radius": 14, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": MAP_COLORS.accent, "circle-stroke-width": 1.5 },
      });
      map.addLayer({
        id: "event-core",
        type: "circle",
        source: SOURCE,
        filter: UNCLUSTERED,
        paint: {
          "circle-radius": 6,
          "circle-color": color as never,
          "circle-opacity": ["case", ["get", "cancelled"], 0.35, 1],
          "circle-stroke-opacity": ["case", ["get", "cancelled"], 0.35, 1],
          "circle-stroke-color": MAP_COLORS.halo,
          "circle-stroke-width": 2,
        },
      });
      // Queer-centered pins also get an outer ring, so they don't rely on violet vs orange alone (color-blind safe).
      map.addLayer({
        id: "event-queer-ring",
        type: "circle",
        source: SOURCE,
        filter: ["all", UNCLUSTERED, ["get", "queer"]] as FilterSpecification,
        paint: {
          "circle-radius": 10,
          "circle-color": "rgba(0,0,0,0)",
          "circle-stroke-color": MAP_COLORS.uv,
          "circle-stroke-width": 1.5,
          "circle-stroke-opacity": ["case", ["get", "cancelled"], 0.35, 1],
        },
      });
      // Clusters: size by count, UV when most are queer-centered, a magenta ring when any are live.
      map.addLayer({
        id: "cluster",
        type: "circle",
        source: SOURCE,
        filter: ["has", "point_count"],
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["get", "point_count"], 2, 15, 10, 20, 50, 28, 200, 36],
          "circle-color": ["case", [">", ["/", ["get", "queer"], ["get", "point_count"]], 0.5], MAP_COLORS.uv, MAP_COLORS.sodium] as never,
          "circle-opacity": 0.92,
          "circle-stroke-color": ["case", [">", ["get", "live"], 0], MAP_COLORS.live, MAP_COLORS.halo] as never,
          "circle-stroke-width": ["case", [">", ["get", "live"], 0], 3, 2],
        },
      });
      map.addLayer({
        id: "cluster-count",
        type: "symbol",
        source: SOURCE,
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-font": ["Noto Sans Bold"],
          "text-size": 13,
          "text-allow-overlap": true,
        },
        paint: { "text-color": "#0a0a0b" },
      });

      // The card you're looking at in the rail. Drawn above clusters so it shows even inside one.
      map.addLayer({
        id: "event-hover",
        type: "circle",
        source: HOVER_SOURCE,
        paint: {
          "circle-radius": 17,
          "circle-color": "rgba(0,0,0,0)",
          "circle-stroke-color": MAP_COLORS.fg,
          "circle-stroke-width": 2,
          "circle-stroke-opacity": 0.85,
        },
      });

      // Zoomed in, events with a flyer show it as the pin.
      map.addLayer({
        id: "event-thumb",
        type: "symbol",
        source: SOURCE,
        minzoom: 13,
        filter: ["all", UNCLUSTERED, ["!=", ["get", "thumb"], ""]] as FilterSpecification,
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
        filter: UNCLUSTERED,
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
      applySelection(map, latest.current.selectedId, latest.current.events);
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
    map.on("click", "cluster", async (e) => {
      const f = e.features?.[0];
      if (!f) return;
      const source = map.getSource(SOURCE) as unknown as { getClusterExpansionZoom(id: number): Promise<number> };
      const zoom = await source.getClusterExpansionZoom(f.properties?.cluster_id as number);
      map.easeTo({
        center: (f.geometry as GeoJSON.Point).coordinates as [number, number],
        zoom: zoom + 0.25,
        duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 500,
      });
    });
    for (const layer of ["event-halo", "event-core", "event-thumb", "cluster"]) {
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
      meMarker.current?.destroy();
      meMarker.current = null;
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
    applySelection(map, latest.current.selectedId, events);
    loadThumbsRef.current?.();
  }, [events]);

  useEffect(() => {
    const map = mapRef.current;
    if (map && ready.current) applySelection(map, selectedId, latest.current.events);
  }, [selectedId]);

  // Ring the pin of the card in view; on phones, bring it on screen if the map has wandered off.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready.current) return;
    (map.getSource(HOVER_SOURCE) as unknown as GeoSource | undefined)?.setData(selectedFeature(latest.current.events, highlight?.id ?? null));
    if (!highlight?.follow) return;
    const e = latest.current.events.find((x) => x.id === highlight.id);
    if (!e) return;
    const p = map.project([e.lng, e.lat]);
    const { clientWidth: w, clientHeight: h } = map.getContainer();
    // Visible band: below the filters, above the rail.
    const inView = p.x > 24 && p.x < w - 24 && p.y > 140 && p.y < h - 230;
    if (!inView) {
      map.easeTo({
        center: [e.lng, e.lat],
        padding: { top: 120, bottom: 220, left: 0, right: 0 },
        duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 450,
      });
    }
  }, [highlight?.id, highlight?.follow]);

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

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !fit || !fit.points.length) return;
    const wide = window.matchMedia("(min-width: 900px)").matches;
    const lngs = fit.points.map((p) => p[0]);
    const lats = fit.points.map((p) => p[1]);
    map.fitBounds(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ],
      {
        // One point (just you): settle at neighborhood zoom rather than street level.
        maxZoom: fit.minZoom ?? 15,
        // Clear of the top bar and the rail of cards.
        padding: wide ? { top: 140, bottom: 260, left: 80, right: 80 } : { top: 200, bottom: window.innerHeight * 0.4, left: 40, right: 40 },
        duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 700,
      },
    );
  }, [fit?.key]);

  // The viewer's dot, and follow mode: fly in the first time, then glide with each update.
  useEffect(() => {
    meMarker.current?.set(myPosition);
  }, [myPosition]);
  const followed = useRef(false);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !followMe || !myPosition) {
      if (!followMe) followed.current = false;
      return;
    }
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const wide = window.matchMedia("(min-width: 900px)").matches;
    const padding = wide ? { top: 120, bottom: 220, left: 0, right: 0 } : { top: 160, bottom: 240, left: 0, right: 0 };
    if (!followed.current) {
      followed.current = true;
      map.flyTo({ center: [myPosition.lng, myPosition.lat], zoom: Math.max(map.getZoom(), 14.5), padding, duration: reduce ? 0 : 900 });
    } else {
      map.easeTo({ center: [myPosition.lng, myPosition.lat], padding, duration: reduce ? 0 : 600 });
    }
  }, [followMe, myPosition]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    friendMarkers.current ??= new FriendMarkers(map);
    friendMarkers.current.update(events, friends, (id) => onSelectRef.current(id));
  }, [events, friends]);
  useEffect(
    () => () => {
      friendMarkers.current?.destroy();
      friendMarkers.current = null;
    },
    [],
  );

  return <div ref={container} className="map" role="region" aria-label="Map of events" />;
}

function applySelection(map: MapLibre, id: string | null, events: EventSummary[]) {
  (map.getSource(SELECTED_SOURCE) as unknown as GeoSource | undefined)?.setData(selectedFeature(events, id));
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
