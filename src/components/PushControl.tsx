import { useState } from "react";
import { Button } from "./ui";
import { disablePush, dismissPrompt, enablePush, promptDismissed, PUSH_COPY, usePushState } from "../lib/push";
import type { ServerConfig } from "../../shared/types";

/** Notifications on/off for this device. Hidden when the server has no push keys. */
export function PushControl({ config, toast }: { config: ServerConfig; toast: (m: string) => void }) {
  const [state, setState] = usePushState(!!config.push);
  const [busy, setBusy] = useState(false);
  if (!config.push || !config.vapidPublicKey || !state) return null;

  async function toggle() {
    setBusy(true);
    try {
      const next = state === "on" ? await disablePush() : await enablePush(config.vapidPublicKey!);
      setState(next);
      if (next === "on") toast("Notifications are on for this device.");
      else if (next === "blocked") toast("Notifications are blocked. Allow them in site settings.");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't change notifications.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="push-control">
      <p className="note">{PUSH_COPY[state]}</p>
      {(state === "on" || state === "off") && (
        <Button size="sm" onClick={toggle} disabled={busy} aria-pressed={state === "on"}>
          {state === "on" ? "Turn off" : "Turn on notifications"}
        </Button>
      )}
    </div>
  );
}

/** One-time nudge after an RSVP. Shows only when notifications are off and it hasn't been dismissed. */
export function PushPrompt({ config, toast }: { config: ServerConfig; toast: (m: string) => void }) {
  const [state, setState] = usePushState(!!config.push);
  const [hidden, setHidden] = useState(promptDismissed());
  const [busy, setBusy] = useState(false);
  if (!config.push || !config.vapidPublicKey || hidden || (state !== "off" && state !== "needs-install")) return null;
  return (
    <div className="push-prompt" role="note">
      <p>{state === "needs-install" ? PUSH_COPY["needs-install"] : "Want a heads-up if this changes, and an hour before doors?"}</p>
      <div className="inline-actions">
        {state === "off" && (
          <Button
            size="sm"
            variant="solid"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const next = await enablePush(config.vapidPublicKey!);
                setState(next);
                if (next === "on") toast("Notifications are on.");
              } catch (err) {
                toast(err instanceof Error ? err.message : "Couldn't turn on notifications.");
              } finally {
                setBusy(false);
              }
            }}
          >
            Turn on notifications
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            dismissPrompt();
            setHidden(true);
          }}
        >
          Not now
        </Button>
      </div>
    </div>
  );
}
