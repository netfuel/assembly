import type { StyleSpecification } from "@maplibre/maplibre-gl-style-spec";

/**
 * Assembly's basemaps, light (default) and dark. Vector tiles in the OpenMapTiles schema from OpenFreeMap
 * (free, no API key). To self-host later, point TILE_URL at a PMTiles archive on R2.
 * Colors mirror the tokens in src/styles/tokens.css; MapLibre can't read CSS variables.
 */
const TILE_URL = import.meta.env.VITE_TILE_URL ?? "https://tiles.openfreemap.org/planet";
const GLYPHS = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";

export type MapTheme = "light" | "dark";
export type MapPalette = Record<
  "land" | "water" | "park" | "building" | "roadMinor" | "roadMajor" | "roadHighway" | "label" | "labelStrong" | "halo" | "sodium" | "uv" | "live" | "accent" | "fg",
  string
>;

/** Light basemap: cool paper gray, like the Timeless specimen. Default theme. */
const LIGHT: MapPalette = {
  land: "#e4e5e8",
  water: "#cdd3dc",
  park: "#d8ddd4",
  building: "#d9dbdf",
  roadMinor: "#f4f4f5",
  roadMajor: "#fbfbfc",
  roadHighway: "#ffffff",
  label: "#8a8d94",
  labelStrong: "#5b5e65",
  halo: "#e9eaec",
  sodium: "#f07f12",
  uv: "#7b5cf0",
  live: "#ff3df2",
  accent: "#ff3df2",
  fg: "#121315",
};

/** Dark basemap: neutral night greys. */
const DARK: MapPalette = {
  land: "#0c0c0e",
  water: "#08090c",
  park: "#0f1210",
  building: "#121215",
  roadMinor: "#19191d",
  roadMajor: "#26262b",
  roadHighway: "#303036",
  label: "#4e4e57",
  labelStrong: "#7a7a84",
  halo: "#0a0a0b",
  sodium: "#ff9a3c",
  uv: "#a98bff",
  live: "#ff3df2",
  accent: "#ff3df2",
  fg: "#ededee",
};

export function mapPalette(theme: MapTheme): MapPalette {
  return theme === "dark" ? DARK : LIGHT;
}

export function mapStyle(theme: MapTheme): StyleSpecification {
  const c = mapPalette(theme);
  return {
  version: 8,
  name: `Assembly ${theme}`,
  glyphs: GLYPHS,
  sources: {
    omt: {
      type: "vector",
      url: TILE_URL,
      attribution:
        '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a>',
    },
  },
  layers: [
    { id: "background", type: "background", paint: { "background-color": c.land } },
    {
      id: "park",
      type: "fill",
      source: "omt",
      "source-layer": "park",
      paint: { "fill-color": c.park },
    },
    {
      id: "landcover-wood",
      type: "fill",
      source: "omt",
      "source-layer": "landcover",
      filter: ["in", ["get", "class"], ["literal", ["wood", "grass"]]],
      paint: { "fill-color": c.park, "fill-opacity": 0.6 },
    },
    { id: "water", type: "fill", source: "omt", "source-layer": "water", paint: { "fill-color": c.water } },
    {
      id: "waterway",
      type: "line",
      source: "omt",
      "source-layer": "waterway",
      paint: { "line-color": c.water, "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1, 16, 4] },
    },
    {
      id: "building",
      type: "fill",
      source: "omt",
      "source-layer": "building",
      minzoom: 14,
      paint: { "fill-color": c.building, "fill-opacity": 0.8 },
    },
    {
      id: "road-minor",
      type: "line",
      source: "omt",
      "source-layer": "transportation",
      filter: ["in", ["get", "class"], ["literal", ["minor", "service", "tertiary", "track"]]],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": c.roadMinor, "line-width": ["interpolate", ["exponential", 1.5], ["zoom"], 12, 0.5, 18, 10] },
    },
    {
      id: "road-major",
      type: "line",
      source: "omt",
      "source-layer": "transportation",
      filter: ["in", ["get", "class"], ["literal", ["primary", "secondary", "trunk"]]],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": c.roadMajor, "line-width": ["interpolate", ["exponential", 1.5], ["zoom"], 10, 1, 18, 16] },
    },
    {
      id: "road-highway",
      type: "line",
      source: "omt",
      "source-layer": "transportation",
      filter: ["==", ["get", "class"], "motorway"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": c.roadHighway, "line-width": ["interpolate", ["exponential", 1.5], ["zoom"], 8, 1, 18, 20] },
    },
    {
      id: "road-label",
      type: "symbol",
      source: "omt",
      "source-layer": "transportation_name",
      minzoom: 14,
      filter: ["in", ["get", "class"], ["literal", ["primary", "secondary", "tertiary", "minor"]]],
      layout: {
        "symbol-placement": "line",
        "text-field": ["coalesce", ["get", "name:en"], ["get", "name"]],
        "text-font": ["Noto Sans Regular"],
        "text-size": 11,
        "text-letter-spacing": 0.08,
        "text-transform": "uppercase",
      },
      paint: { "text-color": c.label, "text-halo-color": c.halo, "text-halo-width": 1.5 },
    },
    {
      id: "place-neighborhood",
      type: "symbol",
      source: "omt",
      "source-layer": "place",
      minzoom: 11,
      filter: ["in", ["get", "class"], ["literal", ["suburb", "neighbourhood", "quarter"]]],
      layout: {
        "text-field": ["coalesce", ["get", "name:en"], ["get", "name"]],
        "text-font": ["Noto Sans Bold"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 11, 10, 15, 13],
        "text-letter-spacing": 0.16,
        "text-transform": "uppercase",
        "text-max-width": 8,
      },
      paint: { "text-color": c.label, "text-halo-color": c.halo, "text-halo-width": 1.5 },
    },
    {
      id: "place-city",
      type: "symbol",
      source: "omt",
      "source-layer": "place",
      maxzoom: 11,
      filter: ["in", ["get", "class"], ["literal", ["city", "town"]]],
      layout: {
        "text-field": ["coalesce", ["get", "name:en"], ["get", "name"]],
        "text-font": ["Noto Sans Bold"],
        "text-size": 14,
        "text-letter-spacing": 0.2,
        "text-transform": "uppercase",
      },
      paint: { "text-color": c.labelStrong, "text-halo-color": c.halo, "text-halo-width": 2 },
    },
  ],
  };
}
