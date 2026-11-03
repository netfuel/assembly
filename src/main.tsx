import { StrictMode, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import "./styles/fonts.css";
import "./styles/tokens.css";
import "./styles/base.css";
import { App } from "./app/App";
import { LegalPage } from "./legal/LegalPage";
import { ErrorBoundary, reportError } from "./components/ErrorBoundary";
import { captureInstallPrompt } from "./lib/install";
import { revealToGate, skipSplash } from "./lib/splash";
import { mountFor } from "./gate/gate";
import type { ServerConfig } from "../shared/types";

// Uncaught errors outside React rendering (event handlers, promises) go to the Worker log too.
window.addEventListener("error", (e) => reportError(e.error ?? e.message));
window.addEventListener("unhandledrejection", (e) => reportError(e.reason));

// The launch gate (src/gate) loads only when it's needed, with everything it brings (Pass 3: Three.js).
const Gate = lazy(() => import("./gate/Gate").then((m) => ({ default: m.Gate })));

const root = createRoot(document.getElementById("root")!);

function start(config: ServerConfig | null) {
  const mount = mountFor(config, location.pathname, location.search);
  const legalMatch = location.pathname.match(/^\/(terms|privacy|guidelines)\/?$/);
  const legal = legalMatch ? (legalMatch[1] as "terms" | "privacy" | "guidelines") : null;

  if (mount === "gate") {
    // Dark always, no service worker, no install prompt: nobody installs a PWA that opens to a wall.
    document.documentElement.dataset.theme = "dark";
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", "#0a0a0b");
    root.render(
      <StrictMode>
        <ErrorBoundary>
          <Suspense fallback={null}>
            <Gate />
          </Suspense>
        </ErrorBoundary>
      </StrictMode>,
    );
    // The splash ends on its formation and fades to the gate instead of zooming into the map.
    revealToGate();
    return;
  }

  registerSW({ immediate: true });
  captureInstallPrompt();
  // The splash caps itself at 6 seconds (src/lib/splash.ts); policy pages don't use it.
  if (legal) skipSplash();
  root.render(
    <StrictMode>
      <ErrorBoundary>{legal ? <LegalPage slug={legal!} /> : <App />}</ErrorBoundary>
    </StrictMode>,
  );
}

// One small request decides what mounts. Policy pages don't need it. A failed fetch (offline, say) mounts the
// app: the API gates itself, and someone with a session in an installed PWA shouldn't be walled off by a flaky network.
if (/^\/(terms|privacy|guidelines)\/?$/.test(location.pathname)) start(null);
else {
  fetch("/api/config", { credentials: "same-origin" })
    .then((r) => (r.ok ? (r.json() as Promise<ServerConfig>) : null))
    .catch(() => null)
    .then(start);
}
