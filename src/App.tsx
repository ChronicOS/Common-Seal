import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { isConfigured, supabase } from "./supabase";
import type { Membership } from "./types";
import Workspace from "./Workspace";

const ORG_KEY = "common-seal-organisation";

function remembered(): string | null {
  try {
    return window.localStorage.getItem(ORG_KEY);
  } catch {
    return null;
  }
}

function remember(id: string) {
  try {
    window.localStorage.setItem(ORG_KEY, id);
  } catch {
    // Storage can be unavailable (private windows); the choice then lasts for this visit only.
  }
}

type ShellProps = {
  children: ReactNode;
  email?: string;
  onSignOut?: () => void;
  onPassword?: () => void;
};

function Shell({ children, email, onSignOut, onPassword }: ShellProps) {
  return (
    <div className="page">
      <header className="masthead">
        <span className="wordmark">Common Seal</span>
        {email && (
          <span className="account">
            <span className="account-email">{email}</span>
            <button type="button" className="link" onClick={onPassword}>
              Password
            </button>
            <button type="button" className="link" onClick={onSignOut}>
              Sign out
            </button>
          </span>
        )}
      </header>
      <main className="content">{children}</main>
      <footer className="footnote">Test environment. Do not enter real company information.</footer>
    </div>
  );
}

function SetupNotice() {
  return (
    <Shell>
      <h1>Setup needed</h1>
      <p className="lead">
        This site is not connected to its database yet. Add <code>VITE_SUPABASE_URL</code> and{" "}
        <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> to the site's environment variables, then redeploy.
      </p>
    </Shell>
  );
}

/** Turns the sign-in service's terse errors into something a person can act on. */
function friendly(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("rate limit"))
    return "Too many sign-in emails have been sent in the last hour. Wait a while and try again, or sign in with a password if you have set one.";
  if (m.includes("invalid login credentials"))
    return "That email and password do not match. If you have not set a password yet, use the email link.";
  return message;
}

function SignIn() {
  const [mode, setMode] = useState<"link" | "password">("link");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setState("sending");
    setError(null);
    const result =
      mode === "link"
        ? await supabase.auth.signInWithOtp({
            email: email.trim(),
            options: { emailRedirectTo: window.location.origin },
          })
        : await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (result.error) {
      setError(friendly(result.error.message));
      setState("idle");
    } else {
      setState(mode === "link" ? "sent" : "idle");
    }
  }

  return (
    <Shell>
      <h1>Sign in</h1>
      {state === "sent" ? (
        <p className="lead" role="status">
          Check your inbox. We sent a sign-in link to <strong>{email.trim()}</strong>.
        </p>
      ) : (
        <form className="card form" onSubmit={submit}>
          <label htmlFor="email">Work email</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          {mode === "password" && (
            <>
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </>
          )}
          <button type="submit" disabled={state === "sending"}>
            {state === "sending" ? "One moment…" : mode === "link" ? "Email me a sign-in link" : "Sign in"}
          </button>
          <button
            type="button"
            className="link-dark"
            onClick={() => {
              setMode(mode === "link" ? "password" : "link");
              setError(null);
            }}
          >
            {mode === "link" ? "Use a password instead" : "Use an email link instead"}
          </button>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </form>
      )}
    </Shell>
  );
}

function PasswordForm({ onClose }: { onClose: () => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    if (password.length < 12) return setError("Use at least 12 characters.");
    setBusy(true);
    setError(null);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (updateError) setError(updateError.message);
    else setDone(true);
  }

  return (
    <>
      <button type="button" className="back" onClick={onClose}>
        ← Back
      </button>
      <h1>Password</h1>
      {done ? (
        <p className="lead" role="status">
          Password saved. Next time, choose "Use a password instead" on the sign-in page.
        </p>
      ) : (
        <form className="card form" onSubmit={submit}>
          <p className="muted">
            Set a password so you can sign in without waiting for an email. Use at least 12 characters, and one you do
            not use anywhere else.
          </p>
          <label htmlFor="new-password">New password</label>
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save password"}
          </button>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </form>
      )}
    </>
  );
}

function CreateOrganisation({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc("create_organisation", { p_name: name });
    setBusy(false);
    if (rpcError) setError(rpcError.message);
    else onCreated();
  }

  return (
    <>
      <h1>Set up your organisation</h1>
      <p className="lead">Start with a name. You can add entities, directors and documents later.</p>
      <form className="card form" onSubmit={submit}>
        <label htmlFor="org">Organisation name</label>
        <input id="org" required minLength={2} maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
        <button type="submit" disabled={busy}>
          {busy ? "Creating…" : "Create organisation"}
        </button>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </form>
    </>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [memberships, setMemberships] = useState<Membership[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string | null>(remembered);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id;

  const loadMemberships = useCallback(async () => {
    if (!supabase || !userId) return;
    setLoadError(null);
    const { data, error } = await supabase
      .from("memberships")
      .select("role, organisation:organisations(id, name, tier, data_region)")
      .eq("user_id", userId)
      .eq("is_active", true);
    if (error) {
      setLoadError(error.message);
      return;
    }
    setMemberships((data ?? []) as unknown as Membership[]);
  }, [userId]);

  useEffect(() => {
    setMemberships(null);
    void loadMemberships();
  }, [loadMemberships]);

  if (!isConfigured || !supabase) return <SetupNotice />;
  if (!ready) return <Shell>{null}</Shell>;
  if (!session) return <SignIn />;

  const client = supabase;
  const current = memberships?.find((m) => m.organisation.id === orgId) ?? memberships?.[0];

  let body: ReactNode;
  if (showPassword) {
    body = <PasswordForm onClose={() => setShowPassword(false)} />;
  } else if (loadError) {
    body = (
      <p className="error" role="alert">
        Could not load your organisation: {loadError}
      </p>
    );
  } else if (memberships === null) {
    body = <p className="lead">Loading…</p>;
  } else if (!current) {
    body = <CreateOrganisation onCreated={() => void loadMemberships()} />;
  } else {
    body = (
      <>
        {memberships.length > 1 && (
          <div className="row org-switch">
            <label htmlFor="org-switch">Organisation</label>
            <select
              id="org-switch"
              value={current.organisation.id}
              onChange={(e) => {
                setOrgId(e.target.value);
                remember(e.target.value);
              }}
            >
              {memberships.map((m) => (
                <option key={m.organisation.id} value={m.organisation.id}>
                  {m.organisation.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <Workspace key={current.organisation.id} membership={current} userId={session.user.id} />
      </>
    );
  }

  return (
    <Shell
      email={session.user.email}
      onSignOut={() => void client.auth.signOut()}
      onPassword={() => setShowPassword(true)}
    >
      {body}
    </Shell>
  );
}
