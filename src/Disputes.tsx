import { useCallback, useEffect, useState } from "react";
import { formatDay } from "./board";
import {
  blankDispute,
  closeDispute,
  EMPLOYEE_CLAIMS,
  loadDisputes,
  loadMembers,
  money,
  PROSPECTS,
  reopenDispute,
  saveDispute,
  type Dispute,
  type DisputeKind,
  type DisputeValues,
  type Member,
} from "./registers";
import type { GroupData } from "./types";

type Props = { organisationId: string; group: GroupData | null; canEdit: boolean; employeeOnly?: boolean };
const KINDS: { id: DisputeKind; label: string }[] = [
  { id: "litigation", label: "Material Litigation" },
  { id: "complaint", label: "Material Customer Complaints" },
  { id: "employee", label: "Employee Disputes" },
];
const today = () => new Date().toLocaleDateString("en-CA");

function DisputeForm({ kind, initial, group, members, busy, onSave, onCancel }: {
  kind: DisputeKind; initial: DisputeValues; group: GroupData | null; members: Member[]; busy: boolean; onSave: (v: DisputeValues) => void; onCancel: () => void;
}) {
  const [v, setV] = useState(initial);
  const set = (patch: Partial<DisputeValues>) => setV({ ...v, ...patch });
  const amount = (s: string) => (s.trim() === "" ? null : Number(s.replace(/[,\s$]/g, "")));
  const ok = v.title.trim().length >= 3 && v.particulars.trim().length >= 10;
  const party = kind === "litigation" ? "Other party" : kind === "complaint" ? "Customer" : "Employee";
  return (
    <div className="card form">
      {kind === "litigation" && (
        <fieldset className="plain-fieldset">
          <legend>Brought by</legend>
          <div className="row">
            <label className="check"><input type="radio" name="dp-dir" checked={v.direction === "by_us"} onChange={() => set({ direction: "by_us" })} /> Us (for)</label>
            <label className="check"><input type="radio" name="dp-dir" checked={v.direction === "against_us"} onChange={() => set({ direction: "against_us" })} /> The other party (against us)</label>
          </div>
        </fieldset>
      )}
      {kind === "employee" && (
        <fieldset className="plain-fieldset">
          <legend>Stage</legend>
          <div className="row">
            <label className="check"><input type="radio" name="dp-stage" checked={v.stage === "active"} onChange={() => set({ stage: "active" })} /> Active (a claim or proceeding is on foot)</label>
            <label className="check"><input type="radio" name="dp-stage" checked={v.stage === "potential"} onChange={() => set({ stage: "potential" })} /> Potential (threatened or likely)</label>
          </div>
        </fieldset>
      )}
      <label htmlFor="dp-title">{kind === "litigation" ? "Matter name" : kind === "complaint" ? "Complaint" : "Matter"}</label>
      <input id="dp-title" placeholder={kind === "litigation" ? "e.g. Acme Pty Ltd v ParentCo Holdings Ltd" : ""} value={v.title} onChange={(e) => set({ title: e.target.value })} />
      <div className="row wrap">
        <span className="field">
          <label htmlFor="dp-party">{party}</label>
          <input id="dp-party" value={v.other_party ?? ""} onChange={(e) => set({ other_party: e.target.value })} />
        </span>
        {kind === "employee" ? (
          <span className="field">
            <label htmlFor="dp-type">Type of claim</label>
            <select id="dp-type" value={v.claim_type ?? ""} onChange={(e) => set({ claim_type: e.target.value || null })}>
              <option value="">Not recorded</option>
              {EMPLOYEE_CLAIMS.map((c) => <option key={c}>{c}</option>)}
            </select>
          </span>
        ) : (
          <span className="field">
            <label htmlFor="dp-type">{kind === "litigation" ? "Cause of action" : "Product or service"}</label>
            <input id="dp-type" value={v.claim_type ?? ""} onChange={(e) => set({ claim_type: e.target.value })} />
          </span>
        )}
        <span className="field">
          <label htmlFor="dp-entity">Company</label>
          <select id="dp-entity" value={v.entity_id ?? ""} onChange={(e) => set({ entity_id: e.target.value || null })}>
            <option value="">The group</option>
            {group?.entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </span>
      </div>
      <div className="row wrap">
        <span className="field">
          <label htmlFor="dp-forum">{kind === "complaint" ? "Received through" : "Court, tribunal or body"}</label>
          <input id="dp-forum" placeholder={kind === "employee" ? "e.g. Fair Work Commission" : kind === "complaint" ? "e.g. customer service, retailer" : "e.g. Federal Court"} value={v.forum ?? ""} onChange={(e) => set({ forum: e.target.value })} />
        </span>
        <span className="field">
          <label htmlFor="dp-ref">Reference</label>
          <input id="dp-ref" value={v.reference ?? ""} onChange={(e) => set({ reference: e.target.value })} />
        </span>
        <span className="field">
          <label htmlFor="dp-opened">{kind === "complaint" ? "Received on" : "Started on"}</label>
          <input id="dp-opened" type="date" value={v.opened_on ?? ""} onChange={(e) => set({ opened_on: e.target.value })} />
        </span>
      </div>
      <label htmlFor="dp-particulars">Particulars</label>
      <textarea id="dp-particulars" rows={4} placeholder="What is alleged or complained of, the relief sought, and where it stands" value={v.particulars} onChange={(e) => set({ particulars: e.target.value })} />
      <div className="row wrap">
        <span className="field">
          <label htmlFor="dp-claimed">Amount claimed</label>
          <input id="dp-claimed" inputMode="decimal" defaultValue={v.amount_claimed ?? ""} onChange={(e) => set({ amount_claimed: amount(e.target.value) })} />
        </span>
        <span className="field">
          <label htmlFor="dp-exposure">Estimated exposure</label>
          <input id="dp-exposure" inputMode="decimal" defaultValue={v.exposure_estimate ?? ""} onChange={(e) => set({ exposure_estimate: amount(e.target.value) })} />
        </span>
        <span className="field">
          <label htmlFor="dp-currency">Currency</label>
          <input id="dp-currency" className="short" maxLength={3} value={v.currency} onChange={(e) => set({ currency: e.target.value.toUpperCase() })} />
        </span>
        {kind !== "complaint" && (
          <span className="field">
            <label htmlFor="dp-prospects">Our prospects</label>
            <select id="dp-prospects" value={v.prospects} onChange={(e) => set({ prospects: e.target.value as Dispute["prospects"] })}>
              {Object.entries(PROSPECTS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </span>
        )}
      </div>
      <div className="row wrap">
        {kind === "complaint" && (
          <span className="field">
            <label htmlFor="dp-regulator">Regulator involved</label>
            <input id="dp-regulator" placeholder="e.g. ACCC, TGA, ombudsman" value={v.regulator_involved ?? ""} onChange={(e) => set({ regulator_involved: e.target.value })} />
          </span>
        )}
        <span className="field">
          <label htmlFor="dp-advisers">External advisers</label>
          <input id="dp-advisers" value={v.external_advisers ?? ""} onChange={(e) => set({ external_advisers: e.target.value })} />
        </span>
        <span className="field">
          <label htmlFor="dp-owner">Handled by</label>
          <select id="dp-owner" value={v.owner_user_id ?? ""} onChange={(e) => set({ owner_user_id: e.target.value || null })}>
            <option value="">Not assigned</option>
            {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.full_name}</option>)}
          </select>
        </span>
      </div>
      <div className="row wrap">
        <span className="field grow">
          <label htmlFor="dp-next">Next step</label>
          <input id="dp-next" value={v.next_step ?? ""} onChange={(e) => set({ next_step: e.target.value })} />
        </span>
        <span className="field">
          <label htmlFor="dp-next-date">By</label>
          <input id="dp-next-date" type="date" value={v.next_date ?? ""} onChange={(e) => set({ next_date: e.target.value })} />
        </span>
      </div>
      <div className="row">
        <button type="button" disabled={busy || !ok} onClick={() => onSave(v)}>Save</button>
        <button type="button" className="link-dark" onClick={onCancel}>Cancel</button>
      </div>
      {!ok && <p className="muted small">A name and the particulars are needed.</p>}
    </div>
  );
}

export default function Disputes({ organisationId, group, canEdit, employeeOnly = false }: Props) {
  const [rows, setRows] = useState<Dispute[] | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [ready, setReady] = useState(true);
  const [kind, setKind] = useState<DisputeKind>(employeeOnly ? "employee" : "litigation");
  const [editing, setEditing] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [r, m] = await Promise.all([loadDisputes(organisationId), loadMembers(organisationId)]);
    setReady(r.ready);
    setRows(r.rows);
    setMembers(m);
  }, [organisationId]);
  useEffect(() => {
    reload().catch((e) => setError(e instanceof Error ? e.message : "Could not load disputes."));
  }, [reload]);

  async function run(action: () => Promise<void>, done: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      await reload();
      setEditing(null);
      setNotice(done);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  if (!rows) return error ? <p className="error">{error}</p> : <p className="lead">Loading…</p>;
  const entityName = (id: string | null) => (id ? group?.entities.find((e) => e.id === id)?.name ?? "" : "");
  const memberName = (id: string | null) => (id ? members.find((m) => m.user_id === id)?.full_name ?? "A member" : null);
  const ofKind = rows.filter((d) => d.kind === kind && (showClosed || d.status === "open"));
  const openCount = (k: DisputeKind) => rows.filter((d) => d.kind === k && d.status === "open").length;
  const groups: { label: string; rows: Dispute[]; empty: string }[] =
    kind === "litigation"
      ? [
          { label: "Against us", rows: ofKind.filter((d) => d.direction === "against_us"), empty: "No litigation against us." },
          { label: "Brought by us (for)", rows: ofKind.filter((d) => d.direction === "by_us"), empty: "No litigation brought by us." },
        ]
      : kind === "employee"
        ? [
            { label: "Active", rows: ofKind.filter((d) => d.stage === "active"), empty: "No active employee disputes." },
            { label: "Potential", rows: ofKind.filter((d) => d.stage === "potential"), empty: "No potential employee disputes." },
          ]
        : [{ label: "", rows: ofKind, empty: "No material customer complaints." }];
  const totals = (list: Dispute[]) => {
    const open = list.filter((d) => d.status === "open");
    const cur = [...new Set(open.map((d) => d.currency))];
    if (cur.length !== 1) return null;
    const exposure = open.reduce((s, d) => s + (d.exposure_estimate ?? 0), 0);
    const unknown = open.filter((d) => d.exposure_estimate === null).length;
    if (unknown === open.length) return "Exposure not estimated";
    return `${money(exposure, cur[0])} estimated exposure${unknown ? `, ${unknown} not estimated` : ""}`;
  };

  return (
    <>
      {!employeeOnly && (
        <>
          <p className="eyebrow">Third parties</p>
          <h1>Disputes</h1>
          <p className="lead">Open disputes go into the next risk review: litigation under Legal and Compliance, and customer complaints under Commercial. Employee disputes are under Company, Employees.</p>
        </>
      )}
      {!ready && <p className="card warning">Run migration 0037 to turn on Disputes.</p>}
      {employeeOnly ? (
        <p className="lead">Active and potential disputes with employees. Open ones go into the next risk review under People, without the employee's name.</p>
      ) : (
      <span className="segmented block-gap" role="group" aria-label="Kinds of dispute">
        {KINDS.filter((k) => k.id !== "employee").map((k) => (
          <button key={k.id} type="button" className={kind === k.id ? "on" : undefined} aria-pressed={kind === k.id} onClick={() => { setKind(k.id); setEditing(null); setNotice(null); }}>
            {k.label}{openCount(k.id) ? ` (${openCount(k.id)})` : ""}
          </button>
        ))}
      </span>
      )}
      {kind === "employee" && <p className="muted">Employee disputes are visible only to the owner, administrators, the company secretary, legal and compliance, and the person handling each one.</p>}
      {notice && <p className="card note" role="status">{notice}</p>}
      {error && <p className="error block" role="alert">{error}</p>}

      {ready &&
        groups.map((g) => (
          <section key={g.label || "all"} className="block">
            {g.label && (
              <div className="row spread">
                <h2>{g.label}</h2>
                {g.rows.length > 0 && kind !== "complaint" && <span className="muted small">{totals(g.rows)}</span>}
              </div>
            )}
            {g.rows.length === 0 && <p className="muted">{g.empty}</p>}
            {g.rows.map((d) =>
              editing === d.id ? (
                <DisputeForm key={d.id} kind={d.kind} initial={d} group={group} members={members} busy={busy} onSave={(v) => void run(() => saveDispute(organisationId, d.kind, d.id, v), "Saved.")} onCancel={() => setEditing(null)} />
              ) : (
                <div key={d.id} className={d.status === "closed" ? "card key-card muted" : "card key-card"}>
                  <div className="row spread">
                    <h3>
                      {d.title}
                      {d.other_party && d.kind !== "litigation" ? <span className="muted"> · {d.other_party}</span> : null}
                    </h3>
                    {d.status === "closed" ? <span className="chip">Closed {d.closed_on ? formatDay(d.closed_on) : ""}</span> : d.next_date && d.next_date < today() ? <span className="chip chip-alert">Next step overdue</span> : <span className="chip">Open</span>}
                  </div>
                  <p className="muted small">{[d.kind === "litigation" ? d.other_party && `Other party: ${d.other_party}` : null, d.claim_type, d.forum, d.reference, entityName(d.entity_id), d.opened_on ? `since ${formatDay(d.opened_on)}` : null].filter(Boolean).join(" · ")}</p>
                  <p className="pre-line">{d.particulars}</p>
                  <dl className="detail-list compact key-facts">
                    {d.amount_claimed !== null && <div><dt>Claimed</dt><dd>{money(d.amount_claimed, d.currency)}</dd></div>}
                    {d.kind !== "complaint" && <div><dt>Estimated exposure</dt><dd className={d.exposure_estimate === null ? "warning-text" : undefined}>{d.exposure_estimate === null ? "Not estimated" : money(d.exposure_estimate, d.currency)}</dd></div>}
                    {d.kind !== "complaint" && <div><dt>Prospects</dt><dd className={d.prospects === "unknown" ? "warning-text" : undefined}>{PROSPECTS[d.prospects]}</dd></div>}
                    {d.kind === "complaint" && <div><dt>Regulator</dt><dd>{d.regulator_involved ?? <span className="muted">None recorded</span>}</dd></div>}
                    <div><dt>Handled by</dt><dd>{memberName(d.owner_user_id) ?? <span className="warning-text">Not assigned</span>}</dd></div>
                    {d.external_advisers && <div><dt>Advisers</dt><dd>{d.external_advisers}</dd></div>}
                  </dl>
                  {d.status === "open" ? (
                    <p className="small"><strong>Next step:</strong> {d.next_step ?? <span className="warning-text">None recorded</span>}{d.next_date ? ` by ${formatDay(d.next_date)}` : ""}</p>
                  ) : (
                    <p className="small"><strong>Outcome:</strong> {d.outcome}</p>
                  )}
                  {canEdit && (
                    <div className="row">
                      {d.status === "open" ? (
                        <>
                          <button type="button" className="link-dark" onClick={() => setEditing(d.id)}>Edit</button>
                          {d.kind === "employee" && d.stage === "potential" && (
                            <button type="button" className="link-dark" disabled={busy} onClick={() => void run(() => saveDispute(organisationId, d.kind, d.id, { ...d, stage: "active" }), "Moved to active.")}>Now active</button>
                          )}
                          <button
                            type="button"
                            className="link-dark"
                            disabled={busy}
                            onClick={() => {
                              const outcome = window.prompt("How was it resolved? (for example settled, dismissed, withdrawn, judgment)");
                              if (outcome && outcome.trim().length >= 3) void run(() => closeDispute(d.id, outcome, today()), "Closed.");
                            }}
                          >
                            Close
                          </button>
                        </>
                      ) : (
                        <button type="button" className="link-dark" disabled={busy} onClick={() => void run(() => reopenDispute(d.id), "Reopened.")}>Reopen</button>
                      )}
                    </div>
                  )}
                </div>
              ),
            )}
          </section>
        ))}

      {ready && rows.some((d) => d.kind === kind && d.status === "closed") && (
        <label className="check block">
          <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> Show closed
        </label>
      )}
      {ready && canEdit && (editing === `new-${kind}` ? (
        <DisputeForm key={kind} kind={kind} initial={blankDispute(kind)} group={group} members={members} busy={busy} onSave={(v) => void run(() => saveDispute(organisationId, kind, null, v), "Added.")} onCancel={() => setEditing(null)} />
      ) : (
        <button type="button" onClick={() => setEditing(`new-${kind}`)}>
          {kind === "litigation" ? "Add litigation" : kind === "complaint" ? "Add a complaint" : "Add an employee dispute"}
        </button>
      ))}
    </>
  );
}
