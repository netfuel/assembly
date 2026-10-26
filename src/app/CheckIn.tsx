import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Label } from "../components/ui";
import { QrCode } from "../components/ShareSheet";
import { api, ApiError } from "../lib/api";
import type { EventSummary, MeProfile, Presence } from "../../shared/types";

/** Metres between two points (haversine). Runs on the phone; the coordinates never leave it. */
function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371e3;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
/** Close enough: within 250 m, plus the phone's own uncertainty up to another 250 m (indoors GPS drifts). */
const NEAR_M = 250;

function position(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) return reject(new Error("unsupported"));
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
  });
}

/** A door code from a scanned QR (/e/<id>?checkin=CODE). Read once, then dropped from the address bar. */
function codeFromUrl(): string | null {
  const p = new URLSearchParams(location.search);
  const code = p.get("checkin");
  if (!code) return null;
  p.delete("checkin");
  history.replaceState(history.state, "", location.pathname + (p.size ? `?${p}` : ""));
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
}

/**
 * "I'm here" for an event that's on: by location (checked on the phone, only yes or no is sent) or by the
 * host's door code. Shows how many people are here. Hosts get the door code and its QR to show at the entrance.
 */
export function CheckIn({
  event: e,
  me,
  onNeedSignIn,
  onChange,
  toast,
  trigger = 0,
}: {
  /** Bump to open the check-in choices from outside (the event page's action bar). */
  trigger?: number;
  event: EventSummary;
  me: MeProfile | null;
  onNeedSignIn: () => void;
  onChange: (p: Presence) => void;
  toast: (msg: string) => void;
}) {
  const [p, setP] = useState<Presence | null>(null);
  const [mode, setMode] = useState<null | "choose" | "code">(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<null | "gps" | "code" | "out">(null);
  const [note, setNote] = useState<string | null>(null);
  const [door, setDoor] = useState<string | null>(null);
  const urlCode = useRef<string | null>(codeFromUrl());
  const stampEl = useRef<HTMLSpanElement>(null);

  const update = useCallback(
    (next: Presence) => {
      setP(next);
      onChange(next);
    },
    [onChange],
  );

  useEffect(() => {
    if (trigger > 0) setMode("choose");
  }, [trigger]);

  useEffect(() => {
    api
      .presence(e.id)
      .then(update)
      .catch(() => setP(null));
  }, [e.id, me?.id, update]);

  async function submit(body: Parameters<typeof api.checkIn>[1], kind: "gps" | "code") {
    setBusy(kind);
    setNote(null);
    try {
      const next = await api.checkIn(e.id, body);
      update(next);
      setMode(null);
      setCode("");
      toast("You're checked in. Have a good night.");
      stampEl.current?.animate?.([{ transform: "scale(1.6) rotate(-8deg)", opacity: 0 }, { transform: "scale(1) rotate(-3deg)", opacity: 1 }], {
        duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 320,
        easing: "cubic-bezier(.2,.8,.2,1)",
      });
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "Couldn't check you in. Try again.");
    } finally {
      setBusy(null);
    }
  }

  // A scanned door QR: check in straight away when signed in.
  useEffect(() => {
    if (!p || !urlCode.current) return;
    if (!me) {
      onNeedSignIn();
      return;
    }
    const c = urlCode.current;
    urlCode.current = null;
    if (p.open && !(p.viewer?.checkedIn && !p.viewer.checkedOut)) void submit({ method: "code", code: c }, "code");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p, me]);

  async function byLocation() {
    if (!me) return onNeedSignIn();
    setBusy("gps");
    setNote(null);
    try {
      const pos = await position();
      const d = distanceM({ lat: pos.coords.latitude, lng: pos.coords.longitude }, e);
      const slack = Math.min(pos.coords.accuracy || 0, 250);
      if (d > NEAR_M + slack) {
        setBusy(null);
        setNote("You don't look close to the venue yet. If you're inside, ask the door for the code.");
        setMode("code");
        return;
      }
      await submit({ method: "gps", near: true }, "gps");
    } catch (err) {
      setBusy(null);
      const denied = (err as GeolocationPositionError)?.code === 1;
      setNote(denied ? "Location is off for this site. Use the door code instead." : "Couldn't get your location. Use the door code instead.");
      setMode("code");
    }
  }

  async function checkOut() {
    setBusy("out");
    try {
      update(await api.checkOut(e.id));
      toast("Checked out. Get home safe.");
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Couldn't check you out.");
    } finally {
      setBusy(null);
    }
  }

  async function showDoor(rotate = false) {
    try {
      setDoor((await api.doorCode(e.id, rotate)).code);
      if (rotate) toast("New door code. The old one stops working.");
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Couldn't load the door code.");
    }
  }

  if (!p) return null;
  const here = p.viewer?.checkedIn && !p.viewer.checkedOut;
  const showPanel = p.open || here || p.hereNow > 0;
  if (!showPanel && !p.viewerIsHost) return null;
  const doorUrl = door ? `${location.origin}/e/${encodeURIComponent(e.id)}?checkin=${door}` : "";

  return (
    <section className="checkin" aria-label="Check in" data-reveal>
      <div className="checkin-row">
        <span className="checkin-count num" aria-live="polite">
          <span className="checkin-dot" aria-hidden="true" />
          {p.hereNow} here now
        </span>
        <span className="spacer" />
        {here ? (
          <>
            <span ref={stampEl} className="checkin-stamp">
              You're here ✓
            </span>
            <Button size="sm" variant="ghost" onClick={checkOut} disabled={busy === "out"}>
              Check out
            </Button>
          </>
        ) : p.open ? (
          <Button size="sm" variant="solid" onClick={() => (me ? setMode(mode ? null : "choose") : onNeedSignIn())} aria-expanded={!!mode}>
            Check in
          </Button>
        ) : (
          <span className="note">Check-in opens 30 minutes before the start.</span>
        )}
      </div>

      {mode && !here && (
        <div className="checkin-panel">
          {mode === "choose" && (
            <>
              <p className="note">
                Your phone checks that you're at the venue and sends only yes or no. Your location isn't stored or shared.
              </p>
              <div className="checkin-options">
                <Button size="lg" variant="primary" onClick={byLocation} disabled={!!busy}>
                  {busy === "gps" ? "Checking…" : "Use my location"}
                </Button>
                <Button size="lg" onClick={() => setMode("code")} disabled={!!busy}>
                  Enter the door code
                </Button>
              </div>
            </>
          )}
          {mode === "code" && (
            <form
              className="checkin-code"
              onSubmit={(ev) => {
                ev.preventDefault();
                if (code.trim()) void submit({ method: "code", code }, "code");
              }}
            >
              <label className="field">
                <span className="field-label">Door code</span>
                <input
                  value={code}
                  onChange={(ev) => setCode(ev.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8))}
                  placeholder="ABC123"
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellCheck={false}
                  className="num code-input"
                  autoFocus
                />
              </label>
              <Button type="submit" size="lg" variant="primary" disabled={busy === "code" || code.length < 4}>
                {busy === "code" ? "Checking…" : "Check in"}
              </Button>
            </form>
          )}
          {note && <p className="field-error">{note}</p>}
        </div>
      )}

      {p.viewerIsHost && (
        <div className="checkin-host">
          {door ? (
            <div className="door-code">
              <QrCode url={doorUrl} label={`Check-in QR for ${e.title}`} />
              <div className="stack">
                <Label glyph="▣">Door code</Label>
                <span className="door-code-value num">{door}</span>
                <p className="note">Show this at the entrance. Scanning the QR checks people in. Their location never comes into it.</p>
                <div className="inline-actions">
                  <Button size="sm" onClick={() => showDoor(true)}>
                    New code
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setDoor(null)}>
                    Hide
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <Button size="sm" onClick={() => showDoor(false)}>
              Show door code
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
