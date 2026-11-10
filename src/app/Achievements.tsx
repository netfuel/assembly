import { useEffect, useState } from "react";
import { Disclosure } from "../components/ui";
import { api, ApiError } from "../lib/api";
import type { MyAchievements } from "../../shared/achievements";
import { ACHIEVEMENTS } from "../../shared/achievements";

/**
 * Check-in marks, in the profile sheet as one collapsed row. Earned marks are filled tiles with the date; the rest
 * are outlines with a hint. Nothing here awards anything: the server computes marks from check-ins.
 */
export function Achievements({ tz, toast }: { tz: string; toast: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<MyAchievements | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api.myAchievements().then(setData).catch(() => setFailed(true));
  }, []);

  // Switched off or not set up on this server: no row at all.
  if (failed) return null;
  const earned = data?.marks.length ?? 0;
  const summary = !data ? "" : earned ? `${earned} of ${ACHIEVEMENTS.length} earned` : "Check in to a night to earn your first";

  async function run(p: Promise<MyAchievements>) {
    try {
      setData(await p);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Couldn't save that. Try again.");
    }
  }

  return (
    <Disclosure id="achievements" title="Achievements" summary={summary} open={open} onToggle={() => setOpen((o) => !o)}>
      {data && (
        <>
          <ul className="marks" aria-label="Achievements">
            {data.marks.map((m) => (
              <li key={m.id} className={`mark is-earned ${m.hidden ? "is-hidden" : ""}`}>
                <span className="mark-glyph" aria-hidden="true">
                  {m.glyph}
                </span>
                <span className="mark-name">{m.name}</span>
                <span className="mark-hint num">{new Date(m.earnedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: tz })}</span>
                <button type="button" className="mark-hide" aria-pressed={m.hidden} onClick={() => void run(api.hideAchievement(m.id, !m.hidden))}>
                  {m.hidden ? "Hidden from friends" : "Hide from friends"}
                </button>
              </li>
            ))}
            {data.locked.map((m) => (
              <li key={m.id} className="mark is-locked">
                <span className="mark-glyph" aria-hidden="true">
                  ○
                </span>
                <span className="mark-name">{m.name}</span>
                <span className="mark-hint">{m.hint}</span>
              </li>
            ))}
          </ul>
          <label className="mark-opt">
            <input type="checkbox" checked={data.hideAll} onChange={(e) => void run(api.hideAllAchievements(e.target.checked))} />
            <span>Hide all my marks from friends</span>
          </label>
          <label className="mark-opt">
            <input type="checkbox" checked={data.shareDetail} onChange={(e) => void run(api.shareAchievementDetail(e.target.checked))} />
            <span>Let friends see the venue and time too. They see only the name and date otherwise.</span>
          </label>
        </>
      )}
    </Disclosure>
  );
}
