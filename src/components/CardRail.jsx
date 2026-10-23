import { useEffect, useRef } from 'react'
import Flyer from './Flyer.jsx'
import { dayLabel, fmtTime, isLive } from '../lib/time.js'

export default function CardRail({ events, selectedId, onSelect, onOpen, emptyText }) {
  const rail = useRef(null)

  useEffect(() => {
    const card = rail.current?.querySelector(`[data-id="${selectedId}"]`)
    card?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  }, [selectedId])

  if (!events.length) {
    return (
      <div className="rail rail--empty">
        <p>{emptyText}</p>
      </div>
    )
  }

  return (
    <div className="rail" ref={rail}>
      {events.map((e) => (
        <article
          key={e.id}
          data-id={e.id}
          className={`card ${e.id === selectedId ? 'is-selected' : ''} ${e.scenes.includes('queer') ? 'card--uv' : ''}`}
          onClick={() => (e.id === selectedId ? onOpen(e.id) : onSelect(e.id))}
        >
          <Flyer event={e} size="thumb" />
          <div className="card__body">
            <div className="card__meta">
              {isLive(e) ? <span className="live">Live now</span> : <span>{dayLabel(e.start)}</span>}
              <span className="mono">{fmtTime(e.start)}</span>
            </div>
            <h3>{e.title}</h3>
            <p className="card__venue">{e.venue}</p>
            <div className="card__foot">
              <span className="mono">{e.door}</span>
              <span className="mono">{e.rsvps} going</span>
            </div>
          </div>
        </article>
      ))}
    </div>
  )
}
