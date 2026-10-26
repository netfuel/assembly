# Assembly

Map-driven underground event PWA: React + Vite, Cloudflare Workers/D1/R2, MapLibre, GSAP.

- Commands: `npm run typecheck`, `npm test`, `npm run build`, `npm run check:bundle`, `npm run setup:local` (migrations and seed).
- UI changes follow `docs/design-review.md`: chrome budget, three layers, 44 px tap targets, and the feature entry rule. Read it before adding a control.
- All JS motion goes through `src/lib/motion.ts` (GSAP, `useGSAP`). Use `reducedMotion()` instead of calling `matchMedia`. Animate transform and opacity only.
