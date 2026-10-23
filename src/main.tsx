import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import "@fontsource/rubik-mono-one/400.css";
import "@fontsource/space-mono/400.css";
import "@fontsource-variable/figtree/wght.css";
import "./styles/tokens.css";
import "./styles/base.css";
import { App } from "./app/App";

registerSW({ immediate: true });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
