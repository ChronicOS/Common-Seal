import { useCallback, useEffect, useState, type FormEvent } from "react";
import { formatDay, loadMembers, type Member } from "./board";
import {
  ACCEPTABLE_ACTIONS,
  closeConflict,
  declare,
  LEVELS,
  levelLabel,
  loadConflictOfficer,
  loadConflicts,
  NOT_ACCEPTABLE_ACTIONS,
  reviewConflict,
  setConflictOfficer,
  standing,
  TYPES,
  typeLabel,
  type ConflictRow,
  type ConflictType,
  type RiskLevel,
} from "./conflicts";
import { has, only } from "./roles";
import type { Entity } from "./types";

type Props = { organisationId: string; role: string; userId: string; entities: Entity[] };
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const levelClass = (l: RiskLevel | null) => (l === "actual" ? "chip chip-alert" : l === "potential" ? "chip chip-warn" : "chip");

/** The responsible person's review: acceptable or not, and what was done */
function Review({ c, busy, onSave, onCancel }: { c: ConflictRow; busy: boolean; onSave: (r: { outcome: "acceptable" | "not_acceptable"; actions: string[]; details: string; riskLevel: RiskLevel; reviewOn: string }) => void; onCancel: () => void }) {
  const [outcome, setOutcome] = useState<"acceptable" | "not_acceptable" | "">(c.outcome ?? "");
  const [actions, setActions] = useState<string[]>(c.outcome_actions ?? []);
  const [details, setDetails] = useState(c.outcome_details ?? "");
  const [level, setLevel] = useState<RiskLevel>(c.risk_level ?? "potential");
  const [review, setReview] = useState(c.review_on ?? "");
  const [error, setError] = useState<string | null>(null);
  const list = outcome === "not_acceptable" ? NOT_ACCEPTABLE_ACTIONS : ACCEPTABLE_ACTIONS;
  return (
    <div className="form review conflict-review">
      <fieldset className="plain-fieldset">
        <legend>Is the conflict acceptable?</legend>
        <label className="check option-help">
          <input type="radio" name={`oc-${c.id}`} checked={outcome === "acceptable"} onChange={() => { setOutcome("acceptable"); setActions([]); }} /> <strong>Acceptable</strong>
          <span className="muted"> · it can continue, with any action or mitigation recorded below</span>
        </label>
        <label className="check option-help">
          <input type="radio" name={`oc-${c.id}`} checked={outcome === "not_acceptable"} onChange={() => { setOutcome("not_acceptable"); setActions([]); }} /> <strong>Not acceptable</strong>
          <span className="muted"> · it must end; record the action taken</span>
        </label>
      </fieldset>
      {outcome && (
        <fieldset className="plain-fieldset">
          <legend>{outcome === "not_acceptable" ? "Action taken" : "Action or mitigation"}</legend>
          {list.map((a) => (
            <label key={a} className="check">
              <input type="checkbox" checked={actions.includes(a)} onChange={(e) => setActions(e.target.checked ? [...actions, a] : actions.filter((x) => x !== a))} /> {a}
            </label>
          ))}
        </fieldset>
      )}
      <label htmlFor={`dt-${c.id}`}>Details{actions.includes("Other") ? "" : " (optional)"}</label>
      <textarea id={`dt-${c.id}`} rows={2} placeholder={outcome === "not_acceptable" ? "e.g. Shares to be sold within 30 days; evidence of sale to be provided" : "e.g. Not to attend the pricing committee when the supplier is discussed"} value={details} onChange={(e) => setDetails(e.target.value)} />
      <div className="row">
        <span className="field">
          <label htmlFor={`lv-${c.id}`}>Risk level (assessed)</label>
          <select id={`lv-${c.id}`} value={level} onChange={(e) => setLevel(e.target.value as RiskLevel)}>
            {LEVELS.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </span>
        <span className="field">
          <label htmlFor={`rv-${c.id}`}>Review again on (optional)</label>
          <input id={`rv-${c.id}`} type="date" value={review} onChange={(e) => setReview(e.target.value)} />
        </span>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (!outcome) return setError("Record whether the conflict is acceptable.");
            if (actions.length === 0) return setError(outcome === "not_acceptable" ? "Record the action taken." : 'Record the action or mitigation, or choose "No further action needed".');
            if (actions.includes("Other") && details.trim().length < 5) return setError("Describe the other action in the details.");
            setError(null);
            onSave({ outcome, actions, details, riskLevel: level, reviewOn: review });
          }}
        >
          Save the review
        </button>
        <button type="button" className="quiet" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export default function Conflicts({ organisationId, role, userId, entities }: Props) {
  const isRecords = has(role, "owner", "admin", "secretary", "legal", "compliance");
  const [officer, setOfficer] = useState<{ ready: boolean; officer: string | null }>({ ready: false, officer: null });
  /** May this person review this conflict: the responsible person, or the records roles when nobody is nominated or the conflict is the responsible person's own */
  const canReview = (c: ConflictRow) =>
    c.person_user_id !== userId && (officer.officer === userId || (isRecords && (!officer.officer || officer.officer === c.person_user_id)));
  const canAssess = isRecords;
  const canDeclare = !only(role, "auditor");
  const [rows, setRows] = useState<ConflictRow[] | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [assessing, setAssessing] = useState<string | null>(null);
  const [filter, setFilter] = useState<{ status: string; type: string; level: string }>({ status: "current", type: "", level: "" });

  const [who, setWho] = useState<string>("me");
  const [otherName, setOtherName] = useState("");
  const [position, setPosition] = useState("");
  const [entityId, setEntityId] = useState("");
  const [type, setType] = useState<ConflictType | "">("");
  const [level, setLevel] = useState<RiskLevel | "">("");
  const [description, setDescription] = useState("");
  const [related, setRelated] = useState("");

  const reload = useCallback(async () => {
    const [list, people, off] = await Promise.all([loadConflicts(organisationId), loadMembers(organisationId).catch(() => []), loadConflictOfficer(organisationId).catch(() => ({ ready: false, officer: null }))]);
    setRows(list);
    setMembers(people);
    setOfficer(off);
  }, [organisationId]);
  useEffect(() => {
    reload().catch((e) => setError(e instanceof Error ? e.message : "Could not load the register."));
  }, [reload]);

  const run = async (work: () => Promise<void>, done?: string) => {
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

  if (!rows) return error ? <p className="error">{error}</p> : <p className="lead">Loading…</p>;

  const memberName = (id: string) => members.find((m) => m.user_id === id)?.name ?? "A member";
  const entityName = (id: string | null) => (id ? entities.find((e) => e.id === id)?.name ?? "A company" : null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const personUserId = who === "me" ? userId : who === "other" ? null : who;
    const personName = who === "other" ? otherName : memberName(personUserId!);
    if (who === "other" && otherName.trim().length < 2) return setError("Enter the person's name.");
    if (!type) return setError("Choose the type of conflict: personal or financial.");
    if (!level) return setError("Choose the risk level: actual, potential or perceived.");
    if (description.trim().length < 5) return setError("Describe the interest and how it could conflict with the person's duties.");
    const ok = await run(() => declare(organisationId, { personName, personUserId, position, entityId: entityId || null, type, level, description, relatedParty: related }), "Declared. It is now on the register for review.");
    if (ok) {
      setDescription("");
      setRelated("");
      setType("");
      setLevel("");
      setOtherName("");
    }
  }

  const shown = rows.filter(
    (c) =>
      (filter.status === "current" ? c.status !== "closed" : !filter.status || c.status === filter.status) &&
      (!filter.type || c.conflict_type === filter.type) &&
      (!filter.level || c.risk_level === filter.level),
  );
  const open = rows.filter((c) => c.status !== "closed");
  const unassessed = rows.filter((c) => c.status !== "closed" && !c.outcome).length;
  const actionsOpen = rows.filter((c) => c.status !== "closed" && c.outcome === "not_acceptable" && !c.action_complete_at).length;
  const actual = open.filter((c) => c.risk_level === "actual").length;
  const reviewDue = open.filter((c) => c.review_on && c.review_on <= today()).length;

  return (
    <>
      <p className="eyebrow">Conduct</p>
      <h1>Conflicts of interest</h1>
      <p className="lead">The register of declared conflicts: whose interest, what kind, how serious, and how it is being managed.</p>
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

      {officer.ready && (
        <section className={officer.officer ? "card form" : "card warning form"}>
          <h2>Responsible person</h2>
          <p className="muted">Reviews every conflict and records whether it is acceptable, and what action or mitigation was taken. Nobody reviews a conflict of their own; Legal, Compliance or the company secretary review the responsible person's own conflicts.</p>
          {isRecords ? (
            <select aria-label="Responsible person for conflicts of interest" value={officer.officer ?? ""} disabled={busy} onChange={(e) => void run(() => setConflictOfficer(organisationId, e.target.value || null), "Responsible person saved.")}>
              <option value="">Not nominated: Legal, Compliance or the company secretary review</option>
              {members
                .filter((m) => m.is_active)
                .map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.name}
                  </option>
                ))}
            </select>
          ) : (
            <p>{officer.officer ? memberName(officer.officer) : "Not nominated yet"}</p>
          )}
        </section>
      )}

      <dl className="facts">
        <div>
          <dt>Current</dt>
          <dd>{open.length}</dd>
        </div>
        <div>
          <dt>Awaiting review</dt>
          <dd className={unassessed ? "warning-text" : undefined}>{unassessed}</dd>
        </div>
        <div>
          <dt>Not acceptable: action in progress</dt>
          <dd className={actionsOpen ? "warning-text" : undefined}>{actionsOpen}</dd>
        </div>
        <div>
          <dt>Actual conflicts</dt>
          <dd className={actual ? "warning-text" : undefined}>{actual}</dd>
        </div>
        <div>
          <dt>Review due</dt>
          <dd className={reviewDue ? "warning-text" : undefined}>{reviewDue}</dd>
        </div>
      </dl>

      <div className="row block">
        <span className="field">
          <label htmlFor="cf-status">Showing</label>
          <select id="cf-status" value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })}>
            <option value="current">Current (open and managed)</option>
            <option value="open">Awaiting review</option>
            <option value="managed">Reviewed</option>
            <option value="closed">Closed</option>
            <option value="">All</option>
          </select>
        </span>
        <span className="field">
          <label htmlFor="cf-type">Type</label>
          <select id="cf-type" value={filter.type} onChange={(e) => setFilter({ ...filter, type: e.target.value })}>
            <option value="">Personal and financial</option>
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {typeLabel(t.value)}
              </option>
            ))}
          </select>
        </span>
        <span className="field">
          <label htmlFor="cf-level">Risk level</label>
          <select id="cf-level" value={filter.level} onChange={(e) => setFilter({ ...filter, level: e.target.value })}>
            <option value="">All levels</option>
            {LEVELS.map((l) => (
              <option key={l.value} value={l.value}>
                {levelLabel(l.value)}
              </option>
            ))}
          </select>
        </span>
      </div>

      {shown.length === 0 ? (
        <p className="muted">{rows.length === 0 ? "Nothing has been declared yet." : "Nothing matches these filters."}</p>
      ) : (
        <div className="table-scroll">
          <table className="report-table conflict-table">
            <thead>
              <tr>
                <th scope="col">Person</th>
                <th scope="col">Interest</th>
                <th scope="col">Type</th>
                <th scope="col">Risk level</th>
                <th scope="col">Review and action</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((c) => (
                <tr key={c.id}>
                  <th scope="row">
                    {c.person_name}
                    {c.person_position ? <span className="muted small"><br />{c.person_position}</span> : null}
                    <span className="muted small">
                      <br />
                      Declared {formatDay(c.declared_on)}
                    </span>
                  </th>
                  <td>
                    <span className="pre-wrap">{c.description}</span>
                    {(c.related_party || c.entity_id) && (
                      <span className="muted small">
                        <br />
                        {[c.related_party ? `With: ${c.related_party}` : "", entityName(c.entity_id) ? `Company: ${entityName(c.entity_id)}` : ""].filter(Boolean).join(" · ")}
                      </span>
                    )}
                  </td>
                  <td>{typeLabel(c.conflict_type)}</td>
                  <td>
                    <span className={levelClass(c.risk_level)}>{levelLabel(c.risk_level)}</span>
                  </td>
                  <td>
                    <span className={!c.outcome && c.status !== "closed" ? "warning-text" : c.outcome === "not_acceptable" && !c.action_complete_at && c.status !== "closed" ? "chip chip-alert" : undefined}>{standing(c)}</span>
                    {c.outcome_actions.length > 0 && <span className="small"><br />{c.outcome_actions.filter((a) => a !== "Other").join("; ")}</span>}
                    {c.outcome_details && <span className="small muted pre-wrap"><br />{c.outcome_details}</span>}
                    {!c.outcome && c.management_plan && <span className="small"><br />{c.management_plan}</span>}
                    {c.outcome_by && (
                      <span className="muted small">
                        <br />
                        Reviewed by {memberName(c.outcome_by)}
                        {c.outcome_at ? `, ${formatDay(c.outcome_at)}` : ""}
                      </span>
                    )}
                    {c.review_on && c.status !== "closed" && (
                      <span className={c.review_on <= today() ? "warning-text small" : "muted small"}>
                        <br />
                        Review {formatDay(c.review_on)}
                      </span>
                    )}
                    {officer.ready && canReview(c) && c.status !== "closed" && assessing !== c.id && (
                      <span className="row">
                        <button type="button" className="link-dark small" onClick={() => setAssessing(c.id)}>
                          {c.outcome ? "Update the review" : "Review"}
                        </button>
                        {c.outcome && (
                          <button
                            type="button"
                            className="link-dark small"
                            disabled={busy}
                            onClick={() => {
                              const note = window.prompt(c.outcome === "not_acceptable" ? "Close the conflict: confirm the action is complete (for example, the date the shares were sold)" : "Close the conflict: why it no longer exists (optional)", "");
                              if (note !== null) void run(() => closeConflict(c.id, note), "Closed.");
                            }}
                          >
                            {c.outcome === "not_acceptable" ? "Action complete: close" : "Close"}
                          </button>
                        )}
                      </span>
                    )}
                    {assessing === c.id && <Review c={c} busy={busy} onCancel={() => setAssessing(null)} onSave={(r) => void run(() => reviewConflict(c.id, r), "Review saved.").then((ok) => ok && setAssessing(null))} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canDeclare && (
        <form className="card form block" onSubmit={submit}>
          <h2>Declare a conflict of interest</h2>
          <div className="row">
            <span className="field">
              <label htmlFor="cd-who">Whose interest</label>
              <select id="cd-who" value={who} onChange={(e) => setWho(e.target.value)}>
                <option value="me">Mine</option>
                {canAssess &&
                  members
                    .filter((m) => m.is_active && m.user_id !== userId)
                    .map((m) => (
                      <option key={m.user_id} value={m.user_id}>
                        {m.name}
                      </option>
                    ))}
                {canAssess && <option value="other">Someone not in VeraPhius…</option>}
              </select>
            </span>
            {who === "other" && (
              <span className="field">
                <label htmlFor="cd-name">Their name</label>
                <input id="cd-name" value={otherName} onChange={(e) => setOtherName(e.target.value)} />
              </span>
            )}
            <span className="field">
              <label htmlFor="cd-position">Position (optional)</label>
              <input id="cd-position" placeholder="e.g. Director, Head of Procurement" value={position} onChange={(e) => setPosition(e.target.value)} />
            </span>
          </div>
          <fieldset className="plain-fieldset">
            <legend>Type of conflict</legend>
            {TYPES.map((t) => (
              <label key={t.value} className="check option-help">
                <input type="radio" name="cd-type" checked={type === t.value} onChange={() => setType(t.value)} /> <strong>{t.label}</strong>
                <span className="muted"> {t.help}</span>
              </label>
            ))}
          </fieldset>
          <fieldset className="plain-fieldset">
            <legend>Risk level</legend>
            {LEVELS.map((l) => (
              <label key={l.value} className="check option-help">
                <input type="radio" name="cd-level" checked={level === l.value} onChange={() => setLevel(l.value)} /> <strong>{l.label}</strong>
                <span className="muted"> {l.help}</span>
              </label>
            ))}
          </fieldset>
          <label htmlFor="cd-desc">The interest, and how it could conflict with the person's duties</label>
          <textarea id="cd-desc" rows={3} placeholder="e.g. Holds 5% of the shares in Acme Packaging, which is tendering to supply the group" value={description} onChange={(e) => setDescription(e.target.value)} />
          <div className="row">
            <span className="field">
              <label htmlFor="cd-related">Other party (optional)</label>
              <input id="cd-related" placeholder="e.g. Acme Packaging Pty Ltd" value={related} onChange={(e) => setRelated(e.target.value)} />
            </span>
            <span className="field">
              <label htmlFor="cd-entity">Company affected (optional)</label>
              <select id="cd-entity" value={entityId} onChange={(e) => setEntityId(e.target.value)}>
                <option value="">The group generally</option>
                {entities.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </span>
          </div>
          <p className="muted">A declaration cannot be edited once made; if it was wrong, declare again. The responsible person reviews it and records whether it is acceptable, and the action or mitigation. Directors must also declare material personal interests to the board.</p>
          <button type="submit" disabled={busy}>
            Declare
          </button>
        </form>
      )}
    </>
  );
}
