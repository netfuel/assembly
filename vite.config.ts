import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  build: {
    rolldownOptions: {
      output: {
        // MapLibre is most of the bundle and changes rarely; its own chunk stays cached across app releases.
        codeSplitting: { groups: [{ name: "maplibre", test: /node_modules[\\/]maplibre-gl/ }] },
      },
    },
  },
  plugins: [
    react(),
    cloudflare(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: false,
      includeAssets: ["icons/favicon.svg"],
      manifest: {
        name: "Assembly",
        short_name: "Assembly",
        description: "Underground music, DIY shows, raves, and queer nights on one live map.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        background_color: "#e9eaec",
        theme_color: "#e9eaec",
        categories: ["music", "entertainment", "social"],
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // Fonts are served from R2 by the Worker and cached at runtime below, not precached.
        globPatterns: ["**/*.{js,mjs,css,html,svg,png}"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/fonts/"),
            handler: "CacheFirst",
            options: { cacheName: "fonts", expiration: { maxEntries: 10, maxAgeSeconds: 365 * 24 * 3600 } },
          },
          {
            // Event data: fresh when online, last copy when the signal drops at the door.
            urlPattern: ({ url }) => url.pathname.startsWith("/api/events"),
            handler: "NetworkFirst",
            options: {
              cacheName: "api-events",
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 200, maxAgeSeconds: 7 * 24 * 3600 },
            },
          },
          {
            // Map tiles, styles, and glyphs.
            urlPattern: ({ url }) => url.hostname === "tiles.openfreemap.org",
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "map-tiles",
              expiration: { maxEntries: 3000, maxAgeSeconds: 30 * 24 * 3600 },
            },
          },
        ],
      },
    }),
  ],
});
