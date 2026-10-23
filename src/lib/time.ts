// Time windows and labels, computed in the city's timezone (not the viewer's device).

export type WindowId = "tonight" | "weekend" | "week" | "all";

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
export function zonedTime(year: number, month: number, day: number, hour: number, tz: string): Date {
  const target = Date.UTC(year, month - 1, day, hour);
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

export function windowRange(id: WindowId, now: Date, tz: string): { from: Date; to: Date } {
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
