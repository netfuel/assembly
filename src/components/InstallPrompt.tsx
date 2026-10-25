import { useEffect, useState } from "react";
import { Button } from "./ui";
import { installMode, remember, runInstallPrompt } from "../lib/install";

/** A small card that offers Add to Home Screen once, after the first "Going". Dismissible for good. */
export function InstallPrompt() {
  const [mode, setMode] = useState<"prompt" | "ios" | null>(null);

  useEffect(() => {
    const onGoing = () => {
      // Let the RSVP toast land first.
      setTimeout(() => setMode(installMode()), 1800);
    };
    window.addEventListener("assembly:going", onGoing);
    return () => window.removeEventListener("assembly:going", onGoing);
  }, []);

  if (!mode) return null;
  const close = () => {
    remember();
    setMode(null);
  };
  return (
    <aside className="install-card" role="dialog" aria-label="Add Assembly to your home screen">
      <img src="/icons/icon-192.png" alt="" width="40" height="40" />
      <div className="install-text">
        <strong>Keep Assembly on your home screen</strong>
        {mode === "ios" ? (
          <span>
            Tap <ShareGlyph /> Share, then <em>Add to Home Screen</em>. Your nights open in one tap, even offline.
          </span>
        ) : (
          <span>Opens in one tap, works offline, and can remind you before doors.</span>
        )}
      </div>
      <div className="install-actions">
        {mode === "prompt" && (
          <Button
            size="sm"
            variant="solid"
            onClick={async () => {
              await runInstallPrompt();
              setMode(null);
            }}
          >
            Add
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={close}>
          {mode === "ios" ? "Got it" : "Not now"}
        </Button>
      </div>
    </aside>
  );
}

function ShareGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" style={{ verticalAlign: "-2px" }}>
      <path d="M8 1.5v9M5 4.5l3-3 3 3M3.5 7.5v6h9v-6" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}
