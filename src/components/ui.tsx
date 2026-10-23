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

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeRef.current();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  return (
    <>
      <div className={`scrim ${modal ? "" : "scrim-soft"}`} onClick={onClose} />
      <div ref={ref} className={`sheet ${center ? "sheet-center" : ""} ${className}`} role="dialog" aria-modal={modal} aria-label={label} tabIndex={-1}>
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
