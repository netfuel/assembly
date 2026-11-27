import { Component, type ReactNode } from "react";
import { apiOrigin, apiUrl } from "../lib/native";

/** Sends a browser error to the Worker log. Paths only, never page content or personal data. */
export function reportError(err: unknown) {
  try {
    const e = err instanceof Error ? err : new Error(String(err));
    const body = JSON.stringify({ message: e.message, stack: e.stack, path: location.pathname });
    // A beacon can't carry JSON across origins, so the app (src/lib/native.ts) always uses fetch.
    if (navigator.sendBeacon && !apiOrigin) navigator.sendBeacon(apiUrl("/api/log"), new Blob([body], { type: "application/json" }));
    else void fetch(apiUrl("/api/log"), { method: "POST", body, headers: { "Content-Type": "application/json" }, keepalive: true });
  } catch {
    // Reporting must never cause its own error.
  }
}

/** If rendering crashes, show a way back instead of a blank screen. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    reportError(error);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="crash" role="alert">
        <p className="crash-title">Something broke.</p>
        <p className="crash-body">We've logged it. Reloading usually fixes it.</p>
        <button className="btn btn-primary btn-lg" onClick={() => location.reload()}>
          Reload
        </button>
        <a href="/">Back to the map</a>
      </div>
    );
  }
}
