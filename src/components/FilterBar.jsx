import { SCENES } from '../data/events.js'
import { WHEN } from '../lib/time.js'

export default function FilterBar({ when, setWhen, scenes, toggleScene }) {
  return (
    <div className="filters">
      <div className="seg" role="tablist" aria-label="When">
        {WHEN.map((w) => (
          <button
            key={w.id}
            role="tab"
            aria-selected={when === w.id}
            className={when === w.id ? 'is-on' : ''}
            onClick={() => setWhen(w.id)}
          >
            {w.label}
          </button>
        ))}
      </div>
      <div className="chips" aria-label="Scenes">
        {SCENES.map((s) => (
          <button
            key={s.id}
            aria-pressed={scenes.has(s.id)}
            className={`chip ${scenes.has(s.id) ? 'is-on' : ''} ${s.id === 'queer' ? 'chip--uv' : ''}`}
            onClick={() => toggleScene(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  )
}
