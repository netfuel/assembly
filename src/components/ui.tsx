import { useEffect, useRef, type ButtonHTMLAttributes, type ComponentProps, type HTMLAttributes, type ReactNode } from "react";
import "./ui.css";

type Variant = "default" | "primary" | "solid" | "ghost" | "confirmed";

/**
 * Buttons. `primary` is the single magenta accent (one per view: RSVP, Post).
 * `solid` is the off-white button used for sign-in, `default` is the hairline dark button.
 */
export function Button({
  variant = "default",
  size = "md",
  className = "",
  ...props
}: ComponentProps<"button"> & { variant?: Variant; size?: "sm" | "md" | "lg" }) {
  return <button className={`btn btn-${variant} btn-${size} ${className}`} {...props} />;
}

export function LinkButton({
  variant = "default",
  size = "md",
  className = "",
  ...props
}: ComponentProps<"a"> & { variant?: Variant; size?: "sm" | "md" | "lg" }) {
  return <a className={`btn btn-${variant} btn-${size} ${className}`} {...props} />;
}

/** A toggleable filter tag. `marker` draws a small scene square in front of the label. */
export function Chip({
  pressed,
  marker,
  children,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { pressed: boolean; marker?: string }) {
  return (
    <button type="button" className={`chip ${className}`} aria-pressed={pressed} {...props}>
      {marker && <span className="marker" style={{ background: marker }} aria-hidden="true" />}
      {children}
    </button>
  );
}

/** Small bordered label, like save.design's "▷ Preview" tags. */
export function Tag({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "accent" | "strong" }) {
  return <span className={`tag tag-${tone}`}>{children}</span>;
}

/** Segmented toggle: one option active at a time. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={value === o.id} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A hairline frame with diamond nodes at its four corners. `featured` switches it to the accent. */
export function Frame({
  featured = false,
  className = "",
  children,
  as: Tag = "div",
  ...props
}: HTMLAttributes<HTMLElement> & { featured?: boolean; as?: "div" | "section" | "article" }) {
  return (
    <Tag className={`frame ${featured ? "frame-featured" : ""} ${className}`} {...props}>
      <i className="node node-tl" aria-hidden="true" />
      <i className="node node-tr" aria-hidden="true" />
      <i className="node node-bl" aria-hidden="true" />
      <i className="node node-br" aria-hidden="true" />
      {children}
    </Tag>
  );
}

/** Section label: a small glyph plus an uppercase mono label. */
export function Label({ glyph, children }: { glyph?: string; children: ReactNode }) {
  return (
    <h2 className="label">
      {glyph && (
        <span className="label-glyph" aria-hidden="true">
          {glyph}
        </span>
      )}
      {children}
    </h2>
  );
}

const openSheets: object[] = [];

/**
 * Phones: pull a sheet down to close it, like a native bottom sheet. Only starts when the sheet's
 * content is scrolled to the top, so normal scrolling is untouched. Past 110 px (or a quick flick) it closes.
 */
function useSwipeToClose(ref: React.RefObject<HTMLDivElement | null>, close: () => void) {
  const state = useRef<{ y: number; t: number; dy: number; active: boolean } | null>(null);
  const isPhone = () => window.matchMedia("(max-width: 899px)").matches;
  const body = () => ref.current?.querySelector<HTMLElement>(".sheet-body");
  const set = (dy: number, animate: boolean) => {
    const el = ref.current;
    if (!el) return;
    el.style.transition = animate ? "transform 180ms ease-out" : "none";
    el.style.transform = dy ? `translateY(${dy}px)` : "";
  };
  return {
    start(e: React.TouchEvent) {
      if (!isPhone() || (body()?.scrollTop ?? 0) > 0) return;
      // Don't hijack sliders, maps, or text fields inside the sheet.
      if ((e.target as HTMLElement).closest("input, textarea, select, .pin-picker, .maplibregl-map")) return;
      state.current = { y: e.touches[0].clientY, t: Date.now(), dy: 0, active: false };
    },
    move(e: React.TouchEvent) {
      const s = state.current;
      if (!s) return;
      const dy = e.touches[0].clientY - s.y;
      if (!s.active) {
        if (dy < 6) {
          if (dy < -6) state.current = null; // scrolling up: let the content scroll
          return;
        }
        s.active = true;
      }
      s.dy = Math.max(0, dy);
      set(s.dy, false);
    },
    end() {
      const s = state.current;
      state.current = null;
      if (!s?.active) return;
      const fast = s.dy / Math.max(1, Date.now() - s.t) > 0.6;
      if (s.dy > 110 || (fast && s.dy > 40)) {
        set(window.innerHeight, true);
        setTimeout(close, 170);
      } else set(0, true);
    },
  };
}

/**
 * A panel that slides up from the bottom on phones and docks to the right on wide screens.
 * `modal` dims the map behind it; non-modal sheets leave the map usable.
 */
export function Sheet({
  open,
  onClose,
  label,
  modal = false,
  center = false,
  className = "",
  children,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  modal?: boolean;
  center?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Held in a ref so a new onClose each render doesn't re-run the focus effect and steal focus from inputs.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const drag = useSwipeToClose(ref, () => closeRef.current());

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    // Only the most recently opened sheet answers Escape, so a preview over an event closes alone.
    const token = {};
    openSheets.push(token);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && openSheets[openSheets.length - 1] === token && closeRef.current();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      openSheets.splice(openSheets.indexOf(token), 1);
      prev?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  return (
    <>
      <div className={`scrim ${modal ? "" : "scrim-soft"}`} onClick={onClose} />
      <div
        ref={ref}
        className={`sheet ${center ? "sheet-center" : ""} ${className}`}
        role="dialog"
        aria-modal={modal}
        aria-label={label}
        tabIndex={-1}
        onTouchStart={drag.start}
        onTouchMove={drag.move}
        onTouchEnd={drag.end}
        onTouchCancel={drag.end}
      >
        <button className="sheet-close" onClick={onClose} aria-label="Close">
          <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
            <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
          </svg>
        </button>
        <div className="sheet-body">{children}</div>
      </div>
    </>
  );
}

export function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="toast" role="status">
      {message}
    </div>
  );
}

/** A placeholder block that shimmers while content loads. Hidden from screen readers; pair with a status label. */
export function Skeleton({ w = "100%", h = 12, className = "" }: { w?: number | string; h?: number | string; className?: string }) {
  return <span className={`skel ${className}`} style={{ width: w, height: h }} aria-hidden="true" />;
}
