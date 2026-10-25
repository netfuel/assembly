// The Worker is built by Vite (Cloudflare plugin), which replaces import.meta.env.DEV at build time.
interface ImportMeta {
  readonly env: { readonly DEV: boolean };
}
