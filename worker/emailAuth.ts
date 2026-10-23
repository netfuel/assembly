// Sign in or sign up with a one-time code sent by email. Same flow for new and returning people.
import { Hono } from "hono";
import type { AppContext, Env } from "./env";
import { upsertUser } from "./auth";
import { rateLimit } from "./posting";
import { startSession } from "./session";

const CODE_TTL_SECONDS = 10 * 60;
const MAX_ATTEMPTS = 5;
const RESEND_AFTER_MS = 30 * 1000;

interface StoredCode {
  hash: string;
  attempts: number;
  sentAt: number;
}

export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  // Practical check, not RFC 5322: one @, a dot in the domain, no spaces, sane length.
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return null;
  return email;
}

async function sha256(text: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Six random digits, without modulo bias. */
export function newCode(): string {
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x1_0000_0000 / 1_000_000) * 1_000_000;
  do crypto.getRandomValues(buf);
  while (buf[0] >= limit);
  return String(buf[0] % 1_000_000).padStart(6, "0");
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const codeKey = async (email: string) => `email-code:${await sha256(email)}`;
const hashCode = (email: string, code: string) => sha256(`${email}:${code}`);

function isLocalTest(c: { env: Env; req: { url: string } }) {
  const host = new URL(c.req.url).hostname;
  return c.env.DEV_LOGIN === "1" && (host === "localhost" || host === "127.0.0.1");
}

export function codeEmail(code: string, origin: string) {
  const site = origin.replace(/^https?:\/\//, "");
  const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
  const text = `Your Assembly code is ${code}.

Enter it on ${site} to sign in. It expires in 10 minutes.

If you didn't ask for this, you can ignore this email. Nobody can sign in without the code.`;
  const html = `<!doctype html><html><body style="margin:0;background:#e9eaec;font-family:-apple-system,Helvetica,Arial,sans-serif;color:#121315">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;background:#f4f4f5;border:1px solid #d2d4d8;border-radius:8px">
<tr><td style="padding:28px 28px 8px;font-family:Georgia,serif;font-size:22px">Assembly</td></tr>
<tr><td style="padding:8px 28px;font-size:14px;line-height:1.5;color:#5b5e65">Your sign-in code:</td></tr>
<tr><td style="padding:4px 28px 16px;font-size:36px;letter-spacing:6px;font-weight:600;font-family:Menlo,Consolas,monospace">${spaced}</td></tr>
<tr><td style="padding:0 28px 28px;font-size:13px;line-height:1.6;color:#5b5e65">Enter it on ${site}. It expires in 10 minutes.<br>If you didn't ask for this, ignore this email. Nobody can sign in without the code.</td></tr>
</table></td></tr></table></body></html>`;
  return { subject: `${code} is your Assembly code`, text, html };
}

export const emailAuth = new Hono<AppContext>();

/** Step 1: send a code. Always answers the same way, so it never reveals whether an account exists. */
emailAuth.post("/start", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { email?: string };
  const email = normalizeEmail(body.email);
  if (!email) return c.json({ error: "Enter a full email address." }, 400);
  const local = isLocalTest(c);
  // EMAIL_FROM is the on switch: set it once the sending domain is onboarded.
  const canSend = !!(c.env.EMAIL && c.env.EMAIL_FROM);
  if (!canSend && !local) return c.json({ error: "Email sign-in isn't set up on this server yet." }, 503);

  const kv = c.env.SESSIONS;
  const ip = c.req.header("CF-Connecting-IP") ?? "local";
  const emailId = await sha256(email);
  if (!(await rateLimit(kv, `email-start:${emailId}`, 5, 3600)) || !(await rateLimit(kv, `email-start-ip:${ip}`, 30, 3600))) {
    return c.json({ error: "Too many codes requested. Wait a bit and try again." }, 429);
  }
  const key = await codeKey(email);
  const prior = (await kv.get(key, "json")) as StoredCode | null;
  if (prior && Date.now() - prior.sentAt < RESEND_AFTER_MS) {
    return c.json({ error: "We just sent a code. Give it a few seconds to arrive." }, 429);
  }

  const code = newCode();
  await kv.put(key, JSON.stringify({ hash: await hashCode(email, code), attempts: 0, sentAt: Date.now() } satisfies StoredCode), {
    expirationTtl: CODE_TTL_SECONDS,
  });

  const origin = new URL(c.req.url).origin;
  if (canSend) {
    const msg = codeEmail(code, origin);
    try {
      await c.env.EMAIL!.send({
        from: { email: c.env.EMAIL_FROM!, name: "Assembly" },
        to: email,
        subject: msg.subject,
        text: msg.text,
        html: msg.html,
      });
    } catch (err) {
      const codeName = (err as { code?: string }).code;
      console.error("email send failed", codeName, (err as Error).message);
      if (!local) {
        await kv.delete(key);
        if (codeName === "E_RECIPIENT_SUPPRESSED") return c.json({ error: "Email to that address is bouncing. Try another address." }, 400);
        return c.json({ error: "We couldn't send the email. Try again in a minute." }, 502);
      }
    }
  }
  // Local test mode: show the code on screen and in the terminal instead of relying on email.
  if (local) {
    console.log(`[email sign-in] code for ${email}: ${code}`);
    return c.json({ ok: true, devCode: code });
  }
  return c.json({ ok: true });
});

/** Step 2: check the code, then sign in (creating the account on first use). */
emailAuth.post("/verify", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { email?: string; code?: string };
  const email = normalizeEmail(body.email);
  const code = typeof body.code === "string" ? body.code.replace(/\D/g, "") : "";
  if (!email || code.length !== 6) return c.json({ error: "Enter the 6-digit code from the email." }, 400);

  const kv = c.env.SESSIONS;
  const key = await codeKey(email);
  const stored = (await kv.get(key, "json")) as StoredCode | null;
  if (!stored) return c.json({ error: "That code expired. Send a new one." }, 400);
  if (stored.attempts >= MAX_ATTEMPTS) {
    await kv.delete(key);
    return c.json({ error: "Too many tries. Send a new code." }, 429);
  }
  if (!timingSafeEqual(stored.hash, await hashCode(email, code))) {
    const left = MAX_ATTEMPTS - stored.attempts - 1;
    if (left <= 0) await kv.delete(key);
    else await kv.put(key, JSON.stringify({ ...stored, attempts: stored.attempts + 1 }), { expirationTtl: CODE_TTL_SECONDS });
    return c.json({ error: left > 0 ? `That code doesn't match. ${left} ${left === 1 ? "try" : "tries"} left.` : "Too many tries. Send a new code." }, 400);
  }

  // One use only.
  await kv.delete(key);
  const { userId, isNew } = await upsertUser(c.env.DB, "email", email, email, null, null, true);
  await startSession(c, userId);
  return c.json({ ok: true, newUser: isNew });
});
