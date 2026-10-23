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
}

export type AppContext = { Bindings: Env; Variables: { userId: string | null } };
