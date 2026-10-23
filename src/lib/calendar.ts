import type { EventSummary } from "../../shared/types";

function icsDate(iso: string) {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function escape(text: string) {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

/** A single-event iCalendar file with the full address and times, for "Add to calendar". */
export function eventToIcs(e: EventSummary, url: string): string {
  const where = [e.venueName, e.address, e.neighborhood].filter(Boolean).join(", ");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Assembly//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${e.id}@assembly`,
    `DTSTAMP:${icsDate(new Date().toISOString())}`,
    `DTSTART:${icsDate(e.startsAt)}`,
    `DTEND:${icsDate(e.endsAt)}`,
    `SUMMARY:${escape(e.title)}`,
    `LOCATION:${escape(where)}`,
    `GEO:${e.lat};${e.lng}`,
    `URL:${url}`,
    `DESCRIPTION:${escape([e.pitch, e.doorPrice && `Door: ${e.doorPrice}`, url].filter(Boolean).join("\n"))}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

export function downloadIcs(e: EventSummary, url: string) {
  const blob = new Blob([eventToIcs(e, url)], { type: "text/calendar" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${e.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.ics`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function directionsLinks(e: EventSummary) {
  const q = `${e.lat},${e.lng}`;
  return {
    apple: `https://maps.apple.com/?daddr=${q}`,
    google: `https://www.google.com/maps/dir/?api=1&destination=${q}`,
  };
}
