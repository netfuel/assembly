// Friends on the map: up to three faces stacked above an event's pin, ringed in the accent when a friend is
// there now. Never a person's own position: a face only ever sits on the event they're going to.
import { Marker, type Map as MapLibre } from "maplibre-gl";
import type { EventSummary, FriendAt } from "../../shared/types";

/** Below this zoom pins are clustered, so faces would float over nothing. */
const MIN_ZOOM = 12;

function faceEl(people: FriendAt[], onClick: () => void) {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "friend-pin";
  const here = people.filter((p) => p.state === "here").length;
  el.setAttribute(
    "aria-label",
    people.length === 1 ? `${people[0].displayName} ${people[0].state === "here" ? "is here" : "is going"}` : `${people.length} friends${here ? `, ${here} here now` : " going"}`,
  );
  for (const p of people.slice(0, 3)) {
    const f = document.createElement("span");
    f.className = `friend-pin-face${p.state === "here" ? " is-here" : ""}`;
    if (p.avatarUrl) {
      const img = document.createElement("img");
      img.src = p.avatarUrl;
      img.alt = "";
      img.referrerPolicy = "no-referrer";
      f.append(img);
    } else f.textContent = p.displayName.slice(0, 1).toUpperCase();
    el.append(f);
  }
  if (people.length > 3) {
    const more = document.createElement("span");
    more.className = "friend-pin-more";
    more.textContent = `+${people.length - 3}`;
    el.append(more);
  }
  el.addEventListener("click", (ev) => {
    ev.stopPropagation();
    onClick();
  });
  return el;
}

export class FriendMarkers {
  private markers = new Map<string, { marker: Marker; key: string }>();
  private onZoom = () => this.toggle();

  constructor(private map: MapLibre) {
    map.on("zoom", this.onZoom);
  }

  private toggle() {
    const show = this.map.getZoom() >= MIN_ZOOM;
    for (const { marker } of this.markers.values()) marker.getElement().classList.toggle("is-hidden", !show);
  }

  update(events: EventSummary[], friends: Record<string, FriendAt[]>, onSelect: (id: string) => void) {
    const wanted = new Set<string>();
    for (const e of events) {
      const people = friends[e.id];
      if (!people?.length) continue;
      wanted.add(e.id);
      const key = people.map((p) => `${p.id}:${p.state}`).join("|");
      const existing = this.markers.get(e.id);
      if (existing?.key === key) continue;
      existing?.marker.remove();
      const marker = new Marker({ element: faceEl(people, () => onSelect(e.id)), anchor: "bottom-left", offset: [8, -8] }).setLngLat([e.lng, e.lat]).addTo(this.map);
      this.markers.set(e.id, { marker, key });
    }
    for (const [id, m] of this.markers) {
      if (!wanted.has(id)) {
        m.marker.remove();
        this.markers.delete(id);
      }
    }
    this.toggle();
  }

  destroy() {
    this.map.off("zoom", this.onZoom);
    for (const m of this.markers.values()) m.marker.remove();
    this.markers.clear();
  }
}
