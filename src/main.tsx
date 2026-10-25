import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import "./styles/fonts.css";
import "./styles/tokens.css";
import "./styles/base.css";
import { App } from "./app/App";
import { LegalPage } from "./legal/LegalPage";

registerSW({ immediate: true });

// Policy pages render on their own, without the map.
const legalMatch = location.pathname.match(/^\/(terms|privacy|guidelines)\/?$/);
const legal = legalMatch ? (legalMatch[1] as "terms" | "privacy" | "guidelines") : null;

createRoot(document.getElementById("root")!).render(
  <StrictMode>{legal ? <LegalPage slug={legal} /> : <App />}</StrictMode>,
);
