import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import "./ui.css";

type Variant = "default" | "primary" | "uv" | "ghost" | "confirmed";

export function Button({
  variant = "default",
  size = "md",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "md" | "lg" }) {
  return <button className={`btn btn-${variant} btn-${size} ${className}`} {...props} />;
}

export function LinkButton({
  variant = "default",
  size = "md",
  className = "",
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: Variant; size?: "md" | "lg" }) {
  return <a className={`btn btn-${variant} btn-${size} ${className}`} {...props} />;
}

export function Chip({
  pressed,
  dot,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { pressed: boolean; dot?: string }) {
  return (
    <button type="button" className="chip" aria-pressed={pressed} {...props}>
      {dot && <span className="chip-dot" style={{ background: dot }} aria-hidden="true" />}
      {children}
    </button>
  );
}

/**
 * A panel that slides up from the bottom on phones and docks to the right on wide screens.
 * `modal` dims the map behind it and traps attention; non-modal sheets let the map stay usable.
 */
export function Sheet({
  open,
  onClose,
  label,
  modal = false,
  center = false,
  children,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  modal?: boolean;
  center?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <>
      <div className={`scrim ${modal ? "" : "scrim-soft"}`} onClick={onClose} />
      <div
        ref={ref}
        className={`sheet ${center ? "sheet-center" : ""}`}
        role="dialog"
        aria-modal={modal}
        aria-label={label}
        tabIndex={-1}
      >
        <button className="sheet-close" onClick={onClose} aria-label="Close">
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
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
