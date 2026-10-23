// What notifications say, and the starting-soon reminder run by the cron trigger.
import type { Env } from "./env";
import { notifyUsers, pushConfigured } from "./push";

function when(iso: string, tz: string) {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" }).format(d);
  const t = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" })
    .format(d)
    .replace(":00", "")
    .replace(" AM", " am")
    .replace(" PM", " pm");
  return { day, time: t };
}

/** A one-line summary of a change people should hear about, or null when nothing important changed. */
export function describeChange(
  before: { starts_at: string; ends_at: string; address: string; venue_id: string | null },
  after: { startsAt: string; endsAt: string; address: string; venueId: string | null },
  tz: string,
): string | null {
  const parts: string[] = [];
  const startMoved = Date.parse(before.starts_at) !== Date.parse(after.startsAt);
  const endMoved = Date.parse(before.ends_at) !== Date.parse(after.endsAt);
  if (startMoved) {
    const a = when(before.starts_at, tz);
    const b = when(after.startsAt, tz);
    parts.push(a.day === b.day ? `Now starts at ${b.time}` : `Moved to ${b.day} at ${b.time}`);
  } else if (endMoved) {
    parts.push(`Now ends at ${when(after.endsAt, tz).time}`);
  }
  if (before.venue_id !== after.venueId || before.address.trim() !== after.address.trim()) {
    parts.push(`New location: ${after.address}`);
  }
  return parts.length ? `${parts.join(". ")}.` : null;
}

const REMINDER_LEAD_MIN = 60;

/**
 * Runs every 15 minutes. Reminds people going to an event that starts in the next hour.
 * A KV marker makes sure each event is announced once, even if runs overlap.
 */
export async function startingSoon(env: Env, now = Date.now()) {
  if (!pushConfigured(env)) return 0;
  const from = new Date(now).toISOString();
  const to = new Date(now + REMINDER_LEAD_MIN * 60e3).toISOString();
  const { results: events } = await env.DB.prepare(
    `SELECT e.id, e.title, e.starts_at, e.address, v.name AS venue_name, c.timezone
     FROM events e JOIN cities c ON c.id = e.city_id LEFT JOIN venues v ON v.id = e.venue_id
     WHERE e.status = 'live' AND e.starts_at > ? AND e.starts_at <= ?`,
  )
    .bind(from, to)
    .all<{ id: string; title: string; starts_at: string; address: string; venue_name: string | null; timezone: string }>();

  let sent = 0;
  for (const e of events) {
    const marker = `pushed:soon:${e.id}:${e.starts_at}`;
    if (await env.SESSIONS.get(marker)) continue;
    await env.SESSIONS.put(marker, "1", { expirationTtl: 3 * 24 * 3600 });
    const { results } = await env.DB.prepare("SELECT user_id FROM rsvps WHERE event_id = ? AND status = 'going'").bind(e.id).all<{ user_id: string }>();
    if (!results.length) continue;
    const t = when(e.starts_at, e.timezone).time;
    sent += await notifyUsers(
      env,
      results.map((r) => r.user_id),
      { title: `Starting soon: ${e.title}`, body: `Doors at ${t}, ${e.venue_name ?? e.address}. Tap for the address and set times.`, url: `/e/${e.id}`, tag: `soon-${e.id}` },
      2 * 3600,
    );
  }
  return sent;
}
