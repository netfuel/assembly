"""Turns a WYXR concert calendar export into SQL for Assembly's database.

Run:  python3 scripts/import-wyxr.py db/import/wyxr-2026-10-25.json
Then: double-click import-events.command (or npx wrangler d1 execute assembly --remote --file=db/import/wyxr.sql)

The export comes from https://concert-calendar.wyxr.org/ (WYXR 91.7 FM's Memphis concert calendar).
Each event is credited to WYXR and links to the venue or ticket page. Safe to re-run: events and
venues are upserted by id, RSVPs are kept, and future WYXR events missing from a newer export are
removed unless someone has RSVP'd.
"""
import json
import re
import sys
from datetime import date, datetime, time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "db" / "import" / "wyxr.sql"
TZ = ZoneInfo("America/Chicago")
CITY = "memphis"

# Venue name in the WYXR data -> (id, display name, type, address, neighborhood, lat, lng).
# Addresses checked against OpenStreetMap and venue sites; coordinates from OpenStreetMap.
V = {
    "Hi Tone": ("venue-hi-tone", "Hi Tone", "club", "412 N Cleveland St, Memphis, TN 38104", "Crosstown", 35.14997, -90.01403),
    "Growlers": ("venue-growlers", "Growlers", "club", "1911 Poplar Ave, Memphis, TN 38104", "Midtown", 35.14206, -89.99685),
    "Hernando's Hideaway": ("venue-hernandos-hideaway", "Hernando's Hideaway", "bar", "3210 Old Hernando Rd, Memphis, TN 38116", "Whitehaven", 35.06104, -90.02448),
    "Minglewood Hall": ("venue-minglewood-hall", "Minglewood Hall", "club", "1555 Madison Ave, Memphis, TN 38104", "Midtown", 35.13817, -90.00953),
    "B-Side Memphis": ("venue-b-side", "B-Side", "bar", "1553 Madison Ave, Ste 101, Memphis, TN 38104", "Midtown", 35.13818, -90.00960),
    "Lafayette's Music Room": ("venue-lafayettes", "Lafayette's Music Room", "club", "2119 Madison Ave, Memphis, TN 38104", "Overton Square", 35.13638, -89.99068),
    "Bar DKDC": ("venue-bar-dkdc", "Bar DKDC", "bar", "964 S Cooper St, Memphis, TN 38104", "Cooper-Young", 35.11942, -89.99082),
    "Lamplighter Lounge": ("venue-lamplighter", "Lamplighter Lounge", "bar", "1702 Madison Ave, Memphis, TN 38104", "Midtown", 35.13819, -90.00451),
    "Lampligher": "Lamplighter Lounge",
    "The Cove Bar": ("venue-the-cove", "The Cove", "bar", "2559 Broad Ave, Memphis, TN 38112", "Broad Avenue", 35.14766, -89.97407),
    "Satellite Music Hall": ("venue-satellite", "Satellite Music Hall", "club", "1291 Autumn Ave, Memphis, TN 38104", "Crosstown", 35.15121, -90.01638),
    "Blues City Cafe": ("venue-blues-city-cafe", "Blues City Cafe", "bar", "138 Beale St, Memphis, TN 38103", "Beale Street", 35.14016, -90.05324),
    "Molly Fontaine Lounge": ("venue-molly-fontaine", "Molly Fontaine Lounge", "bar", "679 Adams Ave, Memphis, TN 38105", "Victorian Village", 35.14431, -90.03798),
    "Flyway Brewing": ("venue-flyway", "Flyway Brewing", "bar", "598 Monroe Ave, Memphis, TN 38103", "Edge District", 35.14114, -90.04105),
    "South Main Sounds": ("venue-south-main-sounds", "South Main Sounds", "other", "550 S Main St, Memphis, TN 38103", "South Main", 35.13235, -90.05891),
    "Memphis Listening Lab": ("venue-memphis-listening-lab", "Memphis Listening Lab", "other", "1350 Concourse Ave, Memphis, TN 38104", "Crosstown", 35.15186, -90.01352),
    "Crosstown Arts": ("venue-crosstown-arts", "Crosstown Arts", "other", "1350 Concourse Ave, Memphis, TN 38104", "Crosstown", 35.15222, -90.01518),
    "Society Memphis Skatepark and Coffee": ("venue-society-memphis", "Society Memphis", "other", "583 Scott St, Memphis, TN 38112", "Binghampton", 35.14830, -89.96754),
    "Overton Park Shell": ("venue-overton-park-shell", "Overton Park Shell", "outdoor", "1928 Poplar Ave, Memphis, TN 38104", "Overton Park", 35.14569, -89.99482),
    "Orpheum Theatre": ("venue-orpheum", "Orpheum Theatre", "other", "203 S Main St, Memphis, TN 38103", "Downtown", 35.14022, -90.05555),
    "Cannon Center for the Performing Arts": ("venue-cannon-center", "Cannon Center", "other", "255 N Main St, Memphis, TN 38103", "Downtown", 35.15223, -90.05103),
    "Graceland Soundstage": ("venue-graceland-soundstage", "Graceland Soundstage", "other", "3717 Elvis Presley Blvd, Memphis, TN 38116", "Whitehaven", 35.04637, -90.02806),
    "Scheidt Family Performing Arts Center": ("venue-scheidt-center", "Scheidt Family Performing Arts Center", "other", "3800 Central Ave, Memphis, TN 38111", "University District", 35.12307, -89.93864),
    "Lindenwood Christian Church": ("venue-lindenwood", "Lindenwood Christian Church", "other", "2400 Union Ave, Memphis, TN 38112", "Midtown", 35.13351, -89.98109),
    "Germantown Performing Arts Center": ("venue-gpac", "Germantown Performing Arts Center", "other", "1801 Exeter Rd, Germantown, TN 38138", "Germantown", 35.10065, -89.80462),
    "Germantown United Methodist Church": ("venue-germantown-umc", "Germantown United Methodist Church", "other", "2331 S Germantown Rd, Germantown, TN 38138", "Germantown", 35.08585, -89.81083),
    "St. Paul United Methodist Church": ("venue-st-paul-umc-lakeland", "St. Paul's United Methodist Church", "other", "2949 Davies Plantation Rd, Lakeland, TN 38002", "Lakeland", 35.20565, -89.74683),
    "Hope Presbyterian Church": ("venue-hope-presbyterian", "Hope Presbyterian Church", "other", "8500 Walnut Grove Rd, Cordova, TN 38018", "Cordova", 35.12863, -89.77937),
    "Hope Church": "Hope Presbyterian Church",
    "Nashoba": ("venue-nashoba", "Nashoba", "bar", "4600 Merchants Park Cir, Unit 111, Collierville, TN 38017", "Collierville", 35.02392, -89.72088),
    "Landers Center": ("venue-landers-center", "Landers Center", "other", "4560 Venture Dr, Southaven, MS 38671", "Southaven", 34.92710, -89.99658),
    "BankPlus Amphitheater at Snowden Grove": ("venue-bankplus-amphitheater", "BankPlus Amphitheater at Snowden Grove", "outdoor", "6285 Snowden Ln, Southaven, MS 38672", "Southaven", 34.95134, -89.93477),
    "Bluesville at Horseshoe": ("venue-bluesville-horseshoe", "Bluesville at Horseshoe Tunica", "club", "1021 Casino Center Dr, Robinsonville, MS 38664", "Tunica", 34.84728, -90.33075),
    "Huey's (Midtown)": ("venue-hueys-midtown", "Huey's Midtown", "bar", "1927 Madison Ave, Memphis, TN 38104", "Overton Square", 35.13732, -89.99708),
    "Hueys (Downtown)": ("venue-hueys-downtown", "Huey's Downtown", "bar", "77 S 2nd St, Memphis, TN 38103", "Downtown", 35.14279, -90.05257),
    "Huey's (Poplar)": ("venue-hueys-poplar", "Huey's Poplar", "bar", "4872 Poplar Ave, Memphis, TN 38117", "East Memphis", 35.11447, -89.89954),
    "Huey's (Germantown)": ("venue-hueys-germantown", "Huey's Germantown", "bar", "7677 Farmington Blvd, Germantown, TN 38138", "Germantown", 35.09562, -89.80655),
    "Huey's (Cordova)": ("venue-hueys-cordova", "Huey's Cordova", "bar", "1771 N Germantown Pkwy, Cordova, TN 38016", "Cordova", 35.17434, -89.79317),
    "Huey's (Collierville)": ("venue-hueys-collierville", "Huey's Collierville", "bar", "2130 W Poplar Ave, Collierville, TN 38017", "Collierville", 35.05175, -89.73279),
    "Huey's (Southwind)": ("venue-hueys-southwind", "Huey's Southwind", "bar", "7825 Winchester Rd, Memphis, TN 38125", "Southwind", 35.04770, -89.80340),
    "Huey's (Millington)": ("venue-hueys-millington", "Huey's Millington", "bar", "8570 US-51, Millington, TN 38053", "Millington", 35.36026, -89.89146),
    "Huey's (Southaven)": ("venue-hueys-southaven", "Huey's Southaven", "bar", "7090 Malco Blvd, Southaven, MS 38671", "Southaven", 34.96516, -89.98708),
    "Huey's (Olive Branch)": ("venue-hueys-olive-branch", "Huey's Olive Branch", "bar", "8179 McGregor Crossing, Suite 200, Olive Branch, MS 38654", "Olive Branch", 34.96420, -89.84522),
}

# Not music, or listings that duplicate a real show.
SKIP = re.compile(
    r"comedy|bingo|board games|book signing|oddity market|visual arts reception|rc drift|second city|"
    r"jay leno|emo phillips|billy wayne davis|talkin in memphis|premier table|^thanksgiving$|\[postponed\]|"
    r"block party$",
    re.I,
)
# Rooms named in Hi Tone titles move to the "getting there" line.
ROOM = re.compile(r"\s*\[(small room[^\]]*|big room[^\]]*|both rooms)\]\s*", re.I)
NO_COVER = re.compile(r"\s*(?:[–-]\s*NO COVER|\*\s*no cover\s*\*|\*\s*free\s*\*)\s*", re.I)

BAR_VENUES = {"bar", "club"}
DANCE = re.compile(r"\bdj\b|dance party|feralween|r&b party|reggaet|hip hop and r&b|indie sleaze|club", re.I)
ELECTRONIC = re.compile(r"oakenfold|crystal method|tvboo|yheti|toadface|fika|digital whorror", re.I)
QUEER = re.compile(r"\bdrag\b|queer|burlesque", re.I)


def parse_clock(text):
    """'7:30 PM', '8pm', '7:00PM', '1p', 'Doors 7, Show 8' -> (time, end_time or None). None when unusable."""
    if not text:
        return None, None
    t = text.strip().lower()
    m = re.search(r"show\s*(\d{1,2})(?::(\d{2}))?", t)
    if m:  # "Doors 7, Show 8": evening show
        h = int(m.group(1))
        return time(h + 12 if h < 12 else h, int(m.group(2) or 0)), None
    rng = re.match(r"(\d{1,2})(?::(\d{2}))?\s*([ap])m?\s*-\s*(\d{1,2})(?::(\d{2}))?\s*([ap])m?", t)
    if rng:
        a = to24(int(rng.group(1)), int(rng.group(2) or 0), rng.group(3))
        b = to24(int(rng.group(4)), int(rng.group(5) or 0), rng.group(6))
        return a, b
    m = re.match(r"(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m?\.?$", t)
    if not m:
        return None, None
    return to24(int(m.group(1)), int(m.group(2) or 0), m.group(3)), None


def to24(h, mi, ap):
    if ap == "p" and h != 12:
        h += 12
    if ap == "a" and h == 12:
        h = 0
    return time(h, mi)


def iso(dt):
    return dt.astimezone(ZoneInfo("UTC")).strftime("%Y-%m-%dT%H:%M:%SZ")


def q(v):
    if v is None:
        return "NULL"
    if isinstance(v, (int, float)):
        return repr(v)
    return "'" + str(v).replace("'", "''") + "'"


def norm(title):
    return re.sub(r"[^a-z0-9]+", " ", title.lower()).strip()


def main(path):
    data = json.loads(Path(path).read_text())
    rows = data["events"]

    events, skipped, unknown_time = [], [], 0
    for r in rows:
        title = r["title"].strip()
        if SKIP.search(title):
            skipped.append(title)
            continue
        venue = V[r["venue"]]
        if isinstance(venue, str):
            venue = V[venue]
        vid, vname, vtype, address, hood, lat, lng = venue

        free = bool(NO_COVER.search(title)) or "free show" in title.lower() or r["price"].lower() == "free"
        room = ROOM.search(title)
        clean = NO_COVER.sub(" ", ROOM.sub(" ", title))
        clean = re.sub(r"\s*\*Matinee-Free Show\*\s*", " (matinee)", clean, flags=re.I)
        clean = re.sub(r"\s+", " ", clean).strip(" –-:")

        day = date.fromisoformat(r["date"])
        start, end_t = parse_clock(r["start"])
        doors, _ = parse_clock(r["doors"])
        if r["start"].strip().lower() == "2:14 pm":  # a placeholder time in one venue's feed
            start = None
        if start is None and doors is not None:
            start = (datetime.combine(day, doors) + timedelta(hours=1)).time()
        timed = start is not None
        if not timed:
            unknown_time += 1
            start = time(20, 0)
        starts = datetime.combine(day, start, TZ)
        if end_t is not None:
            ends = datetime.combine(day, end_t, TZ)
            if ends <= starts:
                ends += timedelta(days=1)
        else:
            ends = starts + timedelta(hours=3)

        price = r["price"].strip()
        door_price = "Free" if free else (f"${price}" if re.fullmatch(r"\d+(\.\d+)?", price) else (price or None))

        scenes = []
        text = f"{clean} {r['desc']} {r['genre']}"
        if QUEER.search(text):
            scenes.append("queer")
        if ELECTRONIC.search(text):
            scenes += ["rave", "bass"]
        elif DANCE.search(text):
            scenes.append("house")
        if re.search(r"\bdiy\b", text, re.I):
            scenes.append("diy")
        if not {"rave", "house"} & set(scenes):
            scenes.append("live")
        if vtype in BAR_VENUES:
            scenes.append("bar")
        scenes = list(dict.fromkeys(scenes))

        tags = []
        if re.search(r"\b18\s*\+|\+\s*18\b", title):
            tags.append("18+")
        if re.search(r"all ages", r["desc"], re.I):
            tags.append("all-ages")

        notes = []
        if room:
            notes.append(room.group(1).replace("-", ", ").capitalize() + ".")
        if not timed:
            notes.append("Start time not listed; check with the venue.")

        desc_parts = [r["desc"].strip()] if r["desc"].strip() else []
        desc_parts.append("Listed on the WYXR 91.7 FM Memphis concert calendar: concert-calendar.wyxr.org")
        pitch = "WYXR pick" if r["pick"] == "1" else None
        if r["presents"] == "1":
            pitch = "WYXR presents"

        events.append({
            "id": f"wyxr-{r['id']}",
            "venue_id": vid,
            "title": clean,
            "pitch": pitch,
            "description": "\n\n".join(desc_parts),
            "starts_at": iso(starts),
            "ends_at": iso(ends),
            "address": address,
            "neighborhood": hood,
            "lat": lat,
            "lng": lng,
            "getting_there": " ".join(notes) or None,
            "door_price": door_price,
            "ticket_url": r["url"] or None,
            "policy_tags": json.dumps(tags),
            "scenes": json.dumps(scenes),
            "_key": (r["date"], vid),
            "_norm": norm(clean),
            "_score": (r["pick"] == "1") * 4 + (r["presents"] == "1") * 4 + timed * 2 + bool(r["desc"]) + bool(r["url"]),
        })

    # Collapse duplicate listings: same night, same venue, one title containing the other.
    events.sort(key=lambda e: -e["_score"])
    kept, dupes = [], []
    for e in events:
        if any(k["_key"] == e["_key"] and (e["_norm"] in k["_norm"] or k["_norm"] in e["_norm"]
               or (e["ticket_url"] and e["ticket_url"] == k["ticket_url"] and "hitonecafe" not in (e["ticket_url"] or "")))
               for k in kept):
            dupes.append(e["title"])
            continue
        kept.append(e)
    kept.sort(key=lambda e: e["starts_at"])

    venues_used = {}
    for v in V.values():
        if isinstance(v, tuple) and any(e["venue_id"] == v[0] for e in kept):
            venues_used[v[0]] = v

    cols = ["id", "city_id", "venue_id", "title", "pitch", "description", "starts_at", "ends_at", "address",
            "neighborhood", "lat", "lng", "getting_there", "door_price", "ticket_url", "policy_tags", "scenes", "status", "is_sample"]
    upd = [c for c in cols if c not in ("id", "city_id", "status", "is_sample")]
    lines = [
        f"-- Generated by scripts/import-wyxr.py from {Path(path).name} ({data.get('fetched')}). Do not edit by hand.",
        f"-- {len(kept)} events at {len(venues_used)} venues. Source: {data.get('source')}",
        "",
    ]
    for vid, name, vtype, address, hood, lat, lng in venues_used.values():
        lines.append(
            "INSERT INTO venues (id, city_id, name, type, address, neighborhood, lat, lng) VALUES "
            f"({q(vid)}, {q(CITY)}, {q(name)}, {q(vtype)}, {q(address)}, {q(hood)}, {lat}, {lng}) "
            "ON CONFLICT(id) DO UPDATE SET name=excluded.name, type=excluded.type, address=excluded.address, "
            "neighborhood=excluded.neighborhood, lat=excluded.lat, lng=excluded.lng;"
        )
    lines.append("")
    for e in kept:
        vals = {**e, "city_id": CITY, "status": "live", "is_sample": 0}
        lines.append(
            f"INSERT INTO events ({', '.join(cols)}) VALUES ({', '.join(q(vals[c]) for c in cols)}) "
            f"ON CONFLICT(id) DO UPDATE SET {', '.join(f'{c}=excluded.{c}' for c in upd)}, "
            "updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now');"
        )
    ids = ", ".join(q(e["id"]) for e in kept)
    lines += [
        "",
        "-- Future WYXR listings that dropped out of this export, unless someone RSVP'd.",
        f"DELETE FROM events WHERE id LIKE 'wyxr-%' AND id NOT IN ({ids}) "
        "AND starts_at > strftime('%Y-%m-%dT%H:%M:%SZ','now') "
        "AND NOT EXISTS (SELECT 1 FROM rsvps r WHERE r.event_id = events.id);",
        "",
    ]
    OUT.write_text("\n".join(lines))
    print(f"{len(rows)} listings -> {len(kept)} events at {len(venues_used)} venues "
          f"({len(skipped)} not music, {len(dupes)} duplicates, {unknown_time} without a start time)")
    print("wrote", OUT.relative_to(ROOT))
    return kept, skipped, dupes


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ROOT / "db" / "import" / "wyxr-2026-10-25.json")
