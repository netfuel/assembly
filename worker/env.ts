export interface Env {
  DB: D1Database;
  SESSIONS: KVNamespace;
  MEDIA: R2Bucket;
  ASSETS: Fetcher;
  DEFAULT_CITY: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  APPLE_CLIENT_ID?: string;
  APPLE_TEAM_ID?: string;
  APPLE_KEY_ID?: string;
  APPLE_PRIVATE_KEY?: string;
  /** Cloudflare Stream for promo videos. Both are needed; without them video upload is hidden. */
  CLOUDFLARE_ACCOUNT_ID?: string;
  STREAM_API_TOKEN?: string;
  /** Optional: your Stream customer subdomain code (customer-<code>.cloudflarestream.com) for playback. */
  STREAM_CUSTOMER_CODE?: string;
  /** "1" enables /api/auth/dev on localhost for testing without OAuth. Never set in production. */
  DEV_LOGIN?: string;
  /** Comma-separated sign-in emails of people who can review reports and verify organizers. */
  MODERATORS?: string;
  /** Cloudflare Email Service binding (wrangler.jsonc send_email). */
  EMAIL?: SendEmailBinding;
  /** Sender for sign-in codes. Must be on an onboarded sending domain. */
  EMAIL_FROM?: string;
  /** Web push (VAPID). Generate with npm run push:keys. */
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  /** Contact for push services, e.g. mailto:hello@assembly.rsvp */
  VAPID_SUBJECT?: string;
}

export type AppContext = { Bindings: Env; Variables: { userId: string | null } };

/** The parts of Cloudflare's send_email binding Assembly uses (Email Service, Workers API). */
export interface SendEmailBinding {
  send(message: {
    from: string | { email: string; name?: string };
    to: string | { email: string; name?: string };
    subject: string;
    html?: string;
    text?: string;
    headers?: Record<string, string>;
  }): Promise<{ messageId: string }>;
}
