import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../components/ui";
import { api, ApiError } from "../lib/api";
import type { EventSummary, MeProfile, Presence } from "../../shared/types";
import { reducedMotion } from "../lib/motion";

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

/**
 * "I'm here" for an event that's on, by location: the phone checks it's near the venue and sends only yes or no.
 * Hosts are always let in. Shows how many people are here.
 */
export function CheckIn({
  event: e,
  me,
  onNeedSignIn,
  onChange,
  toast,
  trigger = 0,
  onTriggered,
}: {
  /** Set above 0 to check in from outside (the event page's action bar); onTriggered resets it. */
  trigger?: number;
  onTriggered?: () => void;
  event: EventSummary;
  me: MeProfile | null;
  onNeedSignIn: () => void;
  onChange: (p: Presence) => void;
  toast: (msg: string) => void;
}) {
  const [p, setP] = useState<Presence | null>(null);
  const [busy, setBusy] = useState<null | "gps" | "out">(null);
  const [note, setNote] = useState<string | null>(null);
  const stampEl = useRef<HTMLSpanElement>(null);

  const update = useCallback(
    (next: Presence) => {
      setP(next);
      onChange(next);
    },
    [onChange],
  );

  // The event page's action bar asks to check in: once presence has loaded, go straight to the location check.
  useEffect(() => {
    if (!trigger || !p) return;
    onTriggered?.();
    void byLocation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger, p]);

  useEffect(() => {
    api
      .presence(e.id)
      .then(update)
      .catch(() => setP(null));
  }, [e.id, me?.id, update]);

  async function submit(body: Parameters<typeof api.checkIn>[1]) {
    setBusy("gps");
    setNote(null);
    try {
      const next = await api.checkIn(e.id, body);
      update(next);
      toast("You're checked in. Have a good night.");
      stampEl.current?.animate?.([{ transform: "scale(1.6) rotate(-8deg)", opacity: 0 }, { transform: "scale(1) rotate(-3deg)", opacity: 1 }], {
        duration: reducedMotion() ? 0 : 320,
        easing: "cubic-bezier(.2,.8,.2,1)",
      });
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "Couldn't check you in. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function byLocation() {
    if (!me) return onNeedSignIn();
    // Hosts don't need to prove they're there.
    if (p?.viewerIsHost) return submit({ method: "host" });
    setBusy("gps");
    setNote(null);
    try {
      const pos = await position();
      const d = distanceM({ lat: pos.coords.latitude, lng: pos.coords.longitude }, e);
      const slack = Math.min(pos.coords.accuracy || 0, 250);
      if (d > NEAR_M + slack) {
        setBusy(null);
        setNote("You don't look close to the venue yet. Indoors, signal can drift: try again near the entrance.");
        return;
      }
      await submit({ method: "gps", near: true });
    } catch (err) {
      setBusy(null);
      const denied = (err as GeolocationPositionError)?.code === 1;
      setNote(
        denied
          ? "Location is off for this site. Turn it on in your browser's site settings to check in."
          : "Couldn't get your location. Try again near the entrance, where signal is usually better.",
      );
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

  if (!p) return null;
  const here = p.viewer?.checkedIn && !p.viewer.checkedOut;
  const showPanel = p.open || here || p.hereNow > 0;
  if (!showPanel && !p.viewerIsHost) return null;

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
          <Button size="sm" variant="solid" onClick={byLocation} disabled={busy === "gps"}>
            {busy === "gps" ? "Checking…" : "Check in"}
          </Button>
        ) : (
          <span className="note">Check-in opens 30 minutes before the start.</span>
        )}
      </div>

      {p.open && !here && (
        <p className="note checkin-privacy">
          {note ? <span className="field-error">{note}</span> : "Your phone checks that you're at the venue and sends only yes or no. Your location isn't stored or shared."}
        </p>
      )}
    </section>
  );
}
