// Under the Vite dev server import.meta.env exists; in the wrangler-bundled production Worker it doesn't.
interface ImportMeta {
  readonly env?: { readonly DEV?: boolean };
}
