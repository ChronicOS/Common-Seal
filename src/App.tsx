import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { isConfigured, supabase } from "./supabase";

type Organisation = { id: string; name: string; tier: string; data_region: string };
type Membership = { role: string; organisation: Organisation };

function Shell({ children, email, onSignOut }: { children: ReactNode; email?: string; onSignOut?: () => void }) {
  return (
    <div className="page">
      <header className="masthead">
        <span className="wordmark">Common Seal</span>
        {email && (
          <span className="account">
            <span className="account-email">{email}</span>
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

function SignIn() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setState("sending");
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    });
    if (signInError) {
      setError(signInError.message);
      setState("idle");
    } else {
      setState("sent");
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
          <button type="submit" disabled={state === "sending"}>
            {state === "sending" ? "Sending…" : "Email me a sign-in link"}
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

function Home({ membership }: { membership: Membership }) {
  const { organisation, role } = membership;
  return (
    <>
      <p className="eyebrow">Director assurance view</p>
      <h1>{organisation.name}</h1>
      <dl className="facts">
        <div>
          <dt>Your role</dt>
          <dd className="capitalise">{role}</dd>
        </div>
        <div>
          <dt>Tier</dt>
          <dd className="capitalise">{organisation.tier}</dd>
        </div>
        <div>
          <dt>Data region</dt>
          <dd>{organisation.data_region}</dd>
        </div>
      </dl>
      <section className="card">
        <h2>Obligations status</h2>
        <p className="status-unknown">Unknown</p>
        <p>
          No obligations are recorded yet, so there is nothing to report as on track. Status appears here once
          obligations have owners and dated evidence.
        </p>
      </section>
    </>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [memberships, setMemberships] = useState<Membership[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

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
  return (
    <Shell email={session.user.email} onSignOut={() => void client.auth.signOut()}>
      {loadError ? (
        <p className="error" role="alert">
          Could not load your organisation: {loadError}
        </p>
      ) : memberships === null ? (
        <p className="lead">Loading…</p>
      ) : memberships.length === 0 ? (
        <CreateOrganisation onCreated={() => void loadMemberships()} />
      ) : (
        <Home membership={memberships[0]} />
      )}
    </Shell>
  );
}
