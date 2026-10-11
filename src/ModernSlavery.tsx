import { useCallback, useEffect, useState, type FormEvent } from "react";
import { formatDay } from "./board";
import {
  approveStatement,
  createStatement,
  CRITERIA,
  loadFacts,
  loadModernSlavery,
  publishStatement,
  setStatementScope,
  MS_STATUS,
  saveReview,
  saveSections,
  SUPPLIER_QUESTIONS,
  type MsData,
  type MsFacts,
  type Statement,
  type SupplierAnswers,
  type SupplierReview,
} from "./modernslavery";
import Attachments from "./Attachments";
import MsSurvey from "./MsSurvey";
import { today } from "./training";
import type { Entity } from "./types";

type Props = { organisationId: string; organisationName: string; role: string; entities: Entity[] };

const MANAGE_ROLES = ["owner", "admin", "secretary", "legal", "compliance"];
const RISK: Record<SupplierReview["risk"], string> = { low: "Low risk", medium: "Medium risk", high: "High risk" };

/** First-draft wording built from what the platform already holds. The writer edits it. */
function suggest(n: number, s: Statement, entities: Entity[], reviews: SupplierReview[], suppliers: MsData["suppliers"], facts: MsFacts | null): string {
  const entity = entities.find((e) => e.id === s.reporting_entity_id);
  const others = entities.filter((e) => e.id !== s.reporting_entity_id).map((e) => e.name);
  const count = (r: SupplierReview["risk"]) => reviews.filter((x) => x.risk === r).length;
  const high = reviews.filter((r) => r.risk === "high").map((r) => suppliers.find((x) => x.id === r.counterparty_id)?.name ?? "a supplier");
  switch (n) {
    case 1:
      return `This statement is made by ${entity?.name ?? "the reporting entity"}${entity?.acn ? ` (ACN ${entity.acn})` : ""} for the reporting period ${formatDay(s.period_start)} to ${formatDay(s.period_end)}.`;
    case 2:
      return `${entity?.name ?? "The entity"} ${others.length ? `owns or controls ${others.length} other ${others.length === 1 ? "entity" : "entities"}: ${others.join(", ")}.` : "does not own or control any other entity."} [Describe what the group does, where it operates, how many people it employs, and the main goods and services it buys and from where.]`;
    case 3:
      if (facts?.survey && facts.survey.answered > 0) {
        const v = facts.survey;
        return `We surveyed ${v.sent} third ${v.sent === 1 ? "party" : "parties"} in the period and ${v.answered} responded. We assessed each response for modern slavery risk using our annual spend with the third party and a country risk rating: ${v.high} rated high risk, ${v.medium} medium and ${v.low} low${v.unrated ? `, with ${v.unrated} not yet rated` : ""}. Their manufacturing facilities are located in ${v.countries.join(", ")}. ${v.concerns} ${v.concerns === 1 ? "response" : "responses"} raised a concern that was escalated to Legal. [Describe the risks in your own operations, and the sectors and countries that carry the most risk.]`;
      }
      return reviews.length
        ? `We reviewed ${reviews.length} ${reviews.length === 1 ? "supplier" : "suppliers"} in the period: ${count("high")} rated high risk, ${count("medium")} medium and ${count("low")} low.${high.length ? ` The high-risk ratings relate to ${high.join(", ")}.` : ""} [Describe the risks in your own operations, and the sectors and countries that carry the most risk in your supply chain.]`
        : "[No supplier reviews are recorded for this period. Describe the risks in your operations and supply chain, and how you identified them.]";
    case 4: {
      const v = facts?.survey;
      const parts = [
        v ? `sent our modern slavery questionnaire to ${v.sent} third ${v.sent === 1 ? "party" : "parties"} and received ${v.answered} ${v.answered === 1 ? "response" : "responses"}` : "",
        v && v.concerns > 0 ? `escalated ${v.concerns} ${v.concerns === 1 ? "concern" : "concerns"} to Legal, of which ${v.resolved} ${v.resolved === 1 ? "has" : "have"} been decided` : "",
        v && v.audits != null ? `carried out ${v.audits} third-party ${v.audits === 1 ? "audit" : "audits"}` : "",
        facts && facts.ddCases > 0 ? `opened ${facts.ddCases} due diligence ${facts.ddCases === 1 ? "case" : "cases"} on third parties` : "",
        reviews.length ? `completed ${reviews.length} supplier risk ${reviews.length === 1 ? "review" : "reviews"}` : "",
        facts && facts.trainingDone > 0 ? `recorded ${facts.trainingDone} ${facts.trainingDone === 1 ? "completion" : "completions"} of modern slavery training` : "",
        facts && facts.policies.length ? `kept these policies in force: ${facts.policies.join(", ")}` : "",
      ].filter(Boolean);
      const actions = reviews.filter((r) => r.actions).map((r) => `${suppliers.find((x) => x.id === r.counterparty_id)?.name ?? "A supplier"}: ${r.actions}`);
      return `${parts.length ? `In the period we ${parts.join("; ")}.` : "[Describe the due diligence, training and contract steps taken in the period.]"}${actions.length ? ` Actions agreed with suppliers: ${actions.join(" ")}` : ""} [Describe any remediation.]`;
    }
    case 5:
      if (facts?.survey) return `We track the response rate to our annual questionnaire (${facts.survey.answered} of ${facts.survey.sent} this period), the number of third parties in each risk rating, and the concerns escalated to Legal and how they were decided, and compare each with the prior year. [Describe reporting to the board and any other measures.]`;
      return "[Describe how you check that these actions work, for example tracking supplier ratings from year to year, reviewing reports raised through the speak-up channel, and reporting to the board.]";
    case 6:
      return others.length
        ? `[Describe how ${others.join(", ")} ${others.length === 1 ? "was" : "were"} consulted, for example through shared policies, common directors or review of this statement in draft.]`
        : `${entity?.name ?? "The entity"} does not own or control any other entity, so no consultation was required.`;
    default:
      return "There is no other relevant information.";
  }
}

function Editor({
  statement,
  initial,
  canEdit,
  busy,
  draftFor,
  onSave,
}: {
  statement: Statement;
  initial: Record<number, string>;
  canEdit: boolean;
  busy: boolean;
  draftFor: (n: number) => string;
  onSave: (contents: Record<number, string>) => void;
}) {
  const [contents, setContents] = useState(initial);
  const set = (n: number, v: string) => setContents({ ...contents, [n]: v });
  const done = CRITERIA.filter((c) => (contents[c.n] ?? "").trim().length >= 20).length;
  return (
    <section className="block">
      <h2>The statement</h2>
      <p className="muted">
        {done} of 7 mandatory criteria addressed.{canEdit ? " Suggested wording comes from your own records and is a starting point; text in square brackets is for you to write." : ""}
      </p>
      {CRITERIA.map((c) => (
        <div key={c.n} className="card form criterion">
          <label htmlFor={`ms-${c.n}`}>
            {c.n}. {c.title}
          </label>
          <span className="muted">{c.guide}</span>
          {canEdit ? (
            <>
              <textarea id={`ms-${c.n}`} rows={5} value={contents[c.n] ?? ""} onChange={(e) => set(c.n, e.target.value)} />
              <button type="button" className="link-dark" onClick={() => set(c.n, [contents[c.n]?.trim(), draftFor(c.n)].filter(Boolean).join("\n\n"))}>
                Suggest wording from our records
              </button>
            </>
          ) : (
            <p className="pre-wrap">{contents[c.n] || "Not yet written."}</p>
          )}
        </div>
      ))}
      {canEdit && (
        <button type="button" disabled={busy} onClick={() => onSave(contents)}>
          Save the statement
        </button>
      )}
      {statement.status !== "draft" && (
        <button type="button" className="quiet no-print" onClick={() => window.print()}>
          Print or save as PDF
        </button>
      )}
    </section>
  );
}

export default function ModernSlavery({ organisationId, organisationName, role, entities }: Props) {
  const canManage = MANAGE_ROLES.includes(role);

  const [data, setData] = useState<MsData | null>(null);
  const [facts, setFacts] = useState<MsFacts | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [entityId, setEntityId] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  const [supplierId, setSupplierId] = useState("");
  const [answers, setAnswers] = useState<SupplierAnswers>({});
  const [actions, setActions] = useState("");

  const [body, setBody] = useState("");
  const [approvedOn, setApprovedOn] = useState(today);
  const [method, setMethod] = useState("meeting");
  const [ceo, setCeo] = useState("");
  const [websiteOn, setWebsiteOn] = useState(today);
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [lodgedOn, setLodgedOn] = useState(today);
  const [band, setBand] = useState("");
  const [holder, setHolder] = useState("");
  const [onWebsite, setOnWebsite] = useState(false);
  const [surveyOpen, setSurveyOpen] = useState(false);

  const reload = useCallback(async () => {
    setData(await loadModernSlavery(organisationId));
  }, [organisationId]);

  useEffect(() => {
    reload().catch((e) => setError(e instanceof Error ? e.message : "Could not load modern slavery statements."));
  }, [reload]);

  const open = data?.statements.find((s) => s.id === openId);
  useEffect(() => {
    setFacts(null);
    if (open) loadFacts(organisationId, open).then(setFacts, () => setFacts(null));
    // Only the statement being opened matters here
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId, organisationId]);

  async function run(action: () => Promise<void>, done?: string): Promise<boolean> {
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

  if (!data) {
    return error ? (
      <p className="error" role="alert">
        {error}
      </p>
    ) : (
      <p className="lead">Loading…</p>
    );
  }

  const entityName = (id: string) => entities.find((e) => e.id === id)?.name ?? "Unknown entity";
  const late = (s: Statement) => s.status !== "lodged" && s.due_on < today();
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

  if (open) {
    const reviews = data.reviews.filter((r) => r.statement_id === open.id);
    const sections = Object.fromEntries(data.sections.filter((x) => x.statement_id === open.id).map((x) => [x.criterion, x.content]));
    const canEdit = canManage && open.status === "draft";
    const supplierName = (id: string) => data.suppliers.find((x) => x.id === id)?.name ?? "Unknown supplier";
    return (
      <>
        <p className="no-print">
          <button
            type="button"
            className="link-dark"
            onClick={() => {
              setOpenId(null);
              setError(null);
              setNotice(null);
            }}
          >
            ← Back to statements
          </button>
        </p>
        <p className="eyebrow">Modern slavery statement</p>
        <h1>{entityName(open.reporting_entity_id)}</h1>
        <p className="lead">
          <span className={late(open) ? "chip chip-alert" : "chip"}>{late(open) ? "Overdue" : MS_STATUS[open.status]}</span> {formatDay(open.period_start)} to{" "}
          {formatDay(open.period_end)} · due {formatDay(open.due_on)}
        </p>
        {open.approved_on && (
          <p className="card">
            Approved by {open.approved_body} on {formatDay(open.approved_on)}
            {open.approval_method ? ` by ${open.approval_method === "meeting" ? "board meeting" : "circular resolution"}` : ""}. Signed by {open.ceo_signed_by ?? open.signed_by},{" "}
            {open.signed_role}.
            {open.website_published_on ? ` Published on the website on ${formatDay(open.website_published_on)}${open.website_url ? ` (${open.website_url})` : ""}.` : ""}
            {open.lodged_on ? ` Lodged on the register on ${formatDay(open.lodged_on)}${open.is_joint ? " as a joint statement" : ""}${open.revenue_band ? `, revenue band ${open.revenue_band}` : ""}.` : ""}
          </p>
        )}
        {messages}

        <section className="block no-print">
          <h2>Scope and report content</h2>
          {open.is_joint && (
            <p>
              Joint statement covering {entityName(open.reporting_entity_id)} and {open.covered_entity_ids.map(entityName).join(", ")}.
            </p>
          )}
          {canEdit ? (
            <div className="card form">
              <label className="check">
                <input
                  type="checkbox"
                  checked={open.is_joint}
                  disabled={busy || entities.length < 2}
                  onChange={(e) =>
                    void run(() =>
                      setStatementScope(open.id, e.target.checked, e.target.checked ? entities.filter((x) => x.id !== open.reporting_entity_id).map((x) => x.id) : [], open.product_info_checked),
                    )
                  }
                />{" "}
                This is a joint statement covering other group entities
              </label>
              {open.is_joint &&
                entities
                  .filter((x) => x.id !== open.reporting_entity_id)
                  .map((x) => (
                    <label key={x.id} className="check indent">
                      <input
                        type="checkbox"
                        checked={open.covered_entity_ids.includes(x.id)}
                        disabled={busy}
                        onChange={(e) =>
                          void run(() =>
                            setStatementScope(open.id, true, e.target.checked ? [...open.covered_entity_ids, x.id] : open.covered_entity_ids.filter((id) => id !== x.id), open.product_info_checked),
                          )
                        }
                      />{" "}
                      {x.name}
                    </label>
                  ))}
              <label className="check">
                <input
                  type="checkbox"
                  checked={open.product_info_checked}
                  disabled={busy}
                  onChange={(e) => void run(() => setStatementScope(open.id, open.is_joint, open.covered_entity_ids, e.target.checked))}
                />{" "}
                Product information, imagery and pack shots in the report are up to date
              </label>
              <Attachments subjectTable="ms_statements" subjectId={open.id} canAttach={canEdit} label="Report, imagery and pack shots" />
            </div>
          ) : (
            <Attachments subjectTable="ms_statements" subjectId={open.id} canAttach={false} label="Report, imagery and pack shots" />
          )}
        </section>

        <section className="block no-print">
          <h2>Supplier reviews</h2>
          <p className="muted">Quick internal reviews. Answers from suppliers themselves are in the supplier survey.</p>
          {reviews.length === 0 ? (
            <p className="muted">No suppliers reviewed for this period.</p>
          ) : (
            <ul className="plain rows">
              {reviews.map((r) => (
                <li key={r.id} className="row spread">
                  <span>
                    <strong>{supplierName(r.counterparty_id)}</strong>
                    <br />
                    <span className="muted">
                      {SUPPLIER_QUESTIONS.filter((q) => r.answers[q.key]).map((q) => q.label.split(" (")[0]).join(" · ") || "No risk factors ticked"}
                    </span>
                    {r.actions && (
                      <>
                        <br />
                        Action: {r.actions}
                      </>
                    )}
                  </span>
                  <span className={r.risk === "high" ? "chip chip-alert" : "chip"}>{RISK[r.risk]}</span>
                </li>
              ))}
            </ul>
          )}
          {canEdit &&
            (data.suppliers.length === 0 ? (
              <p className="muted">Add suppliers under Third parties to review them here.</p>
            ) : (
              <form
                className="card form"
                onSubmit={(e: FormEvent) => {
                  e.preventDefault();
                  if (!supplierId) return setError("Choose a supplier.");
                  void run(() => saveReview(organisationId, open.id, supplierId, answers, actions)).then((ok) => {
                    if (!ok) return;
                    setSupplierId("");
                    setAnswers({});
                    setActions("");
                  });
                }}
              >
                <h3>Review a supplier</h3>
                <label htmlFor="ms-supplier">Supplier</label>
                <select
                  id="ms-supplier"
                  value={supplierId}
                  onChange={(e) => {
                    const existing = reviews.find((r) => r.counterparty_id === e.target.value);
                    setSupplierId(e.target.value);
                    setAnswers(existing?.answers ?? {});
                    setActions(existing?.actions ?? "");
                  }}
                >
                  <option value="">Choose…</option>
                  {data.suppliers.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
                {SUPPLIER_QUESTIONS.map((q) => (
                  <label key={q.key} className="check">
                    <input type="checkbox" checked={Boolean(answers[q.key])} onChange={(e) => setAnswers({ ...answers, [q.key]: e.target.checked })} /> {q.label}
                  </label>
                ))}
                <label htmlFor="ms-actions">Action agreed (optional)</label>
                <input id="ms-actions" value={actions} onChange={(e) => setActions(e.target.value)} />
                <p className="muted">The rating is worked out from the answers. Reviewing a supplier again replaces the earlier review.</p>
                <button type="submit" className="quiet" disabled={busy}>
                  Save review
                </button>
              </form>
            ))}
        </section>

        <Editor
          key={`${open.id}-${open.status}`}
          statement={open}
          initial={sections}
          canEdit={canEdit}
          busy={busy}
          draftFor={(n) => suggest(n, open, entities, reviews, data.suppliers, facts)}
          onSave={(contents) => void run(() => saveSections(organisationId, open.id, contents), "Statement saved.")}
        />

        {canManage && open.status === "draft" && (
          <form
            className="card form no-print"
            onSubmit={(e) => {
              e.preventDefault();
              if (window.confirm("Record approval? The statement and supplier reviews can no longer be changed.")) {
                void run(() => approveStatement(open.id, body, approvedOn, method, ceo), "Approval recorded. The statement is now fixed.");
              }
            }}
          >
            <h2>Record board approval</h2>
            <p className="muted">
              The final report is signed off by the board, at a meeting or by circular resolution, and carries the signature of the CEO or Managing
              Director. Save the statement first.
            </p>
            <label htmlFor="ms-body">Approved by</label>
            <input id="ms-body" placeholder={`e.g. Board of ${entityName(open.reporting_entity_id)}`} value={body} onChange={(e) => setBody(e.target.value)} />
            <div className="row">
              <span className="field">
                <label htmlFor="ms-method">How</label>
                <select id="ms-method" value={method} onChange={(e) => setMethod(e.target.value)}>
                  <option value="meeting">Board meeting</option>
                  <option value="circular">Circular resolution (by email)</option>
                </select>
              </span>
              <span className="field">
                <label htmlFor="ms-on">On</label>
                <input id="ms-on" type="date" max={today()} value={approvedOn} onChange={(e) => setApprovedOn(e.target.value)} />
              </span>
              <span className="field">
                <label htmlFor="ms-ceo">CEO or Managing Director who signed</label>
                <input id="ms-ceo" value={ceo} onChange={(e) => setCeo(e.target.value)} />
              </span>
            </div>
            <button type="submit" disabled={busy}>
              Record approval
            </button>
          </form>
        )}
        {canManage && open.status === "approved" && (
          <form
            className="card form no-print"
            onSubmit={(e) => {
              e.preventDefault();
              if (!onWebsite) return setError("Tick the box to confirm the report is on the entity's website.");
              void run(() => publishStatement(open.id, { websiteOn, websiteUrl, registerOn: lodgedOn, revenueBand: band, accountHolder: holder }), "Publication recorded.");
            }}
          >
            <h2>Record publication</h2>
            <p>
              Due by <strong>{formatDay(open.due_on)}</strong>. The report must be published in two places.
            </p>
            <label className="check">
              <input type="checkbox" checked={onWebsite} onChange={(e) => setOnWebsite(e.target.checked)} /> The report is published on the entity's website
            </label>
            <div className="row">
              <span className="field">
                <label htmlFor="ms-web-on">Website date</label>
                <input id="ms-web-on" type="date" max={today()} value={websiteOn} onChange={(e) => setWebsiteOn(e.target.value)} />
              </span>
              <span className="field grow">
                <label htmlFor="ms-web-url">Web address (optional)</label>
                <input id="ms-web-url" type="url" value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} />
              </span>
            </div>
            <h3>Australian Modern Slavery Register</h3>
            <ul>
              <li>
                Lodge at{" "}
                <a href="https://modernslaveryregister.gov.au/" target="_blank" rel="noreferrer">
                  modernslaveryregister.gov.au
                </a>
                , signing in with the entity's register account.
              </li>
              <li>The register sends a passcode by SMS to the account holder's mobile, so they need to be available.</li>
              <li>
                {open.is_joint ? "Specify that this is a joint statement" : "This is recorded as a single-entity statement"}, enter {entityName(open.reporting_entity_id)} as the reporting
                entity name, and select the band of annual consolidated revenue.
              </li>
            </ul>
            <div className="row">
              <span className="field">
                <label htmlFor="ms-lodged">Lodged on the register</label>
                <input id="ms-lodged" type="date" max={today()} value={lodgedOn} onChange={(e) => setLodgedOn(e.target.value)} />
              </span>
              <span className="field">
                <label htmlFor="ms-band">Revenue band selected</label>
                <input id="ms-band" placeholder="As shown on the register" value={band} onChange={(e) => setBand(e.target.value)} />
              </span>
              <span className="field">
                <label htmlFor="ms-holder">Register account holder</label>
                <input id="ms-holder" placeholder="Name of the person" value={holder} onChange={(e) => setHolder(e.target.value)} />
              </span>
            </div>
            <p className="muted">The register password is not stored here. Keep it in your password manager.</p>
            <button type="submit" disabled={busy}>
              Record publication
            </button>
          </form>
        )}
      </>
    );
  }

  const survey = (
    <MsSurvey
      organisationId={organisationId}
      organisationName={organisationName}
      role={role}
      statements={data.statements.map((x) => ({ id: x.id, label: `${entityName(x.reporting_entity_id)}, period to ${formatDay(x.period_end)}` }))}
      onOpenChange={setSurveyOpen}
    />
  );
  // The survey stays in the same place in the page whether or not one is open, so it keeps its state
  return (
    <>
      {!surveyOpen && (
        <>
          <p className="eyebrow">Annual reporting</p>
          <h1>Modern slavery</h1>
          <p className="lead">Survey your third parties, assess the risk, then write, approve and publish the statement.</p>
          {messages}
        </>
      )}
      {survey}
      {!surveyOpen && (
        <>
      <section className="block">
        <h2>Statements</h2>
        {data.statements.length === 0 ? (
          <p className="muted">No statements yet.</p>
        ) : (
          <ul className="entity-list">
            {data.statements.map((s) => (
              <li key={s.id}>
                <button type="button" className="entity-row" onClick={() => setOpenId(s.id)}>
                  <span>
                    <span className="entity-name">{entityName(s.reporting_entity_id)}</span>
                    <br />
                    <span className="muted">
                      {formatDay(s.period_start)} to {formatDay(s.period_end)} · due {formatDay(s.due_on)}
                    </span>
                  </span>
                  <span className={late(s) ? "chip chip-alert" : "chip"}>{late(s) ? "Overdue" : MS_STATUS[s.status]}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {canManage && (
        <form
          className="card form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!entityId || !start || !end) return setError("Choose the reporting entity and both dates.");
            if (end <= start) return setError("The period must end after it starts.");
            let id = "";
            void run(async () => {
              id = await createStatement(organisationId, entityId, start, end);
            }).then((ok) => ok && setOpenId(id));
          }}
        >
          <h2>Start a statement</h2>
          <label htmlFor="msn-entity">Reporting entity</label>
          <select id="msn-entity" value={entityId} onChange={(e) => setEntityId(e.target.value)}>
            <option value="">Choose…</option>
            {entities.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
          <div className="row">
            <span className="field">
              <label htmlFor="msn-start">Reporting period starts</label>
              <input id="msn-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </span>
            <span className="field">
              <label htmlFor="msn-end">Ends</label>
              <input id="msn-end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
            </span>
          </div>
          <p className="muted">
            The due date is set to six months after the period ends. Whether an entity must report depends on its consolidated
            revenue; check the current threshold. Others may report voluntarily.
          </p>
          <button type="submit" disabled={busy}>
            Start
          </button>
        </form>
      )}
        </>
      )}
    </>
  );
}
