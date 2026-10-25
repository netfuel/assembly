import { Marker, type Map as MapLibre } from "maplibre-gl";
import type { Position } from "../lib/location";

/**
 * The viewer's dot: an accuracy circle sized to real meters, a gradient pulse, and a heading cone
 * when the device reports one. Drawn as an HTML marker so CSS handles the motion (map.css).
 * Distinct from event pins: round, no flyer, a white core, and it sits under the pins.
 */
export class MyLocationMarker {
  private marker: Marker;
  private el: HTMLDivElement;
  private acc: HTMLDivElement;
  private cone: HTMLDivElement;
  private pos: Position | null = null;
  private onZoom = () => this.sizeAccuracy();

  constructor(private map: MapLibre) {
    this.el = document.createElement("div");
    this.el.className = "me-marker";
    this.el.setAttribute("aria-hidden", "true");
    this.acc = document.createElement("div");
    this.acc.className = "me-acc";
    this.cone = document.createElement("div");
    this.cone.className = "me-cone";
    const pulse = document.createElement("div");
    pulse.className = "me-pulse";
    const dot = document.createElement("div");
    dot.className = "me-dot";
    this.el.append(this.acc, this.cone, pulse, dot);
    this.marker = new Marker({ element: this.el, pitchAlignment: "map", rotationAlignment: "map" });
    map.on("zoom", this.onZoom);
  }

  set(pos: Position | null) {
    const first = !this.pos && pos;
    this.pos = pos;
    if (!pos) {
      this.marker.remove();
      return;
    }
    this.marker.setLngLat([pos.lng, pos.lat]);
    if (first) {
      this.marker.addTo(this.map);
      // The dot lands with a small drop-in the first time it appears.
      this.el.classList.remove("is-new");
      void this.el.offsetWidth;
      this.el.classList.add("is-new");
    }
    this.el.classList.toggle("has-heading", pos.heading !== null);
    if (pos.heading !== null) this.cone.style.transform = `translate(-50%, -100%) rotate(${pos.heading}deg)`;
    this.sizeAccuracy();
  }

  /** Accuracy in meters to pixels at this latitude and zoom (512px tiles). Hidden when it's smaller than the dot. */
  private sizeAccuracy() {
    if (!this.pos) return;
    const metersPerPx = (40_075_016.686 * Math.cos((this.pos.lat * Math.PI) / 180)) / (512 * 2 ** this.map.getZoom());
    const d = Math.min(2000, (2 * this.pos.accuracy) / metersPerPx);
    this.acc.style.width = this.acc.style.height = `${d}px`;
    this.acc.style.opacity = d < 24 ? "0" : "";
  }

  destroy() {
    this.map.off("zoom", this.onZoom);
    this.marker.remove();
  }
}
