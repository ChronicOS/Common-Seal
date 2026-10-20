import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { isConfigured, supabase } from "./supabase";
import { joinRoles, roleLabels } from "./roles";
import type { Membership } from "./types";
import Workspace from "./Workspace";
import { Brand } from "./Seal";
import { TwoStep } from "./Settings";
import { loadFactors, loadMySecurity, recordSignIn } from "./settings";

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
    window.sessionStorage.setItem(ORG_KEY, id);
  } catch {
    // Storage can be unavailable (private windows); the choice then lasts for this visit only.
  }
}

/** Chosen in this browser tab since signing in; otherwise people with several organisations are asked to choose */
function chosenThisVisit(): boolean {
  try {
    return Boolean(window.sessionStorage.getItem(ORG_KEY));
  } catch {
    return false;
  }
}
function forgetVisit() {
  try {
    window.sessionStorage.removeItem(ORG_KEY);
  } catch {
    // nothing to forget
  }
}

type ShellProps = {
  children: ReactNode;
  /** The signed-in workspace uses the full width so the side navigation fits. */
  wide?: boolean;
  email?: string;
  onSignOut?: () => void;
  onPassword?: () => void;
  /** Which organisation is open, and a way to change it */
  orgSwitch?: ReactNode;
};

function Shell({ children, wide, email, onSignOut, onPassword, orgSwitch }: ShellProps) {
  return (
    <div className="page">
      <header className="masthead">
        <Brand />
        {orgSwitch}
        {email && (
          <span className="account">
            <span className="account-email">{email}</span>
            {onPassword && (
              <button type="button" className="link" onClick={onPassword}>
                Password
              </button>
            )}
            <button type="button" className="link" onClick={onSignOut}>
              Sign out
            </button>
          </span>
        )}
      </header>
      <main className={wide ? "content content-wide" : "content"}>{children}</main>
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

function CreateOrganisation({ onCreated, onCancel }: { onCreated: (id: string) => void; onCancel?: () => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc("create_organisation", { p_name: name });
    setBusy(false);
    if (rpcError) setError(rpcError.message);
    else onCreated(data as string);
  }

  return (
    <>
      <h1>{onCancel ? "Set up another organisation" : "Set up your organisation"}</h1>
      <p className="lead">Start with a name. You can add entities, directors and documents later.{onCancel ? " You will be its owner. Your other organisations are not affected, and nothing is shared between them." : ""}</p>
      <form className="card form" onSubmit={submit}>
        <label htmlFor="org">Organisation name</label>
        <input id="org" required minLength={2} maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
        <div className="row">
          <button type="submit" disabled={busy}>
            {busy ? "Creating…" : "Create organisation"}
          </button>
          {onCancel && (
            <button type="button" className="link-dark" onClick={onCancel}>
              Cancel
            </button>
          )}
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </form>
    </>
  );
}

function ChooseOrganisation({ memberships, onChoose, onCreate }: { memberships: Membership[]; onChoose: (id: string) => void; onCreate: () => void }) {
  return (
    <>
      <h1>Choose an organisation</h1>
      <p className="lead">You belong to {memberships.length} organisations. Each is kept separate. You can switch at any time from the top of the page.</p>
      <ul className="entity-list">
        {[...memberships]
          .sort((a, b) => a.organisation.name.localeCompare(b.organisation.name))
          .map((m) => (
            <li key={m.organisation.id}>
              <button type="button" className="entity-row" onClick={() => onChoose(m.organisation.id)}>
                <span>
                  <span className="entity-name">{m.organisation.name}</span>
                  <br />
                  <span className="muted">{roleLabels(m.role)}</span>
                </span>
                <span aria-hidden="true">→</span>
              </button>
            </li>
          ))}
      </ul>
      <p>
        <button type="button" className="quiet" onClick={onCreate}>
          Set up another organisation
        </button>
      </p>
    </>
  );
}

/** Site access log (migration 0066): records this visit and roughly how long the person is actively using it */
function VisitBeacon({ organisationId }: { organisationId: string | null }) {
  useEffect(() => {
    if (!supabase) return;
    const client = supabase;
    let visit = "";
    try {
      visit = window.sessionStorage.getItem("veraphius-visit") ?? "";
      if (!visit) {
        visit = crypto.randomUUID();
        window.sessionStorage.setItem("veraphius-visit", visit);
      }
    } catch {
      visit = crypto.randomUUID();
    }
    let lastActive = Date.now();
    const touch = () => {
      lastActive = Date.now();
    };
    const events = ["pointerdown", "keydown", "scroll", "touchstart"];
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    const beat = (active: boolean) =>
      void client.rpc("site_heartbeat", { p_session: visit, p_org: organisationId, p_user_agent: navigator.userAgent.slice(0, 300), p_active: active }).then(
        () => undefined,
        () => undefined,
      );
    beat(false);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") beat(Date.now() - lastActive < 5 * 60_000);
    }, 60_000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, touch));
      window.clearInterval(timer);
    };
  }, [organisationId]);
  return null;
}

/** Signs out after the organisation's idle time, with a minute's warning */
function IdleGuard({ organisationId }: { organisationId: string }) {
  const [minutes, setMinutes] = useState<number | null>(null);
  const [warning, setWarning] = useState(false);
  useEffect(() => {
    void loadMySecurity(organisationId).then((s) => setMinutes(s?.idle_timeout_minutes ?? null));
  }, [organisationId]);
  useEffect(() => {
    if (!minutes) return;
    let last = Date.now();
    const touch = () => {
      last = Date.now();
      setWarning(false);
    };
    const events = ["pointerdown", "keydown", "scroll", "touchstart"];
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    const timer = window.setInterval(() => {
      const idle = Date.now() - last;
      if (idle >= minutes * 60_000) void supabase?.auth.signOut();
      else setWarning(idle >= minutes * 60_000 - 60_000);
    }, 5000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, touch));
      window.clearInterval(timer);
    };
  }, [minutes]);
  return warning ? <p className="card note idle-warning" role="alert">You will be signed out in under a minute because nothing has happened for a while. Click anywhere to stay signed in.</p> : null;
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [memberships, setMemberships] = useState<Membership[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string | null>(remembered);
  const [showPassword, setShowPassword] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      if (event === "SIGNED_OUT") forgetVisit();
      setSession(next);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id;
  const accessToken = session?.access_token;
  // Someone who has set up two-step sign-in is asked for a code before anything else
  const [needsCode, setNeedsCode] = useState(false);
  useEffect(() => {
    if (!accessToken || !userId) return;
    void loadFactors().then((f) => setNeedsCode(f.next === "aal2" && f.level !== "aal2"), () => setNeedsCode(false));
    void recordSignIn(accessToken, userId);
  }, [accessToken, userId]);

  const loadMemberships = useCallback(async () => {
    if (!supabase || !userId) return;
    setLoadError(null);
    // Take up any invitations waiting for this email. Failure here must not block sign-in.
    await supabase.rpc("accept_invitations").then(
      () => undefined,
      () => undefined,
    );
    const client = supabase;
    // Migration 0060: your organisations, including any waiting for two-step sign-in
    const mine = await client.rpc("my_memberships");
    if (!mine.error) {
      type Row = { organisation_id: string; name: string; tier: string; data_region: string; role: string; extra_roles: string[] | null; locked: string | null };
      const list = ((mine.data ?? []) as Row[]).map((m) => ({ role: joinRoles(m.role, m.extra_roles), locked: m.locked, organisation: { id: m.organisation_id, name: m.name, tier: m.tier, data_region: m.data_region } }));
      setMemberships(list);
      if (list.length > 1 && !chosenThisVisit()) setChoosing(true);
      return;
    }
    const read = (columns: string) => client.from("memberships").select(`${columns}, organisation:organisations(id, name, tier, data_region)`).eq("user_id", userId).eq("is_active", true);
    let { data, error } = await read("role, extra_roles");
    // Before the multiple-roles migration has been run there is no extra_roles column
    if (error) ({ data, error } = await read("role"));
    if (error) {
      setLoadError(error.message);
      return;
    }
    const list = ((data ?? []) as unknown as (Membership & { extra_roles?: string[] })[]).map((m) => ({ role: joinRoles(m.role, m.extra_roles), organisation: m.organisation }));
    setMemberships(list);
    // Several organisations and none chosen since signing in: ask which one
    if (list.length > 1 && !chosenThisVisit()) setChoosing(true);
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
  const several = (memberships?.length ?? 0) > 1;
  const choose = (id: string) => {
    setOrgId(id);
    remember(id);
    setChoosing(false);
    setCreating(false);
    setShowPassword(false);
  };

  let body: ReactNode;
  if (needsCode) {
    body = (
      <>
        <h1>Two-step sign-in</h1>
        <section className="card form">
          <TwoStep compact onVerified={() => {
            setNeedsCode(false);
            void loadMemberships();
          }} />
        </section>
      </>
    );
  } else if (showPassword) {
    body = <PasswordForm onClose={() => setShowPassword(false)} />;
  } else if (loadError) {
    body = (
      <p className="error" role="alert">
        Could not load your organisation: {loadError}
      </p>
    );
  } else if (memberships === null) {
    body = <p className="lead">Loading…</p>;
  } else if (!current || creating) {
    body = (
      <CreateOrganisation
        onCreated={(id) => {
          choose(id);
          void loadMemberships();
        }}
        onCancel={current ? () => setCreating(false) : undefined}
      />
    );
  } else if (choosing && several) {
    body = <ChooseOrganisation memberships={memberships} onChoose={choose} onCreate={() => setCreating(true)} />;
  } else if (current.locked === "mfa") {
    body = (
      <>
        <h1>Two-step sign-in needed</h1>
        <p className="lead">{current.organisation.name} asks everyone in your role to use an authenticator app. Set one up to continue. It takes about a minute.</p>
        <section className="card form">
          <TwoStep compact onVerified={() => void loadMemberships()} />
        </section>
      </>
    );
  } else {
    body = (
      <>
        <IdleGuard organisationId={current.organisation.id} />
        <VisitBeacon organisationId={current.organisation.id} />
        <Workspace key={current.organisation.id} membership={current} userId={session.user.id} userName={session.user.email ?? "Someone"} />
      </>
    );
  }

  const inWorkspace = Boolean(current) && !showPassword && !creating && !(choosing && several) && !needsCode && current?.locked !== "mfa";
  const orgSwitch =
    current && memberships ? (
      <span className="org-picker">
        <label htmlFor="org-switch" className="visually-hidden">
          Organisation
        </label>
        <select
          id="org-switch"
          value={creating ? "__new" : choosing && several ? "__choose" : current.organisation.id}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "__new") setCreating(true);
            else if (v === "__choose") setChoosing(true);
            else choose(v);
          }}
        >
          {choosing && several && <option value="__choose">Choose an organisation</option>}
          {[...memberships]
            .sort((a, b) => a.organisation.name.localeCompare(b.organisation.name))
            .map((m) => (
              <option key={m.organisation.id} value={m.organisation.id}>
                {m.organisation.name}
              </option>
            ))}
          <option value="__new">＋ Set up another organisation</option>
        </select>
      </span>
    ) : undefined;

  return (
    <Shell
      wide={inWorkspace}
      orgSwitch={orgSwitch}
      email={session.user.email}
      onSignOut={() => void client.auth.signOut()}
      // Inside an organisation, Password lives under Settings, My profile
      onPassword={current ? undefined : () => setShowPassword(true)}
    >
      {body}
    </Shell>
  );
}
