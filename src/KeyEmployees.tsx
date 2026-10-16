import { useCallback, useEffect, useState } from "react";
import { formatDay } from "./board";
import {
  blankKeyEmployee,
  EMPLOYEE_STATUS,
  loadKeyEmployees,
  READINESS,
  saveKeyEmployee,
  successionGap,
  YES_NO,
  type KeyEmployee,
  type KeyEmployeeValues,
  type Readiness,
  type YesNo,
} from "./registers";
import type { GroupData } from "./types";

type Props = { organisationId: string; group: GroupData | null; canEdit: boolean; embedded?: boolean };
const today = () => new Date().toLocaleDateString("en-CA");

function EmployeeForm({ initial, group, busy, onSave, onCancel }: { initial: KeyEmployeeValues; group: GroupData | null; busy: boolean; onSave: (v: KeyEmployeeValues) => void; onCancel: () => void }) {
  const [v, setV] = useState(initial);
  const set = (patch: Partial<KeyEmployeeValues>) => setV({ ...v, ...patch });
  const ok = v.full_name.trim().length >= 2 && v.position_title.trim().length >= 2 && v.why_key.trim().length >= 5;
  return (
    <div className="card form">
      <div className="row wrap">
        <span className="field">
          <label htmlFor="ke-name">Name</label>
          <input id="ke-name" value={v.full_name} onChange={(e) => set({ full_name: e.target.value })} />
        </span>
        <span className="field">
          <label htmlFor="ke-position">Position</label>
          <input id="ke-position" value={v.position_title} onChange={(e) => set({ position_title: e.target.value })} />
        </span>
        <span className="field">
          <label htmlFor="ke-function">Function</label>
          <input id="ke-function" value={v.function_name ?? ""} onChange={(e) => set({ function_name: e.target.value })} />
        </span>
        <span className="field">
          <label htmlFor="ke-entity">Company</label>
          <select id="ke-entity" value={v.entity_id ?? ""} onChange={(e) => set({ entity_id: e.target.value || null })}>
            <option value="">The group</option>
            {group?.entities.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </span>
      </div>
      <label htmlFor="ke-why">Why they are key</label>
      <textarea id="ke-why" rows={2} placeholder="What the business depends on them for, and what would happen if they left" value={v.why_key} onChange={(e) => set({ why_key: e.target.value })} />
      <div className="row wrap">
        <span className="field">
          <label htmlFor="ke-status">Status</label>
          <select id="ke-status" value={v.status} onChange={(e) => set({ status: e.target.value as KeyEmployee["status"] })}>
            {Object.entries(EMPLOYEE_STATUS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </span>
        {v.status === "leaving" && (
          <span className="field">
            <label htmlFor="ke-leaving">Leaving on</label>
            <input id="ke-leaving" type="date" value={v.leaving_on ?? ""} onChange={(e) => set({ leaving_on: e.target.value })} />
          </span>
        )}
        <span className="field">
          <label htmlFor="ke-successor">Successor</label>
          <input id="ke-successor" placeholder="None identified" value={v.successor_name ?? ""} onChange={(e) => set({ successor_name: e.target.value })} />
        </span>
        <span className="field">
          <label htmlFor="ke-ready">Successor readiness</label>
          <select id="ke-ready" value={v.succession_readiness ?? ""} onChange={(e) => set({ succession_readiness: (e.target.value || null) as Readiness | null })}>
            <option value="">Not assessed</option>
            {Object.entries(READINESS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </span>
      </div>
      <div className="row wrap">
        <span className="field">
          <label htmlFor="ke-notice">Notice period</label>
          <input id="ke-notice" className="short" placeholder="e.g. 3 months" value={v.notice_period ?? ""} onChange={(e) => set({ notice_period: e.target.value })} />
        </span>
        <span className="field">
          <label htmlFor="ke-restraint">Restraint of trade</label>
          <select id="ke-restraint" value={v.restraint} onChange={(e) => set({ restraint: e.target.value as YesNo })}>
            {Object.entries(YES_NO).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </span>
        <span className="field">
          <label htmlFor="ke-insurance">Key person insurance</label>
          <select id="ke-insurance" value={v.key_person_insurance} onChange={(e) => set({ key_person_insurance: e.target.value as YesNo })}>
            {Object.entries(YES_NO).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </span>
        <span className="field">
          <label htmlFor="ke-review">Next review</label>
          <input id="ke-review" type="date" value={v.review_on ?? ""} onChange={(e) => set({ review_on: e.target.value })} />
        </span>
      </div>
      <label htmlFor="ke-retention">Retention arrangements (optional)</label>
      <textarea id="ke-retention" rows={2} placeholder="e.g. retention bonus vesting June 2027, long-term incentive" value={v.retention_notes ?? ""} onChange={(e) => set({ retention_notes: e.target.value })} />
      <div className="row">
        <button type="button" disabled={busy || !ok} onClick={() => onSave(v)}>
          Save
        </button>
        <button type="button" className="link-dark" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {!ok && <p className="muted small">Name, position and why they are key are needed.</p>}
    </div>
  );
}

export default function KeyEmployees({ organisationId, group, canEdit, embedded = false }: Props) {
  const [rows, setRows] = useState<KeyEmployee[] | null>(null);
  const [ready, setReady] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [showRemoved, setShowRemoved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const r = await loadKeyEmployees(organisationId);
    setReady(r.ready);
    setRows(r.rows);
  }, [organisationId]);
  useEffect(() => {
    reload().catch((e) => setError(e instanceof Error ? e.message : "Could not load key employees."));
  }, [reload]);

  async function run(action: () => Promise<void>, done?: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      await reload();
      setEditing(null);
      if (done) setNotice(done);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  if (!rows) return error ? <p className="error">{error}</p> : <p className="lead">Loading…</p>;
  const active = rows.filter((k) => k.is_active);
  const shown = showRemoved ? rows : active;
  const gaps = active.filter(successionGap);
  const entityName = (id: string | null) => (id ? group?.entities.find((e) => e.id === id)?.name ?? "" : "");

  return (
    <>
      {!embedded && <p className="eyebrow">Company</p>}
      {!embedded && <h1>Key Employees</h1>}
      <p className="lead">The people the business depends on, who would step in, and how ready they are. Anyone leaving, a vacant role, or no successor ready now goes into the next risk review under People.</p>
      {!ready && <p className="card warning">Run migration 0037 to turn on Key Employees.</p>}
      {notice && <p className="card note" role="status">{notice}</p>}
      {error && <p className="error block" role="alert">{error}</p>}
      {ready && (
        <dl className="facts">
          <div>
            <dt>Key employees</dt>
            <dd>{active.length}</dd>
          </div>
          <div>
            <dt>Successor ready now</dt>
            <dd>{active.length - gaps.length}</dd>
          </div>
          <div>
            <dt>Succession gaps</dt>
            <dd className={gaps.length ? "warning-text" : undefined}>{gaps.length}</dd>
          </div>
          <div>
            <dt>Leaving or vacant</dt>
            <dd className={active.some((k) => k.status !== "in_role") ? "warning-text" : undefined}>{active.filter((k) => k.status !== "in_role").length}</dd>
          </div>
        </dl>
      )}

      {ready && (
        <section className="block">
          {shown.length === 0 && <p className="muted">No key employees recorded yet.</p>}
          {shown.map((k) =>
            editing === k.id ? (
              <EmployeeForm key={k.id} initial={k} group={group} busy={busy} onSave={(v) => void run(() => saveKeyEmployee(organisationId, k.id, v), "Saved.")} onCancel={() => setEditing(null)} />
            ) : (
              <div key={k.id} className={k.is_active ? "card key-card" : "card key-card muted"}>
                <div className="row spread">
                  <h3>
                    {k.full_name} <span className="muted">· {k.position_title}</span>
                  </h3>
                  <span>
                    {k.status !== "in_role" && <span className="chip chip-alert">{EMPLOYEE_STATUS[k.status]}{k.leaving_on ? ` ${formatDay(k.leaving_on)}` : ""}</span>}{" "}
                    <span className={successionGap(k) ? "chip chip-alert" : "chip"}>{k.succession_readiness ? READINESS[k.succession_readiness] : "Succession not assessed"}</span>
                  </span>
                </div>
                <p className="muted small">{[k.function_name, entityName(k.entity_id)].filter(Boolean).join(" · ")}</p>
                <p>{k.why_key}</p>
                <dl className="detail-list compact key-facts">
                  <div><dt>Successor</dt><dd>{k.successor_name ?? <span className="warning-text">None identified</span>}</dd></div>
                  <div><dt>Notice</dt><dd>{k.notice_period ?? <span className="muted">Not recorded</span>}</dd></div>
                  <div><dt>Restraint</dt><dd className={k.restraint === "unknown" ? "warning-text" : undefined}>{YES_NO[k.restraint]}</dd></div>
                  <div><dt>Key person insurance</dt><dd className={k.key_person_insurance === "unknown" ? "warning-text" : undefined}>{YES_NO[k.key_person_insurance]}</dd></div>
                  <div><dt>Reviewed</dt><dd>{k.last_reviewed_on ? formatDay(k.last_reviewed_on) : <span className="muted">Never</span>}{k.review_on ? ` · next ${formatDay(k.review_on)}` : ""}</dd></div>
                </dl>
                {k.retention_notes && <p className="small"><strong>Retention:</strong> {k.retention_notes}</p>}
                {canEdit && (
                  <div className="row">
                    {k.is_active ? (
                      <>
                        <button type="button" className="link-dark" onClick={() => setEditing(k.id)}>Edit</button>
                        <button type="button" className="link-dark" disabled={busy} onClick={() => void run(() => saveKeyEmployee(organisationId, k.id, { last_reviewed_on: today() }), "Review recorded.")}>Reviewed, no change</button>
                        <button type="button" className="link-dark" disabled={busy} onClick={() => { if (window.confirm(`Remove ${k.full_name} from Key Employees? The record is kept.`)) void run(() => saveKeyEmployee(organisationId, k.id, { is_active: false }), "Removed."); }}>Remove</button>
                      </>
                    ) : (
                      <button type="button" className="link-dark" disabled={busy} onClick={() => void run(() => saveKeyEmployee(organisationId, k.id, { is_active: true }), "Restored.")}>Restore</button>
                    )}
                  </div>
                )}
              </div>
            ),
          )}
          {rows.length > active.length && (
            <label className="check">
              <input type="checkbox" checked={showRemoved} onChange={(e) => setShowRemoved(e.target.checked)} /> Show removed ({rows.length - active.length})
            </label>
          )}
        </section>
      )}

      {ready && canEdit && (editing === "new" ? (
        <EmployeeForm initial={blankKeyEmployee()} group={group} busy={busy} onSave={(v) => void run(() => saveKeyEmployee(organisationId, null, v), `${v.full_name.trim()} added.`)} onCancel={() => setEditing(null)} />
      ) : (
        <button type="button" onClick={() => setEditing("new")}>Add a key employee</button>
      ))}
    </>
  );
}
