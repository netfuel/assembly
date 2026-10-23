const DAY = 86_400_000

function startOfDay(d) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

// The "night" runs until 6 AM, so a 2 AM set still counts as tonight.
function nightEnd(d) {
  return new Date(startOfDay(d).getTime() + DAY + 6 * 3600_000)
}

export function isLive(e, now = new Date()) {
  return e.start <= now && e.end > now
}

export const WHEN = [
  { id: 'tonight', label: 'Tonight' },
  { id: 'weekend', label: 'This weekend' },
  { id: 'week', label: 'Next 7 days' },
]

export function inWindow(e, when, now = new Date()) {
  if (e.end <= now) return false
  const today = startOfDay(now)
  if (when === 'tonight') return e.start < nightEnd(now)
  if (when === 'week') return e.start < new Date(today.getTime() + 7 * DAY)
  if (when === 'weekend') {
    const dow = now.getDay() // 0 Sun ... 5 Fri 6 Sat
    const toFri = dow === 0 ? -2 : dow === 6 ? -1 : 5 - dow
    const fri = new Date(today.getTime() + toFri * DAY)
    const monMorning = new Date(fri.getTime() + 3 * DAY + 6 * 3600_000)
    return e.start < monMorning && e.end > fri
  }
  return true
}

const dayFmt = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
const timeFmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' })

export function dayLabel(d, now = new Date()) {
  const diff = Math.round((startOfDay(d) - startOfDay(now)) / DAY)
  if (diff === 0) return 'Tonight'
  if (diff === 1) return 'Tomorrow'
  if (diff < 7) return new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(d)
  return dayFmt.format(d)
}

export const fmtDay = (d) => dayFmt.format(d)
export const fmtTime = (d) => timeFmt.format(d)

export function icsFor(e) {
  const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const esc = (s) => String(s).replace(/([,;])/g, '\\$1').replace(/\n/g, '\\n')
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Assembly//EN',
    'BEGIN:VEVENT',
    `UID:${e.id}@assembly.rsvp`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(e.start)}`,
    `DTEND:${stamp(e.end)}`,
    `SUMMARY:${esc(e.title)}`,
    `LOCATION:${esc(`${e.venue}, ${e.address}`)}`,
    `DESCRIPTION:${esc(`${e.pitch}\nDoor: ${e.door}`)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  return lines.join('\r\n')
}
