// Placeholder flyer: photocopy-style art generated from the event, until real uploads exist.
import { fmtDay } from '../lib/time.js'

const MOTIFS = {
  smiley: (ink) => (
    <g fill="none" stroke={ink} strokeWidth="6">
      <circle cx="100" cy="100" r="62" />
      <circle cx="78" cy="86" r="6" fill={ink} />
      <circle cx="122" cy="86" r="6" fill={ink} />
      <path d="M68 114 Q100 146 132 114" strokeLinecap="round" />
    </g>
  ),
  bulb: (ink) => (
    <g fill="none" stroke={ink} strokeWidth="6">
      <circle cx="100" cy="88" r="44" />
      <path d="M82 132 h36 M86 146 h28 M100 44 v-24 M56 88 h-24 M144 88 h24 M68 56 l-16 -16 M132 56 l16 -16" strokeLinecap="round" />
    </g>
  ),
  megaphone: (ink) => (
    <g fill="none" stroke={ink} strokeWidth="6" strokeLinejoin="round">
      <path d="M40 84 v32 h22 l64 34 V50 l-64 34 z" />
      <path d="M62 116 l10 34 h16 l-8 -30" />
      <path d="M146 76 q14 24 0 48 M160 62 q26 38 0 76" strokeLinecap="round" />
    </g>
  ),
  tape: (ink) => (
    <g fill="none" stroke={ink} strokeWidth="6">
      <rect x="30" y="56" width="140" height="88" rx="10" />
      <circle cx="72" cy="100" r="18" />
      <circle cx="128" cy="100" r="18" />
      <path d="M72 82 h56 M60 144 l12 -18 h56 l12 18" />
    </g>
  ),
}

export default function Flyer({ event, size = 'card' }) {
  const { ink, paper, motif } = event.flyer
  return (
    <div className={`flyer flyer--${size}`} style={{ '--ink': ink, '--paper': paper }}>
      <div className="flyer__grain" aria-hidden="true" />
      <svg className="flyer__motif" viewBox="0 0 200 200" aria-hidden="true">
        {MOTIFS[motif]?.(ink)}
      </svg>
      <div className="flyer__date">{fmtDay(event.start)}</div>
      <div className="flyer__title">{event.title}</div>
      <div className="flyer__lineup">{event.lineup.map((a) => a.name).join(' · ')}</div>
      <div className="flyer__tape" aria-hidden="true" />
    </div>
  )
}
