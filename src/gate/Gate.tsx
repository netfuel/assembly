import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, ApiError, signInUrl, devSignInUrl } from "../lib/api";
import {
  playLogo,
  reducedMotion,
  useGSAP,
  type LogoParts,
} from "../lib/motion";
import { useOnline } from "../lib/offline";
import { A_PATH } from "../../shared/brandGeometry";
import type { AuthProviders } from "../../shared/types";
import {
  gateReturnTo,
  isPreview,
  looksLikeEmail,
  rememberInterest,
  rememberedInterest,
} from "./gate";
import type { SceneHandle } from "./scene";
import gsap from "gsap";
import "./gate.css";

const POLL_MS = 60_000;

/**
 * The launch gate (docs: "Assembly launch gate plan"). Shown instead of the app while GATE is on and the
 * visitor has no session. Two ways through: Google sign-in, or an email for the interest list. Pass 2 is the
 * screen on a flat ground with the A mark above the wordmark; the Three.js scene (pass 3) mounts into #gate-scene.
 */
export function Gate() {
  const [providers, setProviders] = useState<AuthProviders | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(() => rememberedInterest() !== null);
  const [error, setError] = useState<string | null>(null);
  const [devName, setDevName] = useState("Test Organizer");
  const online = useOnline();
  const root = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const sceneBox = useRef<HTMLDivElement>(null);
  const scene = useRef<SceneHandle | null>(null);
  const mark = useRef<SVGSVGElement>(null);

  // The mark's moves (from the header logo): the stamp as the splash clears, and on every formation beat.
  const playMark = (move: "stamp" | "misregister" | "ring") => {
    const m = mark.current;
    if (!m || reducedMotion()) return;
    const parts: LogoParts = {
      mark: m.querySelector(".logo-mark")!,
      a: m.querySelector(".logo-a")!,
      echo: m.querySelector(".logo-echo")!,
      dot: m.querySelector(".logo-dot")!,
      ring: m.querySelector(".logo-ring")!,
    };
    playLogo(parts, move);
  };
  const [sceneOn, setSceneOn] = useState(false);

  // The Three.js scene (its own chunk) mounts once the splash has cleared, when WebGL is there. Without it,
  // the ground stays flat.
  useEffect(() => {
    let dead = false;
    const start = async () => {
      const m = await import("./scene");
      if (dead || !sceneBox.current || !m.supportsWebGL()) return;
      try {
        scene.current = m.mountScene(sceneBox.current, {
          reducedMotion: reducedMotion(),
        });
        setSceneOn(true);
      } catch {
        // A WebGL context that fails to start (too many contexts, a driver quirk): keep the flat version.
      }
    };
    if (splashStillUp())
      window.addEventListener("assembly:splash-done", start, { once: true });
    else start();
    return () => {
      dead = true;
      window.removeEventListener("assembly:splash-done", start);
      scene.current?.destroy();
      scene.current = null;
    };
  }, []);

  useEffect(() => {
    api
      .providers()
      .then(setProviders)
      .catch(() => setProviders({ google: false, apple: false }));
  }, []);

  // Launch day: when the gate switches off, hand over to the app without anyone having to reload.
  useEffect(() => {
    if (isPreview(location.search)) return; // a review visit stays on the gate
    const t = window.setInterval(() => {
      api
        .config()
        .then((c) => {
          if (c.gate && c.gate !== "on") location.reload();
        })
        .catch(() => undefined);
    }, POLL_MS);
    return () => window.clearInterval(t);
  }, []);

  // Children rise in as the splash clears (or at once when there was no splash).
  useGSAP(
    () => {
      const items = root.current?.querySelectorAll("[data-rise]") ?? [];
      if (reducedMotion()) return void gsap.set(items, { opacity: 1 });
      gsap.set(items, { opacity: 0, y: 10 });
      const go = () => {
        gsap.to(items, {
          opacity: 1,
          y: 0,
          duration: 0.6,
          stagger: 0.07,
          ease: "power3.out",
          delay: 0.1,
        });
        window.setTimeout(() => playMark("stamp"), 500);
      };
      if (splashStillUp())
        window.addEventListener("assembly:splash-done", go, { once: true });
      else go();
    },
    { scope: root },
  );

  const valid = looksLikeEmail(email);
  const returnTo = gateReturnTo(location.search);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.interest(email.trim(), "gate");
      rememberInterest(email.trim().toLowerCase());
      setDone(true);
      // The A asserts itself as the confirmation, and a pin pulse leaves the form.
      const r = field.current?.getBoundingClientRect();
      if (r) scene.current?.ring(r.left + r.width / 2, r.top + r.height / 2);
      if (scene.current) scene.current.beat(() => playMark("stamp"));
      else playMark("stamp");
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "That address didn't go through. Try again.",
      );
      shake(field.current);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="gate" ref={root}>
      <div
        id="gate-scene"
        className={`gate-scene ${sceneOn ? "has-scene" : ""}`}
        aria-hidden="true"
        ref={sceneBox}
      />

      <div className="gate-stack">
        <svg
          ref={mark}
          className="gate-mark"
          viewBox="0 0 512 512"
          width="72"
          height="72"
          aria-hidden="true"
          focusable="false"
          data-rise
        >
          <g className="logo-mark">
            <path
              className="logo-echo"
              d={A_PATH}
              transform="translate(14 12)"
            />
            <path className="logo-a" d={A_PATH} />
            <circle className="logo-ring" cx="404" cy="118" r="30" />
            <circle className="logo-dot" cx="404" cy="118" r="30" />
          </g>
        </svg>
        <main className="gate-panel">
          <h1 className="gate-wordmark" data-rise>
            Assembly
          </h1>
          <p className="gate-caption" data-rise>
            Memphis
          </p>
          <p className="gate-lead" data-rise>
            Underground music on one live map. Opening 2027. Memphis first.
          </p>

          {done ? (
            <p className="gate-done" role="status" aria-live="polite" data-rise>
              You're on the list. We'll write once, when it opens.
            </p>
          ) : (
            <form className="gate-form" onSubmit={submit} noValidate data-rise>
              <label htmlFor="gate-email" className="visually-hidden">
                Email address
              </label>
              <div className={`gate-field ${busy ? "is-busy" : ""}`}>
                <input
                  id="gate-email"
                  ref={field}
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  placeholder="you@…"
                  value={email}
                  disabled={busy || !online}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (error) setError(null);
                    scene.current?.typed();
                  }}
                  onFocus={() => scene.current?.setFocus(true)}
                  onBlur={() => scene.current?.setFocus(false)}
                  aria-invalid={!!error}
                  aria-describedby={error ? "gate-error" : undefined}
                />
                <button
                  type="submit"
                  className="gate-submit"
                  disabled={!valid || busy || !online}
                >
                  Tell me
                </button>
              </div>
              {error && (
                <p id="gate-error" className="gate-error" role="alert">
                  {error}
                </p>
              )}
              {!online && <p className="gate-error">You're offline.</p>}
            </form>
          )}

          {online && providers?.google && (
            <div className="gate-or" data-rise>
              <span className="gate-rule" aria-hidden="true" />
              <span>or</span>
              <span className="gate-rule" aria-hidden="true" />
            </div>
          )}
          {online && providers?.google && (
            <a
              className="gate-google"
              href={signInUrl("google", returnTo)}
              data-rise
              onClick={(e) => {
                // Play the formation beat, then go. Modifier clicks (new tab) are left alone.
                if (
                  !scene.current ||
                  e.metaKey ||
                  e.ctrlKey ||
                  e.shiftKey ||
                  e.altKey ||
                  reducedMotion()
                )
                  return;
                e.preventDefault();
                const href = e.currentTarget.href;
                Promise.race([
                  scene.current.beat(() => playMark("misregister")),
                  new Promise((r) => setTimeout(r, 1600)),
                ]).then(() => (location.href = href));
              }}
            >
              <GoogleMark />
              Continue with Google
            </a>
          )}
          {online && providers?.dev && (
            <form
              className="gate-dev"
              data-rise
              onSubmit={(e) => {
                e.preventDefault();
                location.href = devSignInUrl(devName, returnTo);
              }}
            >
              <input
                aria-label="Test sign-in name"
                value={devName}
                onChange={(e) => setDevName(e.target.value)}
              />
              <button type="submit">Test sign-in</button>
            </form>
          )}

          <footer className="gate-footer" data-rise>
            <a href="/terms">Terms</a>
            <span aria-hidden="true">·</span>
            <a href="/privacy">Privacy</a>
            <span aria-hidden="true">·</span>
            <a href="/guidelines">Guidelines</a>
            <span aria-hidden="true">·</span>
            <a href="mailto:hello@assembly.rsvp">hello@assembly.rsvp</a>
          </footer>
        </main>
      </div>
    </div>
  );
}

/** The splash is on screen and hasn't started its hand-off yet (its "is-gate" class means the event already fired). */
function splashStillUp() {
  const el = document.getElementById("splash");
  return !!el && !el.classList.contains("is-gate");
}

function GoogleMark() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 48 48"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="#EA4335"
        d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.3l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.7c-.5 2.9-2.2 5.4-4.7 7.1l7.6 5.9c4.4-4.1 6.9-10.1 6.9-17z"
      />
      <path
        fill="#FBBC05"
        d="M10.5 28.6A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.1.8-4.6l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.7l7.9-6.1z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.3 0-11.6-4.1-13.5-9.9l-7.9 6.1C6.5 42.6 14.6 48 24 48z"
      />
    </svg>
  );
}

function shake(el: HTMLElement | null) {
  if (!el || reducedMotion()) return;
  gsap.fromTo(
    el,
    { x: -2 },
    {
      x: 2,
      duration: 0.06,
      repeat: 5,
      yoyo: true,
      ease: "none",
      clearProps: "x",
    },
  );
}
