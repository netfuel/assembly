# Assembly

Map-first PWA for underground music events: DIY shows, warehouse raves, queer dance nights, small bars and clubs. Launch city: Memphis. Product spec: [docs/PRD.md](docs/PRD.md).

## Run it locally

Requires Node 20+.

```sh
git clone https://github.com/netfuel/assembly.git
cd assembly
npm install
npm run dev
```

Open http://localhost:5173. Edits to anything in `src/` hot-reload in the browser. `npm run dev` also prints a Network URL so you can open it on your phone on the same Wi-Fi.

## What's here

| Path | What it is |
| --- | --- |
| `src/App.jsx` | App shell: filter state, selection, event sheet, toasts |
| `src/components/MapView.jsx` | MapLibre map with RSVP-sized pins (UV violet for queer-centered, sodium orange otherwise; live events pulse) |
| `src/components/FilterBar.jsx` | Tonight / this weekend / next 7 days, plus scene chips |
| `src/components/CardRail.jsx` | Bottom card rail synced with the map |
| `src/components/EventSheet.jsx` | Event page: flyer hero, times, address and directions, lineup with artist links, door info, policy tags, RSVP stamp, tickets, ICS, share |
| `src/components/Flyer.jsx` | Placeholder photocopy-style flyers until real uploads exist |
| `src/data/events.js` | Mock Memphis events, dated relative to now |
| `src/lib/time.js` | Time windows, labels, ICS export |

## Notes

- The basemap is CARTO Dark Matter for development only. Production moves to Protomaps tiles on R2 with a custom night style, per the PRD.
- No backend yet: RSVPs live in component state. The Workers API, D1, auth, and posting flow come next.
