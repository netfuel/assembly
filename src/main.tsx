import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import "./styles/fonts.css";
import "./styles/tokens.css";
import "./styles/base.css";
import { App } from "./app/App";
import { LegalPage } from "./legal/LegalPage";
import { ErrorBoundary, reportError } from "./components/ErrorBoundary";
import { captureInstallPrompt } from "./lib/install";
import { hideSplash } from "./lib/splash";

registerSW({ immediate: true });
captureInstallPrompt();

// Uncaught errors outside React rendering (event handlers, promises) go to the Worker log too.
window.addEventListener("error", (e) => reportError(e.error ?? e.message));
window.addEventListener("unhandledrejection", (e) => reportError(e.reason));

// Policy pages render on their own, without the map.
const legalMatch = location.pathname.match(/^\/(terms|privacy|guidelines)\/?$/);
const legal = legalMatch ? (legalMatch[1] as "terms" | "privacy" | "guidelines") : null;

// Never hold anyone on the splash: the app has its own loading states after this.
setTimeout(hideSplash, 4000);
if (legal) hideSplash();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>{legal ? <LegalPage slug={legal} /> : <App />}</ErrorBoundary>
  </StrictMode>,
);
