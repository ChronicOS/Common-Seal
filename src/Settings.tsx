import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { formatDay, loadMembers, type Member } from "./board";
import { loadConflictOfficer, setConflictOfficer } from "./conflicts";
import { loadGiftSetup, setGiftResponsible } from "./declarations";
import { ReminderChoice } from "./ForYou";
import { has, ROLES } from "./roles";
import {
  bytes, describeAgent, exportAll, loadAudit, loadFactors, loadMine, loadOrgSettings, loadRecordsControls, loadSignIns, loadUsage, placeOrgHold, releaseHold, REMINDER_AREAS,
  removeFactor, saveOrgSettings, saveRetention, setMuted, startEnrol, verifyCode,
  type AuditRow, type EditableSettings, type Factor, type OrgSettings, type SignIn, type Usage,
} from "./settings";
import { useScreeningStatus } from "./Screening";
import { supabase } from "./supabase";

type Props = { organisationId: string; role: string; userId: string };

/** Loads the organisation's settings and gives a save that reloads them */
function useSettings(organisationId: string) {
  const [s, setS] = useState<OrgSettings | null | undefined>(undefined);
  const reload = useCallback(async () => setS(await loadOrgSettings(organisationId)), [organisationId]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { s, reload };
}

function useRun() {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const run = async (work: () => Promise<void>, done = "Saved.") => {
    setBusy(true);
    setProblem(null);
    setNotice(null);
    try {
      await work();
      setNotice(done);
      return true;
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "That did not save.");
      return false;
    } finally {
      setBusy(false);
    }
  };
  const messages = (
    <>
      {problem && <p className="error" role="alert">{problem}</p>}
      {notice && <p className="card note" role="status">{notice}</p>}
    </>
  );
  return { busy, run, messages };
}

export function NotYet() {
  return <p className="card note">These settings need the latest database update (migration 0060). Ask whoever runs your database to run it, then reload.</p>;
}

function Head({ title, lead }: { title: string; lead?: ReactNode }) {
  return (
    <>
      <p className="eyebrow">Settings</p>
      <h1>{title}</h1>
      {lead && <p className="lead">{lead}</p>}
    </>
  );
}

// ---------------------------------------------------------------------
// My profile
// ---------------------------------------------------------------------

/** Set up, use and remove an authenticator app. Also used at sign-in when an organisation requires it. */
export function TwoStep({ onVerified, compact }: { onVerified?: () => void; compact?: boolean }) {
  const [state, setState] = useState<{ factors: Factor[]; level: string | null; next: string | null } | null>(null);
  const [enrol, setEnrol] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const { busy, run, messages } = useRun();
  const reload = useCallback(async () => {
    try {
      setState(await loadFactors());
    } catch {
      setState({ factors: [], level: null, next: null });
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  if (!state) return <p className="muted">Loading…</p>;
  const verified = state.factors.filter((f) => f.status === "verified");
  const needsCode = verified.length > 0 && state.level !== "aal2";

  const submit = (e: FormEvent, factorId: string) => {
    e.preventDefault();
    void run(async () => {
      await verifyCode(factorId, code);
      setCode("");
      setEnrol(null);
      await reload();
      onVerified?.();
    }, enrol ? "Two-step sign-in is set up. You will be asked for a code from your app when you sign in." : "Verified.");
  };
  const codeForm = (factorId: string, label: string) => (
    <form className="form" onSubmit={(e) => submit(e, factorId)}>
      <label htmlFor="mfa-code">{label}</label>
      <div className="row">
        <input id="mfa-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required value={code} onChange={(e) => setCode(e.target.value)} style={{ maxWidth: "10em" }} />
        <button type="submit" disabled={busy}>{busy ? "Checking…" : "Verify"}</button>
      </div>
    </form>
  );

  return (
    <div>
      {messages}
      {needsCode ? (
        codeForm(verified[0].id, "Enter the 6-digit code from your authenticator app")
      ) : enrol ? (
        <div className="form">
          <p>1. Open an authenticator app on your phone (for example Microsoft Authenticator, Google Authenticator or 1Password) and scan this code.</p>
          <img src={enrol.qr} alt="QR code to scan with your authenticator app" width={180} height={180} style={{ background: "#fff", padding: 8 }} />
          <p className="small muted">Can't scan? Type this key into the app instead: <code>{enrol.secret}</code></p>
          {codeForm(enrol.id, "2. Enter the 6-digit code the app shows")}
          <button type="button" className="link-dark" onClick={() => setEnrol(null)}>Cancel</button>
        </div>
      ) : verified.length > 0 ? (
        <>
          <p className="ok-text">On. You are asked for a code from your authenticator app when you sign in.</p>
          {!compact && (
            <ul className="entity-list">
              {verified.map((f) => (
                <li key={f.id} className="member-row">
                  <span>{f.friendly_name || "Authenticator app"} <span className="muted">· added {formatDay(f.created_at)}</span></span>
                  <button type="button" className="link-dark" disabled={busy} onClick={() => {
                    if (window.confirm("Remove this authenticator? If your organisation requires two-step sign-in you will need to set it up again before you can open it.")) void run(async () => {
                      await removeFactor(f.id);
                      await reload();
                    }, "Removed.");
                  }}>Remove</button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <>
          <p>{compact ? "Set up an authenticator app to continue." : "Off. Adding an authenticator app means someone with your password or email still cannot get in without your phone."}</p>
          <button type="button" disabled={busy} onClick={() => void run(async () => setEnrol(await startEnrol()), "Scan the code below.")}>Set up two-step sign-in</button>
        </>
      )}
    </div>
  );
}

function PasswordInline() {
  const [password, setPassword] = useState("");
  const { busy, run, messages } = useRun();
  return (
    <form className="form" onSubmit={(e) => {
      e.preventDefault();
      if (password.length < 12) return void run(async () => { throw new Error("Use at least 12 characters."); });
      void run(async () => {
        const { error } = await supabase!.auth.updateUser({ password });
        if (error) throw new Error(error.message);
        setPassword("");
      }, "Password saved. Next time, choose \"Use a password instead\" on the sign-in page.");
    }}>
      {messages}
      <label htmlFor="me-password">New password</label>
      <div className="row wrap">
        <input id="me-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <button type="submit" disabled={busy || !password}>{busy ? "Saving…" : "Save password"}</button>
      </div>
      <p className="small muted">At least 12 characters, and one you do not use anywhere else.</p>
    </form>
  );
}

export function MyProfile({ organisationId, userId, email }: Props & { email: string }) {
  const [muted, setMutedList] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    void supabase?.from("people").select("full_name").eq("organisation_id", organisationId).eq("user_id", userId).limit(1).maybeSingle()
      .then(({ data }) => setName((data as { full_name?: string } | null)?.full_name?.trim() || null));
    void loadMine(organisationId, userId).then((m) => setMutedList(m ? m.reminder_muted : null));
  }, [organisationId, userId]);
  return (
    <>
      <Head title="My profile" />
      <section className="card block">
        <h2>You</h2>
        <dl className="detail-list compact">
          <div><dt>Name</dt><dd>{name || <span className="muted">Not recorded. Your name comes from the people list; ask an administrator to add it.</span>}</dd></div>
          <div><dt>Email</dt><dd>{email} <span className="small muted">To use a different email, ask an owner or administrator to invite the new address and then hand over to it.</span></dd></div>
        </dl>
      </section>
      <section className="card block">
        <h2>Password</h2>
        <PasswordInline />
      </section>
      <section className="card block">
        <h2>Two-step sign-in</h2>
        <TwoStep />
      </section>
      <section className="card block">
        <h2>Reminder emails</h2>
        <ReminderChoice organisationId={organisationId} userId={userId} />
        {muted === null ? (
          <p className="small muted">Choosing areas needs the latest database update (migration 0060).</p>
        ) : (
          <fieldset className="plain-fieldset">
            <legend>Areas to email me about</legend>
            <p className="small muted">Untick an area to stop emails about it. It still shows in For you.</p>
            <div className="check-grid">
              {REMINDER_AREAS.map((a) => (
                <label key={a} className="check">
                  <input type="checkbox" checked={!muted.includes(a)} onChange={async (e) => {
                    const next = e.target.checked ? muted.filter((x) => x !== a) : [...muted, a];
                    setMutedList(next);
                    setSaved(false);
                    await setMuted(organisationId, next).then(() => setSaved(true), () => setSaved(false));
                  }} /> {a}
                </label>
              ))}
            </div>
            {saved && <p className="small muted" role="status">Saved.</p>}
          </fieldset>
        )}
      </section>
    </>
  );
}

// ---------------------------------------------------------------------
// Security
// ---------------------------------------------------------------------
const IDLE_CHOICES = [null, 15, 30, 60, 120, 240, 480];
const idleLabel = (m: number | null) => (m === null ? "Never" : m < 60 ? `After ${m} minutes` : `After ${m / 60} hour${m === 60 ? "" : "s"}`);

export function SecuritySettings({ organisationId, role }: Props) {
  const admin = has(role, "owner", "admin");
  const canAudit = has(role, "owner", "admin", "legal", "compliance", "auditor");
  const { s, reload } = useSettings(organisationId);
  const { busy, run, messages } = useRun();
  const [domains, setDomains] = useState("");
  const [signIns, setSignIns] = useState<SignIn[] | null>(null);
  const [audit, setAudit] = useState<AuditRow[] | null>(null);
  const [auditTable, setAuditTable] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const savedDomains = (s?.invite_domains ?? []).join(", ");
  useEffect(() => setDomains(savedDomains), [savedDomains]);
  useEffect(() => {
    if (has(role, "owner", "admin", "auditor")) void loadSignIns(organisationId).then(setSignIns);
    if (canAudit) void loadAudit(organisationId, auditTable, null).then(setAudit);
    void loadMembers(organisationId).then(setMembers, () => setMembers([]));
  }, [organisationId, role, canAudit, auditTable]);
  if (s === undefined) return <p className="lead">Loading…</p>;
  if (s === null) return (<><Head title="Security" /><NotYet /></>);
  const save = (patch: EditableSettings, done = "Saved.") => run(async () => {
    await saveOrgSettings(organisationId, patch);
    await reload();
  }, done);
  const who = (id: string | null) => (id ? members.find((m) => m.user_id === id)?.name ?? "Someone no longer here" : "The system");

  return (
    <>
      <Head title="Security" lead="Who can get in, and how. Changes apply to everyone in this organisation." />
      {messages}
      <section className="card form block">
        <h2>Two-step sign-in</h2>
        <p className="small">Require an authenticator app for these roles. People in them cannot open this organisation until they have set one up. The database enforces this too, not only the screen.</p>
        <div className="check-grid">
          {ROLES.map((r) => (
            <label key={r.value} className="check">
              <input type="checkbox" disabled={!admin || busy} checked={s.mfa_required_roles.includes(r.value)}
                onChange={(e) => void save({ mfa_required_roles: e.target.checked ? [...s.mfa_required_roles, r.value] : s.mfa_required_roles.filter((x) => x !== r.value) })} /> {r.label}
            </label>
          ))}
        </div>
        <p className="small muted">To require it for your own role, set it up for yourself first in My profile, so you cannot lock yourself out. We recommend at least Owner and Admin.</p>
      </section>

      <section className="card form block">
        <h2>Sign out when idle</h2>
        <label htmlFor="sec-idle">Sign people out after no activity</label>
        <select id="sec-idle" disabled={!admin || busy} value={s.idle_timeout_minutes ?? ""} onChange={(e) => void save({ idle_timeout_minutes: e.target.value ? Number(e.target.value) : null })}>
          {IDLE_CHOICES.map((m) => <option key={m ?? "never"} value={m ?? ""}>{idleLabel(m)}</option>)}
        </select>
        <p className="small muted">A warning shows a minute before.</p>
      </section>

      <section className="card form block">
        <h2>Who can be invited</h2>
        <label htmlFor="sec-domains">Only allow email addresses at these domains (leave empty to allow any)</label>
        <div className="row wrap">
          <input id="sec-domains" className="grow" disabled={!admin} placeholder="example.com.au, example.com" value={domains} onChange={(e) => setDomains(e.target.value)} />
          {admin && domains !== s.invite_domains.join(", ") && (
            <button type="button" disabled={busy} onClick={() => void save({ invite_domains: domains.split(/[,\s]+/).map((d) => d.trim()).filter(Boolean) })}>Save</button>
          )}
        </div>
        <p className="small muted">Outside advisers and auditors on other domains then cannot be invited. Remove the limit while you invite them, or add their domain.</p>
      </section>

      <section className="card form block">
        <h2>Personal links</h2>
        <label htmlFor="sec-links">Links sent to people outside VeraPhius (surveys, training, questionnaires, confidentiality notices) stop working after</label>
        <select id="sec-links" disabled={!admin || busy} value={s.link_days} onChange={(e) => void save({ link_days: Number(e.target.value) })}>
          {[7, 14, 30, 60, 90].map((d) => <option key={d} value={d}>{d} days</option>)}
        </select>
        <p className="small muted">Applies to links sent from now on. Sending a reminder renews a link.</p>
      </section>

      {signIns !== null && (
        <section className="block">
          <h2>Sign-ins (last 90 days)</h2>
          {signIns.length === 0 ? <p className="muted">None recorded yet.</p> : (
            <div className="table-scroll"><table className="report-table wide">
              <thead><tr><th>When</th><th>Who</th><th>How</th><th>Device</th></tr></thead>
              <tbody>
                {signIns.slice(0, 100).map((x, i) => (
                  <tr key={i}><td>{new Date(x.at).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" })}</td><td>{x.full_name}</td>
                    <td>{({ password: "Password", link: "Email link", mfa: "With two-step", session: "Returning" } as Record<string, string>)[x.method ?? ""] ?? ""}</td><td>{describeAgent(x.user_agent)}</td></tr>
                ))}
              </tbody>
            </table></div>
          )}
        </section>
      )}

      {canAudit && (
        <section className="block">
          <h2>Activity log</h2>
          <p className="small muted">Every change to a record is logged automatically and cannot be edited.</p>
          <p className="row wrap">
            <label htmlFor="sec-audit-table">Show</label>
            <select id="sec-audit-table" value={auditTable} onChange={(e) => setAuditTable(e.target.value)}>
              <option value="">Everything</option>
              {["entities", "people", "officeholdings", "meetings", "resolutions", "documents", "contracts", "policies", "risk_items", "memberships", "organisations", "legal_holds", "conf_projects"].map((t) => (
                <option key={t} value={t}>{t.replace(/_/g, " ")}</option>
              ))}
            </select>
          </p>
          {audit === null ? <p className="muted">Could not load the log.</p> : audit.length === 0 ? <p className="muted">Nothing logged.</p> : (
            <>
              <div className="table-scroll"><table className="report-table wide">
                <thead><tr><th>When</th><th>Who</th><th>What</th><th>Record</th></tr></thead>
                <tbody>
                  {audit.map((a) => (
                    <tr key={a.id}><td>{new Date(a.occurred_at).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" })}</td><td>{who(a.actor_user_id)}</td>
                      <td>{({ insert: "Added", update: "Changed", delete: "Deleted" } as Record<string, string>)[a.action.toLowerCase()] ?? a.action}</td>
                      <td>{(a.table_name ?? "").replace(/_/g, " ")}</td></tr>
                  ))}
                </tbody>
              </table></div>
              {audit.length === 100 && (
                <button type="button" className="quiet" onClick={async () => {
                  const more = await loadAudit(organisationId, auditTable, audit[audit.length - 1].occurred_at);
                  if (more) setAudit([...audit, ...more]);
                }}>Show older</button>
              )}
            </>
          )}
        </section>
      )}
    </>
  );
}

// ---------------------------------------------------------------------
// Defaults and set-up
// ---------------------------------------------------------------------
export function DefaultsSettings({ organisationId, role, onOpen }: Props & { onOpen: (tab: string) => void }) {
  const admin = has(role, "owner", "admin");
  const { s, reload } = useSettings(organisationId);
  const { busy, run, messages } = useRun();
  const [members, setMembers] = useState<Member[]>([]);
  const [gift, setGift] = useState<string | null | undefined>(undefined);
  const [officer, setOfficer] = useState<string | null | undefined>(undefined);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [giftT, setGiftT] = useState("");
  const [expT, setExpT] = useState("");
  useEffect(() => {
    void loadMembers(organisationId).then((m) => setMembers(m.filter((x) => x.is_active)), () => setMembers([]));
    void loadGiftSetup(organisationId).then((g) => setGift(g ? g.responsible_user_id : undefined), () => setGift(undefined));
    void loadConflictOfficer(organisationId).then((c) => setOfficer(c.ready ? c.officer : undefined), () => setOfficer(undefined));
    void loadUsage(organisationId).then(setUsage);
  }, [organisationId]);
  useEffect(() => {
    setGiftT(s?.gift_approval_threshold == null ? "" : String(s.gift_approval_threshold));
    setExpT(s?.expense_receipt_threshold == null ? "" : String(s.expense_receipt_threshold));
  }, [s]);
  if (s === undefined) return <p className="lead">Loading…</p>;
  if (s === null) return (<><Head title="Defaults and set-up" /><NotYet /></>);
  const save = (patch: EditableSettings) => run(async () => {
    await saveOrgSettings(organisationId, patch);
    await reload();
  });
  const personSelect = (id: string, value: string | null, onChange: (v: string | null) => void) => (
    <select id={id} disabled={!admin || busy} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">Nobody chosen</option>
      {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.name}</option>)}
    </select>
  );

  return (
    <>
      <Head title="Defaults and set-up" lead="Settings the rest of VeraPhius starts from. Each can still be changed on the record itself." />
      {messages}
      {!admin && <p className="small muted">Only an owner or administrator can change these.</p>}
      <section className="card form block">
        <h2>Responsible people</h2>
        {gift !== undefined && (
          <>
            <label htmlFor="def-gift">Decides gifts and hospitality entries</label>
            {personSelect("def-gift", gift, (v) => void run(async () => {
              await setGiftResponsible(organisationId, v);
              setGift(v);
            }))}
          </>
        )}
        {officer !== undefined && (
          <>
            <label htmlFor="def-coi">Decides conflicts of interest</label>
            {personSelect("def-coi", officer, (v) => void run(async () => {
              await setConflictOfficer(organisationId, v);
              setOfficer(v);
            }))}
          </>
        )}
        <p className="small">
          Default legal contact for confidential projects: <strong>{usage?.legal_contact ?? "the directors"}</strong>.{" "}
          <span className="muted">This is whoever holds the General Counsel position, or failing that the CEO. Set those positions in </span>
          <button type="button" className="link-dark" onClick={() => onOpen("company")}>Company Info</button>.
        </p>
        <p className="small">
          Also set up elsewhere: <button type="button" className="link-dark" onClick={() => onOpen("speakup")}>speak-up handlers</button>,{" "}
          <button type="button" className="link-dark" onClick={() => onOpen("register")}>risk categories and owners</button>.
        </p>
      </section>

      <section className="card form block">
        <h2>Thresholds</h2>
        <label htmlFor="def-gift-t">Gifts and hospitality need approval above ($)</label>
        <div className="row"><input id="def-gift-t" type="number" min={0} step={1} disabled={!admin} value={giftT} onChange={(e) => setGiftT(e.target.value)} style={{ maxWidth: "10em" }} />
          {admin && giftT !== (s.gift_approval_threshold == null ? "" : String(s.gift_approval_threshold)) && <button type="button" disabled={busy} onClick={() => void save({ gift_approval_threshold: giftT === "" ? null : Number(giftT) })}>Save</button>}</div>
        <label htmlFor="def-exp-t">Expense claims need a receipt above ($)</label>
        <div className="row"><input id="def-exp-t" type="number" min={0} step={1} disabled={!admin} value={expT} onChange={(e) => setExpT(e.target.value)} style={{ maxWidth: "10em" }} />
          {admin && expT !== (s.expense_receipt_threshold == null ? "" : String(s.expense_receipt_threshold)) && <button type="button" disabled={busy} onClick={() => void save({ expense_receipt_threshold: expT === "" ? null : Number(expT) })}>Save</button>}</div>
      </section>

      <section className="card form block">
        <h2>Starting points</h2>
        <label htmlFor="def-policy">New policies are reviewed every</label>
        <select id="def-policy" disabled={!admin || busy} value={s.policy_review_months} onChange={(e) => void save({ policy_review_months: Number(e.target.value) })}>
          {[6, 12, 18, 24, 36].map((m) => <option key={m} value={m}>{m} months</option>)}
        </select>
        <label htmlFor="def-conf">Confidential projects closed without an end date stay confidential for</label>
        <select id="def-conf" disabled={!admin || busy} value={s.default_conf_months ?? ""} onChange={(e) => void save({ default_conf_months: e.target.value ? Number(e.target.value) : null })}>
          <option value="">No default (ask each time)</option>
          {[12, 24, 36, 60].map((m) => <option key={m} value={m}>{m / 12} year{m === 12 ? "" : "s"} from closing</option>)}
        </select>
        <p className="small muted">Only used where the NDA does not set a period. Projects that did not need an NDA are left alone.</p>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------
// Email and notifications
// ---------------------------------------------------------------------
export function EmailSettings({ organisationId, role }: Props) {
  const admin = has(role, "owner", "admin");
  const { s, reload } = useSettings(organisationId);
  const { busy, run, messages } = useRun();
  const [from, setFrom] = useState("");
  const [footer, setFooter] = useState("");
  useEffect(() => {
    setFrom(s?.email_from_address ?? "");
    setFooter(s?.email_footer ?? "");
  }, [s]);
  if (s === undefined) return <p className="lead">Loading…</p>;
  if (s === null) return (<><Head title="Email and notifications" /><NotYet /></>);
  const save = (patch: EditableSettings) => run(async () => {
    await saveOrgSettings(organisationId, patch);
    await reload();
  });
  const dirty = from !== (s.email_from_address ?? "") || footer !== (s.email_footer ?? "");
  return (
    <>
      <Head title="Email and notifications" lead="Reminder emails tell people only that something needs them, never the detail. Each person chooses how often in My profile." />
      {messages}
      <section className="card form block">
        <h2>For new people</h2>
        <label htmlFor="em-default">Reminder emails start as</label>
        <select id="em-default" disabled={!admin || busy} value={s.default_reminder_emails} onChange={(e) => void save({ default_reminder_emails: e.target.value as OrgSettings["default_reminder_emails"] })}>
          <option value="when_needed">Only when something needs them (at most daily)</option>
          <option value="weekly">At most once a week</option>
          <option value="off">Off</option>
        </select>
      </section>
      <section className="card form block">
        <h2>How emails look</h2>
        <label htmlFor="em-from">Replies go to</label>
        <input id="em-from" type="email" disabled={!admin} placeholder="governance@yourcompany.com.au" value={from} onChange={(e) => setFrom(e.target.value)} />
        <p className="small muted">Emails are sent from VeraPhius's own address. Sending from your own domain comes with the Microsoft 365 and Google connections (see Integrations).</p>
        <label htmlFor="em-footer">Footer (for example your company name and a confidentiality line)</label>
        <textarea id="em-footer" rows={3} maxLength={500} disabled={!admin} value={footer} onChange={(e) => setFooter(e.target.value)} />
        {admin && dirty && <button type="button" disabled={busy} onClick={() => void save({ email_from_address: from.trim() || null, email_footer: footer.trim() || null })}>Save</button>}
      </section>
    </>
  );
}

// ---------------------------------------------------------------------
// Integrations
// ---------------------------------------------------------------------
const INTEGRATIONS: { name: string; what: string }[] = [
  { name: "Microsoft 365 and Outlook", what: "Send invitations, notices and reminders from your own mailbox, put meetings in calendars, and keep confidential project distribution lists in step." },
  { name: "Google Workspace", what: "The same for Gmail and Google Calendar." },
  { name: "Electronic signing", what: "Send NDAs, resolutions and contracts for signature and file the signed copy automatically." },
  { name: "ASIC", what: "Check company details against ASIC and track lodgements." },
  { name: "Accounting software", what: "Bring in revenue and entity figures for thresholds (Xero, MYOB, NetSuite)." },
  { name: "Claude news search", what: "AI web search for adverse media about third parties and the people behind them, alongside Dilisense adverse media." },
];
export function Integrations() {
  const status = useScreeningStatus();
  const usage = status?.usage as { billed_requests_used?: number; billed_requests_quota?: number } | null | undefined;
  return (
    <>
      <Head title="Integrations" lead="Connections to the tools you already use." />
      <div className="tier-grid">
        <section className="card tier-card">
          <p className="eyebrow">{status?.configured ? "Connected" : "Ready to connect"}</p>
          <h3>Sanctions and watch-list screening (Dilisense)</h3>
          <p className="small">Screens organisations and individuals in Due Diligence against sanctions lists, politically exposed persons and criminal and other watch lists.</p>
          {status === undefined ? <p className="small muted">Checking…</p>
            : status?.configured ? (
              <p className="small ok-text">On.{usage?.billed_requests_quota != null ? ` ${usage.billed_requests_used ?? 0} of ${usage.billed_requests_quota} searches used this month.` : ""}</p>
            ) : (
              <p className="small muted">Not connected. Whoever runs your Supabase project adds the Dilisense key there (see the set-up instructions). The key never goes into VeraPhius screens or chat.</p>
            )}
        </section>
        {status?.claude && (
          <section className="card tier-card">
            <p className="eyebrow">Connected</p>
            <h3>Adverse media: Claude news search</h3>
            <p className="small">Claude searches the web for adverse news about third parties and the people behind them, and links every finding to its source.</p>
            <p className="small ok-text">On.</p>
          </section>
        )}
        {INTEGRATIONS.map((i) => (
          <section key={i.name} className="card tier-card">
            <p className="eyebrow">Coming</p>
            <h3>{i.name}</h3>
            <p className="small">{i.what}</p>
            <p className="small muted">Not connected</p>
          </section>
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------
// Data and privacy
// ---------------------------------------------------------------------
export function DataPrivacy({ organisationId, role }: Props) {
  const records = has(role, "owner", "admin", "secretary", "legal", "compliance");
  const canHold = has(role, "owner", "admin", "legal");
  const { busy, run, messages } = useRun();
  const [data, setData] = useState<Awaited<ReturnType<typeof loadRecordsControls>> | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [hold, setHold] = useState({ name: "", matter: "", reason: "" });
  const [showHold, setShowHold] = useState(false);
  const [ret, setRet] = useState({ name: "", applies_to: "", years: "", approval: true });
  const reload = useCallback(async () => setData(await loadRecordsControls(organisationId)), [organisationId]);
  useEffect(() => {
    if (records) void reload();
  }, [records, reload]);

  return (
    <>
      <Head title="Data and privacy" lead="Your data is kept in Sydney, Australia. You can take a copy of it at any time." />
      {messages}
      <section className="card block">
        <h2>Export your data</h2>
        <p className="small">Downloads everything you are allowed to see in this organisation as one file (JSON), which most systems and spreadsheets can read. Files you have uploaded are listed, not included; download those from where they are attached.</p>
        <button type="button" disabled={busy || progress !== null} onClick={() => void run(async () => {
          setProgress("Starting…");
          try {
            const r = await exportAll(organisationId, (d, t) => setProgress(`Reading ${d} of ${t}…`));
            const a = document.createElement("a");
            a.href = URL.createObjectURL(r.blob);
            a.download = `veraphius-export-${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 10000);
          } finally {
            setProgress(null);
          }
        }, "Exported. Check your downloads.")}>{progress ?? "Export everything"}</button>
      </section>

      {!records ? (
        <p className="muted">Legal holds, deletion requests and how long records are kept are visible to owners, administrators, the company secretary, legal and compliance.</p>
      ) : data && (
        <>
          <section className="block">
            <h2>Legal holds</h2>
            <p className="small muted">While a hold is active, nothing it covers can be deleted. Holds on a single meeting or record are placed from that record.</p>
            {data.holds === null ? <p className="muted">Could not load holds.</p> : data.holds.length === 0 ? <p className="muted">No holds.</p> : (
              <ul className="entity-list">
                {data.holds.map((h) => (
                  <li key={h.id} className="member-row">
                    <span>
                      <span className="entity-name">{h.name}</span>{h.matter_reference && <span className="muted"> · {h.matter_reference}</span>}
                      <br />
                      <span className="small muted">
                        {(h.scopes ?? []).some((x) => x.scope_type === "organisation") ? "Everything in the organisation" : `${(h.scopes ?? []).length} record${(h.scopes ?? []).length === 1 ? "" : "s"}`} · placed {formatDay(h.placed_at)}
                        {h.status === "released" ? ` · released ${h.released_at ? formatDay(h.released_at) : ""}` : ""}
                      </span>
                    </span>
                    <span className="row">
                      <span className={h.status === "active" ? "chip warning-text" : "chip"}>{h.status === "active" ? "Active" : "Released"}</span>
                      {canHold && h.status === "active" && (
                        <button type="button" className="link-dark" disabled={busy} onClick={() => {
                          if (window.confirm(`Release the hold "${h.name}"? Records it covers can then be deleted under your retention rules.`)) void run(async () => {
                            await releaseHold(h.id);
                            await reload();
                          }, "Hold released.");
                        }}>Release</button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {canHold && (showHold ? (
              <form className="card form" onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  await placeOrgHold(organisationId, hold.name, hold.matter, hold.reason);
                  setHold({ name: "", matter: "", reason: "" });
                  setShowHold(false);
                  await reload();
                }, "Hold placed. Nothing in the organisation can now be deleted until it is released.");
              }}>
                <h3>Hold everything</h3>
                <label htmlFor="hold-name">Name</label>
                <input id="hold-name" required value={hold.name} onChange={(e) => setHold({ ...hold, name: e.target.value })} placeholder="For example: Supplier dispute 2026" />
                <label htmlFor="hold-matter">Matter reference (optional)</label>
                <input id="hold-matter" value={hold.matter} onChange={(e) => setHold({ ...hold, matter: e.target.value })} />
                <label htmlFor="hold-reason">Why (optional)</label>
                <textarea id="hold-reason" rows={2} value={hold.reason} onChange={(e) => setHold({ ...hold, reason: e.target.value })} />
                <div className="row"><button type="submit" disabled={busy}>Place hold</button><button type="button" className="link-dark" onClick={() => setShowHold(false)}>Cancel</button></div>
              </form>
            ) : (
              <button type="button" className="quiet" onClick={() => setShowHold(true)}>Hold everything…</button>
            ))}
          </section>

          <section className="block">
            <h2>Deletion requests</h2>
            {data.requests === null ? <p className="muted">Could not load requests.</p> : data.requests.length === 0 ? <p className="muted">None. Requests to delete records (for example meeting recordings) appear here.</p> : (
              <div className="table-scroll"><table className="report-table wide">
                <thead><tr><th>Requested</th><th>What</th><th>Status</th></tr></thead>
                <tbody>
                  {data.requests.map((r) => (
                    <tr key={r.id}><td>{formatDay(r.requested_at)}</td><td>{(r.scope ?? r.subject_table).replace(/_/g, " ")}{r.reason ? ` · ${r.reason}` : ""}</td>
                      <td>{({ pending: "Waiting for approval", approved: "Approved", rejected: "Declined", completed: "Deleted", blocked_by_hold: "Blocked by a legal hold" } as Record<string, string>)[r.status] ?? r.status}</td></tr>
                  ))}
                </tbody>
              </table></div>
            )}
          </section>

          <section className="block">
            <h2>How long records are kept</h2>
            {data.retention === null ? <p className="muted">Could not load.</p> : data.retention.length === 0 ? <p className="muted">No rules yet. Without a rule, records are kept until someone deletes them.</p> : (
              <div className="table-scroll"><table className="report-table wide">
                <thead><tr><th>Rule</th><th>Applies to</th><th>Keep for</th><th>Deleting needs approval</th></tr></thead>
                <tbody>
                  {data.retention.map((r) => (
                    <tr key={r.id}><td>{r.name}</td><td>{r.applies_to.replace(/_/g, " ")}</td><td>{r.retain_days === null ? "Permanently" : `${Math.round(r.retain_days / 365.25 * 10) / 10} years`}</td><td>{r.requires_approval ? "Yes" : "No"}</td></tr>
                  ))}
                </tbody>
              </table></div>
            )}
            <form className="card form" onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await saveRetention(organisationId, { name: ret.name, applies_to: ret.applies_to, retain_days: ret.years === "" ? null : Math.round(Number(ret.years) * 365.25), requires_approval: ret.approval });
                setRet({ name: "", applies_to: "", years: "", approval: true });
                await reload();
              }, "Rule added.");
            }}>
              <h3>Add a rule</h3>
              <div className="row wrap">
                <span className="field grow"><label htmlFor="ret-name">Name</label><input id="ret-name" required value={ret.name} onChange={(e) => setRet({ ...ret, name: e.target.value })} placeholder="Board papers" /></span>
                <span className="field grow"><label htmlFor="ret-to">Applies to</label><input id="ret-to" required value={ret.applies_to} onChange={(e) => setRet({ ...ret, applies_to: e.target.value })} placeholder="minutes" /></span>
                <span className="field"><label htmlFor="ret-years">Years (empty = permanently)</label><input id="ret-years" type="number" min={0} step={0.5} value={ret.years} onChange={(e) => setRet({ ...ret, years: e.target.value })} /></span>
              </div>
              <label className="check"><input type="checkbox" checked={ret.approval} onChange={(e) => setRet({ ...ret, approval: e.target.checked })} /> Deleting needs approval</label>
              <button type="submit" disabled={busy}>Add rule</button>
              <p className="small muted">Minute books must be kept for the life of the company, and financial records for 7 years (Corporations Act ss 251A and 286). Check before shortening.</p>
            </form>
          </section>
        </>
      )}
    </>
  );
}

export const storageText = (u: Usage | null) => (u ? `${u.files} file${u.files === 1 ? "" : "s"}, ${bytes(u.storage_bytes)}` : "");

// ---------------------------------------------------------------------
// Site access log (site operators only, migration 0066)
// ---------------------------------------------------------------------
type Visit = { session_id: string; email: string; full_name: string; organisation: string | null; started_at: string; last_seen_at: string; active_seconds: number; user_agent: string | null };
const minutes = (sec: number) => (sec < 60 ? "under a minute" : sec < 3600 ? `${Math.round(sec / 60)} min` : `${Math.floor(sec / 3600)} h ${Math.round((sec % 3600) / 60)} min`);
const when = (iso: string) => new Date(iso).toLocaleString("en-AU", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export function SiteAccessLog() {
  const [days, setDays] = useState(30);
  const [visits, setVisits] = useState<Visit[] | null | undefined>(undefined);
  const [person, setPerson] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    setVisits(undefined);
    if (!supabase) return;
    void supabase.rpc("site_access_log", { p_days: days }).then(({ data, error }) => {
      if (error) {
        setProblem(/Could not find the function|schema cache/.test(error.message) ? "This needs database update 0066." : error.message);
        setVisits(null);
      } else setVisits((data ?? []) as Visit[]);
    });
  }, [days]);
  const people = visits ? [...new Map(visits.map((v) => [v.email, v])).values()] : [];
  const summary = people
    .map((p) => {
      const mine = (visits ?? []).filter((v) => v.email === p.email);
      return { email: p.email, name: p.full_name, visits: mine.length, active: mine.reduce((n, v) => n + v.active_seconds, 0), last: mine[0]?.last_seen_at ?? p.last_seen_at };
    })
    .sort((a, b) => b.last.localeCompare(a.last));
  const shown = (visits ?? []).filter((v) => !person || v.email === person);
  return (
    <>
      <Head title="Site access log" lead="Who has used VeraPhius, when, and for how long. Visible only to the site operator." />
      {problem && <p className="error" role="alert">{problem}</p>}
      <p className="row wrap">
        <label htmlFor="sal-days">Show the last</label>
        <select id="sal-days" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {[7, 30, 90, 180].map((d) => <option key={d} value={d}>{d} days</option>)}
        </select>
        <span className="small muted">Active time counts only while the page is in front of them and they've used it in the last 5 minutes. Visits are kept for 180 days.</span>
      </p>
      {visits === undefined ? <p className="muted">Loading…</p> : visits === null ? null : visits.length === 0 ? <p className="muted">No visits in this period.</p> : (
        <>
          <section className="block">
            <h2>By person</h2>
            <div className="table-scroll">
              <table className="report-table wide">
                <thead><tr><th>Person</th><th>Visits</th><th>Active time</th><th>Last seen</th><th></th></tr></thead>
                <tbody>
                  {summary.map((p) => (
                    <tr key={p.email}>
                      <td>{p.name}{p.name !== p.email ? <span className="muted small"> · {p.email}</span> : null}</td>
                      <td>{p.visits}</td><td>{minutes(p.active)}</td><td>{when(p.last)}</td>
                      <td><button type="button" className="link-dark" onClick={() => setPerson(person === p.email ? "" : p.email)}>{person === p.email ? "Show everyone" : "Visits"}</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="block">
            <h2>Visits{person ? `: ${summary.find((p) => p.email === person)?.name ?? person}` : ""}</h2>
            <div className="table-scroll">
              <table className="report-table wide">
                <thead><tr><th>Started</th><th>Person</th><th>Organisation</th><th>Active time</th><th>Last active</th><th>Device</th></tr></thead>
                <tbody>
                  {shown.map((v) => (
                    <tr key={v.session_id}>
                      <td>{when(v.started_at)}</td><td>{v.full_name}</td><td>{v.organisation ?? <span className="muted">None open</span>}</td>
                      <td>{minutes(v.active_seconds)}</td><td>{when(v.last_seen_at)}</td><td>{describeAgent(v.user_agent)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
      <p className="small muted">Tell people their use is logged: the privacy notice and terms of use should mention it.</p>
    </>
  );
}
