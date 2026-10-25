import type { LocationStatus } from "../lib/location";

/**
 * Map control for the viewer's own location. States, each with its own shape and label, not color alone:
 * off (outline arrow) → locating (gradient arc spinner) → following (filled arrow) → panned away (outline arrow in
 * the accent: tap to recenter). Tapping while following turns location off and clears the dot.
 */
export function LocateButton({
  status,
  following,
  onTap,
}: {
  status: LocationStatus;
  following: boolean;
  onTap: () => void;
}) {
  const state = status === "locating" ? "locating" : status === "on" ? (following ? "following" : "recenter") : "off";
  const label = {
    off: "Show my location",
    locating: "Finding your location",
    following: "Following your location. Tap to turn location off",
    recenter: "Recenter on my location",
  }[state];
  return (
    <button type="button" className={`locate is-${state}`} onClick={onTap} aria-label={label} title={label} aria-pressed={state === "following"}>
      {state === "locating" ? (
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" className="locate-spin">
          <defs>
            <linearGradient id="locate-arc" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="var(--grad-pink)" />
              <stop offset="0.5" stopColor="var(--grad-purple)" />
              <stop offset="1" stopColor="var(--grad-green)" />
            </linearGradient>
          </defs>
          <circle cx="12" cy="12" r="8" fill="none" stroke="url(#locate-arc)" strokeWidth="1.75" strokeLinecap="round" strokeDasharray="34 50" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            d="M20 4 4 11l7 2 2 7z"
            fill={state === "following" ? "currentColor" : "none"}
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  );
}
