import { useCallback, useEffect, useState } from "react";
import { formatDay } from "./board";
import { loadKeyContracts, money, setKeyContract, YES_NO, type KeyContract, type YesNo } from "./registers";
import type { GroupData } from "./types";

type Props = { organisationId: string; group: GroupData | null; canEdit: boolean };
type Values = { reason: string; contingency: string; change_of_control: YesNo; owner: string };
const today = () => new Date().toLocaleDateString("en-CA");
const daysTo = (iso: string) => Math.round((new Date(`${iso}T00:00:00`).getTime() - new Date(`${today()}T00:00:00`).getTime()) / 86_400_000);

function KeyForm({ initial, busy, onSave, onCancel, label }: { initial: Values; busy: boolean; onSave: (v: Values) => void; onCancel?: () => void; label: string }) {
  const [v, setV] = useState(initial);
  return (
    <>
      <label htmlFor="kc-reason">Why it is business critical</label>
      <textarea id="kc-reason" rows={2} placeholder="e.g. sole supplier of the main input; 40% of revenue" value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} />
      <label htmlFor="kc-contingency">Contingency if it were lost (optional)</label>
      <textarea id="kc-contingency" rows={2} placeholder="e.g. second source qualified in Malaysia; three months' stock" value={v.contingency} onChange={(e) => setV({ ...v, contingency: e.target.value })} />
      <div className="row wrap">
        <span className="field">
          <label htmlFor="kc-coc">Change of control clause</label>
          <select id="kc-coc" value={v.change_of_control} onChange={(e) => setV({ ...v, change_of_control: e.target.value as YesNo })}>
            {Object.entries(YES_NO).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </span>
        <span className="field">
          <label htmlFor="kc-owner">Relationship owner</label>
          <input id="kc-owner" value={v.owner} onChange={(e) => setV({ ...v, owner: e.target.value })} />
        </span>
      </div>
      <div className="row">
        <button type="button" disabled={busy || v.reason.trim().length < 5} onClick={() => onSave(v)}>
          {label}
        </button>
        {onCancel && (
          <button type="button" className="link-dark" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </>
  );
}

export default function KeyContracts({ organisationId, group, canEdit }: Props) {
  const [rows, setRows] = useState<KeyContract[] | null>(null);
  const [ready, setReady] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const r = await loadKeyContracts(organisationId);
    setReady(r.ready);
    setRows(r.rows);
  }, [organisationId]);
  useEffect(() => {
    reload().catch((e) => setError(e instanceof Error ? e.message : "Could not load contracts."));
  }, [reload]);

  async function run(action: () => Promise<void>, done: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      await reload();
      setEditing(null);
      setAdding("");
      setNotice(done);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  if (!rows) return error ? <p className="error">{error}</p> : <p className="lead">Loading…</p>;
  const key = rows.filter((c) => c.is_key && c.status !== "terminated");
  const others = rows.filter((c) => !c.is_key && !["terminated", "rejected"].includes(c.status));
  const entityName = (id: string) => group?.entities.find((e) => e.id === id)?.name ?? "";
  const soon = (c: KeyContract) => [c.notice_by, c.ends_on].some((d) => d && daysTo(d) <= 183);

  return (
    <>
      <p className="eyebrow">Contracts</p>
      <h1>Key Contracts</h1>
      <p className="lead">Contracts the business could not easily do without. A key contract ending or due for notice within six months goes into the next risk review under Commercial.</p>
      {!ready && <p className="card warning">Run migration 0037 to turn on Key Contracts.</p>}
      {notice && <p className="card note" role="status">{notice}</p>}
      {error && <p className="error block" role="alert">{error}</p>}

      {ready && (
        <section className="block">
          {key.length === 0 && <p className="muted">No contracts are marked as key yet.</p>}
          {key.map((c) => {
            const dates = [
              c.notice_by ? { label: "Notice by", d: c.notice_by } : null,
              c.ends_on ? { label: "Ends", d: c.ends_on } : null,
            ].filter((x): x is { label: string; d: string } => Boolean(x));
            return (
              <div key={c.id} className="card key-card">
                <div className="row spread">
                  <h3>
                    {c.title} <span className="muted">· {c.counterparty?.name ?? "Intercompany"}</span>
                  </h3>
                  {soon(c) ? <span className="chip chip-alert">Due within six months</span> : !c.ends_on && !c.notice_by ? <span className="chip chip-alert">No end date recorded</span> : <span className="chip">Key contract</span>}
                </div>
                <p className="muted small">{[entityName(c.entity_id), c.value_amount !== null ? money(c.value_amount, c.currency) : "Value not recorded", c.auto_renews ? "Renews automatically" : null].filter(Boolean).join(" · ")}</p>
                {editing === c.id ? (
                  <KeyForm
                    initial={{ reason: c.key_reason ?? "", contingency: c.key_contingency ?? "", change_of_control: c.key_change_of_control, owner: c.key_owner ?? "" }}
                    busy={busy}
                    label="Save"
                    onSave={(v) => void run(() => setKeyContract(c.id, { is_key: true, ...v }), "Saved.")}
                    onCancel={() => setEditing(null)}
                  />
                ) : (
                  <>
                    <p>{c.key_reason}</p>
                    <dl className="detail-list compact key-facts">
                      {dates.map((x) => (
                        <div key={x.label}>
                          <dt>{x.label}</dt>
                          <dd className={daysTo(x.d) <= 183 ? "warning-text" : undefined}>
                            {formatDay(x.d)}
                            {daysTo(x.d) < 0 ? " (passed)" : daysTo(x.d) <= 183 ? ` (${daysTo(x.d)} days)` : ""}
                          </dd>
                        </div>
                      ))}
                      <div><dt>Change of control</dt><dd className={c.key_change_of_control === "unknown" ? "warning-text" : undefined}>{YES_NO[c.key_change_of_control]}</dd></div>
                      <div><dt>Relationship owner</dt><dd>{c.key_owner ?? <span className="muted">Not recorded</span>}</dd></div>
                    </dl>
                    <p className="small"><strong>Contingency:</strong> {c.key_contingency ?? <span className="warning-text">None recorded</span>}</p>
                    {canEdit && (
                      <div className="row">
                        <button type="button" className="link-dark" onClick={() => setEditing(c.id)}>Edit</button>
                        <button type="button" className="link-dark" disabled={busy} onClick={() => { if (window.confirm(`No longer treat "${c.title}" as a key contract?`)) void run(() => setKeyContract(c.id, { is_key: false, reason: "", contingency: "", change_of_control: c.key_change_of_control, owner: "" }), "No longer a key contract."); }}>
                          Not key
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </section>
      )}

      {ready && canEdit && (
        <section className="card form">
          <h2>Mark a contract as key</h2>
          {others.length === 0 ? (
            <p className="muted">Every contract on file is already key, or there are none. Add contracts under Contracts first.</p>
          ) : (
            <>
              <label htmlFor="kc-pick">Contract</label>
              <select id="kc-pick" value={adding} onChange={(e) => setAdding(e.target.value)}>
                <option value="">Choose a contract</option>
                {others.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title} · {c.counterparty?.name ?? "Intercompany"}
                  </option>
                ))}
              </select>
              {adding && <KeyForm key={adding} initial={{ reason: "", contingency: "", change_of_control: "unknown", owner: "" }} busy={busy} label="Mark as key" onSave={(v) => void run(() => setKeyContract(adding, { is_key: true, ...v }), "Marked as a key contract.")} />}
            </>
          )}
        </section>
      )}
    </>
  );
}
