import { Button, Label, LinkButton, Sheet } from "./ui";
import { SCENES, type SceneId } from "../../shared/types";

/** Follow a city (or one scene) in a calendar app or a feed reader. No account needed. */
export function SubscribeSheet({
  open,
  onClose,
  citySlug,
  cityName,
  scene,
  toast,
}: {
  open: boolean;
  onClose: () => void;
  citySlug: string;
  cityName: string;
  scene: SceneId | null;
  toast: (msg: string) => void;
}) {
  const base = `${location.origin}/feeds/${scene ? `${citySlug}/${scene}` : citySlug}`;
  const label = scene ? `${SCENES.find((s) => s.id === scene)?.label} in ${cityName}` : cityName;
  const webcal = `${base}.ics`.replace(/^https?:/, "webcal:");
  const copy = async (url: string, what: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast(`${what} copied.`);
    } catch {
      toast(url);
    }
  };
  return (
    <Sheet open={open} onClose={onClose} label="Subscribe" modal center>
      <div className="small-sheet subscribe-sheet">
        <div className="stack" data-reveal>
          <Label glyph="◎">Subscribe</Label>
          <h1 className="sheet-title">{label}, in your calendar.</h1>
          <p className="note serif-text">Every upcoming night shows up and stays current. Cancellations update on their own. No account needed.</p>
        </div>
        <div className="share-options" data-reveal>
          <LinkButton size="lg" variant="solid" href={webcal}>
            Add to Apple or Outlook Calendar
          </LinkButton>
          <LinkButton size="lg" href={`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`} target="_blank" rel="noopener noreferrer">
            Add to Google Calendar
          </LinkButton>
          <Button size="lg" onClick={() => copy(`${base}.xml`, "Feed link")}>
            Copy RSS feed link
          </Button>
        </div>
        <p className="note" data-reveal>
          {scene ? "Showing one scene because that filter is on. Clear it to follow the whole city." : "Turn on a scene filter first to follow just that scene."}
        </p>
      </div>
    </Sheet>
  );
}
