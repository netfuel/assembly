import { useEffect, useRef } from "react";
import { Map as MapLibre } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { mapStyle, type MapTheme } from "./mapStyle";
import "./map.css";

/**
 * A small map with a pin fixed at its center. Dragging the map moves the spot under the pin.
 * `fly` re-centers the map (after an address search); `onMove` reports the spot under the pin.
 */
export function PinPicker({
  start,
  fly,
  onMove,
  theme,
}: {
  start: [number, number];
  fly: { lng: number; lat: number; key: number } | null;
  onMove: (lng: number, lat: number) => void;
  theme: MapTheme;
}) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibre | null>(null);
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;

  useEffect(() => {
    if (!container.current) return;
    const map = new MapLibre({
      container: container.current,
      style: mapStyle(theme),
      center: start,
      zoom: 16,
      minZoom: 10,
      maxZoom: 19,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
      cooperativeGestures: false,
    });
    map.touchZoomRotate.disableRotation();
    map.on("moveend", (e) => {
      // Only report moves the person made, so opening the form doesn't count as placing the pin.
      if (!(e as { originalEvent?: Event }).originalEvent && !(e as { fromSearch?: boolean }).fromSearch) return;
      const c = map.getCenter();
      onMoveRef.current(Number(c.lng.toFixed(6)), Number(c.lat.toFixed(6)));
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // Created once; start only seeds it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const firstTheme = useRef(theme);
  useEffect(() => {
    if (theme === firstTheme.current) return;
    firstTheme.current = theme;
    mapRef.current?.setStyle(mapStyle(theme), { diff: false });
  }, [theme]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !fly) return;
    map.jumpTo({ center: [fly.lng, fly.lat], zoom: Math.max(map.getZoom(), 16) }, { fromSearch: true });
  }, [fly]);

  return (
    <div className="pin-picker">
      <div ref={container} className="pin-picker-map" role="application" aria-label="Drag the map to put the pin on the entrance" />
      <svg className="pin-picker-pin" viewBox="0 0 24 34" width="24" height="34" aria-hidden="true">
        <path d="M12 33C12 33 22 20 22 12A10 10 0 0 0 2 12C2 20 12 33 12 33Z" fill="var(--color-accent)" stroke="var(--color-fg)" strokeWidth="1.5" />
        <circle cx="12" cy="12" r="3.5" fill="var(--color-fg)" />
      </svg>
    </div>
  );
}
