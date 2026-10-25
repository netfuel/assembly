import { describe, expect, it } from "vitest";
import { atom, calendar, jsonFeed, type FeedEvent } from "../worker/feeds";
import { structuredData } from "../worker/og";

const ev: FeedEvent = {
  id: "e1",
  title: 'Wet Paint <b>& "friends"</b>',
  pitch: "Queer house, all night, with a very long pitch line that will need folding in the calendar file for sure",
  description: null,
  starts_at: "2026-10-31T03:00:00.000Z",
  ends_at: "2026-10-31T08:00:00.000Z",
  status: "cancelled",
  address: "1 Main St, Memphis, TN",
  neighborhood: "Midtown",
  lat: 35.1,
  lng: -90,
  door_price: "$10 door",
  ticket_url: "https://example.com/t?a=1&b=2",
  scenes: '["queer","house"]',
  flyer_key: "flyers/e1.webp",
  created_at: "2026-10-20T00:00:00.000Z",
  updated_at: "2026-10-21T00:00:00.000Z",
  venue_name: "Room 9",
  lineup: "Juno Ray, Kitten Static",
};
const o = { origin: "https://assembly.rsvp", self: "https://assembly.rsvp/feeds/memphis.xml", title: "Assembly: Memphis", tz: "America/Chicago", home: "https://assembly.rsvp" };

describe("feeds", () => {
  it("escapes markup in Atom and marks cancellations", () => {
    const out = atom([ev], o);
    expect(out).not.toContain("<b>");
    expect(out).toContain("<title>Cancelled: Wet Paint &lt;b&gt;&amp; &quot;friends&quot;&lt;/b&gt;</title>");
    expect(out).toContain("tag:assembly.rsvp,2026:event/e1");
    expect(out).toContain('href="https://assembly.rsvp/api/media/flyers/e1.webp"');
  });
  it("JSON Feed has one item per event", () => {
    const f = jsonFeed([ev], o);
    expect(f.items).toHaveLength(1);
    expect(f.items[0].url).toBe("https://assembly.rsvp/e/e1");
  });
  it("calendar lines are folded at 75 octets and cancelled events say so", () => {
    const out = calendar([ev], o);
    for (const line of out.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(out).toContain("STATUS:CANCELLED");
    expect(out.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });
  it("structured data can't break out of its script tag", () => {
    const json = structuredData(
      { ...ev, title: "</script><script>alert(1)</script>", timezone: "America/Chicago", lineup: '["Juno"]', host_name: null },
      "https://assembly.rsvp/e/e1",
      "https://assembly.rsvp/icons/og.png",
      "https://assembly.rsvp",
    );
    expect(json).not.toContain("</script");
    const data = JSON.parse(json);
    expect(data.eventStatus).toBe("https://schema.org/EventCancelled");
    expect(data.offers.price).toBe("10");
    expect(data.performer[0].name).toBe("Juno");
  });
});
