// Mock Memphis events for local development. All names are placeholders.
// Dates are generated relative to "now" so the map always has something tonight.

export const CITY = {
  name: 'Memphis',
  slug: 'memphis',
  timezone: 'America/Chicago',
  center: [-90.005, 35.14],
  zoom: 12.4,
}

export const SCENES = [
  { id: 'queer', label: 'Queer' },
  { id: 'rave', label: 'Rave' },
  { id: 'techno', label: 'Techno' },
  { id: 'house', label: 'House + disco' },
  { id: 'bass', label: 'Jungle + bass' },
  { id: 'diy', label: 'DIY' },
  { id: 'live', label: 'Live bands' },
  { id: 'bar', label: 'Bar + club' },
]

export const POLICY_LABELS = {
  queer: 'Queer-centered',
  allages: 'All ages',
  '18': '18+',
  '21': '21+',
  sliding: 'Sliding scale',
  accessible: 'Accessible entrance',
  sober: 'Sober-friendly',
  harm: 'Harm reduction on site',
  nophotos: 'No photos on the floor',
}

// day offset from today, start hour (24h, may exceed 24 for after midnight), duration hours
function at(dayOffset, hour, minute = 0) {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + dayOffset)
  d.setMinutes(Math.round(hour * 60) + minute)
  return d
}

function plusHours(date, h) {
  return new Date(date.getTime() + h * 3600_000)
}

// Make one event "live" right now so the pulse state is always visible in dev.
const nowStart = new Date(Date.now() - 45 * 60_000)

const raw = [
  {
    id: 'evt-sodium',
    title: 'Sodium Hours',
    pitch: 'Eight hours of hypnotic techno under one orange bulb.',
    start: nowStart,
    hours: 7,
    venue: 'The Boiler Room on Tutwiler',
    venueType: 'warehouse',
    address: '1250 Tutwiler Ave, Memphis, TN 38107',
    lngLat: [-90.0005, 35.1612],
    scenes: ['techno', 'rave'],
    policies: ['21', 'harm', 'nophotos'],
    door: '$15 before midnight, $20 after',
    ticketUrl: 'https://dice.fm',
    rsvps: 212,
    flyer: { ink: '#ff9a1f', paper: '#14110a', motif: 'bulb' },
    notes: 'Enter through the loading dock on the north side. Street parking on Tutwiler.',
    lineup: [
      { name: 'Halide', set: '10:00 PM', links: { soundcloud: '#', instagram: '#' } },
      { name: 'Corridor 9', set: '12:30 AM', links: { bandcamp: '#', ra: '#' } },
      { name: 'Ms. Ferrous', set: '2:30 AM', links: { mixcloud: '#' } },
    ],
  },
  {
    id: 'evt-velvet',
    title: 'Velvet Static',
    pitch: 'A queer dance night for the girls, the gays, and the theys.',
    start: at(0, 22),
    hours: 5,
    venue: 'Lucky Seven Lounge',
    venueType: 'bar',
    address: '2117 Young Ave, Memphis, TN 38104',
    lngLat: [-89.9893, 35.1189],
    scenes: ['queer', 'house'],
    policies: ['queer', '21', 'accessible', 'sliding'],
    door: '$5 to $15 sliding scale',
    ticketUrl: 'https://posh.vip',
    rsvps: 164,
    flyer: { ink: '#c084fc', paper: '#120a1a', motif: 'smiley' },
    notes: 'Ramp entrance on the side patio.',
    lineup: [
      { name: 'Dolly Paradox', set: '10:00 PM', links: { instagram: '#', soundcloud: '#' } },
      { name: 'Femme Fatality', set: '12:00 AM', links: { instagram: '#', spotify: '#' } },
    ],
  },
  {
    id: 'evt-basement',
    title: 'Basement Tapes vol. 14',
    pitch: 'Three noise-pop bands, one basement, bring earplugs.',
    start: at(0, 20),
    hours: 4,
    venue: 'The Hollow (DIY)',
    venueType: 'diy',
    address: '914 S Cox St, Memphis, TN 38104',
    lngLat: [-89.9829, 35.1253],
    scenes: ['diy', 'live'],
    policies: ['allages', 'sober', 'sliding'],
    door: '$8 suggested, nobody turned away',
    ticketUrl: '',
    rsvps: 48,
    flyer: { ink: '#fde047', paper: '#11110a', motif: 'tape' },
    notes: 'Side gate, go down the stairs. Please be kind to the neighbors.',
    lineup: [
      { name: 'Wet Signal', set: '8:30 PM', links: { bandcamp: '#' } },
      { name: 'Cul-de-sac Saints', set: '9:30 PM', links: { bandcamp: '#', instagram: '#' } },
      { name: 'Lowercase', set: '10:30 PM', links: { site: '#' } },
    ],
  },
  {
    id: 'evt-amen',
    title: 'Amen Break Social',
    pitch: 'Jungle, footwork, and breaks from Memphis selectors.',
    start: at(1, 22),
    hours: 5,
    venue: 'Broad Ave Arts Lot',
    venueType: 'outdoor',
    address: '2565 Broad Ave, Memphis, TN 38112',
    lngLat: [-89.9658, 35.1478],
    scenes: ['bass', 'rave'],
    policies: ['18', 'harm'],
    door: '$12',
    ticketUrl: 'https://ra.co',
    rsvps: 131,
    flyer: { ink: '#f472b6', paper: '#160a10', motif: 'megaphone' },
    notes: 'Free parking in the lot behind the gallery.',
    lineup: [
      { name: 'Riverside Rinse', set: '10:00 PM', links: { soundcloud: '#' } },
      { name: 'Tempo Thief', set: '11:30 PM', links: { mixcloud: '#', instagram: '#' } },
      { name: 'BPM Mamí', set: '1:00 AM', links: { soundcloud: '#', ra: '#' } },
    ],
  },
  {
    id: 'evt-mirrorball',
    title: 'Mirrorball Mass',
    pitch: 'Sunday disco tea dance. Sequins encouraged, judgment banned.',
    start: at(2, 16),
    hours: 5,
    venue: 'Overton Hall',
    venueType: 'club',
    address: '2101 Madison Ave, Memphis, TN 38104',
    lngLat: [-89.9925, 35.1493],
    scenes: ['house', 'queer', 'bar'],
    policies: ['queer', '21', 'accessible'],
    door: '$10',
    ticketUrl: 'https://eventbrite.com',
    rsvps: 96,
    flyer: { ink: '#c084fc', paper: '#0f0a18', motif: 'smiley' },
    notes: 'Elevator at the rear entrance.',
    lineup: [
      { name: 'Sister Spin', set: '4:00 PM', links: { mixcloud: '#' } },
      { name: 'Lady Lowend', set: '6:00 PM', links: { soundcloud: '#', spotify: '#' } },
    ],
  },
  {
    id: 'evt-riverside',
    title: 'Low Water Mark',
    pitch: 'Dub techno and ambient by the river until the sun says stop.',
    start: at(1, 21),
    hours: 6,
    venue: 'South Main Freight Hall',
    venueType: 'warehouse',
    address: '380 S Front St, Memphis, TN 38103',
    lngLat: [-90.0571, 35.1346],
    scenes: ['techno'],
    policies: ['21', 'harm', 'nophotos'],
    door: '$20 at the door',
    ticketUrl: 'https://dice.fm',
    rsvps: 77,
    flyer: { ink: '#ff9a1f', paper: '#0d0c0a', motif: 'bulb' },
    notes: 'Paid lots on Front St; the trolley stops one block away.',
    lineup: [
      { name: 'Delta Drift', set: '9:00 PM', links: { bandcamp: '#' } },
      { name: 'Oxbow', set: '11:30 PM', links: { soundcloud: '#', ra: '#' } },
    ],
  },
  {
    id: 'evt-crosstown',
    title: 'Open Decks + Flyer Swap',
    pitch: 'Bring a USB and your flyers. Sign up at the door.',
    start: at(5, 19),
    hours: 4,
    venue: 'Crosstown Back Bar',
    venueType: 'bar',
    address: '1350 Concourse Ave, Memphis, TN 38104',
    lngLat: [-90.0141, 35.1528],
    scenes: ['bar', 'house'],
    policies: ['21'],
    door: 'Free',
    ticketUrl: '',
    rsvps: 22,
    flyer: { ink: '#fde047', paper: '#12110a', motif: 'tape' },
    notes: 'Garage parking is free after 6 PM.',
    lineup: [{ name: 'You', set: '7:00 PM', links: {} }],
  },
  {
    id: 'evt-orange',
    title: 'Block Party Bounce',
    pitch: 'Memphis rap, bounce, and club classics in the backyard.',
    start: at(6, 18),
    hours: 5,
    venue: 'Backyard on Park Ave',
    venueType: 'diy',
    address: '2280 Park Ave, Memphis, TN 38114',
    lngLat: [-89.9612, 35.1204],
    scenes: ['diy', 'bass'],
    policies: ['allages', 'sober'],
    door: '$5',
    ticketUrl: 'https://venmo.com',
    rsvps: 58,
    flyer: { ink: '#f472b6', paper: '#140a0e', motif: 'megaphone' },
    notes: 'Food truck on site. Gate is on the side street.',
    lineup: [
      { name: 'DJ Hush Puppy', set: '6:00 PM', links: { instagram: '#' } },
      { name: 'Kreme Krew', set: '8:00 PM', links: { soundcloud: '#', instagram: '#' } },
    ],
  },
]

export const EVENTS = raw.map(({ hours, ...e }) => ({
  ...e,
  end: plusHours(e.start, hours),
  status: 'live',
}))
