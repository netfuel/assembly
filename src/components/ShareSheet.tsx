import { useMemo, useState } from "react";
import qrcode from "qrcode-generator";
import { Button, Label, LinkButton, Sheet } from "./ui";

export interface ShareTarget {
  title: string;
  /** One line that goes before the link in texts and the share sheet. */
  text: string;
  url: string;
}

const isApple = () => /iphone|ipad|ipod|macintosh/i.test(navigator.userAgent);
const isPhone = () => /iphone|ipad|ipod|android/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

/** sms: links differ: iOS and macOS read sms:&body=, Android reads sms:?body=. */
export function smsHref(body: string) {
  return `sms:${isApple() ? "&" : "?"}body=${encodeURIComponent(body)}`;
}

/** Adds ?ref=<channel> so we can count share-to-visit without tracking anyone. */
export const withRef = (url: string, ref: string) => `${url}${url.includes("?") ? "&" : "?"}ref=${ref}`;

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers and some in-app browsers: fall back to a hidden textarea.
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

/** A QR code as an SVG path, so it stays crisp and follows the theme colors. */
export function QrCode({ url, label }: { url: string; label: string }) {
  const { d, n } = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(url);
    qr.make();
    const n = qr.getModuleCount();
    let d = "";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
    return { d, n };
  }, [url]);
  return (
    <svg className="share-qr" viewBox={`-2 -2 ${n + 4} ${n + 4}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect x="-2" y="-2" width={n + 4} height={n + 4} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}

/** One share menu for events (and later artists and venues): copy link, text message, and the system share sheet. */
export function ShareSheet({
  target,
  open,
  onClose,
  toast,
  extra,
}: {
  target: ShareTarget;
  open: boolean;
  onClose: () => void;
  toast: (msg: string) => void;
  extra?: React.ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const canNative = typeof navigator !== "undefined" && !!navigator.share;
  const message = `${target.text}\n${withRef(target.url, "sms")}`;
  return (
    <Sheet open={open} onClose={onClose} label={`Share ${target.title}`} modal center className="share-sheet-panel">
      <div className="small-sheet share-sheet">
        <div className="stack" data-reveal>
          <Label glyph="↗">Share</Label>
          <h1 className="sheet-title">{target.title}</h1>
          <p className="share-url num">{target.url.replace(/^https?:\/\//, "")}</p>
        </div>
        <div className="share-options" data-reveal>
          <Button
            size="lg"
            variant={copied ? "confirmed" : "solid"}
            onClick={async () => {
              if (await copy(withRef(target.url, "link"))) {
                setCopied(true);
                toast("Link copied.");
                setTimeout(() => setCopied(false), 2000);
              } else toast(`Copy this link: ${target.url}`);
            }}
          >
            {copied ? "Copied" : "Copy link"}
          </Button>
          {isPhone() ? (
            <LinkButton size="lg" href={smsHref(message)}>
              Text message
            </LinkButton>
          ) : (
            <Button
              size="lg"
              onClick={async () => {
                if (await copy(message)) toast("Message copied. Paste it anywhere.");
              }}
            >
              Copy message
            </Button>
          )}
          {canNative && (
            <Button
              size="lg"
              onClick={async () => {
                try {
                  await navigator.share({ title: target.title, text: target.text, url: withRef(target.url, "share") });
                  onClose();
                } catch {
                  // Cancelled: keep the menu open.
                }
              }}
            >
              More…
            </Button>
          )}
          {extra}
        </div>
        <div className="share-qr-wrap" data-reveal>
          <QrCode url={withRef(target.url, "qr")} label={`QR code for ${target.title}`} />
          <p className="note">Show this at the door or on a flyer. Scanning it opens the event.</p>
        </div>
      </div>
    </Sheet>
  );
}
