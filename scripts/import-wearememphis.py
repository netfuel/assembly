"""Turns the We Are Memphis live-music scrape (plus Overton Park Shell) into SQL for Assembly's database.

Run:  python3 scripts/import-wearememphis.py db/import/wearememphis-2026-10-25.json
Then: double-click import-wearememphis.command (downloads the artwork, uploads it to R2, loads the SQL)

Skips anything already on the site from the WYXR import (same night, same venue, matching title) but
still attaches We Are Memphis artwork to those WYXR events when they have no flyer yet. Only
event-specific artwork is used: a venue's stock photo (reused across listings) is left out.
Safe to re-run: events and venues are upserted by id, RSVPs are kept, and future listings that drop out
of a newer scrape are removed unless someone has RSVP'd or an organizer took the event over.
"""
import hashlib
import json
import re
import sys
from datetime import datetime, time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "db" / "import" / "wearememphis.sql"
MANIFEST = ROOT / "db" / "import" / "wearememphis-artwork.tsv"
WYXR = ROOT / "db" / "import" / "wyxr-2026-10-25.json"
TZ = ZoneInfo("America/Chicago")
UTC = ZoneInfo("UTC")
CITY = "memphis"
PREFIX = "wam-"
NOW = datetime.now(UTC)

# Venue name as We Are Memphis / the Shell write it -> (id, display name, type, address, neighborhood, lat, lng).
# Ids shared with scripts/import-wyxr.py so the same room is one venue. Coordinates from OpenStreetMap.
V = {
    "Growlers": ("venue-growlers", "Growlers", "club", "1911 Poplar Ave, Memphis, TN 38104", "Midtown", 35.14206, -89.99685),
    "Hi-Tone Café": ("venue-hi-tone", "Hi Tone", "club", "282 N Cleveland St, Memphis, TN 38104", "Crosstown", 35.14649, -90.01448),
    "B-Side Bar": ("venue-b-side", "B-Side", "bar", "1553 Madison Ave, Ste 101, Memphis, TN 38104", "Midtown", 35.13818, -90.00960),
    "Lafayette's Music Room": ("venue-lafayettes", "Lafayette's Music Room", "club", "2119 Madison Ave, Memphis, TN 38104", "Overton Square", 35.13638, -89.99068),
    "Lamplighter Lounge": ("venue-lamplighter", "Lamplighter Lounge", "bar", "1702 Madison Ave, Memphis, TN 38104", "Midtown", 35.13819, -90.00451),
    "The Cove": ("venue-the-cove", "The Cove", "bar", "2559 Broad Ave, Memphis, TN 38112", "Broad Avenue", 35.14766, -89.97407),
    "Minglewood Hall": ("venue-minglewood-hall", "Minglewood Hall", "club", "1555 Madison Ave, Memphis, TN 38104", "Midtown", 35.13817, -90.00953),
    "Satellite Music Hall": ("venue-satellite", "Satellite Music Hall", "club", "1291 Autumn Ave, Memphis, TN 38104", "Crosstown", 35.15121, -90.01638),
    "Bar DKDC": ("venue-bar-dkdc", "Bar DKDC", "bar", "964 S Cooper St, Memphis, TN 38104", "Cooper-Young", 35.11942, -89.99082),
    "Hernando's Hideaway": ("venue-hernandos-hideaway", "Hernando's Hideaway", "bar", "3210 Old Hernando Rd, Memphis, TN 38116", "Whitehaven", 35.06104, -90.02448),
    "Huey's Midtown": ("venue-hueys-midtown", "Huey's Midtown", "bar", "1927 Madison Ave, Memphis, TN 38104", "Overton Square", 35.13732, -89.99708),
    "Huey's East": ("venue-hueys-poplar", "Huey's Poplar", "bar", "4872 Poplar Ave, Memphis, TN 38117", "East Memphis", 35.11447, -89.89954),
    "Graceland Soundstage": ("venue-graceland-soundstage", "Graceland Soundstage", "other", "3717 Elvis Presley Blvd, Memphis, TN 38116", "Whitehaven", 35.04637, -90.02806),
    "Flyway Brewing Company": ("venue-flyway", "Flyway Brewing", "bar", "598 Monroe Ave, Memphis, TN 38103", "Edge District", 35.14114, -90.04105),
    "South Main Sounds": ("venue-south-main-sounds", "South Main Sounds", "other", "550 S Main St, Memphis, TN 38103", "South Main", 35.13235, -90.05891),
    "Society Memphis Skatepark and Coffee": ("venue-society-memphis", "Society Memphis", "other", "583 Scott St, Memphis, TN 38112", "Binghampton", 35.14830, -89.96754),
    "Overton Park Shell": ("venue-overton-park-shell", "Overton Park Shell", "outdoor", "1928 Poplar Ave, Memphis, TN 38104", "Overton Park", 35.14569, -89.99482),
    "Scheidt Family Performing Arts Center": ("venue-scheidt-center", "Scheidt Family Performing Arts Center", "other", "3800 Central Ave, Memphis, TN 38111", "University District", 35.12307, -89.93864),
    "Orpheum Theatre": ("venue-orpheum", "Orpheum Theatre", "other", "203 S Main St, Memphis, TN 38103", "Downtown", 35.14022, -90.05555),
    "Cannon Center for Performing Arts": ("venue-cannon-center", "Cannon Center", "other", "255 N Main St, Memphis, TN 38103", "Downtown", 35.15223, -90.05103),
    "The Grove at GPAC": ("venue-gpac", "Germantown Performing Arts Center", "other", "1801 Exeter Rd, Germantown, TN 38138", "Germantown", 35.10065, -89.80462),
    "Crosstown Concourse": ("venue-crosstown-arts", "Crosstown Arts", "other", "1350 Concourse Ave, Memphis, TN 38104", "Crosstown", 35.15222, -90.01518),
    "Huey's Downtown": ("venue-hueys-downtown", "Huey's Downtown", "bar", "77 S 2nd St, Memphis, TN 38103", "Downtown", 35.14279, -90.05257),
    "Huey's Germantown": ("venue-hueys-germantown", "Huey's Germantown", "bar", "7677 Farmington Blvd, Germantown, TN 38138", "Germantown", 35.09562, -89.80655),
    "Huey's Cordova": ("venue-hueys-cordova", "Huey's Cordova", "bar", "1771 N Germantown Pkwy, Cordova, TN 38016", "Cordova", 35.17434, -89.79317),
    "Huey's Collierville": ("venue-hueys-collierville", "Huey's Collierville", "bar", "2130 W Poplar Ave, Collierville, TN 38017", "Collierville", 35.05175, -89.73279),
    "Huey's Southwind": ("venue-hueys-southwind", "Huey's Southwind", "bar", "7825 Winchester Rd, Memphis, TN 38125", "Southwind", 35.04770, -89.80340),
    "Huey's Millington": ("venue-hueys-millington", "Huey's Millington", "bar", "8570 US-51, Millington, TN 38053", "Millington", 35.36026, -89.89146),
    "Mollie Fontaine Lounge": ("venue-molly-fontaine", "Molly Fontaine Lounge", "bar", "679 Adams Ave, Memphis, TN 38105", "Victorian Village", 35.14431, -90.03798),
    "Hope Church": ("venue-hope-presbyterian", "Hope Presbyterian Church", "other", "8500 Walnut Grove Rd, Cordova, TN 38018", "Cordova", 35.12863, -89.77937),
    "Nashoba": ("venue-nashoba", "Nashoba", "bar", "4600 Merchants Park Cir, Unit 111, Collierville, TN 38017", "Collierville", 35.02392, -89.72088),
    "Lindenwood Christian Church": ("venue-lindenwood", "Lindenwood Christian Church", "other", "2400 Union Ave, Memphis, TN 38112", "Midtown", 35.13351, -89.98109),
    "Germantown United Methodist Church": ("venue-germantown-umc", "Germantown United Methodist Church", "other", "2331 S Germantown Rd, Germantown, TN 38138", "Germantown", 35.08585, -89.81083),
    "St. Paul United Methodist Church": ("venue-st-paul-umc-lakeland", "St. Paul's United Methodist Church", "other", "2949 Davies Plantation Rd, Lakeland, TN 38002", "Lakeland", 35.20565, -89.74683),
    # New here.
    "The Green Room at Crosstown Arts": ("venue-green-room-crosstown", "The Green Room at Crosstown Arts", "club", "1350 Concourse Ave, Memphis, TN 38104", "Crosstown", 35.15222, -90.01518),
    "Crosstown Theatre": ("venue-crosstown-theatre", "Crosstown Theatre", "other", "1350 Concourse Ave, Memphis, TN 38104", "Crosstown", 35.15222, -90.01518),
    "Memphis Brooks Museum of Art": ("venue-brooks-museum", "Memphis Brooks Museum of Art", "other", "1934 Poplar Ave, Memphis, TN 38104", "Overton Park", 35.14453, -89.99464),
    "Harris Concert Hall": ("venue-harris-concert-hall", "Harris Concert Hall", "other", "3775 Central Ave, Memphis, TN 38111", "University District", 35.12289, -89.93783),
    "University of Memphis School of Music": ("venue-uofm-school-of-music", "University of Memphis School of Music", "other", "3775 Central Ave, Memphis, TN 38111", "University District", 35.12289, -89.93783),
    "Wiseacre Brewing Company OG": ("venue-wiseacre-og", "Wiseacre Brewing OG", "bar", "2783 Broad Ave, Memphis, TN 38112", "Broad Avenue", 35.14838, -89.97824),
    "Wiseacre OG": "Wiseacre Brewing Company OG",
    "Halloran Centre for Performing Arts": ("venue-halloran-centre", "Halloran Centre", "other", "225 S Main St, Memphis, TN 38103", "Downtown", 35.13979, -90.05570),
    "Tiger Lane at Liberty Park": ("venue-tiger-lane", "Tiger Lane at Liberty Park", "outdoor", "450 Early Maxwell Blvd, Memphis, TN 38104", "Liberty Park", 35.12004, -89.98064),
    "Memphis Youth Symphony Program": ("venue-mysp", "Memphis Youth Symphony Program", "other", "474 Perkins Extd, Memphis, TN 38117", "East Memphis", 35.11843, -89.90844),
    "Tin Roof Beale Street": ("venue-tin-roof", "Tin Roof", "bar", "315 Beale St, Memphis, TN 38103", "Beale Street", 35.13915, -90.05087),
    "Calvary Episcopal Church": ("venue-calvary-episcopal", "Calvary Episcopal Church", "other", "102 N 2nd St, Memphis, TN 38103", "Downtown", 35.14753, -90.05004),
    "2487 Broad Ave": ("venue-2487-broad", "2487 Broad Ave", "other", "2487 Broad Ave, Memphis, TN 38112", "Broad Avenue", 35.14793, -89.97420),
    "Buckman Performing Arts Center": ("venue-buckman", "Buckman Performing Arts Center", "other", "60 Perkins Ext, Memphis, TN 38117", "East Memphis", 35.12650, -89.90690),
    "Bartlett Performing Arts & Conference Center": ("venue-bartlett-pacc", "Bartlett Performing Arts & Conference Center", "other", "3663 Appling Rd, Bartlett, TN 38133", "Bartlett", 35.22678, -89.80819),
    "The Village Event Center": ("venue-village-event-center", "The Village Event Center", "other", "7818 E Holmes Rd, Memphis, TN 38125", "Southwind", 35.00646, -89.99183),
    "Meddlesome Brewing Co": ("venue-meddlesome", "Meddlesome Brewing", "bar", "7750 Trinity Rd, Cordova, TN 38018", "Cordova", 35.13952, -89.80408),
    "ARRIVE Memphis": ("venue-arrive-memphis", "ARRIVE Memphis", "bar", "477 S Main St, Memphis, TN 38103", "South Main", 35.13439, -90.05935),
    "The Peabody Memphis, Grand Lobby": ("venue-peabody", "The Peabody Memphis", "other", "149 Union Ave, Memphis, TN 38103", "Downtown", 35.14302, -90.05325),
    "TheatreWorks at the Square": ("venue-theatreworks", "TheatreWorks at the Square", "other", "2085 Monroe Ave, Memphis, TN 38104", "Overton Square", 35.13544, -89.99230),
    "Idlewild Presbyterian Church": ("venue-idlewild-presbyterian", "Idlewild Presbyterian Church", "other", "1750 Union Ave, Memphis, TN 38104", "Midtown", 35.13559, -90.00317),
    "Elmwood Cemetery": ("venue-elmwood-cemetery", "Elmwood Cemetery", "outdoor", "824 S Dudley St, Memphis, TN 38104", "Midtown", 35.12437, -90.02935),
    "Beale Street Entertainment District": ("venue-beale-street", "Beale Street", "outdoor", "Beale St, Memphis, TN 38103", "Beale Street", 35.13970, -90.05200),
    "AutoZone Sharpe Planetarium, Memphis Museum of Science and History": ("venue-mosh", "Museum of Science & History (MoSH)", "other", "3050 Central Ave, Memphis, TN 38111", "Central Gardens", 35.12534, -89.95936),
    "Museum of Science & History (MoSH)": "AutoZone Sharpe Planetarium, Memphis Museum of Science and History",
    "Greenhouse at Overton Park": ("venue-overton-park-greenhouse", "Greenhouse at Overton Park", "other", "281 E Parkway N, Memphis, TN 38112", "Overton Park", 35.14322, -89.98228),
    "Vietnamese Buddhist Association of Memphis, Chùa Chánh Tâm": ("venue-chua-chanh-tam", "Chùa Chánh Tâm", "other", "1368 Jefferson Ave, Memphis, TN 38104", "Midtown", 35.14230, -90.02170),
}

# Not music, or not something to list.
SKIP = re.compile(r"comedy|bingo|trivia|\bkaraoke\b|book signing|RESCHEDULED", re.I)
STOP = {"the", "a", "an", "of", "and", "with", "w", "at", "in", "on", "feat", "ft", "presents", "live", "tour", "show", "night", "party", "memphis"}
BAR_VENUES = {"bar", "club"}
DANCE = re.compile(r"\bdj\b|dance party|dance night|reggaet|hip hop (and|&) r&b|indie sleaze|rave\b|silent disco", re.I)
QUEER = re.compile(r"\bdrag\b|queer|burlesque|\blgbtq", re.I)
PRICE = re.compile(r"(?<![\w$])\$\s?(\d+(?:\.\d{2})?)")


def q(v):
    if v is None:
        return "NULL"
    if isinstance(v, (int, float)):
        return repr(v)
    return "'" + str(v).replace("'", "''") + "'"


def iso(dt):
    return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def norm(s):
    return re.sub(r"[^a-z0-9]+", " ", s.lower().replace("’", "'")).strip()


def words(s):
    return {w for w in norm(s).split() if w not in STOP and len(w) > 1}


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower().replace("’", "")).strip("-")


def parse_clock(text):
    m = re.match(r"\s*(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m", text or "", re.I)
    if not m:
        return None
    h = int(m.group(1)) % 12 + (12 if m.group(3).lower() == "p" else 0)
    return time(h, int(m.group(2) or 0))


def venue_for(e):
    name = e["venue"]
    if not name:
        # The listing left it blank; the summary line at the end of the blurb names it:
        # "Sunday, October 25, 2026 · Huey's Collierville · 6 PM"
        m = re.search(r"\d{4} · ([^·]+?)(?:,\s*\d[^·]*)? · ", e["about"])
        name = m.group(1).strip() if m else ""
    v = V.get(name)
    if isinstance(v, str):
        v = V[v]
    return name, v


def own_artwork(e):
    """True when the picture is for this listing, not the venue's stock photo reused across its shows."""
    img = e.get("image") or ""
    if not img:
        return False
    if e["source"] == "overtonparkshell":
        return True
    s = slug(e["title"])
    return s[:24] in img or (len(s) > 12 and s.split("-")[0] + "-" + s.split("-")[1] in img if "-" in s else s in img)


def main(path):
    data = json.loads(Path(path).read_text())
    wyxr = json.loads(WYXR.read_text())["events"] if WYXR.exists() else []
    wyxr_by_day = {}
    for r in wyxr:
        wyxr_by_day.setdefault(r["date"], []).append(r)

    events, skipped, dupes, flyer_updates, unknown_venue, past = [], [], [], [], [], 0
    seen_keys = {}
    for e in data["events"]:
        if SKIP.search(e["title"]):
            skipped.append(e["title"])
            continue
        vname, venue = venue_for(e)

        if e.get("start"):
            starts = datetime.fromisoformat(e["start"]).astimezone(TZ)
            ends = datetime.fromisoformat(e["end"]).astimezone(TZ) if e.get("end") else starts + timedelta(hours=3)
        else:
            day = datetime.strptime(e["date"], "%Y-%m-%d").date()
            t = parse_clock(e["time"]) or time(20, 0)
            starts = datetime.combine(day, t, TZ)
            ends = starts + timedelta(hours=3)
        if ends < NOW:
            past += 1
            continue
        day_key = starts.date().isoformat()

        # Already on the site from WYXR? Same night, same venue (or the WYXR venue name is in ours), related title.
        tw = words(e["title"])
        hit = None
        for r in wyxr_by_day.get(day_key, []):
            rt = norm(r["title"])
            same_venue = norm(r["venue"]) in norm(vname) or norm(vname) in norm(r["venue"]) or words(r["venue"]) & words(vname)
            if rt == norm(e["title"]) or (same_venue and (norm(e["title"]) in rt or rt in norm(e["title"]) or len(tw & words(r["title"])) >= 1 and (len(tw) <= 2 or len(tw & words(r["title"])) >= 2))):
                hit = r
                break
        if hit:
            dupes.append((e["title"], hit["title"]))
            if own_artwork(e):
                flyer_updates.append((f"wyxr-{hit['id']}", e))
            continue
        if not venue:
            unknown_venue.append((e["title"], vname, e["address"]))
            continue
        vid, vdisplay, vtype, address, hood, lat, lng = venue
        # The same show listed by both sources (Shell on Wheels at Wiseacre is on We Are Memphis too).
        key = (day_key, vid)
        if key in seen_keys and (tw & seen_keys[key]):
            dupes.append((e["title"], "earlier listing"))
            continue
        seen_keys[key] = seen_keys.get(key, set()) | tw

        about = e["about"].strip()
        summary = about.rsplit("  ", 1)[-1] if " · " in about else ""
        text = f"{e['title']} {about} {e.get('genre', '')}"
        price = e.get("price")
        if not price:
            if re.search(r"\bfree\b|no cover", summary, re.I) and not PRICE.search(summary):
                price = "Free"
            else:
                found = sorted({float(x) for x in PRICE.findall(summary)})
                if found:
                    fmt = lambda n: f"${n:g}" if n == int(n) else f"${n:.2f}"
                    if re.search(r"from \$", summary, re.I) or len(found) == 1:
                        price = ("From " if len(found) > 1 or re.search(r"from \$", summary, re.I) else "") + fmt(found[0])
                    else:
                        price = f"{fmt(found[0])} to {fmt(found[-1])}"
        tags = []
        if re.search(r"\b21\s*\+|21 and (up|over)", text):
            tags.append("21+")
        elif re.search(r"\b18\s*\+|18 and (up|over)", text):
            tags.append("18+")
        if re.search(r"all ages", text, re.I):
            tags.append("all-ages")
        if e.get("age") and e["age"] not in tags:
            tags.append(e["age"])

        genre = e.get("genre") or ""
        scenes = []
        if QUEER.search(text):
            scenes.append("queer")
        # We Are Memphis files some multi-band bills under EDM; only call it a rave when it reads like one.
        if genre == "Electronic/EDM" and (DANCE.search(text) or re.search(r"electronic|techno|\bbass\b|\bedm\b|\bhouse\b", text, re.I) or " & " not in e["title"]):
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

        desc = [about] if about else []
        if e.get("lineup"):
            desc.append("Lineup: " + ", ".join(e["lineup"]))
        if e["source"] == "overtonparkshell":
            desc.append("Listed by the Overton Park Shell: overtonparkshell.org")
        else:
            desc.append(f"Listed on We Are Memphis: wearememphis.com/live" + (f" · Genre: {genre}" if genre and genre != "Other" else ""))
        has_art = own_artwork(e)
        if has_art and e.get("image_credit"):
            desc.append(f"Image: {e['image_credit']}")

        ticket = next((l["href"] for l in e.get("links", []) if l.get("href")), None)
        eid = PREFIX + hashlib.sha1(e["url"].encode()).hexdigest()[:8]
        events.append({
            "id": eid,
            "venue_id": vid,
            "title": re.sub(r"\s+", " ", e["title"]).strip(),
            "pitch": None,
            "description": "\n\n".join(desc),
            "starts_at": iso(starts),
            "ends_at": iso(ends),
            "address": address,
            "neighborhood": hood,
            "lat": lat,
            "lng": lng,
            "getting_there": None,
            "door_price": price,
            "ticket_url": ticket,
            "policy_tags": json.dumps(tags),
            "scenes": json.dumps(scenes),
            "_image": e["image"] if has_art else None,
        })
    events.sort(key=lambda x: x["starts_at"])

    # Artwork manifest: event id, source image URL, R2 key. import-wearememphis.command downloads and uploads these.
    art = []
    for ev in events:
        if ev["_image"]:
            ext = "png" if ev["_image"].lower().split("?")[0].endswith(".png") else "jpg"
            ev["flyer_key"] = f"flyers/import/wam/{ev['id']}.{ext}"
            art.append((ev["id"], ev["_image"], ev["flyer_key"]))
        else:
            ev["flyer_key"] = None
    for wid, e in flyer_updates:
        ext = "png" if e["image"].lower().split("?")[0].endswith(".png") else "jpg"
        art.append((wid, e["image"], f"flyers/import/wam/{wid}.{ext}"))
    MANIFEST.write_text("".join(f"{i}\t{u}\t{k}\n" for i, u, k in art))

    venues_used = {}
    for v in V.values():
        if isinstance(v, tuple) and any(ev["venue_id"] == v[0] for ev in events):
            venues_used[v[0]] = v

    cols = ["id", "city_id", "venue_id", "title", "pitch", "description", "starts_at", "ends_at", "address", "neighborhood",
            "lat", "lng", "getting_there", "door_price", "ticket_url", "policy_tags", "scenes", "flyer_key", "status", "is_sample"]
    upd = [c for c in cols if c not in ("id", "city_id", "status", "is_sample")]
    lines = [
        f"-- Generated by scripts/import-wearememphis.py from {Path(path).name} ({data.get('fetched')}). Do not edit by hand.",
        f"-- {len(events)} events at {len(venues_used)} venues; {len(flyer_updates)} WYXR events get artwork. Sources: {'; '.join(data.get('sources', []))}",
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
    for ev in events:
        vals = {**ev, "city_id": CITY, "status": "live", "is_sample": 0}
        lines.append(
            f"INSERT INTO events ({', '.join(cols)}) VALUES ({', '.join(q(vals[c]) for c in cols)}) "
            f"ON CONFLICT(id) DO UPDATE SET {', '.join(f'{c}=excluded.{c}' for c in upd)}, "
            "updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') "
            # Once an organizer has taken the event over (it has a host), their edits win.
            "WHERE NOT EXISTS (SELECT 1 FROM event_hosts h WHERE h.event_id = events.id);"
        )
    if flyer_updates:
        lines += ["", "-- Artwork for shows that were already listed from WYXR without a flyer."]
        for wid, e in flyer_updates:
            ext = "png" if e["image"].lower().split("?")[0].endswith(".png") else "jpg"
            lines.append(f"UPDATE events SET flyer_key={q(f'flyers/import/wam/{wid}.{ext}')} WHERE id={q(wid)} AND flyer_key IS NULL;")
    ids = ", ".join(q(ev["id"]) for ev in events) or "''"
    lines += [
        "",
        "-- Future We Are Memphis listings that dropped out of this scrape, unless someone RSVP'd or an organizer took them over.",
        f"DELETE FROM events WHERE id LIKE '{PREFIX}%' AND id NOT IN ({ids}) "
        "AND starts_at > strftime('%Y-%m-%dT%H:%M:%SZ','now') "
        "AND NOT EXISTS (SELECT 1 FROM rsvps r WHERE r.event_id = events.id) "
        "AND NOT EXISTS (SELECT 1 FROM event_hosts h WHERE h.event_id = events.id);",
        "",
    ]
    OUT.write_text("\n".join(lines))
    print(f"{len(data['events'])} listings -> {len(events)} new events at {len(venues_used)} venues "
          f"({len(dupes)} already on the site, {len(flyer_updates)} of those get artwork; {len(skipped)} skipped, {past} already over)")
    print(f"{sum(1 for e in events if e['flyer_key'])} of the new events have their own artwork; {len(art)} images to fetch")
    if unknown_venue:
        print("Venues not in the table (events left out):")
        for t, v, a in unknown_venue:
            print(f"  {t!r} at {v!r} ({a})")
    print("wrote", OUT.relative_to(ROOT), "and", MANIFEST.relative_to(ROOT))
    return events, dupes, flyer_updates


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ROOT / "db" / "import" / "wearememphis-2026-10-25.json")
