import { useEffect, useRef } from 'react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
// MapLibre finds its worker relative to its own file, which Vite's pre-bundling breaks.
// Point it at a worker Vite builds itself, so it works in dev and production.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { CITY } from '../data/events.js'
import { isLive } from '../lib/time.js'

maplibregl.setWorkerUrl(workerUrl)

// Dev basemap. Swap for the Protomaps night style on R2 before launch (see PRD: Technical architecture).
const STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'

function pinSize(rsvps) {
  return Math.round(18 + Math.min(1, Math.sqrt(rsvps) / 16) * 22)
}

export default function MapView({ events, selectedId, onSelect }) {
  const el = useRef(null)
  const map = useRef(null)
  const markers = useRef(new Map())

  useEffect(() => {
    const m = new maplibregl.Map({
      container: el.current,
      style: STYLE,
      center: CITY.center,
      zoom: CITY.zoom,
      attributionControl: { compact: true },
    })
    m.on('style.load', () => {
      // Push the base map toward blue-black so pins carry the color.
      for (const layer of m.getStyle().layers) {
        if (layer.type === 'background') m.setPaintProperty(layer.id, 'background-color', '#07080f')
      }
    })
    map.current = m
    return () => {
      // Drop cached markers with the map, or a remount (React StrictMode in dev) leaves them on a dead map.
      markers.current.forEach((mk) => mk.remove())
      markers.current.clear()
      m.remove()
      map.current = null
    }
  }, [])

  // Sync markers with the filtered event list.
  useEffect(() => {
    const m = map.current
    if (!m) return
    const keep = new Set(events.map((e) => e.id))
    for (const [id, mk] of markers.current) {
      if (!keep.has(id)) {
        mk.remove()
        markers.current.delete(id)
      }
    }
    for (const e of events) {
      let mk = markers.current.get(e.id)
      if (!mk) {
        const node = document.createElement('button')
        node.type = 'button'
        node.setAttribute('aria-label', e.title)
        node.addEventListener('click', (ev) => {
          ev.stopPropagation()
          onSelect(e.id)
        })
        mk = new maplibregl.Marker({ element: node }).setLngLat(e.lngLat).addTo(m)
        markers.current.set(e.id, mk)
      }
      const node = mk.getElement()
      const size = pinSize(e.rsvps)
      // Toggle our classes only: MapLibre's own marker classes handle positioning.
      node.classList.add('pin')
      node.classList.toggle('pin--uv', e.scenes.includes('queer'))
      node.classList.toggle('pin--sodium', !e.scenes.includes('queer'))
      node.classList.toggle('pin--live', isLive(e))
      node.classList.toggle('pin--selected', e.id === selectedId)
      node.style.setProperty('--size', `${size}px`)
    }
  }, [events, selectedId, onSelect])

  // Fly to the selected event.
  useEffect(() => {
    const e = events.find((x) => x.id === selectedId)
    if (e && map.current) {
      map.current.flyTo({ center: e.lngLat, zoom: Math.max(map.current.getZoom(), 13.5), speed: 1.4, offset: [0, -80] })
    }
  }, [selectedId]) // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={el} className="map" />
}
