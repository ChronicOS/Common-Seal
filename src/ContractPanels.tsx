import { useState } from "react";
import type { Contract } from "./contracts";
import {
  AGREEMENT_TYPES,
  FAMILY_ROLES,
  FUNCTIONS,
  setFiling,
  setSignatories,
  signatoryText,
  TYPE_GROUPS,
  typeLabel,
  VERDICT_LABEL,
  type SignatoryCheck,
} from "./contractFiling";
import { formatDay } from "./board";

const money = (n: number, cur?: string | null) => `${cur && cur !== "AUD" ? cur + " " : "$"}${Number(n).toLocaleString("en-AU", { maximumFractionDigits: 2 })}`;

/** Type, function, family, name and value: shown, and changed in one small form */
export function FilingPanel({
  contract,
  masters,
  canEdit,
  onSaved,
  onOpen,
}: {
  contract: Contract;
  masters: { id: string; name: string }[];
  canEdit: boolean;
  onSaved: () => Promise<void>;
  onOpen: (id: string) => void;
}) {
  const c = contract;
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [f, setF] = useState({
    type: c.agreement_type ?? "OTH",
    other: c.agreement_type_other ?? "",
    fn: c.business_function ?? "",
    parentId: c.parent_contract_id ?? "",
    role: c.family_role ?? "",
    name: c.name_is_custom ? (c.display_name ?? "") : "",
    value: c.value_amount == null ? "" : String(c.value_amount),
    basis: c.value_basis ?? "",
  });
  const valueFixed = !["draft", "rejected", "signed"].includes(c.status);
  const parent = masters.find((m) => m.id === c.parent_contract_id);

  async function save() {
    const amount = f.value.trim() === "" ? null : Number(f.value.replace(/[$,\s]/g, ""));
    if (amount !== null && !(Number.isFinite(amount) && amount >= 0)) return setProblem("Give the value as a number, or leave it blank.");
    if (f.parentId && !f.role) return setProblem("Say how it relates to the master agreement.");
    setBusy(true);
    setProblem(null);
    try {
      await setFiling(c.id, { type: f.type, other: f.other, fn: f.fn, parentId: f.parentId || null, role: f.role, name: f.name, value: amount, basis: f.basis });
      await onSaved();
      setEditing(false);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  if (!editing)
    return (
      <section className="block">
        <h2>Filing</h2>
        <dl className="detail-list two">
          <div>
            <dt>Filed as</dt>
            <dd><strong>{c.display_name ?? c.title}</strong>{c.name_is_custom && <span className="muted small"> (name typed in)</span>}</dd>
          </div>
          <div>
            <dt>Type</dt>
            <dd>{c.agreement_type ? `${c.agreement_type} · ${typeLabel(c.agreement_type, c.agreement_type_other)}` : "Not classified"}</dd>
          </div>
          <div>
            <dt>Business function</dt>
            <dd>{c.business_function ? FUNCTIONS[c.business_function] : "Not set"}</dd>
          </div>
          {parent && (
            <div>
              <dt>{FAMILY_ROLES[c.family_role ?? "amendment"]} {c.family_no ?? ""} to</dt>
              <dd><button type="button" className="link-dark" onClick={() => onOpen(parent.id)}>{parent.name}</button></dd>
            </div>
          )}
          <div>
            <dt>Value</dt>
            <dd>{c.value_amount == null ? "Not stated" : money(c.value_amount, c.currency)}{c.value_basis && <span className="muted"> · {c.value_basis}</span>}</dd>
          </div>
        </dl>
        {canEdit && <button type="button" className="quiet" onClick={() => setEditing(true)}>Change filing or value</button>}
      </section>
    );

  return (
    <section className="block card form">
      <h2>Filing</h2>
      <div className="row wrap">
        <span className="field">
          <label htmlFor="fl-type">Type of agreement</label>
          <select id="fl-type" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
            {TYPE_GROUPS.map((g) => (
              <optgroup key={g} label={g}>
                {AGREEMENT_TYPES.filter((t) => t.group === g).map((t) => <option key={t.code} value={t.code}>{t.code} · {t.label}</option>)}
              </optgroup>
            ))}
          </select>
        </span>
        <span className="field">
          <label htmlFor="fl-fn">Business function</label>
          <select id="fl-fn" value={f.fn} onChange={(e) => setF({ ...f, fn: e.target.value })}>
            <option value="">Not set</option>
            {Object.entries(FUNCTIONS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </span>
      </div>
      {f.type === "OTH" && (
        <>
          <label htmlFor="fl-oth">What kind (two or three words)</label>
          <input id="fl-oth" value={f.other} onChange={(e) => setF({ ...f, other: e.target.value })} />
        </>
      )}
      <div className="row wrap">
        <span className="field">
          <label htmlFor="fl-role">Part of another agreement?</label>
          <select id="fl-role" value={f.parentId ? f.role || "amendment" : ""} onChange={(e) => setF({ ...f, role: e.target.value, parentId: e.target.value ? f.parentId : "" })}>
            <option value="">No, it stands alone</option>
            {Object.entries(FAMILY_ROLES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </span>
        {(f.role || f.parentId) && (
          <span className="field">
            <label htmlFor="fl-parent">Master agreement</label>
            <select id="fl-parent" value={f.parentId} onChange={(e) => setF({ ...f, parentId: e.target.value, role: f.role || "amendment" })}>
              <option value="">Choose</option>
              {masters.filter((m) => m.id !== c.id).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </span>
        )}
      </div>
      <div className="row wrap">
        <span className="field">
          <label htmlFor="fl-val">Value</label>
          <input id="fl-val" inputMode="decimal" disabled={valueFixed} value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} />
        </span>
        <span className="field">
          <label htmlFor="fl-basis">Covers</label>
          <input id="fl-basis" placeholder="e.g. total over the term" value={f.basis} onChange={(e) => setF({ ...f, basis: e.target.value })} />
        </span>
      </div>
      {valueFixed && <p className="muted small">The value is fixed while the contract is with its approvers.</p>}
      <label htmlFor="fl-name">Filing name (leave blank to keep it automatic)</label>
      <input id="fl-name" placeholder={c.name_is_custom ? "" : c.display_name ?? ""} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      {problem && <p className="error small" role="alert">{problem}</p>}
      <div className="row">
        <button type="button" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save"}</button>
        <button type="button" className="quiet" onClick={() => setEditing(false)}>Cancel</button>
      </div>
    </section>
  );
}

/** Who signed for us, and whether they had authority on the day */
export function SigningPanel({ contract, canEdit, onSaved }: { contract: Contract; canEdit: boolean; onSaved: () => Promise<void> }) {
  const c = contract;
  const check = c.signatory_check as SignatoryCheck | null | undefined;
  const [editing, setEditing] = useState(false);
  const [names, setNames] = useState(signatoryText(c.our_signatories));
  const [on, setOn] = useState(c.signed_on ?? "");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  if (c.status !== "signed") return null;

  async function save() {
    setBusy(true);
    setProblem(null);
    try {
      await setSignatories(c.id, names, on || null);
      await onSaved();
      setEditing(false);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="block">
      <h2>Who signed for us</h2>
      {!editing ? (
        <>
          <p>
            {(c.our_signatories ?? []).length ? signatoryText(c.our_signatories) : <span className="muted">Not recorded.</span>}
            {c.signed_on && <span className="muted"> · signed {formatDay(c.signed_on)}</span>}
          </p>
          {check ? (
            <div className={`card signing-check verdict-${check.verdict}`}>
              <p><span className={`chip verdict-${check.verdict}`}>{VERDICT_LABEL[check.verdict]}</span> {check.summary}</p>
              {(check.notes ?? []).length > 0 && (
                <ul className="plain small">{check.notes!.map((n) => <li key={n}>{n}</li>)}</ul>
              )}
            </div>
          ) : (
            (c.our_signatories ?? []).length === 0 && <p className="muted small">Record who signed to check it against the Signing Delegation.</p>
          )}
          {canEdit && <button type="button" className="quiet" onClick={() => setEditing(true)}>{(c.our_signatories ?? []).length ? "Change" : "Record who signed"}</button>}
        </>
      ) : (
        <div className="form">
          <label htmlFor="sg-names">Names and titles, separated by ;</label>
          <input id="sg-names" placeholder="e.g. Jane Smith (Director); John Lee (Company Secretary)" value={names} onChange={(e) => setNames(e.target.value)} />
          <label htmlFor="sg-on">Date signed</label>
          <input id="sg-on" type="date" value={on} onChange={(e) => setOn(e.target.value)} />
          {problem && <p className="error small" role="alert">{problem}</p>}
          <div className="row">
            <button type="button" disabled={busy || names.trim().length < 2} onClick={() => void save()}>{busy ? "Checking…" : "Save and check"}</button>
            <button type="button" className="quiet" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      )}
    </section>
  );
}
