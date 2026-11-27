import type { CapacitorConfig } from "@capacitor/cli";

// The iOS app (docs/ios.md). It ships the same React build the web serves (dist/client), packaged inside the app so
// it opens with no network; API calls, media and fonts go to https://assembly.rsvp (src/lib/native.ts).
//
// Dev mode: CAP_SERVER_URL=http://<your Mac's LAN IP>:5173 npm run ios:sync points the app at `npm run dev`
// instead of the bundle, so the whole app (sign-in included) runs in the simulator with live reload.
// Never sync a release build with it set.
const devServer = process.env.CAP_SERVER_URL;

const config: CapacitorConfig = {
  appId: "rsvp.assembly.app",
  appName: "Assembly",
  webDir: "dist/client",
  backgroundColor: "#0a0a0b",
  ios: {
    // The web app handles safe areas itself (viewport-fit=cover and env(safe-area-inset-*)).
    contentInset: "never",
    backgroundColor: "#0a0a0b",
    // Page scrolling stays on: the policy pages scroll the document. The app shell sets overflow: hidden itself.
  },
  server: {
    // Links to these hosts stay in the app's web view; everything else opens in Safari.
    allowNavigation: ["assembly.rsvp"],
    ...(devServer ? { url: devServer, cleartext: devServer.startsWith("http://") } : {}),
  },
  plugins: {
    StatusBar: { style: "DARK", overlaysWebView: true },
  },
};

export default config;
