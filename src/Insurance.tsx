import { useCallback, useEffect, useRef, useState } from "react";
import Attachments from "./Attachments";
import { loadMembers, type Member } from "./board";
import { extractFromText, pdfText, POLICY_TYPES, type Extracted } from "./cocExtract";
import {
  addPolicy,
  attachCertificate,
  day,
  loadInsurance,
  markReminderSent,
  money,
  monthsBefore,
  reminderDue,
  renewPolicy,
  setPersonEmail,
  setPolicyStatus,
  standing,
  updatePolicy,
  downloadCertificate,
  type Certificate,
  type Contact,
  type Policy,
  type PolicyValues,
} from "./insurance";
import { mailto } from "./risk";
import type { GroupData } from "./types";

type Props = { organisationId: string; organisationName: string; group: GroupData; canEdit: boolean; userId: string };

const CURRENCIES = ["AUD", "NZD", "USD", "GBP", "EUR", "SGD"];
const FIELD_NAMES: Record<keyof Extracted, string> = {
  policy_type: "type",
  insurer: "insurer",
  broker: "broker",
  policy_number: "policy number",
  insured_name: "insured",
  limit_amount: "limit",
  limit_basis: "limit basis",
  excess_amount: "excess",
  currency: "currency",
  period_from: "period start",
  period_to: "expiry date",
};

const blank = (): PolicyValues => ({
  entity_id: null,
  policy_type: "",
  insurer: "",
  broker: "",
  policy_number: "",
  insured_name: "",
  limit_amount: null,
  limit_basis: "",
  excess_amount: null,
  currency: "AUD",
  premium_amount: null,
  period_from: "",
  period_to: "",
  details: "",
  responsible_user_id: null,
});
const plusYear = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${y + 1}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
};

function Amount({ id, value, onChange }: { id: string; value: number | null; onChange: (v: number | null) => void }) {
  const [text, setText] = useState(value === null ? "" : String(value));
  return (
    <input
      id={id}
      inputMode="decimal"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const t = text.replace(/[$,\s]/g, "").toLowerCase();
        const n = t === "" ? null : Number(t.replace(/m$/, "")) * (t.endsWith("m") ? 1e6 : 1);
        onChange(n !== null && Number.isFinite(n) && n >= 0 ? n : null);
        setText(n !== null && Number.isFinite(n) && n >= 0 ? String(n) : "");
      }}
    />
  );
}

/** Adding or editing a policy. found lists what was read from a certificate, so the person knows what to check. */
function PolicyForm({
  initial,
  found,
  renewalOf,
  file,
  group,
  members,
  busy,
  onSave,
  onCancel,
}: {
  initial: PolicyValues;
  found: (keyof Extracted)[] | null;
  renewalOf: Policy | null;
  file: File | null;
  group: GroupData;
  members: Member[];
  busy: boolean;
  onSave: (v: PolicyValues, asRenewal: boolean) => void;
  onCancel: () => void;
}) {
  const [v, setV] = useState(initial);
  const [asRenewal, setAsRenewal] = useState(Boolean(renewalOf));
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<PolicyValues>) => setV({ ...v, ...patch });
  const mark = (k: keyof Extracted) => (found?.includes(k) ? "from-certificate" : undefined);
  return (
    <section className="card form insurance-form">
      <h2>{file ? `From the certificate: ${file.name}` : initial.policy_type ? "Change the policy" : "Add a policy"}</h2>
      {found && (
        <p className={found.length ? "card note" : "card warning"} role="status">
          {found.length
            ? `Read from the certificate: ${found.map((k) => FIELD_NAMES[k]).join(", ")}. These are highlighted. Check each against the certificate before saving; anything missing, fill in by hand.`
            : "No details could be read from this file (it may be a scanned image). Fill them in by hand; the certificate is still stored with the policy."}
        </p>
      )}
      {renewalOf && (
        <label className="check">
          <input type="checkbox" checked={asRenewal} onChange={(e) => setAsRenewal(e.target.checked)} /> This is the renewal of the current {renewalOf.policy_type} policy
          {renewalOf.policy_number ? ` (${renewalOf.policy_number})` : ""}, expiring {day(renewalOf.period_to)}
        </label>
      )}
      <label htmlFor="in-type">Type of insurance</label>
      <input id="in-type" className={mark("policy_type")} list="in-types" value={v.policy_type} onChange={(e) => set({ policy_type: e.target.value })} placeholder="e.g. Directors and officers liability" />
      <datalist id="in-types">
        {POLICY_TYPES.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      <label htmlFor="in-entity">Company insured</label>
      <select id="in-entity" value={v.entity_id ?? ""} onChange={(e) => set({ entity_id: e.target.value || null })}>
        <option value="">The whole group</option>
        {group.entities.map((e) => (
          <option key={e.id} value={e.id}>
            {e.name}
          </option>
        ))}
      </select>
      <div className="row">
        <span className="field">
          <label htmlFor="in-insurer">Insurer</label>
          <input id="in-insurer" className={mark("insurer")} value={v.insurer ?? ""} onChange={(e) => set({ insurer: e.target.value })} />
        </span>
        <span className="field">
          <label htmlFor="in-broker">Broker</label>
          <input id="in-broker" className={mark("broker")} value={v.broker ?? ""} onChange={(e) => set({ broker: e.target.value })} />
        </span>
        <span className="field">
          <label htmlFor="in-number">Policy number</label>
          <input id="in-number" className={mark("policy_number")} value={v.policy_number ?? ""} onChange={(e) => set({ policy_number: e.target.value })} />
        </span>
      </div>
      <label htmlFor="in-insured">Named insured (as on the certificate)</label>
      <input id="in-insured" className={mark("insured_name")} value={v.insured_name ?? ""} onChange={(e) => set({ insured_name: e.target.value })} />
      <div className="row">
        <span className={`field ${mark("limit_amount") ?? ""}`}>
          <label htmlFor="in-limit">Limit or sum insured</label>
          <Amount id="in-limit" value={v.limit_amount} onChange={(n) => set({ limit_amount: n })} />
        </span>
        <span className="field">
          <label htmlFor="in-basis">Basis</label>
          <input id="in-basis" className={mark("limit_basis")} placeholder="e.g. any one claim and in the aggregate" value={v.limit_basis ?? ""} onChange={(e) => set({ limit_basis: e.target.value })} />
        </span>
        <span className="field">
          <label htmlFor="in-currency">Currency</label>
          <select id="in-currency" className={mark("currency")} value={v.currency} onChange={(e) => set({ currency: e.target.value })}>
            {CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </span>
      </div>
      <div className="row">
        <span className={`field ${mark("excess_amount") ?? ""}`}>
          <label htmlFor="in-excess">Excess or deductible</label>
          <Amount id="in-excess" value={v.excess_amount} onChange={(n) => set({ excess_amount: n })} />
        </span>
        <span className="field">
          <label htmlFor="in-premium">Annual premium (optional)</label>
          <Amount id="in-premium" value={v.premium_amount} onChange={(n) => set({ premium_amount: n })} />
        </span>
      </div>
      <div className="row">
        <span className="field">
          <label htmlFor="in-from">Period from</label>
          <input id="in-from" className={mark("period_from")} type="date" value={v.period_from ?? ""} onChange={(e) => set({ period_from: e.target.value })} />
        </span>
        <span className="field">
          <label htmlFor="in-to">Period to (expiry)</label>
          <input id="in-to" className={mark("period_to")} type="date" value={v.period_to} onChange={(e) => set({ period_to: e.target.value })} />
        </span>
      </div>
      <label htmlFor="in-details">Details of cover (optional)</label>
      <textarea id="in-details" rows={3} placeholder="What is covered, key exclusions, extensions, sub-limits" value={v.details ?? ""} onChange={(e) => set({ details: e.target.value })} />
      <label htmlFor="in-owner">Responsible for renewal</label>
      <select id="in-owner" value={v.responsible_user_id ?? ""} onChange={(e) => set({ responsible_user_id: e.target.value || null })}>
        <option value="">The directors collectively</option>
        {members
          .filter((m) => m.is_active)
          .map((m) => (
            <option key={m.user_id} value={m.user_id}>
              {m.name}
            </option>
          ))}
      </select>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="row">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (v.policy_type.trim().length < 2) return setError("Say what type of insurance this is.");
            if (!v.period_to) return setError("Enter the expiry date (the end of the period of insurance).");
            if (v.period_from && v.period_from >= v.period_to) return setError("The period must end after it starts.");
            setError(null);
            onSave(v, asRenewal);
          }}
        >
          {busy ? "Saving…" : asRenewal ? "Save as the renewal" : "Save"}
        </button>
        <button type="button" className="quiet" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </section>
  );
}

export default function Insurance({ organisationId, organisationName, group, canEdit, userId }: Props) {
  const [policies, setPolicies] = useState<Policy[] | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [form, setForm] = useState<{ id: string | null; initial: PolicyValues; found: (keyof Extracted)[] | null; file: File | null; renewalOf: Policy | null } | null>(null);
  const [renewing, setRenewing] = useState<{ id: string; from: string; to: string } | null>(null);
  const [emailDraft, setEmailDraft] = useState<Record<string, string>>({});
  const fileInput = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    try {
      const [d, m] = await Promise.all([loadInsurance(organisationId), loadMembers(organisationId).catch(() => [])]);
      setPolicies(d.policies);
      setContacts(d.contacts);
      setCertificates(d.certificates);
      setMembers(m);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the insurance register.");
    }
  }, [organisationId]);
  useEffect(() => {
    void reload();
  }, [reload]);

  const run = async (work: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await work();
      await reload();
      if (done) setNotice(done);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (!policies) return error ? <p className="error">{error}</p> : <p className="lead">Loading…</p>;

  const entityName = (id: string | null) => (id ? group.entities.find((e) => e.id === id)?.name ?? "A company" : "The whole group");
  const memberName = (id: string) => members.find((m) => m.user_id === id)?.name ?? "A member";
  /** Who a reminder goes to: the named person, or every current director of the insured company (all companies for a group policy) */
  const recipients = (p: Policy) => {
    if (p.responsible_user_id) {
      const name = memberName(p.responsible_user_id);
      return { label: name, emails: /.+@.+\..+/.test(name) ? [name] : [], missing: [] as Contact[] };
    }
    const ids = [...new Set(group.officeholdings.filter((o) => !o.ceased_on && ["director", "chair"].includes(o.role) && (!p.entity_id || o.entity_id === p.entity_id)).map((o) => o.person.id))];
    const people = ids.map((id) => contacts.find((c) => c.id === id) ?? { id, full_name: group.officeholdings.find((o) => o.person.id === id)!.person.full_name, email: null });
    return { label: people.length ? `The directors: ${people.map((x) => x.full_name).join(", ")}` : "The directors (none recorded)", emails: people.flatMap((x) => (x.email ? [x.email] : [])), missing: people.filter((x) => !x.email) };
  };
  const responsibleLabel = (p: Policy) => (p.responsible_user_id ? memberName(p.responsible_user_id) : "The directors collectively");
  const isResponsible = (p: Policy) => p.responsible_user_id === userId;

  const current = policies.filter((p) => p.status === "current").sort((a, b) => a.period_to.localeCompare(b.period_to));
  const past = policies.filter((p) => p.status !== "current").sort((a, b) => b.period_to.localeCompare(a.period_to));
  const due = current.filter((p) => reminderDue(p) && (canEdit || isResponsible(p)));
  const expired = current.filter((p) => standing(p) === "expired");

  async function read(file: File) {
    setError(null);
    setNotice(null);
    if (file.size > 10 * 1024 * 1024) return setError("Files can be up to 10 MB.");
    setReading(true);
    let found: (keyof Extracted)[] = [];
    const values = blank();
    try {
      const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
      const text = isPdf ? await pdfText(file) : "";
      if (text.trim()) {
        const x = extractFromText(text);
        found = (Object.keys(x) as (keyof Extracted)[]).filter((k) => x[k] !== null);
        Object.assign(values, Object.fromEntries(Object.entries(x).filter(([, val]) => val !== null)));
        // The insured name on the certificate often matches a company in the group
        const match = x.insured_name ? group.entities.find((e) => x.insured_name!.toLowerCase().startsWith(e.name.toLowerCase())) : undefined;
        if (match && !/subsidiar|group|related/i.test(x.insured_name!)) values.entity_id = match.id;
      }
    } catch {
      found = [];
    } finally {
      setReading(false);
    }
    // Is this the renewal of a policy already on the register?
    const renewalOf =
      current.find(
        (p) =>
          values.period_to &&
          values.period_to > p.period_to &&
          ((values.policy_number && p.policy_number && values.policy_number.replace(/\W/g, "") === p.policy_number.replace(/\W/g, "")) ||
            (values.policy_type && p.policy_type === values.policy_type && (p.entity_id ?? "") === (values.entity_id ?? ""))),
      ) ?? null;
    if (renewalOf) values.responsible_user_id = renewalOf.responsible_user_id;
    setForm({ id: null, initial: values, found, file, renewalOf });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const save = (v: PolicyValues, asRenewal: boolean) => {
    if (!form) return;
    const { id, file, renewalOf } = form;
    void run(async () => {
      let target = id;
      if (asRenewal && renewalOf) {
        target = await renewPolicy(renewalOf.id, v.period_from || null, v.period_to);
        await updatePolicy(target, v);
      } else if (target) await updatePolicy(target, v);
      else target = await addPolicy(organisationId, v);
      if (file) await attachCertificate(target, file);
    }, asRenewal ? "Renewal recorded. The previous term is kept in the history, and reminders start again for the new expiry date." : "Saved.").then((ok) => ok && setForm(null));
  };

  const chip = (p: Policy) => {
    const s = standing(p);
    if (p.status !== "current") return <span className="chip">{p.status === "renewed" ? "Renewed" : p.status === "lapsed" ? "Lapsed" : "Cancelled"}</span>;
    if (s === "expired") return <span className="chip chip-alert">Expired {day(p.period_to)}</span>;
    if (s === "due") return <span className="chip chip-alert">Expires {day(p.period_to)}</span>;
    if (s === "soon") return <span className="chip chip-warn">Expires {day(p.period_to)}</span>;
    return <span className="chip">Current to {day(p.period_to)}</span>;
  };

  const card = (p: Policy) => {
    const cert = certificates.find((c) => c.policy_id === p.id);
    return (
    <section key={p.id} className="card insurance">
      <div className="row spread">
        <h3>{p.policy_type}</h3>
        <span className="row">
          {cert ? (
            <button type="button" className="quiet small" title={cert.file_name} onClick={() => void downloadCertificate(cert).catch((e) => setError(e instanceof Error ? e.message : "Could not download."))}>
              ⤓ Certificate of currency
            </button>
          ) : (
            p.status === "current" && <span className="chip chip-warn">No certificate on file</span>
          )}
          {chip(p)}
        </span>
      </div>
      <dl className="detail-list compact">
        <div>
          <dt>Insured</dt>
          <dd>
            {entityName(p.entity_id)}
            {p.insured_name && p.insured_name.toLowerCase() !== entityName(p.entity_id).toLowerCase() ? <span className="muted"> ({p.insured_name})</span> : null}
          </dd>
        </div>
        <div>
          <dt>Insurer</dt>
          <dd className={p.insurer ? undefined : "muted"}>
            {p.insurer ?? "Not recorded"}
            {p.policy_number ? <span className="muted">, policy {p.policy_number}</span> : null}
            {p.broker ? <span className="muted">, through {p.broker}</span> : null}
          </dd>
        </div>
        <div>
          <dt>Limit</dt>
          <dd className={p.limit_amount !== null ? undefined : "muted"}>
            {p.limit_amount !== null ? money(p.limit_amount, p.currency) : "Not recorded"}
            {p.limit_basis ? <span className="muted"> {p.limit_basis}</span> : null}
            {p.excess_amount !== null ? <span className="muted">; excess {money(p.excess_amount, p.currency)}</span> : null}
          </dd>
        </div>
        <div>
          <dt>Period</dt>
          <dd>
            {p.period_from ? `${day(p.period_from)} to ` : "To "}
            {day(p.period_to)}
          </dd>
        </div>
        {p.premium_amount !== null && (
          <div>
            <dt>Premium</dt>
            <dd>{money(p.premium_amount, p.currency)}</dd>
          </div>
        )}
        {p.details && (
          <div>
            <dt>Details</dt>
            <dd className="pre-wrap">{p.details}</dd>
          </div>
        )}
        <div>
          <dt>Responsible</dt>
          <dd>{responsibleLabel(p)}</dd>
        </div>
        {p.status === "current" && (
          <div>
            <dt>Reminders</dt>
            <dd className="muted">
              {[3, 2, 1]
                .map((m) => {
                  const sent = m === 3 ? p.reminder3_sent_at : m === 2 ? p.reminder2_sent_at : p.reminder1_sent_at;
                  return `${m} ${m === 1 ? "month" : "months"} (${day(monthsBefore(p.period_to, m))}): ${sent ? `sent ${day(sent.slice(0, 10))}` : "not yet"}`;
                })
                .join("; ")}
            </dd>
          </div>
        )}
      </dl>
      <Attachments subjectTable="insurance_policies" subjectId={p.id} canAttach={canEdit && p.status === "current"} label="All certificates and files" />
      {canEdit && p.status === "current" && (
        <div className="row">
          <button type="button" className="link-dark" onClick={() => { setForm({ id: p.id, initial: { ...p }, found: null, file: null, renewalOf: null }); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
            Change
          </button>
          <button type="button" className="link-dark" onClick={() => setRenewing({ id: p.id, from: p.period_to, to: plusYear(p.period_to) })}>
            Record the renewal
          </button>
          <button type="button" className="link-dark" disabled={busy} onClick={() => { if (window.confirm(`Mark the ${p.policy_type} policy as lapsed (not renewed)?`)) void run(() => setPolicyStatus(p.id, "lapsed")); }}>
            Mark as lapsed
          </button>
          <button type="button" className="link-dark" disabled={busy} onClick={() => { if (window.confirm(`Mark the ${p.policy_type} policy as cancelled?`)) void run(() => setPolicyStatus(p.id, "cancelled")); }}>
            Mark as cancelled
          </button>
        </div>
      )}
      {renewing?.id === p.id && (
        <div className="row review">
          <span className="field">
            <label htmlFor={`rn-from-${p.id}`}>New period from</label>
            <input id={`rn-from-${p.id}`} type="date" value={renewing.from} onChange={(e) => setRenewing({ ...renewing, from: e.target.value })} />
          </span>
          <span className="field">
            <label htmlFor={`rn-to-${p.id}`}>to</label>
            <input id={`rn-to-${p.id}`} type="date" value={renewing.to} onChange={(e) => setRenewing({ ...renewing, to: e.target.value })} />
          </span>
          <button type="button" disabled={busy || !renewing.to} onClick={() => void run(() => renewPolicy(p.id, renewing.from || null, renewing.to), "Renewal recorded. Drop the new certificate of currency on the renewed policy, and update any details that changed.").then((ok) => ok && setRenewing(null))}>
            Save renewal
          </button>
          <button type="button" className="quiet" onClick={() => setRenewing(null)}>
            Cancel
          </button>
        </div>
      )}
    </section>
    );
  };

  return (
    <>
      <p className="eyebrow">Board</p>
      <h1>Insurance</h1>
      <p className="lead">Every insurance policy across the group, with its certificate of currency. Reminders fall due three, two and one month before each policy expires.</p>
      {notice && (
        <p className="card note" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="error block" role="alert">
          {error}
        </p>
      )}

      {expired.length > 0 && (
        <section className="card warning">
          <h2>Expired</h2>
          <ul>
            {expired.map((p) => (
              <li key={p.id}>
                {p.policy_type} ({entityName(p.entity_id)}) expired on {day(p.period_to)}. Record the renewal, or mark it as lapsed.
              </li>
            ))}
          </ul>
        </section>
      )}

      {due.length > 0 && (
        <section className="block">
          <h2>Reminders to send</h2>
          <p className="muted">VeraPhius cannot send email yet, so each reminder opens in your own email. Mark it as sent once it has gone.</p>
          {due.map((p) => {
            const months = reminderDue(p)!;
            const r = recipients(p);
            const subject = `Insurance renewal: ${p.policy_type} expires ${day(p.period_to)}`;
            const body = `Dear ${p.responsible_user_id ? "colleague" : "Directors"},\n\nThe ${p.policy_type} policy for ${p.entity_id ? entityName(p.entity_id) : organisationName}${p.insurer ? ` with ${p.insurer}` : ""}${p.policy_number ? ` (policy ${p.policy_number})` : ""} expires on ${day(p.period_to)}, ${months === 1 ? "one month" : `${months} months`} from now.\n\n${p.limit_amount !== null ? `Current limit: ${money(p.limit_amount, p.currency)}${p.limit_basis ? ` ${p.limit_basis}` : ""}.\n\n` : ""}Please arrange the renewal with the broker${p.broker ? ` (${p.broker})` : ""}, and send the new certificate of currency once it is issued so it can be recorded in VeraPhius.\n\nKind regards`;
            return (
              <div key={p.id} className="card row spread">
                <span>
                  <strong>{p.policy_type}</strong>, {entityName(p.entity_id)}: {months === 1 ? "one month" : `${months} months`} before expiry ({day(p.period_to)})
                  <br />
                  <span className="muted">To: {r.label}</span>
                  {r.missing.map((x) => (
                    <span key={x.id} className="row">
                      <span className="warning-text small">No email for {x.full_name}</span>
                      {canEdit && (
                        <>
                          <input aria-label={`Email for ${x.full_name}`} type="email" placeholder="name@company.com" value={emailDraft[x.id] ?? ""} onChange={(e) => setEmailDraft({ ...emailDraft, [x.id]: e.target.value })} />
                          <button type="button" className="quiet" disabled={busy || !/.+@.+\..+/.test(emailDraft[x.id] ?? "")} onClick={() => void run(() => setPersonEmail(x.id, emailDraft[x.id]))}>
                            Save email
                          </button>
                        </>
                      )}
                    </span>
                  ))}
                </span>
                <span className="row">
                  {r.emails.length > 0 && (
                    <a className="link-dark" href={mailto(r.emails, subject, body)}>
                      Open email
                    </a>
                  )}
                  <button type="button" className="quiet" disabled={busy} onClick={() => void run(() => markReminderSent(p.id, months), "Recorded as sent.")}>
                    Mark as sent
                  </button>
                </span>
              </div>
            );
          })}
        </section>
      )}

      {canEdit && !form && (
        <section className="block">
          <div
            className={dragging ? "dropzone on" : "dropzone"}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const f = e.dataTransfer.files[0];
              if (f) void read(f);
            }}
          >
            <p>
              <strong>{reading ? "Reading the certificate…" : "Drop a certificate of currency here"}</strong>
            </p>
            <p className="muted">The key details are read from the PDF and shown for you to check before anything is saved. The certificate is stored with the policy.</p>
            <input ref={fileInput} id="coc-file" type="file" accept="application/pdf,image/*" className="visually-hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void read(f); e.target.value = ""; }} />
            <div className="row">
              <button type="button" className="quiet" disabled={reading} onClick={() => fileInput.current?.click()}>
                Choose a file
              </button>
              <button type="button" className="link-dark" onClick={() => setForm({ id: null, initial: blank(), found: null, file: null, renewalOf: null })}>
                Or add a policy by hand
              </button>
            </div>
          </div>
        </section>
      )}

      {form && (
        <PolicyForm
          key={`${form.id}-${form.file?.name ?? ""}`}
          initial={form.initial}
          found={form.found}
          renewalOf={form.renewalOf}
          file={form.file}
          group={group}
          members={members}
          busy={busy}
          onSave={save}
          onCancel={() => setForm(null)}
        />
      )}

      <section className="block">
        <h2>Current policies</h2>
        {current.length === 0 ? <p className="muted">No policies recorded yet. Unknown is not the same as uninsured: add each policy the group holds.</p> : current.map(card)}
      </section>

      {past.length > 0 && (
        <details className="block">
          <summary>
            <strong>Past terms ({past.length})</strong>
          </summary>
          {past.map(card)}
        </details>
      )}
    </>
  );
}
