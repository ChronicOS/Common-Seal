import { useCallback, useEffect, useState, type FormEvent } from "react";
import { money } from "./authority";
import { formatDay } from "./board";
import {
  addRecipient,
  buildEmail,
  closeCampaign,
  createCampaign,
  decideConcern,
  emailDue,
  importCountryRatings,
  loadSurveys,
  SECTOR_PACKS,
  markSent,
  rateCampaign,
  removeRecipient,
  RISK_LABEL,
  surveyLink,
  today,
  updateCampaign,
  type Campaign,
  type EmailKind,
  type Recipient,
  type SurveyData,
} from "./mssurvey";

type Props = { organisationId: string; organisationName: string; role: string; statements: { id: string; label: string }[]; onOpenChange: (open: boolean) => void };

const MANAGE_ROLES = ["owner", "admin", "secretary", "legal", "compliance"];
const LEGAL_ROLES = ["owner", "admin", "legal", "compliance"];
const EMAIL_NAME: Record<EmailKind, string> = { cover: "Cover email", chaser1: "Chaser 1", chaser2: "Chaser 2" };
const plusDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** A ring split into parts. The legend beside it carries the numbers, so nothing depends on colour alone. */
function Ring({ parts, label }: { parts: { name: string; value: number; tone: string }[]; label: string }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  const R = 42;
  const C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <div className="ring">
      <svg viewBox="0 0 120 120" width="150" height="150" role="img" aria-label={`${label}: ${parts.map((p) => `${p.value} ${p.name.toLowerCase()}`).join(", ")}`}>
        <circle cx="60" cy="60" r={R} className="ring-track" />
        {total > 0 &&
          parts
            .filter((p) => p.value > 0)
            .map((p) => {
              const length = (p.value / total) * C;
              const el = <circle key={p.name} cx="60" cy="60" r={R} className={`ring-part tone-${p.tone}`} strokeDasharray={`${Math.max(0, length - 1.5)} ${C}`} strokeDashoffset={-offset} transform="rotate(-90 60 60)" />;
              offset += length;
              return el;
            })}
        <text x="60" y="58" textAnchor="middle" className="ring-number">
          {total}
        </text>
        <text x="60" y="74" textAnchor="middle" className="ring-caption">
          {label}
        </text>
      </svg>
      <ul className="plain legend">
        {parts.map((p) => (
          <li key={p.name}>
            <span className={`swatch tone-${p.tone}`} aria-hidden="true" /> {p.name} <strong>{p.value}</strong>
            {total > 0 && <span className="muted"> · {Math.round((p.value / total) * 100)}%</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ConcernDecision({ busy, onDecide }: { busy: boolean; onDecide: (decision: string) => void }) {
  const [text, setText] = useState("");
  return (
    <div className="row review">
      <input className="grow" aria-label="Decision and reason" placeholder="What was decided, and why" value={text} onChange={(e) => setText(e.target.value)} />
      <button type="button" className="quiet" disabled={busy} onClick={() => onDecide(text)}>
        Record decision
      </button>
    </div>
  );
}

export default function MsSurvey({ organisationId, organisationName, role, statements, onOpenChange }: Props) {
  const canManage = MANAGE_ROLES.includes(role);
  const isLegal = LEGAL_ROLES.includes(role);

  const [data, setData] = useState<SurveyData | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [viewId, setViewId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState(`${new Date().getFullYear()} supplier survey`);
  const [deadline, setDeadline] = useState(() => plusDays(today(), 28));
  const [sender, setSender] = useState("");
  const [statementId, setStatementId] = useState("");
  const [sectorPack, setSectorPack] = useState("");

  const [supplierId, setSupplierId] = useState("");
  const [contact, setContact] = useState("");
  const [email, setEmail] = useState("");
  const [spend, setSpend] = useState("");

  const [pasted, setPasted] = useState("");
  const [source, setSource] = useState("");
  const [editing, setEditing] = useState<Partial<Campaign> | null>(null);

  const reload = useCallback(async () => {
    setData(await loadSurveys(organisationId));
  }, [organisationId]);

  useEffect(() => {
    reload().catch((e) => setError(e instanceof Error ? e.message : "Could not load the supplier survey."));
  }, [reload]);

  useEffect(() => {
    onOpenChange(openId !== null);
  }, [openId, onOpenChange]);

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

  if (!data) return error ? <p className="muted">The supplier survey is not available yet: {error}</p> : <p className="muted">Loading the supplier survey…</p>;

  const supplierName = (id: string) => data.suppliers.find((s) => s.id === id)?.name ?? "Unknown third party";
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

  const c = data.campaigns.find((x) => x.id === openId);
  if (!c) {
    return (
      <section className="block">
        <h2>Supplier surveys</h2>
        {messages}
        {data.campaigns.length === 0 ? (
          <p className="muted">No survey has been run yet.</p>
        ) : (
          <ul className="entity-list">
            {data.campaigns.map((x) => {
              const rs = data.recipients.filter((r) => r.campaign_id === x.id);
              return (
                <li key={x.id}>
                  <button type="button" className="entity-row" onClick={() => setOpenId(x.id)}>
                    <span>
                      <span className="entity-name">{x.name}</span>
                      <br />
                      <span className="muted">
                        Responses due {formatDay(x.deadline)}
                        {canManage ? ` · ${rs.filter((r) => r.submitted_at).length} of ${rs.length} answered` : ""}
                      </span>
                    </span>
                    <span className={x.status === "open" && x.deadline < today() ? "chip chip-alert" : "chip"}>
                      {x.status === "closed" ? "Closed" : x.deadline < today() ? "Past deadline" : "Open"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {canManage && (
          <form
            className="card form"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              if (name.trim().length < 3) return setError("Name the survey.");
              if (deadline <= today()) return setError("Choose a deadline in the future.");
              let id = "";
              void run(async () => {
                const gap = Math.max(2, Math.floor((new Date(deadline).getTime() - Date.now()) / 86400000 / 3));
                id = await createCampaign(organisationId, {
                  name,
                  year: Number(deadline.slice(0, 4)),
                  deadline,
                  chaser1: plusDays(today(), gap),
                  chaser2: plusDays(today(), gap * 2),
                  sender,
                  statementId: statementId || null,
                  sectorPack: sectorPack || null,
                });
              }).then((ok) => ok && setOpenId(id));
            }}
          >
            <h3>Start a survey</h3>
            <div className="row">
              <span className="field">
                <label htmlFor="sv-name">Name</label>
                <input id="sv-name" value={name} onChange={(e) => setName(e.target.value)} />
              </span>
              <span className="field">
                <label htmlFor="sv-deadline">Responses due</label>
                <input id="sv-deadline" type="date" min={today()} value={deadline} onChange={(e) => setDeadline(e.target.value)} />
              </span>
            </div>
            <label htmlFor="sv-sender">Emails are sent from (optional)</label>
            <input id="sv-sender" type="email" placeholder="e.g. modernslavery@yourcompany.com" value={sender} onChange={(e) => setSender(e.target.value)} />
            <label htmlFor="sv-pack">Extra sector questions (optional)</label>
            <select id="sv-pack" value={sectorPack} onChange={(e) => setSectorPack(e.target.value)}>
              <option value="">Core questions only</option>
              {SECTOR_PACKS.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
            <label htmlFor="sv-statement">Feeds the statement (optional)</label>
            <select id="sv-statement" value={statementId} onChange={(e) => setStatementId(e.target.value)}>
              <option value="">Not linked yet</option>
              {statements.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            <p className="muted">The deadline defaults to four weeks from today, which is twenty business days. The two chasers are spaced evenly before it. You can change the dates and the email wording afterwards.</p>
            <button type="submit" disabled={busy}>
              Start
            </button>
          </form>
        )}
      </section>
    );
  }

  // ---- One survey ----
  const rs = data.recipients.filter((r) => r.campaign_id === c.id);
  const concerns = data.concerns.filter((k) => k.campaign_id === c.id);
  const answered = rs.filter((r) => r.submitted_at);
  const opened = rs.filter((r) => !r.submitted_at && r.opened_at);
  const silent = rs.filter((r) => !r.submitted_at && !r.opened_at);
  const due = rs.map((r) => ({ r, kind: emailDue(c, r, today()) })).filter((x): x is { r: Recipient; kind: EmailKind } => x.kind !== null);
  const level = (l: Recipient["risk_level"]) => answered.filter((r) => r.risk_level === l).length;
  const questionOf = (code: string) => data.questions.find((q) => q.code === code);
  const prior = data.campaigns.find((x) => x.survey_year === c.survey_year - 1);
  const auditYes = (campaignId: string) => data.recipients.filter((r) => r.campaign_id === campaignId && r.answers?.audits_suppliers?.a === "yes").length;
  const open = c.status === "open";
  const viewing = rs.find((r) => r.id === viewId);
  const status = (r: Recipient) => (r.submitted_at ? `Answered ${formatDay(r.submitted_at)}` : r.opened_at ? "Opened, not finished" : r.cover_sent_at ? "Sent, not opened" : "Not sent yet");
  const edit = editing ?? {};
  const value = <K extends keyof Campaign>(k: K): Campaign[K] => (k in edit ? (edit[k] as Campaign[K]) : c[k]);

  return (
    <>
      <p className="no-print">
        <button
          type="button"
          className="link-dark"
          onClick={() => {
            setOpenId(null);
            setViewId(null);
            setEditing(null);
            setError(null);
            setNotice(null);
          }}
        >
          ← Back to modern slavery
        </button>
      </p>
      <p className="eyebrow">Supplier survey</p>
      <h1>{c.name}</h1>
      <p className="lead">
        <span className={open && c.deadline < today() ? "chip chip-alert" : "chip"}>{!open ? "Closed" : c.deadline < today() ? "Past deadline" : "Open"}</span> Responses due{" "}
        {formatDay(c.deadline)}
        {c.sender_email ? ` · emails from ${c.sender_email}` : ""}
        {c.sector_pack ? ` · includes ${c.sector_pack} questions` : ""}
      </p>
      {messages}
      {!canManage && <p className="card">Supplier answers are visible to legal, compliance and the company secretary.</p>}

      {canManage && (
        <>
          <section className="block">
            <h2>Dashboard</h2>
            <div className="dash">
              <Ring
                label="surveyed"
                parts={[
                  { name: "Answered", value: answered.length, tone: "good" },
                  { name: "Opened, not finished", value: opened.length, tone: "mid" },
                  { name: "No response", value: silent.length, tone: "none" },
                ]}
              />
              <Ring
                label="answered"
                parts={[
                  { name: "High risk", value: level("high"), tone: "bad" },
                  { name: "Medium risk", value: level("medium"), tone: "mid" },
                  { name: "Low risk", value: level("low"), tone: "good" },
                  { name: "Not rated", value: level(null), tone: "none" },
                ]}
              />
            </div>
            <div className="tiles">
              <div className="card">
                <h3>Concerns for Legal</h3>
                <p className="big-number">{concerns.filter((k) => k.status === "open").length}</p>
                <p className="muted">{concerns.length} raised in total</p>
              </div>
              <div className="card">
                <h3>Suppliers who audit their own suppliers</h3>
                <p className="big-number">{auditYes(c.id)}</p>
                <p className="muted">{prior ? `${auditYes(prior.id)} in ${prior.survey_year}` : "No prior year survey to compare"}</p>
              </div>
              <div className="card">
                <h3>Third-party audits we carried out</h3>
                <p className="big-number">{c.audits_conducted ?? "–"}</p>
                <p className="muted">{prior ? `${prior.audits_conducted ?? "Not recorded"} in ${prior.survey_year}` : "No prior year survey to compare"}</p>
              </div>
            </div>
            {level(null) > 0 && (
              <p className="card warning">
                {level(null)} answered {level(null) === 1 ? "supplier is" : "suppliers are"} not rated, because the annual spend is missing or a country they named is not in your
                country ratings. Not rated does not mean low risk.
              </p>
            )}
          </section>

          {due.length > 0 && (
            <section className="block">
              <h2>Emails to send</h2>
              <p className="muted">
                "Open email" opens the message in your own mail program, addressed and with the supplier's personal link. Send it
                {c.sender_email ? ` from ${c.sender_email}` : ""}, then mark it as sent. The cover email is long, and some mail programs cut long messages off; if yours
                does, use "Copy email" and paste it into a new message.
              </p>
              {(!c.relevant_policies || !c.query_name || !c.query_title) && (
                <p className="card warning">
                  The cover email still has blanks for the policies you are sending and the person suppliers should contact. Fill them in under Settings before
                  sending.
                </p>
              )}
              <ul className="plain rows">
                {due.map(({ r, kind }) => {
                  const mail = buildEmail(kind, c, r, supplierName(r.counterparty_id), organisationName, formatDay);
                  return (
                    <li key={r.id} className="row spread">
                      <span>
                        <strong>{supplierName(r.counterparty_id)}</strong> <span className="chip">{EMAIL_NAME[kind]}</span>
                        <br />
                        <span className="muted">
                          {r.contact_name} · {r.contact_email}
                        </span>
                      </span>
                      <span className="row">
                        <a className="link-dark" href={mail.mailto}>
                          Open email
                        </a>
                        <button
                          type="button"
                          className="link-dark"
                          onClick={() => void navigator.clipboard.writeText(`To: ${r.contact_email}\nSubject: ${mail.subject}\n\n${mail.body}`).then(() => setNotice("Email text copied. Paste it into a new message."), () => setError("The email could not be copied."))}
                        >
                          Copy email
                        </button>
                        <button type="button" className="quiet" disabled={busy} onClick={() => void run(() => markSent(r.id, kind))}>
                          Mark as sent
                        </button>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          <section className="block">
            <h2>Third parties surveyed</h2>
            {rs.length === 0 ? (
              <p className="muted">Nobody has been added yet.</p>
            ) : (
              <div className="table-scroll">
                <table className="report-table">
                  <thead>
                    <tr>
                      <th scope="col">Third party</th>
                      <th scope="col">Status</th>
                      <th scope="col">Spend</th>
                      <th scope="col">Country</th>
                      <th scope="col">Risk</th>
                      <th scope="col">Flags</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rs.map((r) => (
                      <tr key={r.id}>
                        <th scope="row">
                          {r.submitted_at ? (
                            <button type="button" className="link-dark" onClick={() => setViewId(viewId === r.id ? null : r.id)}>
                              {supplierName(r.counterparty_id)}
                            </button>
                          ) : (
                            supplierName(r.counterparty_id)
                          )}
                          <br />
                          <span className="muted small">{r.contact_name}</span>
                        </th>
                        <td>
                          {status(r)}
                          {open && !r.submitted_at && (
                            <>
                              <br />
                              <button
                                type="button"
                                className="link-dark small"
                                onClick={() => void navigator.clipboard.writeText(surveyLink(r.token)).then(() => setNotice(`Link for ${supplierName(r.counterparty_id)} copied.`), () => setError("The link could not be copied."))}
                              >
                                Copy link
                              </button>{" "}
                              <button type="button" className="link-dark small" disabled={busy} onClick={() => void run(() => removeRecipient(r.id))}>
                                Remove
                              </button>
                            </>
                          )}
                        </td>
                        <td>{r.revenue_rating ? `${RISK_LABEL[r.revenue_rating]}${r.annual_spend != null ? ` (${money(r.annual_spend)})` : ""}` : "Unknown"}</td>
                        <td>{r.submitted_at ? (r.country_rating ? `${RISK_LABEL[r.country_rating]} (${(r.countries ?? []).join(", ")})` : `Unknown (${(r.countries ?? []).join(", ")})`) : "–"}</td>
                        <td>{r.submitted_at ? <span className={r.risk_level === "high" || !r.risk_level ? "chip chip-alert" : "chip"}>{r.risk_level ? `${RISK_LABEL[r.risk_level]} · ${r.risk_score}` : "Not rated"}</span> : "–"}</td>
                        <td>{r.submitted_at ? `${r.concerns_count} concerns · ${r.gaps_count} gaps` : "–"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {viewing?.answers && (
              <div className="card">
                <h3>Answers from {supplierName(viewing.counterparty_id)}</h3>
                <p className="muted">
                  Completed by {viewing.respondent_name} ({viewing.respondent_email}) for {viewing.respondent_company}
                </p>
                <ol className="answer-list">
                  {data.questions
                    .filter((q) => q.kind !== "countries" && viewing.answers![q.code])
                    .map((q) => {
                      const a = viewing.answers![q.code];
                      const flagged = q.adverse !== null && a?.a === q.adverse;
                      if (q.kind !== "yesno") {
                        return (
                          <li key={q.code}>
                            {q.prompt.replace(/\{organisation\}/g, organisationName)} <strong>{a.a}</strong>
                          </li>
                        );
                      }
                      return (
                        <li key={q.code}>
                          {q.prompt.replace(/\{organisation\}/g, organisationName)}{" "}
                          <strong className={flagged ? "warning-text" : undefined}>
                            {a?.a === "yes" ? "Yes" : "No"}
                            {flagged ? (q.serious ? " (concern)" : " (gap)") : ""}
                          </strong>
                          {a?.d && <span className="muted"> · {a.d}</span>}
                        </li>
                      );
                    })}
                </ol>
              </div>
            )}

            {open && (
              <form
                className="card form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const amount = spend.trim() === "" ? null : Number(spend.replace(/[$,\s]/g, ""));
                  if (!supplierId) return setError("Choose the third party.");
                  if (contact.trim().length < 2 || !/.+@.+\..+/.test(email)) return setError("Enter the contact's name and email.");
                  if (amount !== null && !(Number.isFinite(amount) && amount >= 0)) return setError("Enter the annual spend as a number, or leave it blank.");
                  void run(() => addRecipient(organisationId, c.id, { counterpartyId: supplierId, name: contact, email, spend: amount })).then((ok) => {
                    if (!ok) return;
                    setSupplierId("");
                    setContact("");
                    setEmail("");
                    setSpend("");
                  });
                }}
              >
                <h3>Add a third party to survey</h3>
                {data.suppliers.length === 0 ? (
                  <p className="muted">Add third parties under Third parties first.</p>
                ) : (
                  <>
                    <label htmlFor="rc-supplier">Third party</label>
                    <select id="rc-supplier" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                      <option value="">Choose…</option>
                      {data.suppliers
                        .filter((s) => !rs.some((r) => r.counterparty_id === s.id))
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                    </select>
                    <div className="row">
                      <span className="field">
                        <label htmlFor="rc-contact">Contact name</label>
                        <input id="rc-contact" value={contact} onChange={(e) => setContact(e.target.value)} />
                      </span>
                      <span className="field">
                        <label htmlFor="rc-email">Contact email</label>
                        <input id="rc-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                      </span>
                      <span className="field">
                        <label htmlFor="rc-spend">Annual spend with them, A$</label>
                        <input id="rc-spend" className="short-wide" inputMode="decimal" value={spend} onChange={(e) => setSpend(e.target.value)} />
                      </span>
                    </div>
                    <button type="submit" className="quiet" disabled={busy}>
                      Add
                    </button>
                  </>
                )}
              </form>
            )}
          </section>

          <section className="block">
            <h2>Concerns for Legal</h2>
            {concerns.length === 0 ? (
              <p className="muted">No answer has raised a concern.</p>
            ) : (
              <ul className="plain rows">
                {concerns.map((k) => {
                  const r = rs.find((x) => x.id === k.recipient_id);
                  return (
                    <li key={k.id}>
                      <span className="row spread">
                        <span>
                          <strong>{r ? supplierName(r.counterparty_id) : "A supplier"}</strong> answered <strong>{k.answer === "yes" ? "Yes" : "No"}</strong>:{" "}
                          {questionOf(k.question_code)?.prompt.replace(/\{organisation\}/g, organisationName)}
                          {k.detail && (
                            <>
                              <br />
                              <span className="muted">Their details: {k.detail}</span>
                            </>
                          )}
                          {k.decision && (
                            <>
                              <br />
                              Decision{k.decided_at ? ` on ${formatDay(k.decided_at)}` : ""}: {k.decision}
                            </>
                          )}
                        </span>
                        <span className={k.status === "open" ? "chip chip-alert" : "chip"}>{k.status === "open" ? "With Legal" : "Decided"}</span>
                      </span>
                      {k.status === "open" && isLegal && <ConcernDecision key={k.id} busy={busy} onDecide={(d) => void run(() => decideConcern(k.id, d))} />}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="block">
            <h2>Country ratings</h2>
            <p className="muted">
              {data.countries.length === 0
                ? "No country ratings are loaded, so no supplier can be given a country rating yet."
                : `${data.countries.length} countries loaded${data.countries[0].source ? ` · source: ${data.countries[0].source}` : ""}.`}{" "}
              These apply to every survey.
            </p>
            {data.countries.length > 0 && (
              <details>
                <summary>Show the ratings</summary>
                <ul className="columns">
                  {data.countries.map((k) => (
                    <li key={k.id}>
                      {k.country}: {RISK_LABEL[k.rating]}
                      {k.score != null ? ` (${k.score})` : ""}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <form
              className="card form"
              onSubmit={(e) => {
                e.preventDefault();
                if (data.countries.length > 0 && !window.confirm("Replace the country ratings already loaded?")) return;
                void run(async () => {
                  const n = await importCountryRatings(organisationId, pasted, source);
                  await Promise.all(data.campaigns.filter((x) => x.status === "open").map((x) => rateCampaign(x.id)));
                  setNotice(`${n} country ratings loaded and open surveys re-rated.`);
                  setPasted("");
                });
              }}
            >
              <h3>Load country ratings</h3>
              <label htmlFor="cr-paste">Paste from a spreadsheet: country, then low, medium or high, then the score if you keep one</label>
              <textarea id="cr-paste" rows={5} placeholder={"Australia, low, 1.6\nIndia, high, 8.0"} value={pasted} onChange={(e) => setPasted(e.target.value)} />
              <label htmlFor="cr-source">Source and year</label>
              <input id="cr-source" placeholder="e.g. Walk Free Global Slavery Index 2023, prevalence" value={source} onChange={(e) => setSource(e.target.value)} />
              <button type="submit" className="quiet" disabled={busy}>
                Load ratings
              </button>
            </form>
          </section>

          {open && (
            <section className="block">
              <h2>Settings</h2>
              <form
                className="card form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!editing) return;
                  void run(async () => {
                    await updateCampaign(c.id, editing);
                    await rateCampaign(c.id);
                    setEditing(null);
                  }, "Settings saved.");
                }}
              >
                <div className="row">
                  <span className="field">
                    <label htmlFor="st-deadline">Responses due</label>
                    <input id="st-deadline" type="date" value={value("deadline")} onChange={(e) => setEditing({ ...edit, deadline: e.target.value })} />
                  </span>
                  <span className="field">
                    <label htmlFor="st-c1">Chaser 1 from</label>
                    <input id="st-c1" type="date" value={value("chaser1_on") ?? ""} onChange={(e) => setEditing({ ...edit, chaser1_on: e.target.value || null })} />
                  </span>
                  <span className="field">
                    <label htmlFor="st-c2">Chaser 2 from</label>
                    <input id="st-c2" type="date" value={value("chaser2_on") ?? ""} onChange={(e) => setEditing({ ...edit, chaser2_on: e.target.value || null })} />
                  </span>
                </div>
                <div className="row">
                  <span className="field">
                    <label htmlFor="st-med">Spend is medium from, A$</label>
                    <input id="st-med" className="short-wide" inputMode="decimal" value={value("spend_medium_from")} onChange={(e) => setEditing({ ...edit, spend_medium_from: Number(e.target.value) || 0 })} />
                  </span>
                  <span className="field">
                    <label htmlFor="st-high">Spend is high from, A$</label>
                    <input id="st-high" className="short-wide" inputMode="decimal" value={value("spend_high_from")} onChange={(e) => setEditing({ ...edit, spend_high_from: Number(e.target.value) || 0 })} />
                  </span>
                  <span className="field">
                    <label htmlFor="st-audits">Audits we carried out this year</label>
                    <input
                      id="st-audits"
                      className="short"
                      inputMode="numeric"
                      value={value("audits_conducted") ?? ""}
                      onChange={(e) => setEditing({ ...edit, audits_conducted: e.target.value.trim() === "" ? null : Number(e.target.value) })}
                    />
                  </span>
                </div>
                <p className="muted">
                  Risk score = spend rating × country rating, each 1 to 3. A score of 6 or more is high, 3 or 4 is medium, 1 or 2 is low. With several
                  countries, the highest rating is used.
                </p>
                <label htmlFor="st-policies">Policies sent with the questionnaire</label>
                <input id="st-policies" placeholder="e.g. Supplier Code of Conduct and Modern Slavery Policy" value={value("relevant_policies") ?? ""} onChange={(e) => setEditing({ ...edit, relevant_policies: e.target.value || null })} />
                <div className="row">
                  <span className="field">
                    <label htmlFor="st-qname">Contact for queries</label>
                    <input id="st-qname" value={value("query_name") ?? ""} onChange={(e) => setEditing({ ...edit, query_name: e.target.value || null })} />
                  </span>
                  <span className="field">
                    <label htmlFor="st-qtitle">Their title</label>
                    <input id="st-qtitle" value={value("query_title") ?? ""} onChange={(e) => setEditing({ ...edit, query_title: e.target.value || null })} />
                  </span>
                  <span className="field">
                    <label htmlFor="st-qemail">Their email</label>
                    <input id="st-qemail" type="email" value={value("query_email") ?? ""} onChange={(e) => setEditing({ ...edit, query_email: e.target.value || null })} />
                  </span>
                </div>
                <label htmlFor="st-sender">Emails are sent from</label>
                <input id="st-sender" type="email" value={value("sender_email") ?? ""} onChange={(e) => setEditing({ ...edit, sender_email: e.target.value || null })} />
                {(["cover", "chaser1", "chaser2"] as EmailKind[]).map((kind) => (
                  <fieldset key={kind} className="plain-fieldset question">
                    <legend>{EMAIL_NAME[kind]}</legend>
                    <label htmlFor={`st-${kind}-s`}>Subject</label>
                    <input id={`st-${kind}-s`} value={value(`${kind}_subject`)} onChange={(e) => setEditing({ ...edit, [`${kind}_subject`]: e.target.value })} />
                    <label htmlFor={`st-${kind}-b`}>Message</label>
                    <textarea id={`st-${kind}-b`} rows={7} value={value(`${kind}_body`)} onChange={(e) => setEditing({ ...edit, [`${kind}_body`]: e.target.value })} />
                  </fieldset>
                ))}
                <p className="muted">
                  These are filled in for each supplier: {"{contact}"}, {"{supplier}"}, {"{organisation}"}, {"{deadline}"}, {"{policies}"}, {"{query_name}"}, {"{query_title}"}, {"{query_email}"} and {"{link}"}. Keep {"{link}"} in every message.
                </p>
                <button type="submit" disabled={busy || !editing}>
                  Save settings
                </button>
              </form>
              <button
                type="button"
                className="quiet"
                disabled={busy}
                onClick={() => {
                  const waiting = rs.length - answered.length;
                  const openConcerns = concerns.filter((k) => k.status === "open").length;
                  const warn = [waiting > 0 ? `${waiting} have not answered and their links will stop working` : "", openConcerns > 0 ? `${openConcerns} concerns are still with Legal` : ""].filter(Boolean).join("; ");
                  if (window.confirm(`Close this survey?${warn ? ` ${warn}.` : ""} It cannot be reopened.`)) void run(() => closeCampaign(c.id), "Survey closed. The results now feed the statement.");
                }}
              >
                Close the survey
              </button>
            </section>
          )}
        </>
      )}
    </>
  );
}
