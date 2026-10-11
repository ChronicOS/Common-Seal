import { useCallback, useEffect, useState, type FormEvent } from "react";
import { formatDay } from "./board";
import {
  approveStatement,
  createStatement,
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
import { draftPart, MANDATORY, parseReport, REPORT_PARTS } from "./msreport";
import { today } from "./training";
import type { Entity } from "./types";

type Props = { organisationId: string; organisationName: string; role: string; entities: Entity[] };

const MANAGE_ROLES = ["owner", "admin", "secretary", "legal", "compliance"];
const RISK: Record<SupplierReview["risk"], string> = { low: "Low risk", medium: "Medium risk", high: "High risk" };

function Editor({
  heading,
  closing,
  initial,
  canEdit,
  busy,
  draftFor,
  onSave,
}: {
  heading: React.ReactNode;
  closing: React.ReactNode;
  initial: Record<number, string>;
  canEdit: boolean;
  busy: boolean;
  draftFor: (n: number) => string;
  onSave: (contents: Record<number, string>) => void;
}) {
  const [contents, setContents] = useState(initial);
  const set = (n: number, v: string) => setContents({ ...contents, [n]: v });
  const done = MANDATORY.filter((n) => (contents[n] ?? "").trim().length >= 20).length;
  const [reading, setReading] = useState(!canEdit);

  if (reading) {
    return (
      <section className="block report">
        <div className="row no-print">
          {canEdit && (
            <button type="button" className="quiet" onClick={() => setReading(false)}>
              Back to editing
            </button>
          )}
          <button type="button" className="quiet" onClick={() => window.print()}>
            Print or save as PDF
          </button>
        </div>
        {heading}
        {REPORT_PARTS.filter((part) => part.n !== 9 && ((contents[part.n] ?? "").trim() || MANDATORY.includes(part.n))).map((part) => (
          <div key={part.n} className="report-part">
            <h2>{part.title}</h2>
            {(contents[part.n] ?? "").trim() ? <ReportText content={contents[part.n]} /> : <p className="muted">Not yet written.</p>}
          </div>
        ))}
        {closing}
        {(contents[9] ?? "").trim() && (
          <div className="report-part">
            <h2>Appendix: questionnaire results</h2>
            <ReportText content={contents[9]} />
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="block">
      <h2>The report</h2>
      <p className="muted">
        {done} of 7 mandatory criteria addressed. Suggested wording is built from your own records, including the supplier survey linked to this
        statement. Text in square brackets is for you to write. Start a line with "# " for a sub-heading or "- " for a bullet.
      </p>
      <div className="row">
        <button
          type="button"
          className="quiet"
          onClick={() => {
            const next = { ...contents };
            for (const part of REPORT_PARTS) if (!(next[part.n] ?? "").trim() || part.n === 9) next[part.n] = draftFor(part.n);
            setContents(next);
          }}
        >
          Build the report from our records
        </button>
        <button type="button" className="quiet" onClick={() => setReading(true)}>
          Read as a report
        </button>
      </div>
      <p className="muted">"Build" fills every empty part and refreshes the questionnaire results appendix. It does not overwrite what you have written.</p>
      {REPORT_PARTS.map((part) => (
        <div key={part.n} className="card form criterion">
          <label htmlFor={`ms-${part.n}`}>
            {part.title}
            {part.criterion ? <span className="muted"> · {part.criterion}, mandatory</span> : <span className="muted"> · optional</span>}
          </label>
          <span className="muted">{part.guide}</span>
          <textarea id={`ms-${part.n}`} rows={part.n === 9 ? 6 : 7} value={contents[part.n] ?? ""} onChange={(e) => set(part.n, e.target.value)} />
          <button type="button" className="link-dark" onClick={() => set(part.n, part.n === 9 ? draftFor(9) : [contents[part.n]?.trim(), draftFor(part.n)].filter(Boolean).join("\n\n"))}>
            {part.n === 9 ? "Refresh from the survey" : "Suggest wording from our records"}
          </button>
        </div>
      ))}
      <button type="button" disabled={busy} onClick={() => onSave(contents)}>
        Save the report
      </button>
    </section>
  );
}

/** Report text: sub-headings, paragraphs, bullets and simple tables. No images. */
function ReportText({ content }: { content: string }) {
  return (
    <>
      {parseReport(content).map((b, i) =>
        b.kind === "heading" ? (
          <h3 key={i}>{b.text}</h3>
        ) : b.kind === "list" ? (
          <ul key={i}>
            {b.items.map((x, k) => (
              <li key={k}>{x}</li>
            ))}
          </ul>
        ) : b.kind === "table" ? (
          <table key={i} className="report-table">
            <thead>
              <tr>
                {b.rows[0].map((c, k) => (
                  <th key={k} scope="col">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.slice(1).map((row, r) => (
                <tr key={r}>
                  {row.map((c, k) => (k === 0 ? <th key={k} scope="row">{c}</th> : <td key={k}>{c}</td>))}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p key={i}>{b.text}</p>
        ),
      )}
    </>
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
        <div className="no-print">
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
        </div>
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
          heading={
            <>
              <p className="eyebrow">Modern Slavery Statement</p>
              <h1>{entityName(open.reporting_entity_id)}</h1>
              <p className="lead">
                Reporting period {formatDay(open.period_start)} to {formatDay(open.period_end)}
              </p>
            </>
          }
          closing={
            <>
              <div className="report-part">
                <h2>Approval</h2>
                {open.approved_on ? (
                  <p>
                    This statement was approved by {open.approved_body} on {formatDay(open.approved_on)}
                    {open.approval_method ? ` by ${open.approval_method === "meeting" ? "resolution at a board meeting" : "circular resolution"}` : ""}.
                  </p>
                ) : (
                  <p className="muted">Not yet approved. The approving body, date and signatory appear here once approval is recorded.</p>
                )}
                {open.ceo_signed_by && (
                  <p className="signature">
                    {open.ceo_signed_by}
                    <br />
                    {open.signed_role}
                  </p>
                )}
              </div>
              {open.is_joint && (
                <div className="report-part">
                  <h2>Appendix: entities covered by this statement</h2>
                  <ul>
                    {[open.reporting_entity_id, ...open.covered_entity_ids].map((id) => (
                      <li key={id}>
                        {entityName(id)}
                        {id === open.reporting_entity_id ? " (reporting entity)" : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          }
          initial={sections}
          canEdit={canEdit}
          busy={busy}
          draftFor={(n) => draftPart(n, open, entities, reviews, supplierName, facts)}
          onSave={(contents) => void run(() => saveSections(organisationId, open.id, contents), "Report saved.")}
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
