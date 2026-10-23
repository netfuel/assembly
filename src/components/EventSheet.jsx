import { useEffect, useState } from 'react'
import Flyer from './Flyer.jsx'
import { POLICY_LABELS, SCENES } from '../data/events.js'
import { dayLabel, fmtDay, fmtTime, icsFor, isLive } from '../lib/time.js'

const LINK_LABELS = {
  instagram: 'IG',
  soundcloud: 'SoundCloud',
  bandcamp: 'Bandcamp',
  mixcloud: 'Mixcloud',
  ra: 'RA',
  spotify: 'Spotify',
  site: 'Site',
}

function downloadIcs(e) {
  const blob = new Blob([icsFor(e)], { type: 'text/calendar' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${e.id}.ics`
  a.click()
  URL.revokeObjectURL(a.href)
}

export default function EventSheet({ event: e, rsvp, setRsvp, onClose, toast }) {
  const [stampKey, setStampKey] = useState(0)

  useEffect(() => {
    const onKey = (ev) => ev.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const q = encodeURIComponent(e.address)
  const share = async () => {
    const url = `${location.origin}/e/${e.id}`
    if (navigator.share) {
      try {
        await navigator.share({ title: e.title, text: e.pitch, url })
      } catch {
        /* dismissed */
      }
    } else {
      await navigator.clipboard?.writeText(url)
      toast('Link copied')
    }
  }

  const choose = (status) => {
    const next = rsvp === status ? null : status
    setRsvp(next)
    if (next === 'going') setStampKey((k) => k + 1)
  }

  const scenes = SCENES.filter((s) => e.scenes.includes(s.id))

  return (
    <div className="sheet-wrap" onClick={onClose}>
      <aside
        className={`sheet ${e.scenes.includes('queer') ? 'sheet--uv' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={e.title}
        onClick={(ev) => ev.stopPropagation()}
      >
        <button className="sheet__close" onClick={onClose} aria-label="Close">
          ×
        </button>

        <div className="sheet__hero">
          <Flyer event={e} size="hero" />
          {rsvp === 'going' && (
            <div key={stampKey} className="stamp" aria-hidden="true">
              Going
            </div>
          )}
        </div>

        <div className="sheet__body">
          <div className="sheet__when">
            {isLive(e) ? <span className="live">Live now</span> : <span>{dayLabel(e.start)}</span>}
            <span className="mono">
              {fmtDay(e.start)} · Doors {fmtTime(e.start)} · Ends {fmtTime(e.end)}
            </span>
          </div>
          <h1>{e.title}</h1>
          <p className="sheet__pitch">{e.pitch}</p>

          <div className="actions">
            <button className={`btn btn--primary ${rsvp === 'going' ? 'is-on' : ''}`} onClick={() => choose('going')}>
              {rsvp === 'going' ? "You're going" : 'RSVP'}
            </button>
            <button className={`btn ${rsvp === 'interested' ? 'is-on' : ''}`} onClick={() => choose('interested')}>
              {rsvp === 'interested' ? 'Interested ✓' : 'Interested'}
            </button>
            {e.ticketUrl && (
              <a className="btn" href={e.ticketUrl} target="_blank" rel="noreferrer">
                Tickets ↗
              </a>
            )}
          </div>

          <section className="block">
            <h2>Where</h2>
            <p className="venue">{e.venue}</p>
            <p className="mono">{e.address}</p>
            {e.notes && <p className="note">{e.notes}</p>}
            <div className="row">
              <a className="link" href={`https://maps.apple.com/?q=${q}`} target="_blank" rel="noreferrer">
                Apple Maps ↗
              </a>
              <a className="link" href={`https://www.google.com/maps/search/?api=1&query=${q}`} target="_blank" rel="noreferrer">
                Google Maps ↗
              </a>
            </div>
          </section>

          <section className="block">
            <h2>Lineup</h2>
            <ol className="lineup">
              {e.lineup.map((a) => (
                <li key={a.name}>
                  <span className="mono set">{a.set}</span>
                  <span className="artist">{a.name}</span>
                  <span className="artist-links">
                    {Object.entries(a.links).map(([k, href]) => (
                      <a key={k} href={href} target="_blank" rel="noreferrer">
                        {LINK_LABELS[k] ?? k}
                      </a>
                    ))}
                  </span>
                </li>
              ))}
            </ol>
          </section>

          <section className="block">
            <h2>Door</h2>
            <p className="mono">{e.door}</p>
            <div className="tags">
              {e.policies.map((p) => (
                <span key={p} className={`tag ${p === 'queer' ? 'tag--uv' : ''}`}>
                  {POLICY_LABELS[p]}
                </span>
              ))}
              {scenes.map((s) => (
                <span key={s.id} className="tag tag--ghost">
                  {s.label}
                </span>
              ))}
            </div>
          </section>

          <div className="row row--end">
            <button className="link" onClick={() => downloadIcs(e)}>
              Add to calendar
            </button>
            <button className="link" onClick={share}>
              Share
            </button>
            <button className="link link--muted" onClick={() => toast('Thanks. Reporting goes live with accounts.')}>
              Report
            </button>
          </div>
        </div>
      </aside>
    </div>
  )
}
