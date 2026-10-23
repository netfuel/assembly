import { useCallback, useMemo, useState } from 'react'
import MapView from './components/MapView.jsx'
import FilterBar from './components/FilterBar.jsx'
import CardRail from './components/CardRail.jsx'
import EventSheet from './components/EventSheet.jsx'
import { CITY, EVENTS } from './data/events.js'
import { inWindow, isLive } from './lib/time.js'

const EMPTY = {
  tonight: 'Nothing on the schedule tonight. Check the weekend.',
  weekend: 'Quiet weekend so far. Somebody make an announcement.',
  week: 'Nothing in the next 7 days yet.',
}

export default function App() {
  const [when, setWhen] = useState('tonight')
  const [scenes, setScenes] = useState(() => new Set())
  const [selectedId, setSelectedId] = useState(null)
  const [openId, setOpenId] = useState(null)
  const [rsvps, setRsvps] = useState({})
  const [toastMsg, setToastMsg] = useState(null)

  const toast = useCallback((msg) => {
    setToastMsg(msg)
    clearTimeout(toast.t)
    toast.t = setTimeout(() => setToastMsg(null), 2200)
  }, [])

  const toggleScene = (id) =>
    setScenes((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const visible = useMemo(
    () =>
      EVENTS.filter((e) => inWindow(e, when))
        .filter((e) => !scenes.size || e.scenes.some((s) => scenes.has(s)))
        .sort((a, b) => Number(isLive(b)) - Number(isLive(a)) || a.start - b.start),
    [when, scenes],
  )

  const onSelect = useCallback((id) => setSelectedId(id), [])
  const onOpen = useCallback((id) => {
    setSelectedId(id)
    setOpenId(id)
  }, [])

  const open = EVENTS.find((e) => e.id === openId)

  return (
    <div className="app">
      <MapView events={visible} selectedId={selectedId} onSelect={onOpen} />

      <header className="top">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true" />
          <span className="brand__name">Assembly</span>
          <span className="brand__city mono">{CITY.name}</span>
        </div>
        <button className="btn btn--announce" onClick={() => toast('Posting flow is next on the build list.')}>
          Make an announcement
        </button>
      </header>

      <div className="bottom">
        <FilterBar when={when} setWhen={setWhen} scenes={scenes} toggleScene={toggleScene} />
        <CardRail events={visible} selectedId={selectedId} onSelect={onSelect} onOpen={onOpen} emptyText={EMPTY[when]} />
      </div>

      {open && (
        <EventSheet
          event={open}
          rsvp={rsvps[open.id] ?? null}
          setRsvp={(s) => setRsvps((r) => ({ ...r, [open.id]: s }))}
          onClose={() => setOpenId(null)}
          toast={toast}
        />
      )}

      {toastMsg && <div className="toast">{toastMsg}</div>}
    </div>
  )
}
