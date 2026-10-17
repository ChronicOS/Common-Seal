import { useCallback, useEffect, useState } from "react";
import { formatDay, formatWhen } from "./board";
import { attachFile, downloadFile, listFiles, type LinkedFile } from "./files";
import { has } from "./roles";
import {
  blankValues,
  COUNTRY_LEVELS,
  decideAssessment,
  LEVEL_LABELS,
  LISTS,
  loadSanctions,
  OUTCOME_LABELS,
  QUESTIONS,
  rate,
  recordLicence,
  removeCountry,
  reopenAssessment,
  RESULT_LABELS,
  saveAssessment,
  saveCountry,
  SOURCES,
  STATUS_LABELS,
  SUBJECT_TYPES,
  submitAssessment,
  type Answer,
  type Assessment,
  type AssessmentValues,
  type Country,
  type CountryLevel,
  type Level,
  type Outcome,
  type Result,
  type SanctionsData,
} from "./sanctions";
import type { GroupData } from "./types";

type Props = { organisationId: string; role: string; userId: string; group: GroupData | null };
type View = { kind: "list" } | { kind: "edit"; id: string | null; from?: string; partyId?: string } | { kind: "view"; id: string } | { kind: "countries" };

const RECORDS = ["owner", "admin", "secretary", "legal", "compliance"];
const today = () => new Date().toLocaleDateString("en-CA");
const levelClass = (l: Level) => (l === "stop" || l === "high" ? "chip chip-alert" : l === "incomplete" ? "chip chip-warn" : "chip");
const valuesOf = (a: Assessment): AssessmentValues => ({
  counterparty_id: a.counterparty_id, contract_id: a.contract_id, entity_id: a.entity_id, subject_name: a.subject_name, subject_type: a.subject_type,
  description: a.description, countries: a.countries, screened_on: a.screened_on, screened_by: a.screened_by, screening_tool: a.screening_tool,
  lists_checked: a.lists_checked, persons_screened: a.persons_screened, screening_result: a.screening_result, screening_notes: a.screening_notes, answers: a.answers,
});

function Rating({ level, reasons }: { level: Level; reasons: string[] }) {
  return (
    <div className={`card rating-${level === "stop" ? "high" : level === "incomplete" ? "medium" : level}`} role="status">
      <p>
        <strong>{level === "stop" ? "Stop: do not proceed without legal advice and any permit needed" : level === "incomplete" ? "Incomplete: cannot be cleared yet" : LEVEL_LABELS[level]}</strong>
      </p>
      {reasons.length > 0 && (
        <ul className="small">
          {reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AssessmentForm({ data, group, initial, busy, onSave, onCancel }: {
  data: SanctionsData; group: GroupData | null; initial: AssessmentValues; busy: boolean;
  onSave: (v: AssessmentValues, submit: boolean) => void; onCancel: () => void;
}) {
  const [v, setV] = useState(initial);
  const [countryText, setCountryText] = useState(initial.countries.join(", "));
  const set = (patch: Partial<AssessmentValues>) => setV({ ...v, ...patch });
  const current = (): AssessmentValues => ({ ...v, countries: countryText.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean) });
  const r = rate(current(), data.countries, today());
  const listedHere = data.countries.filter((c) => current().countries.some((x) => x.toLowerCase() === c.country.toLowerCase()));
  const party = data.parties.find((p) => p.id === v.counterparty_id);
  return (
    <>
      <section className="card form">
        <h2>1. Who and what</h2>
        <div className="row wrap">
          <span className="field">
            <label htmlFor="sa-party">Third party (optional)</label>
            <select id="sa-party" value={v.counterparty_id ?? ""} onChange={(e) => { const p = data.parties.find((x) => x.id === e.target.value); set({ counterparty_id: e.target.value || null, subject_name: p && !v.subject_name ? p.name : v.subject_name }); if (p?.country && !countryText) setCountryText(p.country); }}>
              <option value="">Not on file</option>
              {data.parties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </span>
          <span className="field">
            <label htmlFor="sa-contract">Contract (optional)</label>
            <select id="sa-contract" value={v.contract_id ?? ""} onChange={(e) => set({ contract_id: e.target.value || null })}>
              <option value="">None</option>
              {data.contracts.filter((c) => !v.counterparty_id || c.counterparty_id === v.counterparty_id).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </span>
          <span className="field">
            <label htmlFor="sa-entity">Our company</label>
            <select id="sa-entity" value={v.entity_id ?? ""} onChange={(e) => set({ entity_id: e.target.value || null })}>
              <option value="">The group</option>
              {group?.entities.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </span>
        </div>
        <div className="row wrap">
          <span className="field grow">
            <label htmlFor="sa-name">Name of the party being assessed</label>
            <input id="sa-name" value={v.subject_name} onChange={(e) => set({ subject_name: e.target.value })} placeholder={party?.name} />
          </span>
          <span className="field">
            <label htmlFor="sa-type">Type</label>
            <select id="sa-type" value={v.subject_type} onChange={(e) => set({ subject_type: e.target.value as AssessmentValues["subject_type"] })}>
              {Object.entries(SUBJECT_TYPES).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </span>
        </div>
        <label htmlFor="sa-desc">The transaction</label>
        <textarea id="sa-desc" rows={2} placeholder="What is being bought, sold or provided, how it moves, and how it is paid" value={v.description ?? ""} onChange={(e) => set({ description: e.target.value })} />
        <label htmlFor="sa-countries">Countries involved (comma between): where the party is, origin, destination, transit, and the banks' countries</label>
        <input id="sa-countries" list="sa-country-list" value={countryText} onChange={(e) => setCountryText(e.target.value)} />
        <datalist id="sa-country-list">
          {data.countries.map((c) => (
            <option key={c.id} value={c.country} />
          ))}
        </datalist>
        {listedHere.length > 0 && (
          <p className="warning-text small">
            On your sanctions country list: {listedHere.map((c) => `${c.country} (${COUNTRY_LEVELS[c.level].toLowerCase()})`).join(", ")}
          </p>
        )}
      </section>

      <section className="card form">
        <h2>2. Screening</h2>
        <p className="muted small">
          Screen the party, its owners (50% or more, alone or together), directors, and the banks involved.{" "}
          {SOURCES.slice(0, 1).concat(SOURCES.slice(2)).map((s, i) => (
            <span key={s.url}>
              {i > 0 ? " · " : ""}
              <a className="link-dark" href={s.url} target="_blank" rel="noreferrer">
                {s.label}
              </a>
            </span>
          ))}
        </p>
        <div className="row wrap">
          <span className="field">
            <label htmlFor="sa-on">Screened on</label>
            <input id="sa-on" type="date" max={today()} value={v.screened_on ?? ""} onChange={(e) => set({ screened_on: e.target.value || null })} />
          </span>
          <span className="field">
            <label htmlFor="sa-by">Screened by</label>
            <input id="sa-by" value={v.screened_by ?? ""} onChange={(e) => set({ screened_by: e.target.value })} />
          </span>
          <span className="field">
            <label htmlFor="sa-tool">Tool or provider</label>
            <input id="sa-tool" placeholder="e.g. manual search, a screening provider" value={v.screening_tool ?? ""} onChange={(e) => set({ screening_tool: e.target.value })} />
          </span>
        </div>
        <fieldset className="plain-fieldset">
          <legend>Lists checked</legend>
          <div className="row wrap">
            {LISTS.map((l) => (
              <label key={l} className="check">
                <input type="checkbox" checked={v.lists_checked.includes(l)} onChange={(e) => set({ lists_checked: e.target.checked ? [...v.lists_checked, l] : v.lists_checked.filter((x) => x !== l) })} /> {l}
              </label>
            ))}
          </div>
        </fieldset>
        <label htmlFor="sa-persons">Who was screened (owners, directors, banks)</label>
        <textarea id="sa-persons" rows={2} value={v.persons_screened ?? ""} onChange={(e) => set({ persons_screened: e.target.value })} />
        <fieldset className="plain-fieldset">
          <legend>Result</legend>
          <div className="row wrap">
            <label className="check">
              <input type="radio" name="sa-result" checked={!v.screening_result} onChange={() => set({ screening_result: null })} /> Not screened yet
            </label>
            {(Object.keys(RESULT_LABELS) as Result[]).map((k) => (
              <label key={k} className="check">
                <input type="radio" name="sa-result" checked={v.screening_result === k} onChange={() => set({ screening_result: k })} /> {RESULT_LABELS[k]}
              </label>
            ))}
          </div>
        </fieldset>
        <label htmlFor="sa-notes">Screening notes (how a potential match was ruled in or out)</label>
        <textarea id="sa-notes" rows={2} value={v.screening_notes ?? ""} onChange={(e) => set({ screening_notes: e.target.value })} />
      </section>

      <section className="card form">
        <h2>3. Questions</h2>
        {QUESTIONS.map((q) => (
          <fieldset key={q.key} className="plain-fieldset question">
            <legend>
              {q.text}
              {q.help && <span className="muted small"> {q.help}</span>}
            </legend>
            <div className="row">
              {(["yes", "no", "unknown"] as Answer[]).map((a) => (
                <label key={a} className="check">
                  <input type="radio" name={`sq-${q.key}`} checked={v.answers[q.key] === a} onChange={() => set({ answers: { ...v.answers, [q.key]: a } })} /> {a === "unknown" ? "Not known" : a === "yes" ? "Yes" : "No"}
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </section>

      <Rating level={r.level} reasons={r.reasons} />
      <div className="row block">
        <button type="button" disabled={busy || v.subject_name.trim().length < 2} onClick={() => onSave(current(), true)}>
          Submit for decision
        </button>
        <button type="button" className="quiet" disabled={busy || v.subject_name.trim().length < 2} onClick={() => onSave(current(), false)}>
          Save as a draft
        </button>
        <button type="button" className="link-dark" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </>
  );
}

function CountryRow({ c, busy, onSave, onRemove }: { c: Country; busy: boolean; onSave: (v: { country: string; level: CountryLevel; regimes: string; notes: string }) => void; onRemove: () => void }) {
  const [v, setV] = useState({ country: c.country, level: c.level, regimes: c.regimes ?? "", notes: c.notes ?? "" });
  const changed = v.country !== c.country || v.level !== c.level || v.regimes !== (c.regimes ?? "") || v.notes !== (c.notes ?? "");
  return (
    <tr>
      <td>
        <input aria-label="Country" value={v.country} onChange={(e) => setV({ ...v, country: e.target.value })} />
      </td>
      <td>
        <select aria-label={`Level for ${c.country}`} value={v.level} onChange={(e) => setV({ ...v, level: e.target.value as CountryLevel })}>
          {Object.entries(COUNTRY_LEVELS).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
      </td>
      <td>
        <input aria-label={`Regimes for ${c.country}`} value={v.regimes} onChange={(e) => setV({ ...v, regimes: e.target.value })} />
      </td>
      <td>
        <input aria-label={`Notes for ${c.country}`} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} />
      </td>
      <td className="nowrap">
        <button type="button" className="quiet" disabled={busy || !changed} onClick={() => onSave(v)}>
          Save
        </button>{" "}
        <button type="button" className="link-dark small" disabled={busy} onClick={onRemove}>
          Remove
        </button>
      </td>
    </tr>
  );
}

export default function Sanctions({ organisationId, role, userId, group }: Props) {
  const canDecide = has(role, ...RECORDS);
  const [data, setData] = useState<SanctionsData | null>(null);
  const [files, setFiles] = useState<LinkedFile[]>([]);
  const [view, setView] = useState<View>({ kind: "list" });
  const [filter, setFilter] = useState<"open" | "decided" | "all">("open");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [decision, setDecision] = useState<{ outcome: Outcome | ""; conditions: string; note: string; next: string }>({ outcome: "", conditions: "", note: "", next: "" });
  const [licence, setLicence] = useState({ reference: "", expires: "" });
  const [newCountry, setNewCountry] = useState({ country: "", level: "targeted" as CountryLevel, regimes: "", notes: "" });

  const reload = useCallback(async () => {
    const d = await loadSanctions(organisationId);
    setData(d);
    setFiles(await listFiles("sanctions_assessments", d.assessments.map((a) => a.id)));
  }, [organisationId]);
  useEffect(() => {
    reload().catch((e) => setError(e instanceof Error ? e.message : "Could not load sanctions."));
  }, [reload]);

  async function run(action: () => Promise<void>, done?: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      await reload();
      if (done) setNotice(done);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      return false;
    } finally {
      setBusy(false);
    }
  }
  const go = (v: View) => {
    setView(v);
    setError(null);
    setNotice(null);
    setDecision({ outcome: "", conditions: "", note: "", next: "" });
  };

  if (!data) return error ? <p className="error">{error}</p> : <p className="lead">Loading…</p>;
  const messages = (
    <>
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
    </>
  );
  if (!data.ready) return <p className="card warning">Run migration 0038 to turn on sanctions assessments.</p>;
  const who = (uid: string | null) => data.people.find((p) => p.user_id === uid)?.full_name ?? "a member";
  const partyName = (id: string | null) => data.parties.find((p) => p.id === id)?.name;

  // ---- Edit ----
  if (view.kind === "edit") {
    const existing = view.id ? data.assessments.find((a) => a.id === view.id) : undefined;
    const from = view.from ? data.assessments.find((a) => a.id === view.from) : undefined;
    const party = view.partyId ? data.parties.find((p) => p.id === view.partyId) : undefined;
    const initial = existing ? valuesOf(existing) : from ? { ...valuesOf(from), screened_on: null, screening_result: null } : { ...blankValues(), counterparty_id: party?.id ?? null, subject_name: party?.name ?? "", countries: party?.country ? [party.country] : [] };
    return (
      <>
        <button type="button" className="back" onClick={() => go(existing ? { kind: "view", id: existing.id } : { kind: "list" })}>
          ← Back
        </button>
        <p className="eyebrow">Sanctions</p>
        <h1>{existing ? `Assessment: ${existing.subject_name}` : from ? `Re-screen: ${from.subject_name}` : "New sanctions assessment"}</h1>
        {from && <p className="lead">The answers are copied from the last assessment. Screen again and check each answer is still right.</p>}
        {messages}
        <AssessmentForm
          data={data}
          group={group}
          initial={initial}
          busy={busy}
          onCancel={() => go(existing ? { kind: "view", id: existing.id } : { kind: "list" })}
          onSave={(v, submit) => {
            let id = "";
            let level: Level = "incomplete";
            void run(async () => {
              id = await saveAssessment(organisationId, existing?.id ?? null, v, from?.id ?? null);
              if (submit) level = await submitAssessment(id);
            }).then((ok) => {
              if (!ok) return;
              go({ kind: "view", id });
              setNotice(submit ? `Submitted: ${LEVEL_LABELS[level].toLowerCase()}. Legal or compliance will decide.` : "Saved as a draft.");
            });
          }}
        />
      </>
    );
  }

  // ---- Countries ----
  if (view.kind === "countries") {
    return (
      <>
        <button type="button" className="back" onClick={() => go({ kind: "list" })}>
          ← Back
        </button>
        <p className="eyebrow">Sanctions</p>
        <h1>Sanctions countries</h1>
        <p className="lead">The countries the assessment treats as sanctioned, and how heavily. Comprehensive gives Stop, extensive gives High, targeted gives Medium. Open assessments are re-rated when this changes.</p>
        <p className="card warning">
          This started as a starter list taken from DFAT's list of regimes, plus US, UK and EU regimes that often matter. Sanctions change often: confirm each entry against the{" "}
          <a className="link-dark" href={SOURCES[1].url} target="_blank" rel="noreferrer">
            DFAT regimes page
          </a>{" "}
          and keep it current.
        </p>
        {messages}
        <div className="table-scroll">
          <table className="report-table">
            <thead>
              <tr>
                <th scope="col">Country or region</th>
                <th scope="col">Level</th>
                <th scope="col">Regimes</th>
                <th scope="col">Notes</th>
                <th scope="col"></th>
              </tr>
            </thead>
            <tbody>
              {data.countries.map((c) =>
                canDecide ? (
                  <CountryRow key={c.id + c.updated_at} c={c} busy={busy} onSave={(v) => void run(() => saveCountry(organisationId, c.id, v), "Saved. Open assessments re-rated.")} onRemove={() => { if (window.confirm(`Remove ${c.country} from the list?`)) void run(() => removeCountry(c.id), "Removed."); }} />
                ) : (
                  <tr key={c.id}>
                    <th scope="row">{c.country}</th>
                    <td>{COUNTRY_LEVELS[c.level]}</td>
                    <td>{c.regimes}</td>
                    <td>{c.notes}</td>
                    <td></td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
        {canDecide && (
          <section className="card form">
            <h2>Add a country or region</h2>
            <div className="row wrap">
              <input aria-label="New country" placeholder="Country or region" value={newCountry.country} onChange={(e) => setNewCountry({ ...newCountry, country: e.target.value })} />
              <select aria-label="New country level" value={newCountry.level} onChange={(e) => setNewCountry({ ...newCountry, level: e.target.value as CountryLevel })}>
                {Object.entries(COUNTRY_LEVELS).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
              <input aria-label="New country regimes" placeholder="Regimes" value={newCountry.regimes} onChange={(e) => setNewCountry({ ...newCountry, regimes: e.target.value })} />
              <button type="button" disabled={busy || newCountry.country.trim().length < 2} onClick={() => void run(() => saveCountry(organisationId, null, newCountry), "Added.").then((ok) => ok && setNewCountry({ country: "", level: "targeted", regimes: "", notes: "" }))}>
                Add
              </button>
            </div>
          </section>
        )}
      </>
    );
  }

  // ---- One assessment ----
  if (view.kind === "view") {
    const a = data.assessments.find((x) => x.id === view.id);
    if (a) {
      const mine = a.created_by === userId;
      const canEditDraft = a.status === "draft" && (mine || canDecide);
      const mayDecide = canDecide && a.status === "submitted" && (!mine || a.risk_level === "low");
      const allowed: Outcome[] =
        a.risk_level === "stop" ? ["licence_required", "do_not_proceed"] : a.risk_level === "incomplete" ? ["do_not_proceed"] : ["proceed", "proceed_conditions", "licence_required", "do_not_proceed"];
      const attached = files.filter((f) => f.subject_id === a.id);
      const newer = data.assessments.find((x) => x.previous_id === a.id && x.status !== "withdrawn");
      return (
        <>
          <button type="button" className="back" onClick={() => go({ kind: "list" })}>
            ← Back to sanctions
          </button>
          <p className="eyebrow">Sanctions assessment · {STATUS_LABELS[a.status]}</p>
          <h1>{a.subject_name}</h1>
          <p className="lead">
            <span className={levelClass(a.risk_level)}>{LEVEL_LABELS[a.risk_level]}</span>
            {a.outcome ? ` ${OUTCOME_LABELS[a.outcome]}` : ""}
            {a.next_screen_on ? ` · re-screen by ${formatDay(a.next_screen_on)}` : ""}
          </p>
          {messages}
          <Rating level={a.risk_level} reasons={a.risk_reasons} />
          <dl className="detail-list compact key-facts">
            <div><dt>Type</dt><dd>{SUBJECT_TYPES[a.subject_type]}</dd></div>
            {a.counterparty_id && <div><dt>Third party</dt><dd>{partyName(a.counterparty_id)}</dd></div>}
            {a.contract_id && <div><dt>Contract</dt><dd>{data.contracts.find((c) => c.id === a.contract_id)?.title}</dd></div>}
            <div><dt>Countries</dt><dd>{a.countries.join(", ") || <span className="warning-text">Not recorded</span>}</dd></div>
            <div><dt>Screening</dt><dd className={a.screening_result ? undefined : "warning-text"}>{a.screening_result ? `${RESULT_LABELS[a.screening_result]}${a.screened_on ? `, ${formatDay(a.screened_on)}` : ""}${a.screened_by ? ` by ${a.screened_by}` : ""}` : "Not screened"}</dd></div>
            <div><dt>Raised by</dt><dd>{who(a.created_by)}, {formatDay(a.created_at)}</dd></div>
          </dl>
          {a.description && <p>{a.description}</p>}
          {a.lists_checked.length > 0 && <p className="small">Lists: {a.lists_checked.join("; ")}{a.screening_tool ? ` · ${a.screening_tool}` : ""}</p>}
          {a.persons_screened && <p className="small">Screened: {a.persons_screened}</p>}
          {a.screening_notes && <p className="small">Notes: {a.screening_notes}</p>}
          <details className="block">
            <summary>Answers</summary>
            <ul className="small">
              {QUESTIONS.map((q) => (
                <li key={q.key}>
                  {q.text} <strong className={a.answers[q.key] === q.adverse ? "warning-text" : a.answers[q.key] === "unknown" || !a.answers[q.key] ? "warning-text" : undefined}>{a.answers[q.key] === "unknown" ? "Not known" : a.answers[q.key] === "yes" ? "Yes" : a.answers[q.key] === "no" ? "No" : "Not answered"}</strong>
                </li>
              ))}
            </ul>
          </details>

          <section className="block">
            <h2>Evidence</h2>
            {attached.length === 0 ? (
              <p className="muted">No screening report or other evidence attached.</p>
            ) : (
              <ul className="plain rows">
                {attached.map((f) => (
                  <li key={f.storage_path}>
                    <button type="button" className="quiet" onClick={() => void downloadFile(f.storage_path, f.file_name).catch((e) => setError(e.message))}>
                      ⤓ {f.file_name}
                    </button>{" "}
                    <span className="muted small">{formatDay(f.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
            {(mine || canDecide) && (
              <label className="quiet file-button">
                Attach a screening report or evidence
                <input type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void run(() => attachFile("sanctions_assessments", a.id, f).then(() => undefined), "Attached."); e.target.value = ""; }} />
              </label>
            )}
          </section>

          {a.status === "decided" && (
            <section className="card block">
              <h2>Decision</h2>
              <p>
                <strong>{a.outcome ? OUTCOME_LABELS[a.outcome] : ""}</strong>, {who(a.decided_by)}
                {a.decided_at ? `, ${formatWhen(a.decided_at)}` : ""}
              </p>
              {a.conditions && <p>Conditions: {a.conditions}</p>}
              {a.decision_note && <p>{a.decision_note}</p>}
              {a.outcome === "licence_required" &&
                (a.licence_reference ? (
                  <p>
                    Permit or licence: <strong>{a.licence_reference}</strong>
                    {a.licence_expires_on ? `, expires ${formatDay(a.licence_expires_on)}` : ""}
                  </p>
                ) : canDecide ? (
                  <div className="form">
                    <p className="warning-text">Do not proceed until the permit or licence is granted. In Australia, apply to DFAT for a sanctions permit.</p>
                    <div className="row wrap">
                      <input aria-label="Permit or licence reference" placeholder="Permit or licence reference" value={licence.reference} onChange={(e) => setLicence({ ...licence, reference: e.target.value })} />
                      <input aria-label="Expires on" type="date" value={licence.expires} onChange={(e) => setLicence({ ...licence, expires: e.target.value })} />
                      <button type="button" disabled={busy} onClick={() => void run(() => recordLicence(a.id, licence.reference, licence.expires), "Permit recorded.")}>
                        Record the permit
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="warning-text">Waiting for the permit or licence.</p>
                ))}
            </section>
          )}

          {a.status === "submitted" && canDecide && (
            <section className="card form block">
              <h2>Decide</h2>
              {!mayDecide ? (
                <p className="warning-text">You raised this assessment, so someone else in legal or compliance must decide it.</p>
              ) : (
                <>
                  {a.risk_level === "stop" && <p className="warning-text">A stop result can only be "do not proceed" or "permit or licence required". Get legal advice.</p>}
                  {a.risk_level === "incomplete" && <p className="warning-text">Incomplete: return it to draft to finish it, or decide not to proceed.</p>}
                  <fieldset className="plain-fieldset">
                    <legend>Outcome</legend>
                    {allowed.map((o) => (
                      <label key={o} className="check">
                        <input type="radio" name="sd-outcome" checked={decision.outcome === o} onChange={() => setDecision({ ...decision, outcome: o })} /> {OUTCOME_LABELS[o]}
                      </label>
                    ))}
                  </fieldset>
                  {decision.outcome === "proceed_conditions" && (
                    <>
                      <label htmlFor="sd-conditions">Conditions</label>
                      <textarea id="sd-conditions" rows={2} placeholder="e.g. sanctions clause in the contract; no US dollar payments; re-screen before each shipment" value={decision.conditions} onChange={(e) => setDecision({ ...decision, conditions: e.target.value })} />
                    </>
                  )}
                  <label htmlFor="sd-note">{decision.outcome === "do_not_proceed" || decision.outcome === "licence_required" ? "Reason" : "Note (optional)"}</label>
                  <textarea id="sd-note" rows={2} value={decision.note} onChange={(e) => setDecision({ ...decision, note: e.target.value })} />
                  {decision.outcome && decision.outcome !== "do_not_proceed" && (
                    <>
                      <label htmlFor="sd-next">Re-screen by (default {a.risk_level === "high" || a.risk_level === "stop" ? "6" : "12"} months)</label>
                      <input id="sd-next" type="date" min={today()} value={decision.next} onChange={(e) => setDecision({ ...decision, next: e.target.value })} />
                    </>
                  )}
                  <div className="row">
                    <button type="button" disabled={busy || !decision.outcome} onClick={() => void run(() => decideAssessment(a.id, decision.outcome as Outcome, decision.conditions, decision.note, decision.next), "Decided.")}>
                      Record the decision
                    </button>
                    <button type="button" className="quiet" disabled={busy} onClick={() => void run(() => reopenAssessment(a.id, false), "Returned to draft.")}>
                      Return to draft
                    </button>
                  </div>
                </>
              )}
            </section>
          )}

          <div className="row block">
            {canEditDraft && (
              <button type="button" onClick={() => go({ kind: "edit", id: a.id })}>
                Continue the assessment
              </button>
            )}
            {a.status === "decided" && a.outcome !== "do_not_proceed" && !newer && (
              <button type="button" className="quiet" onClick={() => go({ kind: "edit", id: null, from: a.id })}>
                Re-screen
              </button>
            )}
            {newer && (
              <button type="button" className="link-dark" onClick={() => go({ kind: "view", id: newer.id })}>
                See the later assessment
              </button>
            )}
            {(a.status === "draft" || a.status === "submitted" || (a.status === "decided" && canDecide)) && (
              <button type="button" className="link-dark" disabled={busy} onClick={() => { if (window.confirm("Withdraw this assessment? It is kept on record.")) void run(() => reopenAssessment(a.id, true), "Withdrawn."); }}>
                Withdraw
              </button>
            )}
          </div>
        </>
      );
    }
  }

  // ---- List ----
  const t = today();
  const live = data.assessments.filter((a) => a.status !== "withdrawn");
  const latestFor = (partyId: string) => live.find((a) => a.counterparty_id === partyId);
  const dueRescreen = live.filter((a) => a.status === "decided" && a.outcome !== "do_not_proceed" && a.next_screen_on && a.next_screen_on < t && !live.some((n) => n.previous_id === a.id));
  // Third parties under a live contract with no current cleared assessment
  const activeParties = [...new Set(data.contracts.filter((c) => c.counterparty_id && !["terminated", "rejected"].includes(c.status)).map((c) => c.counterparty_id!))];
  const uncovered = activeParties.filter((pid) => {
    const a = latestFor(pid);
    return !a || a.status !== "decided" || a.outcome === "do_not_proceed" || (a.next_screen_on !== null && a.next_screen_on < t) || (a.outcome === "licence_required" && !a.licence_reference);
  });
  const shown = live.filter((a) => (filter === "all" ? true : filter === "open" ? a.status !== "decided" : a.status === "decided"));

  return (
    <>
      <p className="eyebrow">Contracts</p>
      <h1>Sanctions</h1>
      <p className="lead">Assess a party or transaction before contracting: screen it, record the countries involved, and answer the questions. The result is Stop, High, Medium or Low, or Incomplete if anything is missing.</p>
      {messages}
      <p className="row">
        <button type="button" onClick={() => go({ kind: "edit", id: null })}>
          New assessment
        </button>
        <button type="button" className="quiet" onClick={() => go({ kind: "countries" })}>
          Sanctions countries ({data.countries.length})
        </button>
      </p>
      <dl className="facts">
        <div>
          <dt>Awaiting decision</dt>
          <dd>{live.filter((a) => a.status === "submitted").length}</dd>
        </div>
        <div>
          <dt>Stop or high</dt>
          <dd className={live.some((a) => a.status !== "decided" && (a.risk_level === "stop" || a.risk_level === "high")) ? "warning-text" : undefined}>{live.filter((a) => a.status !== "decided" && (a.risk_level === "stop" || a.risk_level === "high")).length}</dd>
        </div>
        <div>
          <dt>Re-screens overdue</dt>
          <dd className={dueRescreen.length ? "warning-text" : undefined}>{dueRescreen.length}</dd>
        </div>
        <div>
          <dt>Contracted parties not covered</dt>
          <dd className={uncovered.length ? "warning-text" : undefined}>{uncovered.length}</dd>
        </div>
      </dl>
      {uncovered.length > 0 && (
        <section className="card warning block">
          <h2>Third parties under contract without a current assessment</h2>
          <ul className="plain rows">
            {uncovered.map((pid) => {
              const a = latestFor(pid);
              return (
                <li key={pid} className="row spread">
                  <span>
                    <strong>{partyName(pid)}</strong>
                    <span className="muted small"> · {!a ? "never assessed" : a.status !== "decided" ? STATUS_LABELS[a.status].toLowerCase() : a.outcome === "do_not_proceed" ? "decided: do not proceed" : a.outcome === "licence_required" && !a.licence_reference ? "permit not yet recorded" : `re-screen was due ${formatDay(a.next_screen_on!)}`}</span>
                  </span>
                  <button type="button" className="quiet" onClick={() => go(a && a.status !== "decided" ? { kind: "view", id: a.id } : a ? { kind: "edit", id: null, from: a.id } : { kind: "edit", id: null, partyId: pid })}>
                    {a && a.status !== "decided" ? "Open" : a ? "Re-screen" : "Assess"}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <span className="segmented block-gap" role="group" aria-label="Show">
        {(
          [
            ["open", "Open"],
            ["decided", "Decided"],
            ["all", "All"],
          ] as const
        ).map(([k, l]) => (
          <button key={k} type="button" className={filter === k ? "on" : undefined} aria-pressed={filter === k} onClick={() => setFilter(k)}>
            {l}
          </button>
        ))}
      </span>
      {shown.length === 0 ? (
        <p className="muted">No assessments {filter === "open" ? "open" : filter === "decided" ? "decided" : ""} yet.</p>
      ) : (
        <ul className="entity-list">
          {shown.map((a) => (
            <li key={a.id}>
              <button type="button" className="entity-row" onClick={() => go({ kind: "view", id: a.id })}>
                <span>
                  <span className="entity-name">{a.subject_name}</span>
                  <span className="muted">
                    {" "}
                    · {STATUS_LABELS[a.status]}
                    {a.outcome ? `: ${OUTCOME_LABELS[a.outcome]}` : ""}
                    {a.countries.length ? ` · ${a.countries.join(", ")}` : ""}
                    {a.next_screen_on ? ` · re-screen ${formatDay(a.next_screen_on)}` : ""}
                  </span>
                </span>
                <span className={levelClass(a.risk_level)}>{LEVEL_LABELS[a.risk_level]}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="muted small block">
        Official lists:{" "}
        {SOURCES.map((s, i) => (
          <span key={s.url}>
            {i > 0 ? " · " : ""}
            <a className="link-dark" href={s.url} target="_blank" rel="noreferrer">
              {s.label}
            </a>
          </span>
        ))}
        . VeraPhius does not screen against the lists itself; record the result of your screening here.
      </p>
    </>
  );
}
