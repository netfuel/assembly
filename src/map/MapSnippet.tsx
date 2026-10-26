import { useEffect, useRef } from "react";
import { Map as MapLibre, Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { mapStyle, type MapTheme } from "./mapStyle";
import "./map.css";

/** A small, still map of one place (the venue page). Tapping it is the caller's job: it shows the place on the big map. */
export function MapSnippet({ lng, lat, theme, label }: { lng: number; lat: number; theme: MapTheme; label: string }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!el.current) return;
    const map = new MapLibre({
      container: el.current,
      style: mapStyle(theme),
      center: [lng, lat],
      zoom: 15.2,
      interactive: false,
      attributionControl: { compact: true },
    });
    const pin = document.createElement("div");
    pin.className = "snippet-pin";
    new Marker({ element: pin }).setLngLat([lng, lat]).addTo(map);
    return () => map.remove();
  }, [lng, lat, theme]);
  return <div ref={el} className="map-snippet" role="img" aria-label={label} />;
}
