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
      // Credits are shown beside the map (MapCredits), not inside it: the snippet sits in a button,
      // and links inside a button are unreachable (axe nested-interactive).
      attributionControl: false,
    });
    const pin = document.createElement("div");
    pin.className = "snippet-pin";
    new Marker({ element: pin }).setLngLat([lng, lat]).addTo(map);
    // Nothing inside is focusable: the canvas and pin are just the picture.
    map.getCanvas().setAttribute("tabindex", "-1");
    pin.setAttribute("aria-hidden", "true");
    pin.removeAttribute("tabindex");
    return () => map.remove();
  }, [lng, lat, theme, label]);
  return <div ref={el} className="map-snippet" role="img" aria-label={label} />;
}

/** The map data credits for a MapSnippet, placed next to it (outside any button). */
export function MapCredits() {
  return (
    <p className="map-credits">
      <a href="https://openfreemap.org" target="_blank" rel="noopener noreferrer">OpenFreeMap</a> ·{" "}
      <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap</a>
    </p>
  );
}
