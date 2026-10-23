import { useEffect, useRef, useState } from "react";
import { Button, Label, LinkButton, Tag } from "../components/ui";
import { api, ApiError, devSignInUrl, signInUrl } from "../lib/api";
import type { AuthProviders, MeProfile } from "../../shared/types";

type Step = { kind: "start" } | { kind: "code"; email: string; devCode?: string } | { kind: "name"; me: MeProfile };

/**
 * Sign in or create an account. Google and Apple when configured, plus a code by email for everyone else.
 * The email flow is the same for new and returning people: enter email, enter the code.
 */
export function SignInSheet({
  providers,
  returnTo,
  onSignedIn,
}: {
  providers: AuthProviders;
  returnTo: string;
  onSignedIn: (me: MeProfile, isNew: boolean) => void;
}) {
  const [step, setStep] = useState<Step>({ kind: "start" });
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const [devName, setDevName] = useState("Test Organizer");
  const codeInput = useRef<HTMLInputElement>(null);
  const sso = providers.google || providers.apple;

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  useEffect(() => {
    if (step.kind === "code") codeInput.current?.focus();
  }, [step.kind]);

  async function sendCode(address: string) {
    setBusy(true);
    setError(null);
    try {
      const r = await api.emailStart(address);
      setStep({ kind: "code", email: address.trim().toLowerCase(), devCode: r.devCode });
      setCode("");
      setResendIn(30);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't send the code. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function verify(value: string) {
    if (step.kind !== "code" || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.emailVerify(step.email, value);
      const me = await api.me();
      if (!me) throw new ApiError("Signed in, but couldn't load your profile. Refresh the page.", 500);
      if (r.newUser) {
        setName(me.displayName);
        setStep({ kind: "name", me });
      } else onSignedIn(me, false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't check the code. Try again.");
      setCode("");
      codeInput.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    if (step.kind !== "name") return;
    const me = step.me;
    if (!name.trim() || name.trim() === me.displayName) return onSignedIn(me, true);
    setBusy(true);
    try {
      const updated = await api.updateProfile({
        displayName: name,
        pronouns: me.pronouns ?? "",
        bio: me.bio ?? "",
        scenes: me.scenes,
        links: me.links as Record<string, string>,
        showAttendance: me.showAttendance,
      });
      onSignedIn(updated, true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save your name.");
    } finally {
      setBusy(false);
    }
  }

  if (step.kind === "name") {
    return (
      <form className="small-sheet signin" onSubmit={saveName}>
        <div className="stack" data-reveal>
          <Label glyph="◇">Welcome</Label>
          <h1 className="sheet-title">What should we call you?</h1>
          <p className="note serif-text">This is how you show up to hosts and on the map. You can change it any time.</p>
        </div>
        <label className="field signin-field" data-reveal>
          <span className="field-label">Name</span>
          <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} autoComplete="nickname" autoFocus />
        </label>
        {error && <p className="field-error">{error}</p>}
        <Button type="submit" size="lg" variant="primary" disabled={busy}>
          {busy ? "Saving…" : "Continue"}
        </Button>
      </form>
    );
  }

  if (step.kind === "code") {
    return (
      <form
        className="small-sheet signin"
        onSubmit={(e) => {
          e.preventDefault();
          verify(code);
        }}
      >
        <div className="stack" data-reveal>
          <Label glyph="◇">Check your email</Label>
          <h1 className="sheet-title">Enter the code.</h1>
          <p className="note serif-text">
            We sent a 6-digit code to <strong>{step.email}</strong>. It works for 10 minutes.
          </p>
        </div>
        {step.devCode && (
          <p className="dev-code" data-reveal>
            <Tag>Local only</Tag> Your code is <span className="num">{step.devCode}</span>
          </p>
        )}
        <label className={`field signin-field ${error ? "has-error" : ""}`} data-reveal>
          <span className="field-label">Code</span>
          <input
            ref={codeInput}
            className="code-input num"
            value={code}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={7}
            placeholder="000000"
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, "").slice(0, 6);
              setCode(v);
              // Submit as soon as all six digits are in, including when the phone autofills it.
              if (v.length === 6) verify(v);
            }}
          />
          {error && <span className="field-error">{error}</span>}
        </label>
        <Button type="submit" size="lg" variant="primary" disabled={busy || code.length !== 6}>
          {busy ? "Checking…" : "Sign in"}
        </Button>
        <div className="inline-actions signin-alt">
          <Button type="button" size="sm" variant="ghost" disabled={resendIn > 0 || busy} onClick={() => sendCode(step.email)}>
            {resendIn > 0 ? `Resend in ${resendIn}s` : "Resend code"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setStep({ kind: "start" });
              setError(null);
            }}
          >
            Use a different email
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="small-sheet signin">
      <div className="stack" data-reveal>
        <Label glyph="◇">Sign in or sign up</Label>
        <h1 className="sheet-title">RSVP and save your nights.</h1>
        <p className="note serif-text">New here? Signing in creates your account. Your RSVPs stay private unless you choose to show them.</p>
      </div>
      {sso && (
        <div className="sso" data-reveal>
          {providers.google && (
            <LinkButton size="lg" variant="solid" href={signInUrl("google", returnTo)}>
              Continue with Google
            </LinkButton>
          )}
          {providers.apple && (
            <LinkButton size="lg" href={signInUrl("apple", returnTo)}>
              Continue with Apple
            </LinkButton>
          )}
        </div>
      )}
      {providers.email && (
        <>
          {sso && (
            <div className="or" data-reveal aria-hidden="true">
              <span>or</span>
            </div>
          )}
          <form
            className="email-start"
            data-reveal
            onSubmit={(e) => {
              e.preventDefault();
              sendCode(email);
            }}
          >
            <label className={`field signin-field ${error ? "has-error" : ""}`}>
              <span className="field-label">Email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                inputMode="email"
                autoCapitalize="none"
                spellCheck={false}
                required
              />
              {error && <span className="field-error">{error}</span>}
            </label>
            <Button type="submit" size="lg" variant={sso ? "default" : "solid"} disabled={busy || !email.trim()}>
              {busy ? "Sending…" : "Email me a code"}
            </Button>
            <p className="note">No password needed. We'll email a 6-digit code.</p>
          </form>
        </>
      )}
      {providers.dev && (
        <form
          className="dev-signin"
          data-reveal
          onSubmit={(ev) => {
            ev.preventDefault();
            location.href = devSignInUrl(devName || "Test Organizer", returnTo);
          }}
        >
          <Tag>Local only</Tag>
          <input value={devName} onChange={(ev) => setDevName(ev.target.value)} aria-label="Test name" />
          <Button type="submit" size="sm">
            Test sign-in
          </Button>
        </form>
      )}
      {!sso && !providers.email && !providers.dev && (
        <p className="note" data-reveal>
          <Tag>Setup</Tag> Sign-in isn't configured on this server yet. See README, "Set up sign-in".
        </p>
      )}
    </div>
  );
}
