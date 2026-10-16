import { useCallback, useEffect, useState } from "react";
import { formatDay, formatWhen } from "./board";
import { has } from "./roles";
import {
  addAction,
  ALL_ITEMS,
  ANSWER_LABELS,
  completeAction,
  createAudit,
  loadAudits,
  loadEvidence,
  removeAction,
  saveAnswer,
  SECTIONS,
  signOff,
  startFollowUp,
  updateAudit,
  type Action,
  type Answer,
  type AnswerRow,
  type Audit,
  type AuditData,
  type Evidence,
  type Item,
} from "./legalAudit";
import type { GroupData } from "./types";

type Props = { organisationId: string; role: string; group: GroupData | null };
const RECORDS = ["owner", "admin", "secretary", "legal", "compliance"];
const today = () => new Date().toLocaleDateString("en-CA");

function ItemRow({ item, row, actions, evidence, locked, busy, onSave, onAddAction, onRemoveAction, onComplete }: {
  item: Item; row: AnswerRow | undefined; actions: Action[]; evidence?: string; locked: boolean; busy: boolean;
  onSave: (v: { answer: Answer | null; response: string; responsible: string }) => void;
  onAddAction: (a: { action: string; owner: string; due: string }) => void;
  onRemoveAction: (id: string) => void;
  onComplete: (id: string) => void;
}) {
  const [response, setResponse] = useState(row?.response ?? "");
  const [responsible, setResponsible] = useState(row?.responsible ?? "");
  const [adding, setAdding] = useState(false);
  const [act, setAct] = useState({ action: "", owner: "", due: "" });
  const [answer, setAnswer] = useState<Answer | null>(row?.answer ?? null);
  const save = (patch: Partial<{ answer: Answer | null; response: string; responsible: string }>) => {
    if (patch.answer !== undefined) setAnswer(patch.answer);
    onSave({ answer, response, responsible, ...patch });
  };
  const needs = answer === item.adverse && response.trim().length < 3 && actions.length === 0;
  return (
    <div className={`audit-item${needs ? " needs" : ""}`}>
      <p className="audit-q">{item.text}</p>
      {item.help && <p className="muted small">{item.help}</p>}
      {evidence && (
        <p className="evidence small">
          <strong>Common Seal shows:</strong> {evidence}
        </p>
      )}
      <div className="row wrap">
        {(["yes", "no", "na"] as Answer[]).map((a) => (
          <label key={a} className="check">
            <input type="radio" name={`la-${item.key}`} disabled={locked || busy} checked={answer === a} onChange={() => save({ answer: a })} /> {ANSWER_LABELS[a]}
          </label>
        ))}
        {item.responsible && (
          <input className="grow" aria-label={`Person responsible: ${item.text}`} placeholder="Person responsible" disabled={locked} value={responsible} onChange={(e) => setResponsible(e.target.value)} onBlur={() => responsible !== (row?.responsible ?? "") && save({})} />
        )}
      </div>
      <textarea
        rows={response.length > 80 ? 3 : 1}
        aria-label={`Comments: ${item.text}`}
        placeholder={answer === item.adverse ? "Comment needed, or agree an action" : "Comments and details"}
        disabled={locked}
        value={response}
        onChange={(e) => setResponse(e.target.value)}
        onBlur={() => response !== (row?.response ?? "") && save({})}
      />
      {needs && <p className="warning-text small">This answer needs a comment or an agreed action before sign-off.</p>}
      {actions.length > 0 && (
        <ul className="plain rows small">
          {actions.map((a) => (
            <li key={a.id} className="row spread">
              <span>
                <span className={a.done_at ? "chip" : a.due_on && a.due_on < today() ? "chip chip-alert" : "chip"}>{a.done_at ? "Done" : "Action"}</span> {a.action}
                <span className="muted">
                  {a.owner_name ? ` · ${a.owner_name}` : ""}
                  {a.due_on ? ` · by ${formatDay(a.due_on)}` : ""}
                  {a.done_at ? ` · done ${formatDay(a.done_at)}${a.done_note ? `: ${a.done_note}` : ""}` : ""}
                </span>
              </span>
              {!locked && (
                <button type="button" className="link-dark small" disabled={busy} onClick={() => onRemoveAction(a.id)}>
                  Remove
                </button>
              )}
              {locked && !a.done_at && (
                <button type="button" className="quiet" disabled={busy} onClick={() => onComplete(a.id)}>
                  Mark as done
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!locked &&
        (adding ? (
          <div className="row wrap">
            <input className="grow" aria-label="Agreed action" placeholder="Agreed action" value={act.action} onChange={(e) => setAct({ ...act, action: e.target.value })} />
            <input aria-label="Responsibility" placeholder="Who" value={act.owner} onChange={(e) => setAct({ ...act, owner: e.target.value })} />
            <input aria-label="Timeframe" type="date" value={act.due} onChange={(e) => setAct({ ...act, due: e.target.value })} />
            <button type="button" className="quiet" disabled={busy || act.action.trim().length < 5} onClick={() => { onAddAction(act); setAct({ action: "", owner: "", due: "" }); setAdding(false); }}>
              Add
            </button>
            <button type="button" className="link-dark small" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <button type="button" className="link-dark small" onClick={() => setAdding(true)}>
            Agree an action
          </button>
        ))}
    </div>
  );
}

export default function LegalAudit({ organisationId, role, group }: Props) {
  const canEdit = has(role, ...RECORDS);
  const canSign = canEdit || has(role, "director");
  const [data, setData] = useState<AuditData | null>(null);
  const [evidence, setEvidence] = useState<Evidence>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState({ title: `${new Date().getFullYear()} legal audit`, entity_id: "", country: "", audit_date: today(), auditor_name: "", with_names: "" });
  const [sign, setSign] = useState({ name: "", title: "" });

  const reload = useCallback(async () => {
    setData(await loadAudits(organisationId));
  }, [organisationId]);
  useEffect(() => {
    reload().catch((e) => setError(e instanceof Error ? e.message : "Could not load legal audits."));
    loadEvidence(organisationId).then(setEvidence, () => setEvidence({}));
  }, [reload, organisationId]);

  async function run(action: () => Promise<void>, done?: string, quiet = false) {
    if (!quiet) setBusy(true);
    setError(null);
    if (!quiet) setNotice(null);
    try {
      await action();
      await reload();
      if (done) setNotice(done);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      return false;
    } finally {
      if (!quiet) setBusy(false);
    }
  }

  if (!data) return error ? <p className="error">{error}</p> : <p className="lead">Loading…</p>;
  if (!data.ready) return <p className="card warning">Run migration 0040 to turn on the Legal Audit.</p>;
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
  const entityName = (id: string | null) => (id ? group?.entities.find((e) => e.id === id)?.name ?? "" : "");
  const progress = (a: Audit) => {
    const rows = data.answers.filter((x) => x.audit_id === a.id);
    const acts = data.actions.filter((x) => x.audit_id === a.id);
    const required = ALL_ITEMS.filter((i) => !i.optional);
    const answered = required.filter((i) => rows.some((r) => r.question_key === i.key && r.answer)).length;
    const needing = ALL_ITEMS.filter((i) => {
      const r = rows.find((x) => x.question_key === i.key);
      return r?.answer === i.adverse && (r.response ?? "").trim().length < 3 && !acts.some((t) => t.question_key === i.key);
    }).length;
    return { answered, total: required.length, needing, openActions: acts.filter((t) => !t.done_at).length, overdue: acts.filter((t) => !t.done_at && t.due_on && t.due_on < today()).length };
  };

  // ---- One audit ----
  const audit = openId ? data.audits.find((a) => a.id === openId) : undefined;
  if (audit) {
    const locked = audit.status === "signed_off" || !canEdit;
    const rows = data.answers.filter((x) => x.audit_id === audit.id);
    const acts = data.actions.filter((x) => x.audit_id === audit.id);
    const p = progress(audit);
    const header = (patch: Partial<Audit>) => void run(() => updateAudit(audit.id, patch), undefined, true);
    return (
      <>
        <button type="button" className="back no-print" onClick={() => { setOpenId(null); setError(null); setNotice(null); }}>
          ← Back to legal audits
        </button>
        <p className="eyebrow">Legal Audit · {audit.status === "signed_off" ? "Signed off" : "In progress"}</p>
        <h1>{audit.title}</h1>
        <p className="lead">
          {[entityName(audit.entity_id), audit.country, formatDay(audit.audit_date)].filter(Boolean).join(" · ")} · {p.answered} of {p.total} answered
          {p.needing ? ` · ${p.needing} need a comment or action` : ""}
          {p.openActions ? ` · ${p.openActions} open action${p.openActions === 1 ? "" : "s"}` : ""}
        </p>
        {messages}
        <section className="card form">
          <div className="row wrap">
            <span className="field">
              <label htmlFor="la-auditor">Audit carried out by</label>
              <input id="la-auditor" disabled={locked} defaultValue={audit.auditor_name ?? ""} onBlur={(e) => e.target.value !== (audit.auditor_name ?? "") && header({ auditor_name: e.target.value || null })} />
            </span>
            <span className="field grow">
              <label htmlFor="la-with">With (legal director, general manager, finance director)</label>
              <input id="la-with" disabled={locked} defaultValue={audit.with_names ?? ""} onBlur={(e) => e.target.value !== (audit.with_names ?? "") && header({ with_names: e.target.value || null })} />
            </span>
          </div>
          <label htmlFor="la-comments">Management comments</label>
          <textarea id="la-comments" rows={2} disabled={locked} defaultValue={audit.management_comments ?? ""} onBlur={(e) => e.target.value !== (audit.management_comments ?? "") && header({ management_comments: e.target.value || null })} />
        </section>

        {SECTIONS.map((s) => (
          <section key={s.id} className="block audit-section">
            <h2>{s.title}</h2>
            {s.questions.map((q) => (
              <div key={q.id} className="card audit-question">
                {q.items.length > 1 && <p className="audit-q">{q.text}</p>}
                {q.items.map((item) => (
                  <ItemRow
                    key={item.key}
                    item={q.items.length > 1 ? item : { ...item, text: q.text, help: q.help }}
                    row={rows.find((r) => r.question_key === item.key)}
                    actions={acts.filter((a) => a.question_key === item.key)}
                    evidence={item.evidence ? evidence[item.evidence] : undefined}
                    locked={locked}
                    busy={busy}
                    onSave={(v) => void run(() => saveAnswer(organisationId, audit.id, item.key, v), undefined, true)}
                    onAddAction={(a) => void run(() => addAction(organisationId, audit.id, item.key, a), "Action agreed.")}
                    onRemoveAction={(id) => void run(() => removeAction(id))}
                    onComplete={(id) => {
                      const note = window.prompt("How was it done? (optional)") ?? "";
                      void run(() => completeAction(id, note), "Marked as done.");
                    }}
                  />
                ))}
              </div>
            ))}
          </section>
        ))}

        {audit.status === "signed_off" ? (
          <section className="card block">
            <h2>Sign-off</h2>
            <p>
              Signed off by <strong>{audit.signed_off_name}</strong>, {audit.signed_off_title}
              {audit.signed_off_at ? `, ${formatWhen(audit.signed_off_at)}` : ""}.
            </p>
            <p className="muted small">The audit is locked. Agreed actions still open go into the next risk review under Legal and Compliance.</p>
          </section>
        ) : (
          canSign && (
            <section className="card form block no-print">
              <h2>Sign-off</h2>
              <p className="muted">By the general manager or finance director, once every question is answered and every adverse answer has a comment or an agreed action. The audit is then locked.</p>
              <div className="row wrap">
                <span className="field">
                  <label htmlFor="so-name">Name</label>
                  <input id="so-name" value={sign.name} onChange={(e) => setSign({ ...sign, name: e.target.value })} />
                </span>
                <span className="field">
                  <label htmlFor="so-title">Title</label>
                  <input id="so-title" placeholder="General Manager" value={sign.title} onChange={(e) => setSign({ ...sign, title: e.target.value })} />
                </span>
              </div>
              <button type="button" disabled={busy || p.answered < p.total || p.needing > 0} onClick={() => void run(() => signOff(audit.id, sign.name, sign.title), "Signed off.")}>
                Sign off
              </button>
              {(p.answered < p.total || p.needing > 0) && (
                <p className="muted small">
                  {p.total - p.answered ? `${p.total - p.answered} still to answer. ` : ""}
                  {p.needing ? `${p.needing} need a comment or action.` : ""}
                </p>
              )}
            </section>
          )
        )}
        <p className="row no-print">
          <button type="button" className="quiet" onClick={() => window.print()}>
            Print or save as PDF
          </button>
          {audit.status === "signed_off" && canEdit && (
            <button
              type="button"
              className="quiet"
              disabled={busy}
              onClick={() => {
                let id = "";
                void run(async () => {
                  id = await startFollowUp(audit.id, `${new Date().getFullYear() + (audit.audit_date.slice(0, 4) === String(new Date().getFullYear()) ? 1 : 0)} legal audit${audit.country ? `: ${audit.country}` : ""}`);
                }, "Next audit started, with this audit's answers to confirm or change.").then((ok) => ok && setOpenId(id));
              }}
            >
              Start the next audit from this one
            </button>
          )}
        </p>
      </>
    );
  }

  // ---- List ----
  return (
    <>
      <p className="eyebrow">Risk and compliance</p>
      <h1>Legal Audit</h1>
      <p className="lead">A periodic legal compliance review of a company or country, done with local management and signed off by the general manager or finance director. Where Common Seal already holds the answer, it is shown beside the question.</p>
      {messages}
      {data.audits.length === 0 ? (
        <p className="muted">No legal audits yet.</p>
      ) : (
        <ul className="entity-list">
          {data.audits.map((a) => {
            const p = progress(a);
            return (
              <li key={a.id}>
                <button type="button" className="entity-row" onClick={() => setOpenId(a.id)}>
                  <span>
                    <span className="entity-name">{a.title}</span>
                    <span className="muted">
                      {" "}
                      · {[entityName(a.entity_id), a.country, formatDay(a.audit_date)].filter(Boolean).join(" · ")}
                      {a.status === "open" ? ` · ${p.answered} of ${p.total} answered` : ""}
                      {p.openActions ? ` · ${p.openActions} open action${p.openActions === 1 ? "" : "s"}` : ""}
                    </span>
                    {p.overdue > 0 && <strong className="warning-text"> · {p.overdue} overdue</strong>}
                  </span>
                  <span className={a.status === "signed_off" ? "chip" : "chip chip-warn"}>{a.status === "signed_off" ? "Signed off" : "In progress"}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {canEdit && (
        <section className="card form">
          <h2>Start a legal audit</h2>
          <div className="row wrap">
            <span className="field grow">
              <label htmlFor="na-title">Title</label>
              <input id="na-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </span>
            <span className="field">
              <label htmlFor="na-date">Date of the audit</label>
              <input id="na-date" type="date" value={form.audit_date} onChange={(e) => setForm({ ...form, audit_date: e.target.value })} />
            </span>
          </div>
          <div className="row wrap">
            <span className="field">
              <label htmlFor="na-entity">Company</label>
              <select id="na-entity" value={form.entity_id} onChange={(e) => setForm({ ...form, entity_id: e.target.value })}>
                <option value="">The group</option>
                {group?.entities.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </span>
            <span className="field">
              <label htmlFor="na-country">Country</label>
              <input id="na-country" value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} />
            </span>
            <span className="field">
              <label htmlFor="na-auditor">Carried out by</label>
              <input id="na-auditor" value={form.auditor_name} onChange={(e) => setForm({ ...form, auditor_name: e.target.value })} />
            </span>
            <span className="field grow">
              <label htmlFor="na-with">With</label>
              <input id="na-with" placeholder="General manager, finance director" value={form.with_names} onChange={(e) => setForm({ ...form, with_names: e.target.value })} />
            </span>
          </div>
          <button
            type="button"
            disabled={busy || form.title.trim().length < 3}
            onClick={() => {
              let id = "";
              void run(async () => {
                id = await createAudit(organisationId, { title: form.title.trim(), entity_id: form.entity_id || null, country: form.country.trim() || null, audit_date: form.audit_date, auditor_name: form.auditor_name.trim() || null, with_names: form.with_names.trim() || null, management_comments: null });
              }).then((ok) => ok && setOpenId(id));
            }}
          >
            Start
          </button>
        </section>
      )}
    </>
  );
}
