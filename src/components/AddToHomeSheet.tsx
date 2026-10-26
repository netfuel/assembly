import { Button, Label } from "./ui";
import { remember, runInstallPrompt } from "../lib/install";

const STEPS = [
  { glyph: <ShareGlyph />, text: "Tap Share in Safari's toolbar." },
  { glyph: "+", text: "Scroll down and tap Add to Home Screen." },
  { glyph: "✓", text: "Tap Add. Assembly is now on your home screen." },
];

/**
 * Shown once, right after someone's first sign-in on a device. On iPhone there is no install prompt, so this walks
 * through the three taps; on Android and desktop Chrome it runs the browser's own prompt. The sheet around it
 * (Sheet) owns focus, Escape, and the close button.
 */
export function AddToHomeBody({ mode, onDone }: { mode: "prompt" | "ios"; onDone: () => void }) {
  const done = () => {
    remember();
    onDone();
  };
  return (
    <div className="home-add">
      <div className="stack" data-reveal>
        <Label glyph="＋">Add to home screen</Label>
        <h1 className="sheet-title">Keep Assembly one tap away.</h1>
        <p className="note">Opens like an app, works offline, and can remind you before doors.</p>
      </div>

      {mode === "ios" ? (
        <>
          <ol className="home-steps" data-reveal>
            {STEPS.map((s, i) => (
              <li key={i}>
                <span className="home-step-glyph" aria-hidden="true">
                  {s.glyph}
                </span>
                <span>{s.text}</span>
              </li>
            ))}
          </ol>
          <p className="note" data-reveal>
            Not seeing Add to Home Screen? Open this page in Safari first; other apps' browsers can't add it.
          </p>
          <div className="home-actions" data-reveal>
            <Button variant="primary" size="lg" onClick={done}>
              Got it
            </Button>
          </div>
        </>
      ) : (
        <div className="home-actions" data-reveal>
          <Button
            variant="primary"
            size="lg"
            onClick={async () => {
              await runInstallPrompt();
              onDone();
            }}
          >
            Add to home screen
          </Button>
          <Button variant="ghost" onClick={done}>
            Not now
          </Button>
        </div>
      )}
    </div>
  );
}

function ShareGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true">
      <path d="M8 1.5v9M5 4.5l3-3 3 3M3.5 7.5v6h9v-6" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}
