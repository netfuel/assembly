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
        background_color: "#0a0a0b",
        theme_color: "#0a0a0b",
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
        // Push notifications: public/push-sw.js adds the push and notificationclick handlers.
        importScripts: ["/push-sw.js"],
        navigateFallbackDenylist: [/^\/api\//],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        runtimeCaching: [
          {
            // Our own font route only (the tile host also has /fonts/ paths, for map glyphs).
            // Cache only real WOFF2 responses, so an error page can never be stored as a font.
            // Named fonts-v2 to abandon an early cache that stored HTML responses.
            urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith("/fonts/timeless/"),
            handler: "CacheFirst",
            options: {
              cacheName: "fonts-v2",
              cacheableResponse: { statuses: [200], headers: { "Content-Type": "font/woff2" } },
              expiration: { maxEntries: 10, maxAgeSeconds: 365 * 24 * 3600 },
            },
          },
          {
            // One event's details. Saved events are fetched ahead (src/lib/offline.ts) so the address and
            // set times open at the door with no signal. Kept apart from list queries so those can't evict them.
            urlPattern: ({ url, sameOrigin }) => sameOrigin && /^\/api\/events\/[^/]+$/.test(url.pathname),
            handler: "NetworkFirst",
            options: {
              cacheName: "event-details",
              networkTimeoutSeconds: 4,
              cacheableResponse: { statuses: [200] },
              expiration: { maxEntries: 150, maxAgeSeconds: 60 * 24 * 3600 },
            },
          },
          {
            // Event lists: fresh when online, last copy when the signal drops.
            urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname === "/api/events",
            handler: "NetworkFirst",
            options: {
              cacheName: "api-events",
              networkTimeoutSeconds: 4,
              cacheableResponse: { statuses: [200] },
              expiration: { maxEntries: 60, maxAgeSeconds: 7 * 24 * 3600 },
            },
          },
          {
            // Your profile and your Going list, so the app still knows you offline. Cleared on sign-out.
            urlPattern: ({ url, sameOrigin }) => sameOrigin && (url.pathname === "/api/me" || url.pathname === "/api/me/events"),
            handler: "NetworkFirst",
            options: { cacheName: "api-me", networkTimeoutSeconds: 4, cacheableResponse: { statuses: [200] } },
          },
          {
            // Flyers and profile photos: immutable, so cache first.
            urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith("/api/media/"),
            handler: "CacheFirst",
            options: {
              cacheName: "media",
              cacheableResponse: { statuses: [200] },
              expiration: { maxEntries: 300, maxAgeSeconds: 60 * 24 * 3600 },
            },
          },
          {
            // City record (center, timezone).
            urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith("/api/cities/"),
            handler: "StaleWhileRevalidate",
            options: { cacheName: "api-city" },
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
