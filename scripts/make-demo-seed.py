#!/usr/bin/env python3
"""Writes db/demo/seed.sql: the fictional content for demo.assembly.rsvp.

Everything is invented: venues, artists, crews, people, comments. Neighborhoods are real Memphis areas.
Event times are relative to when the seed runs (the demo Worker re-runs it every night at 3 am Memphis),
so "tonight" and "this weekend" always have something on. Re-run this script after editing the lists:

    python3 scripts/make-demo-seed.py
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "db" / "demo" / "seed.sql"
# The same SQL as a module the Worker imports for the nightly reset. Production builds with wrangler's own
# bundler, which can't import .sql files, so the text is embedded as a string instead.
OUT_TS = ROOT / "worker" / "demoSeed.ts"


def q(v):
    if v is None:
        return "NULL"
    if isinstance(v, (int, float)):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


def j(v):
    return q(json.dumps(v, separators=(",", ":")))


# Offsets are hours from midnight UTC on the day the seed runs. Memphis is UTC-6 (CST), so local hour H on
# local day d is 24*d + H + 6. Hours past midnight use H >= 24.
def at(day, hour):
    h = 24 * day + hour + 6
    return f"strftime('%Y-%m-%dT%H:%M:%SZ', 'now', 'start of day', '+{int(h * 60)} minutes')"


VENUES = [
    ("static-annex", "Static Annex", "warehouse", "418 Rear Loading Dock (demo address)", "South Main", 35.1318, -90.0566, "Freight door on the alley side. Ramp entrance."),
    ("moth-house", "Moth House", "diy", "Side basement door (demo address)", "Cooper-Young", 35.1188, -89.9912, "Basement show space. Keep it quiet on the porch."),
    ("velvet-ditch", "Velvet Ditch", "bar", "Upstairs, 2nd floor (demo address)", "Midtown", 35.1372, -90.0035, "Upstairs bar with a tiny booth."),
    ("room-9", "Room 9", "club", "Below the record shop (demo address)", "Overton Square", 35.1497, -89.9929, "Basement club, 180 cap, Funktion-One."),
    ("pulp", "Pulp Warehouse", "warehouse", "North gate (demo address)", "Crosstown", 35.1523, -90.0128, "Two rooms. Rideshare drop at the north gate."),
    ("low-ceiling", "Low Ceiling", "club", "Stairs behind the diner (demo address)", "Downtown", 35.1452, -90.0505, "Low ceiling, loud system."),
    ("greenhouse", "Greenhouse Lot", "outdoor", "Garden gate entrance (demo address)", "Binghampton", 35.1441, -89.9489, "Open-air lot behind the community garden."),
    ("lantern", "The Lantern", "bar", "Back patio (demo address)", "Broad Ave", 35.1479, -89.9651, "Neighborhood bar with a patio and a jukebox."),
    ("tin-roof", "Tin Roof Hall", "diy", "Old church annex (demo address)", "Crosstown", 35.1561, -90.0187, "All-ages DIY hall run by volunteers."),
    ("riverline", "Riverline Pavilion", "outdoor", "Bluff walk, south end (demo address)", "Riverside", 35.1386, -90.0571, "Sunset spot on the bluff."),
    ("kiln", "The Kiln", "club", "Behind the pottery studio (demo address)", "Midtown", 35.1324, -89.9880, "Small sweaty room, big lights."),
    ("signal", "Signal Supply", "bar", "Corner storefront (demo address)", "Clinton", 35.1253, -89.9801, "Record store by day, bar by night."),
]

ARTISTS = [
    ("juno-ray", "Juno Ray", {"soundcloud": "https://soundcloud.com/", "instagram": "https://instagram.com/"}, "Disco romantic. Resident at Wet Paint."),
    ("kitten-static", "Kitten Static", {"mixcloud": "https://www.mixcloud.com/"}, "Jacking house and ballroom cuts."),
    ("mister-ozone", "Mister Ozone", {"bandcamp": "https://bandcamp.com/", "ra": "https://ra.co/"}, "Acid lines, 303 worship."),
    ("soft-ditch", "Soft Ditch", {"bandcamp": "https://bandcamp.com/"}, "Four-piece noise pop."),
    ("gravel-saints", "Gravel Saints", {"instagram": "https://instagram.com/"}, "Post-punk from the east side."),
    ("dalia-k", "Dalia K", {"soundcloud": "https://soundcloud.com/", "ra": "https://ra.co/"}, "Hypnotic techno, long sets."),
    ("form-three", "Form Three", {"soundcloud": "https://soundcloud.com/"}, "Hardgroove and loops."),
    ("tuff-gong-jr", "Tuff Gong Jr", {"mixcloud": "https://www.mixcloud.com/"}, "Jungle, dub, and dancehall."),
    ("dj-pallet", "DJ Pallet", {"soundcloud": "https://soundcloud.com/"}, "Footwork and Memphis rap edits."),
    ("petal-grip", "Petal Grip", {"bandcamp": "https://bandcamp.com/"}, "Balearic and ambient for daylight."),
    ("big-aunt", "Big Aunt", {"instagram": "https://instagram.com/"}, "Disco that raised you."),
    ("lou-vega", "Lou Vega", {"spotify": "https://open.spotify.com/"}, "Edits all night."),
    ("neon-debt", "Neon Debt", {"soundcloud": "https://soundcloud.com/"}, "Electro and breaks."),
    ("halle-burn", "Halle Burn", {"ra": "https://ra.co/"}, "Peak-time techno."),
    ("mothra-twins", "Mothra Twins", {"bandcamp": "https://bandcamp.com/", "instagram": "https://instagram.com/"}, "Synth duo, drum machines and harmonies."),
    ("sister-tape", "Sister Tape", {"soundcloud": "https://soundcloud.com/"}, "Vogue beats and Jersey club."),
    ("orchard-hum", "Orchard Hum", {"bandcamp": "https://bandcamp.com/"}, "Shoegaze in a church annex."),
    ("dj-bluff", "DJ Bluff", {"mixcloud": "https://www.mixcloud.com/"}, "Deep house for sunsets."),
    ("vex-mercy", "Vex Mercy", {"soundcloud": "https://soundcloud.com/", "ra": "https://ra.co/"}, "Industrial and EBM."),
    ("cola-wars", "Cola Wars", {"bandcamp": "https://bandcamp.com/"}, "Garage rock, three chords, no mercy."),
]

# Organizers (hosts) and attendees. Attendees with friend=True become the guest's friends on the map.
PEOPLE = [
    ("org-wet-paint", "Wet Paint Collective", "they/them", "Queer house nights since 2019.", ["queer", "house"], True, False),
    ("org-moth", "Moth House", None, "Basement shows, all ages, sliding scale.", ["diy", "live"], True, False),
    ("org-static", "Static Crew", None, "Warehouse techno, one room, no phones.", ["rave", "techno"], True, False),
    ("org-low", "Low Ceiling Sound", None, "Jungle, footwork, and bass.", ["bass", "rave"], True, False),
    ("org-greenhouse", "Greenhouse Sundays", None, "Open-air disco, free with RSVP.", ["house", "queer"], True, False),
    ("org-pulp", "Pulp After Dark", None, "Costume raves, two rooms.", ["rave", "queer"], True, False),
    ("org-tin-roof", "Tin Roof Volunteers", None, "All-ages DIY hall.", ["diy", "live"], True, False),
    ("friend-ari", "Ari M.", "she/her", "Out most Fridays.", ["queer", "house"], False, True),
    ("friend-dev", "Dev O.", "he/him", "Techno and coffee.", ["techno", "rave"], False, True),
    ("friend-sky", "Sky R.", "they/them", "Basement shows forever.", ["diy", "live"], False, True),
    ("friend-nina", "Nina T.", "she/her", None, ["bass", "bar"], False, True),
    ("fan-jules", "Jules P.", "they/them", None, ["queer"], False, False),
    ("fan-marco", "Marco L.", "he/him", None, ["house"], False, False),
    ("fan-bee", "Bee W.", "she/her", None, ["diy"], False, False),
    ("fan-theo", "Theo K.", "he/him", None, ["techno"], False, False),
    ("fan-rosa", "Rosa G.", "she/her", None, ["queer", "rave"], False, False),
    ("fan-kai", "Kai N.", "they/them", None, ["bass"], False, False),
]

# (id, venue, host, title, pitch, day, start hour, end hour, door, ticket, policies, scenes, getting there, lineup, going, interested)
EVENTS = [
    ("signal-records", "signal", None, "Record swap and listening bar", "Crates, coffee, and a slow afternoon", 0, 12, 19, "Free", None,
     ["all-ages", "sober-friendly"], ["bar", "house"], "Street parking on Cooper", [("lou-vega", "1:00 pm", "selector")], 5, 6),
    ("lantern-vinyl", "lantern", None, "Lantern vinyl hour", "45s and cheap beer on the patio", 0, 18, 23, "Free", None,
     ["21+"], ["bar", "house"], None, [("big-aunt", "7:00 pm", "soul 45s")], 7, 4),
    ("moth-house", "moth-house", "org-moth", "Moth House show", "Three bands in a basement", 0, 20, 23.5, "Sliding scale $5 to $15", None,
     ["all-ages", "sliding-scale", "byob"], ["diy", "live"], "Bike rack out front; please keep it quiet on the porch",
     [("soft-ditch", "8:00 pm", "noise pop"), ("orchard-hum", "9:00 pm", "shoegaze"), ("gravel-saints", "10:00 pm", "post-punk")], 18, 9),
    ("wet-paint", "room-9", "org-wet-paint", "Wet Paint", "Queer house all night", 0, 22, 27, "$10 door, $8 advance", "https://example.com/tickets/wet-paint",
     ["21+", "queer-centered", "no-photos"], ["queer", "house", "bar"], "Street parking on the square; rideshare drop at the corner",
     [("juno-ray", "10:00 pm", "warmup, disco"), ("kitten-static", "12:00 am", "house"), ("mister-ozone", "1:30 am", "acid and ghetto house")], 46, 21),
    ("kiln-ballroom", "kiln", None, "Kiln ballroom practice", "Open floor, Jersey club and vogue beats", 1, 21, 25, "$5", None,
     ["18+", "queer-centered", "sober-friendly"], ["queer", "bar"], None, [("sister-tape", "9:00 pm", "vogue and club")], 14, 11),
    ("tin-roof-shoegaze", "tin-roof", "org-tin-roof", "Tin Roof shoegaze night", "Loud guitars, soft lights", 2, 19, 23, "$8 to $12", None,
     ["all-ages", "sliding-scale", "accessible-entrance"], ["diy", "live"], "Lot next to the annex; bus 50 stops out front",
     [("orchard-hum", "8:00 pm", "headline"), ("mothra-twins", "9:15 pm", "synth duo")], 12, 15),
    ("low-ceiling", "low-ceiling", "org-low", "Low Ceiling", "Jungle, footwork, Memphis rap edits", 3, 22, 26, "$5 before 11", None,
     ["21+"], ["rave", "bass", "bar"], None, [("tuff-gong-jr", "10:00 pm", "jungle"), ("dj-pallet", "12:00 am", "footwork and phonk")], 29, 17),
    ("static", "static-annex", "org-static", "Static: six hours", "Warehouse techno, one room", 3, 23, 29, "$20 advance", "https://example.com/tickets/static",
     ["21+", "harm-reduction", "no-photos"], ["rave", "techno"], "Lot behind the building; trolley stop two blocks north",
     [("dalia-k", "11:00 pm", "hypnotic"), ("form-three", "1:00 am", "hardgroove"), ("halle-burn", "3:00 am", "closing")], 61, 34),
    ("velvet-ebm", "velvet-ditch", None, "Black leather Saturday", "EBM, industrial, darkwave", 4, 21, 26, "$7", None,
     ["21+"], ["bar", "techno"], None, [("vex-mercy", "10:00 pm", "EBM and industrial")], 19, 12),
    ("pulp-costume", "pulp", "org-pulp", "Pulp After Dark", "Costume rave, two rooms", 4, 22, 29, "$25 advance, $35 door", "https://example.com/tickets/pulp",
     ["21+", "harm-reduction", "queer-centered"], ["rave", "techno", "queer", "diy"], "Rideshare strongly recommended; no parking on the street",
     [("neon-debt", "10:00 pm", "electro, Room A"), ("halle-burn", "12:00 am", "techno, Room A"), ("dalia-k", "2:00 am", "trance, Room B"), ("sister-tape", "12:30 am", "club, Room B")], 88, 52),
    ("greenhouse", "greenhouse", "org-greenhouse", "Greenhouse Sundays", "Open-air disco until dark", 5, 14, 20, "Free with RSVP", None,
     ["all-ages", "queer-centered", "accessible-entrance"], ["queer", "house", "diy"], "Bring water and a layer for after sunset",
     [("petal-grip", "2:00 pm", "balearic"), ("big-aunt", "4:30 pm", "disco")], 54, 40),
    ("riverline-sunset", "riverline", None, "Riverline sunset session", "Deep house on the bluff", 5, 16, 19.5, "Free", None,
     ["all-ages", "accessible-entrance"], ["house"], "Park at the south lot and walk the bluff path",
     [("dj-bluff", "4:00 pm", "deep house")], 23, 19),
    ("tender-tuesdays", "velvet-ditch", None, "Tender Tuesdays", "Disco edits at the bar", 7, 21, 25, "Free", None,
     ["21+"], ["house", "bar"], None, [("lou-vega", "9:00 pm", "edits all night")], 9, 7),
    ("signal-garage", "signal", None, "Cola Wars record release", "Garage rock in a record store", 8, 19, 22, "$10, includes the 7-inch", "https://example.com/tickets/cola-wars",
     ["all-ages"], ["live", "bar"], None, [("cola-wars", "8:00 pm", "record release"), ("gravel-saints", "7:15 pm", "opening")], 16, 13),
    ("room9-acid", "room-9", "org-wet-paint", "303 Night", "Acid only, all night", 10, 22, 27, "$12", "https://example.com/tickets/303",
     ["21+", "queer-centered"], ["queer", "house", "techno"], None, [("mister-ozone", "10:00 pm", "all night long")], 22, 31),
    ("moth-synth", "moth-house", "org-moth", "Moth House synth night", "Drum machines in a basement", 11, 20, 23, "Sliding scale $5 to $15", None,
     ["all-ages", "sliding-scale", "byob"], ["diy", "live"], None, [("mothra-twins", "9:00 pm", "headline")], 11, 14),
    ("static-rave", "static-annex", "org-static", "Static: ten hours", "The long one", 11, 22, 32, "$30 advance", "https://example.com/tickets/static-ten",
     ["21+", "harm-reduction", "no-photos"], ["rave", "techno"], "Lot behind the building; trolley stop two blocks north",
     [("form-three", "10:00 pm", "opening"), ("vex-mercy", "1:00 am", "industrial"), ("dalia-k", "4:00 am", "closing")], 37, 58),
]

COMMENTS = [
    ("wet-paint", "friend-ari", "Who's going early for Juno? Warmup sets are always the best part."),
    ("wet-paint", "fan-jules", "Same crowd as last month? That room was perfect."),
    ("wet-paint", "org-wet-paint", "Doors at 10. Coat check is free, bring cash for the bar."),
    ("static", "friend-dev", "Six hours of Dalia and Form Three. Clearing my weekend."),
    ("static", "org-static", "Water stations and a chill room upstairs. Harm reduction table by the door."),
    ("moth-house", "friend-sky", "Soft Ditch played their new one last time and the floor shook."),
    ("pulp-costume", "fan-rosa", "Costume theme is anything chrome. Start planning."),
    ("pulp-costume", "org-pulp", "Room B opens at midnight. Costume contest at 1 am."),
    ("greenhouse", "fan-marco", "Best Sunday in the city. Bring a blanket."),
    ("low-ceiling", "friend-nina", "Tuff Gong Jr at 10 sharp, don't be late."),
]

# A crowd of invented attendees, so RSVP counts (and pin sizes on the map) look like a real week.
CROWD = [f"crowd-{n}" for n in ["ash", "bo", "cam", "dee", "eli", "fern", "gus", "hana", "ivy", "jay", "kit", "lu", "mo", "ned", "oli",
         "pia", "quin", "ray", "sol", "tam", "uma", "val", "wren", "xan", "yas", "zed", "alba", "bram", "cleo", "dax", "esme", "fitz",
         "gia", "hal", "isa", "jett", "kaz", "lark", "mika", "nova"]]
INITIALS = "ABCDEFGHJKLMNPRSTVW"

REACTIONS = ["heart", "fire", "smiley", "rainbow", "see-you"]


def main():
    s = []
    s.append("-- Demo content for demo.assembly.rsvp. Generated by scripts/make-demo-seed.py: edit that, not this file.")
    s.append("-- Every venue, artist, crew, person, and comment is invented. Neighborhood names are real Memphis areas.")
    s.append("-- Runs on deploy and every night (worker/demo.ts): clears the demo, then puts it back with fresh dates.")
    s.append("")
    s.append("DELETE FROM events;")
    s.append("DELETE FROM users WHERE id LIKE 'demo-%';")
    s.append("DELETE FROM users WHERE id LIKE 'guest-%' AND created_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day');")
    s.append("DELETE FROM reports;")
    s.append("")
    s.append("INSERT OR IGNORE INTO cities (id, name, slug, timezone, center_lat, center_lng, default_zoom) VALUES ('memphis', 'Memphis', 'memphis', 'America/Chicago', 35.1400, -90.0100, 12.2);")
    rows = []
    for vid, name, typ, addr, hood, lat, lng, bio in VENUES:
        rows.append(f"({q('demo-' + vid)}, 'memphis', {q(name)}, {q(vid)}, {q(typ)}, {q(addr)}, {q(hood)}, {lat}, {lng}, {q(bio)})")
    s.append("INSERT INTO venues (id, city_id, name, slug, type, address, neighborhood, lat, lng, bio) VALUES\n" + ",\n".join(rows) +
             "\nON CONFLICT(id) DO UPDATE SET name = excluded.name, slug = excluded.slug, type = excluded.type, address = excluded.address,"
             " neighborhood = excluded.neighborhood, lat = excluded.lat, lng = excluded.lng, bio = excluded.bio;")
    rows = []
    for aid, name, links, bio in ARTISTS:
        rows.append(f"({q('demo-' + aid)}, {q(name)}, {q(aid)}, {j(links)}, {q(bio)}, 'memphis')")
    s.append("INSERT INTO artists (id, name, slug, links, bio, city_id) VALUES\n" + ",\n".join(rows) +
             "\nON CONFLICT(id) DO UPDATE SET name = excluded.name, slug = excluded.slug, links = excluded.links, bio = excluded.bio;")
    rows = []
    for pid, name, pron, bio, scenes, org, friend in PEOPLE:
        rows.append(f"({q('demo-' + pid)}, {q(name)}, {q(pron)}, {q(bio)}, {j(scenes)}, 1, {1 if org else 0}, {q(pid.replace('-', ''))}, {1 if friend else 0})")
    s.append("INSERT INTO users (id, display_name, pronouns, bio, scenes, show_attendance, is_verified_organizer, username, friends_on) VALUES\n" + ",\n".join(rows) + ";")

    rows = []
    for k, cid in enumerate(CROWD):
        first = cid.split("-")[1].capitalize()
        rows.append(f"({q('demo-' + cid)}, {q(f'{first} {INITIALS[k % len(INITIALS)]}.')}, '[]', 0)")
    s.append("INSERT INTO users (id, display_name, scenes, show_attendance) VALUES\n" + ",\n".join(rows) + ";")

    fans = [p[0] for p in PEOPLE if not p[5]]
    crowd = CROWD
    for i, (eid, vid, host, title, pitch, day, sh, eh, door, ticket, pol, scenes, there, lineup, going, interested) in enumerate(EVENTS):
        ev = "demo-" + eid
        s.append(
            "INSERT INTO events (id, city_id, venue_id, title, pitch, starts_at, ends_at, address, neighborhood, lat, lng, getting_there, door_price, ticket_url, policy_tags, scenes, status, is_sample)\n"
            f"SELECT {q(ev)}, 'memphis', v.id, {q(title)}, {q(pitch)}, {at(day, sh)}, {at(day, eh)}, v.address, v.neighborhood, v.lat, v.lng, {q(there)}, {q(door)}, {q(ticket)}, {j(pol)}, {j(scenes)}, 'live', 0\n"
            f"FROM venues v WHERE v.id = {q('demo-' + vid)};"
        )
        if host:
            s.append(f"INSERT INTO event_hosts (event_id, user_id, role) VALUES ({q(ev)}, {q('demo-' + host)}, 'owner');")
        rows = [f"({q(ev)}, {q('demo-' + a)}, {q(t)}, NULL, {q(n)}, {k})" for k, (a, t, n) in enumerate(lineup)]
        s.append("INSERT INTO lineup_slots (event_id, artist_id, set_start, room, note, position) VALUES " + ", ".join(rows) + ";")
        # Visible RSVPs from invented people, so "who's going" has faces. Counts on the map come from these rows.
        rot = fans[i % len(fans):] + fans[: i % len(fans)]
        g = rot[: min(len(rot), max(2, going // 8))]
        rows = [f"({q(ev)}, {q('demo-' + u)}, 'going', 1)" for u in g]
        rows += [f"({q(ev)}, {q('demo-' + u)}, 'interested', 1)" for u in rot[len(g): len(g) + max(1, interested // 12)]]
        # The crowd fills out the count without showing faces (their RSVPs stay private).
        extra = crowd[(i * 7) % len(crowd):] + crowd[: (i * 7) % len(crowd)]
        rows += [f"({q(ev)}, {q('demo-' + u)}, 'going', 0)" for u in extra[: min(len(crowd), max(0, going // 2 - len(g)))]]
        s.append("INSERT OR IGNORE INTO rsvps (event_id, user_id, status, visible) VALUES " + ", ".join(rows) + ";")
        rows = [f"('event', {q(ev)}, {q('demo-' + u)}, {q(REACTIONS[(i + k) % len(REACTIONS)])})" for k, u in enumerate(rot[:4])]
        s.append("INSERT OR IGNORE INTO reactions (target_type, target_id, user_id, kind) VALUES " + ", ".join(rows) + ";")

    for k, (eid, uid, body) in enumerate(COMMENTS):
        s.append(f"INSERT INTO comments (id, event_id, user_id, body, created_at) VALUES ({q(f'demo-c{k}')}, {q('demo-' + eid)}, {q('demo-' + uid)}, {q(body)}, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-{(len(COMMENTS) - k) * 37} minutes'));")

    # Guests still signed in keep their four friends (the invented people were just recreated).
    friends = ", ".join(q("demo-" + p[0]) for p in PEOPLE if p[6])
    s.append("INSERT OR IGNORE INTO friendships (user_a, user_b, status, requested_by, created_at, accepted_at)\n"
             "SELECT min(g.id, f.id), max(g.id, f.id), 'accepted', f.id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')\n"
             f"FROM users g JOIN users f ON f.id IN ({friends}) WHERE g.id LIKE 'guest-%';")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    sql = "\n".join(s) + "\n"
    OUT.write_text(sql)
    OUT_TS.write_text("// Generated by scripts/make-demo-seed.py from the same lists as db/demo/seed.sql. Don't edit by hand.\n"
                      f"export const DEMO_SEED_SQL = {json.dumps(sql)};\n")
    print(f"wrote {OUT} ({len(EVENTS)} events)")


if __name__ == "__main__":
    main()
