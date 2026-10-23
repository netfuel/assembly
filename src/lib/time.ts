// Time windows and labels, computed in the city's timezone (not the viewer's device).

export type WindowId = "tonight" | "weekend" | "week" | "all" | "date";

interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number; // 0 = Sunday
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      weekday: "short",
    });
    fmtCache.set(tz, f);
  }
  return f;
}

export function localParts(date: Date, tz: string): Parts {
  const out: Record<string, string> = {};
  for (const p of formatter(tz).formatToParts(date)) out[p.type] = p.value;
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour: Number(out.hour) % 24,
    minute: Number(out.minute),
    weekday: WEEKDAYS.indexOf(out.weekday),
  };
}

/** UTC instant for a wall-clock time in a timezone. Day overflow (day 32) rolls over correctly. */
export function zonedTime(year: number, month: number, day: number, hour: number, tz: string, minute = 0): Date {
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const p = localParts(new Date(guess), tz);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    guess += target - asUtc;
  }
  return new Date(guess);
}

/** The nightlife day: anything before 6 am still belongs to the previous night. */
const NIGHT_ROLLOVER_HOUR = 6;

export function windowRange(id: WindowId, now: Date, tz: string, date?: string): { from: Date; to: Date } {
  const p = localParts(now, tz);
  const nightOffset = p.hour < NIGHT_ROLLOVER_HOUR ? -1 : 0;
  const endOfTonight = zonedTime(p.year, p.month, p.day + nightOffset + 1, NIGHT_ROLLOVER_HOUR, tz);

  switch (id) {
    case "tonight":
      return { from: now, to: endOfTonight };
    case "weekend": {
      // Friday noon through Monday 6 am. If it's already the weekend, start now.
      const nightWeekday = (p.weekday + 7 + nightOffset) % 7;
      const daysToFriday = nightWeekday === 0 ? -2 : nightWeekday === 6 ? -1 : 5 - nightWeekday;
      const fridayDay = p.day + nightOffset + daysToFriday;
      const start = zonedTime(p.year, p.month, fridayDay, 12, tz);
      const end = zonedTime(p.year, p.month, fridayDay + 3, NIGHT_ROLLOVER_HOUR, tz);
      return { from: start < now ? now : start, to: end };
    }
    case "week":
      return { from: now, to: new Date(now.getTime() + 7 * 86400e3) };
    case "date": {
      const night = date ? nightRange(date, tz) : null;
      if (!night) return { from: now, to: endOfTonight };
      return { from: night.from < now ? now : night.from, to: night.to };
    }
    case "all":
    default:
      return { from: now, to: new Date(now.getTime() + 14 * 86400e3) };
  }
}

export function overlaps(startsAt: string, endsAt: string, range: { from: Date; to: Date }): boolean {
  return Date.parse(endsAt) > range.from.getTime() && Date.parse(startsAt) < range.to.getTime();
}

export function isLive(startsAt: string, endsAt: string, now: Date): boolean {
  return now.getTime() >= Date.parse(startsAt) && now.getTime() < Date.parse(endsAt);
}

function nightKey(date: Date, tz: string) {
  const p = localParts(date, tz);
  const shift = p.hour < NIGHT_ROLLOVER_HOUR ? -1 : 0;
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day + shift));
  return { key: d.getTime(), weekday: d.getUTCDay(), month: d.getUTCMonth(), day: d.getUTCDate() };
}

/** "Tonight", "Tomorrow", or "Sat Oct 24", by nightlife day. */
export function dayLabel(startsAt: string, now: Date, tz: string): string {
  const e = nightKey(new Date(startsAt), tz);
  const n = nightKey(now, tz);
  const diff = Math.round((e.key - n.key) / 86400e3);
  if (diff === 0) return "Tonight";
  if (diff === 1) return "Tomorrow";
  return `${WEEKDAYS[e.weekday]} ${MONTHS[e.month]} ${e.day}`;
}

export function clock(iso: string, tz: string): string {
  const p = localParts(new Date(iso), tz);
  const h = p.hour % 12 || 12;
  const ap = p.hour < 12 ? "am" : "pm";
  return p.minute ? `${h}:${String(p.minute).padStart(2, "0")} ${ap}` : `${h} ${ap}`;
}

export function timeRange(startsAt: string, endsAt: string, tz: string): string {
  return `${clock(startsAt, tz)} to ${clock(endsAt, tz)}`;
}

// Form helpers: the posting form shows the city's wall clock, whatever the poster's device is set to.

const pad2 = (n: number) => String(n).padStart(2, "0");

/** ISO instant → values for <input type="date"> and <input type="time"> in the city's timezone. */
export function toInputs(iso: string, tz: string): { date: string; time: string } {
  const p = localParts(new Date(iso), tz);
  return { date: `${p.year}-${pad2(p.month)}-${pad2(p.day)}`, time: `${pad2(p.hour)}:${pad2(p.minute)}` };
}

/**
 * Date + start and end times (city wall clock) → ISO start and end.
 * An end time at or before the start time means the next morning: 10 pm to 3 am.
 */
export function fromInputs(date: string, start: string, end: string, tz: string): { startsAt: string; endsAt: string } | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const s = /^(\d{1,2}):(\d{2})$/.exec(start);
  const e = /^(\d{1,2}):(\d{2})$/.exec(end);
  if (!d || !s || !e) return null;
  const [y, m, day] = [Number(d[1]), Number(d[2]), Number(d[3])];
  const startMin = Number(s[1]) * 60 + Number(s[2]);
  const endMin = Number(e[1]) * 60 + Number(e[2]);
  const startsAt = zonedTime(y, m, day, Number(s[1]), tz, Number(s[2]));
  const endsAt = zonedTime(y, m, day + (endMin <= startMin ? 1 : 0), Number(e[1]), tz, Number(e[2]));
  return { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() };
}

/** The night of a calendar date: 6 am that day until 6 am the next, in the city's timezone. */
export function nightRange(date: string, tz: string): { from: Date; to: Date } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return { from: zonedTime(y, mo, d, NIGHT_ROLLOVER_HOUR, tz), to: zonedTime(y, mo, d + 1, NIGHT_ROLLOVER_HOUR, tz) };
}

/** Today's nightlife date as YYYY-MM-DD (before 6 am still counts as last night). */
export function tonightDate(now: Date, tz: string): string {
  const p = localParts(now, tz);
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day - (p.hour < NIGHT_ROLLOVER_HOUR ? 1 : 0)));
  return d.toISOString().slice(0, 10);
}

/** "Sat Oct 31" for a YYYY-MM-DD date. */
export function dateHeading(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}
