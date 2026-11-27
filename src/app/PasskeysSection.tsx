import { useEffect, useState } from "react";
import { Button } from "../components/ui";
import { api, ApiError, type Passkey } from "../lib/api";
import { addPasskey, PasskeyCancelled, passkeysAvailable } from "../lib/passkeys";

/**
 * Profile → Passkeys: one collapsed row, like Muted and blocked. Open, it lists your passkeys (what keeps each
 * one, when it was added and last used) with Remove, and Add a passkey. Hidden where passkeys can't work.
 */
export function PasskeysSection({ toast }: { toast: (m: string) => void }) {
  const [available, setAvailable] = useState(false);
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<Passkey[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void passkeysAvailable().then(setAvailable);
  }, []);
  useEffect(() => {
    if (!available || list) return;
    api
      .passkeys()
      .then(setList)
      .catch(() => setList([]));
  }, [available, list]);

  if (!available) return null;
  const count = list?.length ?? 0;
  const date = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

  return (
    <section className="muted-list passkeys" aria-label="Passkeys" data-reveal>
      <button className="muted-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span>Passkeys{count ? ` · ${count}` : ""}</span>
        <span className="dim">{open ? "Hide" : count ? "Show" : "Set up"}</span>
      </button>
      {open && (
        <>
          <p className="note">Sign in with Face ID or Touch ID instead of a code. Your passkey syncs to your other devices through iCloud Keychain or your password manager.</p>
          {list && list.length > 0 && (
            <ul className="muted-people">
              {list.map((p) => (
                <li key={p.id}>
                  <span className="muted-name">
                    {p.label}
                    <span className="dim">
                      {" "}
                      · added {date(p.createdAt)}
                      {p.lastUsedAt ? ` · last used ${date(p.lastUsedAt)}` : ""}
                    </span>
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      try {
                        setList(await api.passkeyRemove(p.id));
                        toast("Passkey removed. Also delete it from your password manager if you won't use it.");
                      } catch (err) {
                        toast(err instanceof ApiError ? err.message : "That didn't go through.");
                      }
                    }}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <Button
            size="sm"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                setList(await addPasskey());
                toast("Passkey added. Next time, sign in with Face ID.");
              } catch (err) {
                if (!(err instanceof PasskeyCancelled)) toast(err instanceof ApiError ? err.message : "Adding the passkey didn't finish.");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Waiting…" : count ? "Add another passkey" : "Add a passkey"}
          </Button>
        </>
      )}
    </section>
  );
}
