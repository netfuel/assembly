// Under the Vite dev server import.meta.env exists; in the wrangler-bundled production Worker it doesn't.
interface ImportMeta {
  readonly env?: { readonly DEV?: boolean };
}

// Text imports (worker/demo.ts reads the demo seed this way).
declare module "*.sql?raw" {
  const text: string;
  export default text;
}
