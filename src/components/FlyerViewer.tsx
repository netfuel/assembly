import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "./ui";

/**
 * Full-screen flyer. Pinch or double-tap to zoom, drag to look around, share the image with the event link,
 * or save it. Escape, the close button, or a tap on the backdrop closes it.
 */
export function FlyerViewer({
  src,
  title,
  url,
  credit,
  onClose,
  toast,
}: {
  src: string;
  title: string;
  url: string;
  /** Who posted it, kept with the art when it's shared. */
  credit: string | null;
  onClose: () => void;
  toast: (msg: string) => void;
}) {
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ dist: number; scale: number; x: number; y: number; cx: number; cy: number } | null>(null);
  const lastTap = useRef(0);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const caption = `${title}${credit ? `, posted by ${credit}` : ""}: ${url}`;

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    closeBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    // Capture so the event sheet underneath doesn't also close.
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      prev?.focus?.();
    };
  }, [onClose]);

  const clamp = (v: { scale: number; x: number; y: number }) => {
    const scale = Math.min(5, Math.max(1, v.scale));
    if (scale === 1) return { scale, x: 0, y: 0 };
    const lim = (n: number, size: number) => Math.max(-size * (scale - 1) * 0.5, Math.min(size * (scale - 1) * 0.5, n));
    return { scale, x: lim(v.x, window.innerWidth), y: lim(v.y, window.innerHeight) };
  };

  function down(e: React.PointerEvent) {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    if (pts.length === 1) {
      const now = Date.now();
      if (now - lastTap.current < 280) {
        setView((v) => (v.scale > 1 ? { scale: 1, x: 0, y: 0 } : clamp({ scale: 2.5, x: (window.innerWidth / 2 - e.clientX) * 1.5, y: (window.innerHeight / 2 - e.clientY) * 1.5 })));
        lastTap.current = 0;
        return;
      }
      lastTap.current = now;
    }
    const [a, b] = pts;
    gesture.current = {
      dist: b ? Math.hypot(a.x - b.x, a.y - b.y) : 0,
      scale: view.scale,
      x: view.x,
      y: view.y,
      cx: b ? (a.x + b.x) / 2 : a.x,
      cy: b ? (a.y + b.y) / 2 : a.y,
    };
  }
  function move(e: React.PointerEvent) {
    if (!pointers.current.has(e.pointerId) || !gesture.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    const g = gesture.current;
    if (pts.length >= 2 && g.dist) {
      const [a, b] = pts;
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      setView(clamp({ scale: (g.scale * Math.hypot(a.x - b.x, a.y - b.y)) / g.dist, x: g.x + cx - g.cx, y: g.y + cy - g.cy }));
    } else if (pts.length === 1 && view.scale > 1) {
      setView(clamp({ scale: view.scale, x: g.x + pts[0].x - g.cx, y: g.y + pts[0].y - g.cy }));
    }
  }
  function up(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId);
    const pts = [...pointers.current.values()];
    // Re-anchor when one finger lifts during a pinch, so the image doesn't jump.
    gesture.current = pts.length ? { dist: 0, scale: view.scale, x: view.x, y: view.y, cx: pts[0].x, cy: pts[0].y } : null;
  }

  async function blob() {
    const res = await fetch(src);
    if (!res.ok) throw new Error(String(res.status));
    return res.blob();
  }
  const fileName = () => `${title.replace(/[^\w-]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "flyer"}-assembly`;

  async function share() {
    try {
      const b = await blob();
      const ext = b.type.split("/")[1] ?? "jpg";
      const file = new File([b], `${fileName()}.${ext}`, { type: b.type });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title, text: caption });
        return;
      }
      if (navigator.share) {
        await navigator.share({ title, text: caption, url });
        return;
      }
      await navigator.clipboard.writeText(caption);
      toast("Link copied. Save the image to post the art.");
    } catch (err) {
      if ((err as DOMException)?.name !== "AbortError") toast("Couldn't share the flyer. Try saving it instead.");
    }
  }
  async function save() {
    try {
      const b = await blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(b);
      a.download = `${fileName()}.${b.type.split("/")[1] ?? "jpg"}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch {
      toast("Couldn't save the flyer.");
    }
  }

  return createPortal(
    <div className="flyer-viewer" role="dialog" aria-modal="true" aria-label={`Flyer for ${title}`}>
      <div
        className="flyer-viewer-stage"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onClick={(e) => {
          if (e.target === e.currentTarget && view.scale === 1) onClose();
        }}
        onWheel={(e) => setView((v) => clamp({ ...v, scale: v.scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15) }))}
      >
        <img
          src={src}
          alt={`Flyer for ${title}`}
          draggable={false}
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
        />
      </div>
      <div className="flyer-viewer-bar">
        <span className="flyer-viewer-credit">{credit ? `Posted by ${credit}` : title}</span>
        <span className="spacer" />
        <Button size="sm" onClick={save}>
          Save
        </Button>
        <Button size="sm" variant="solid" onClick={share}>
          Share flyer
        </Button>
        <Button ref={closeBtn} size="sm" onClick={onClose} aria-label="Close flyer">
          Close
        </Button>
      </div>
    </div>,
    document.body,
  );
}
