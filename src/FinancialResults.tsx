import { useCallback, useEffect, useMemo, useState } from "react";
import Attachments from "./Attachments";
import { formatDay } from "./board";
import {
  DEFAULT_METRICS,
  FREQUENCIES,
  fmt,
  fyStart,
  loadFinance,
  periodLabel,
  reviewPeriod,
  savePeriod,
  saveReport,
  variance,
  type FinData,
  type FinPeriod,
  type FinReport,
  type Figure,
  type Metric,
} from "./finResults";

type Props = { organisationId: string; entities: { id: string; name: string }[]; canSetUp: boolean; canReview: boolean; userId: string };

const today = () => new Date().toLocaleDateString("en-CA");
const SHOWN = 6;

/** High-level financial results, prepared by a named person each period, for the board to see */
export default function FinancialResults({ organisationId, entities, canSetUp, canReview, userId }: Props) {
  const [data, setData] = useState<FinData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reportId, setReportId] = useState<string | null>(null);
  const [periodId, setPeriodId] = useState<string | null>(null);
  const [setup, setSetup] = useState<Partial<FinReport> | null>(null);

  const reload = useCallback(async () => setData(await loadFinance(organisationId)), [organisationId]);
  useEffect(() => {
    reload().catch((e) => setError(e instanceof Error ? e.message : "Could not load the financial results."));
  }, [reload]);

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await work();
      await reload();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const report = data?.reports.find((r) => r.id === reportId) ?? data?.reports[0] ?? null;
  const periods = useMemo(() => (data && report ? data.periods.filter((p) => p.report_id === report.id) : []), [data, report]);

  if (!data) return error ? <p className="error" role="alert">{error}</p> : <p className="lead">Loading…</p>;

  const entityName = (id: string | null) => (id ? entities.find((e) => e.id === id)?.name ?? "A company" : "Whole group");
  const preparer = (r: FinReport) => data.people.find((p) => p.id === r.preparer_person_id);
  const isPreparer = (r: FinReport) => preparer(r)?.user_id === userId;

  const head = (
    <>
      <p className="eyebrow">Company</p>
      <h1>Finance</h1>
      <p className="lead">High-level results each period, prepared by a named person, with the supporting papers, so the board sees how the business is tracking.</p>
    </>
  );

  if (setup) {
    return (
      <>
        {head}
        <SetupForm initial={setup} entities={entities} people={data.people} busy={busy} error={error}
          onCancel={() => { setSetup(null); setError(null); }}
          onSave={async (r) => { if (await run(() => saveReport(organisationId, r))) setSetup(null); }} />
      </>
    );
  }

  if (!report) {
    return (
      <>
        {head}
        {canSetUp ? (
          <div className="card">
            <h2>Set up financial reporting</h2>
            <p className="muted">Choose how often results come to the board and who prepares them. You can change the measures at any time.</p>
            <button type="button" onClick={() => setSetup({ frequency: "monthly", first_period_start: fyStart(), due_days: 15, metrics: DEFAULT_METRICS, currency: "AUD", name: "Financial results" })}>Set it up</button>
          </div>
        ) : (
          <p className="muted">Nothing to show. Financial results are visible to the board roles, auditors and the person preparing them.</p>
        )}
        {error && <p className="error block" role="alert">{error}</p>}
      </>
    );
  }

  const shown = periods.slice(0, SHOWN).reverse();
  const open = periods.find((p) => p.id === periodId) ?? periods.find((p) => p.status !== "open") ?? periods[0];
  const late = (p: FinPeriod) => p.status === "open" && p.due_on < today();

  return (
    <>
      {head}
      {data.reports.length > 1 && (
        <div className="chip-row" role="group" aria-label="Reports">
          {data.reports.map((r) => (
            <button key={r.id} type="button" className={r.id === report.id ? "chip-button on" : "chip-button"} onClick={() => { setReportId(r.id); setPeriodId(null); }}>
              {r.name} · {entityName(r.entity_id)}
            </button>
          ))}
        </div>
      )}
      <p className="muted">
        {report.name} · {entityName(report.entity_id)} · {FREQUENCIES[report.frequency]} · prepared by <strong>{preparer(report)?.full_name ?? "no one yet"}</strong> · due {report.due_days} days after each period
        {canSetUp && (
          <>
            {" "}<button type="button" className="link-dark small" onClick={() => setSetup(report)}>Change set-up</button>
            {" "}<button type="button" className="link-dark small" onClick={() => setSetup({ frequency: "monthly", first_period_start: fyStart(), due_days: 15, metrics: DEFAULT_METRICS, currency: "AUD", name: "Financial results" })}>Add another report</button>
          </>
        )}
      </p>
      {!report.preparer_person_id && <p className="small warning-text">No one is assigned to prepare these results.</p>}

      {shown.length > 0 && (
        <div className="table-scroll">
          <table className="fin-table">
            <thead>
              <tr>
                <th scope="col">Measure</th>
                {shown.map((p) => (
                  <th key={p.id} scope="col">
                    <button type="button" className={p.id === open?.id ? "link-dark on" : "link-dark"} onClick={() => setPeriodId(p.id)}>{periodLabel(p, report.frequency)}</button>
                    <br />
                    <span className={`chip small ${p.status === "reviewed" ? "verdict-authorised" : late(p) ? "verdict-outside" : p.status === "submitted" ? "verdict-check" : ""}`}>
                      {p.status === "reviewed" ? "Reviewed" : p.status === "submitted" ? "Submitted" : late(p) ? "Overdue" : p.period_end >= today() ? "In progress" : "Due " + formatDay(p.due_on)}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.metrics.map((m) => (
                <tr key={m.key}>
                  <th scope="row">{m.label}</th>
                  {shown.map((p) => {
                    const f = p.figures[m.key];
                    const v = variance(m, f);
                    return (
                      <td key={p.id}>
                        {fmt(f?.actual, m.unit, report.currency)}
                        {m.budget && f?.budget != null && (
                          <span className="fin-budget">
                            budget {fmt(f.budget, m.unit, report.currency)}
                            {v && <span className={v.good ? "good" : "bad"}> {v.text}</span>}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <PeriodPanel key={open.id + open.status + (open.commentary ?? "")} report={report} period={open} busy={busy}
          canEdit={(isPreparer(report) || canSetUp) && (open.status !== "reviewed" || canSetUp)} canReview={canReview}
          onSave={(figs, text, submit) => void run(() => savePeriod(open.id, figs, text, submit))}
          onReview={(note) => void run(() => reviewPeriod(open.id, note))} />
      )}
      {periods.length > SHOWN && (
        <p className="muted small">
          Earlier periods:{" "}
          {periods.slice(SHOWN).map((p, i) => (
            <span key={p.id}>{i > 0 && " · "}<button type="button" className="link-dark small" onClick={() => setPeriodId(p.id)}>{periodLabel(p, report.frequency)}</button></span>
          ))}
        </p>
      )}
      {error && <p className="error block" role="alert">{error}</p>}
    </>
  );
}

function PeriodPanel({ report, period, canEdit, canReview, busy, onSave, onReview }: {
  report: FinReport; period: FinPeriod; canEdit: boolean; canReview: boolean; busy: boolean;
  onSave: (figures: Record<string, Figure>, commentary: string, submit: boolean) => void; onReview: (note: string) => void;
}) {
  const toText = (v: number | null | undefined, unit: Metric["unit"]) => (v == null ? "" : unit === "percent" ? String(+(v * 100).toFixed(2)) : String(v));
  const [vals, setVals] = useState<Record<string, { actual: string; budget: string }>>(() =>
    Object.fromEntries(report.metrics.map((m) => [m.key, { actual: toText(period.figures[m.key]?.actual, m.unit), budget: toText(period.figures[m.key]?.budget, m.unit) }])),
  );
  const [text, setText] = useState(period.commentary ?? "");
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const label = periodLabel(period, report.frequency);

  function figures(): Record<string, Figure> | null {
    const out: Record<string, Figure> = {};
    for (const m of report.metrics) {
      const parse = (s: string) => {
        const t = s.replace(/[$,\s%]/g, "");
        if (t === "") return null;
        const n = Number(t);
        if (!Number.isFinite(n)) throw new Error(`${m.label}: give a number.`);
        return m.unit === "percent" ? n / 100 : n;
      };
      out[m.key] = { actual: parse(vals[m.key].actual), budget: m.budget ? parse(vals[m.key].budget) : null };
    }
    // Margin from revenue and expenses (or profit) when it is left blank
    const rev = out.revenue?.actual;
    const profit = out.net_profit?.actual ?? (rev != null && out.expenses?.actual != null ? rev - out.expenses.actual! : null);
    if (out.margin && out.margin.actual == null && rev && profit != null) out.margin.actual = Math.round((profit / rev) * 10000) / 10000;
    if (out.net_profit && out.net_profit.actual == null && profit != null) out.net_profit.actual = profit;
    return out;
  }

  function save(submit: boolean) {
    try {
      const f = figures();
      setProblem(null);
      if (submit && report.metrics.some((m) => f![m.key].actual == null) && !window.confirm("Some measures are blank. Submit anyway?")) return;
      onSave(f!, text, submit);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Check the figures.");
    }
  }

  return (
    <section className="card block fin-period">
      <h2>{label}</h2>
      <p className="muted small">
        {formatDay(period.period_start)} to {formatDay(period.period_end)} · due {formatDay(period.due_on)}
        {period.submitted_at && ` · submitted ${formatDay(period.submitted_at)}`}
        {period.reviewed_at && ` · reviewed by the board ${formatDay(period.reviewed_at)}`}
      </p>
      {period.review_note && <p className="small"><strong>Board note:</strong> {period.review_note}</p>}

      {canEdit ? (
        <div className="form">
          <div className="fin-grid" role="table" aria-label={`Figures for ${label}`}>
            <span role="columnheader" />
            <span role="columnheader" className="muted small">Actual</span>
            <span role="columnheader" className="muted small">Budget</span>
            {report.metrics.map((m) => (
              <span key={m.key} role="row" className="fin-row">
                <label htmlFor={`fa-${m.key}`}>{m.label}{m.unit === "percent" ? " (%)" : m.unit === "money" ? ` (${report.currency})` : ""}</label>
                <input id={`fa-${m.key}`} inputMode="decimal" value={vals[m.key].actual} onChange={(e) => setVals({ ...vals, [m.key]: { ...vals[m.key], actual: e.target.value } })}
                  placeholder={m.key === "margin" || m.key === "net_profit" ? "worked out if blank" : ""} />
                {m.budget ? (
                  <input aria-label={`${m.label} budget`} inputMode="decimal" value={vals[m.key].budget} onChange={(e) => setVals({ ...vals, [m.key]: { ...vals[m.key], budget: e.target.value } })} />
                ) : <span className="muted small">–</span>}
              </span>
            ))}
          </div>
          <label htmlFor="fin-comment">Commentary for the board</label>
          <textarea id="fin-comment" rows={4} placeholder="What drove the result, risks, what is changing" value={text} onChange={(e) => setText(e.target.value)} />
          {problem && <p className="error small" role="alert">{problem}</p>}
          <div className="row">
            <button type="button" disabled={busy} onClick={() => save(true)}>{period.status === "open" ? "Submit to the board" : "Save and resubmit"}</button>
            <button type="button" className="quiet" disabled={busy} onClick={() => save(false)}>Save draft</button>
          </div>
        </div>
      ) : (
        <>
          {period.commentary ? <p className="fin-commentary">{period.commentary}</p> : <p className="muted">{period.status === "open" ? "Not submitted yet." : "No commentary."}</p>}
        </>
      )}

      <Attachments subjectTable="fin_periods" subjectId={period.id} canAttach={canEdit} label="Supporting papers (P&L, balance sheet, slides)" />

      {canReview && period.status === "submitted" && (
        <div className="form block">
          <label htmlFor="fin-note">Board note (optional)</label>
          <input id="fin-note" value={note} onChange={(e) => setNote(e.target.value)} />
          <button type="button" disabled={busy} onClick={() => onReview(note)}>Mark as reviewed</button>
        </div>
      )}
    </section>
  );
}

function SetupForm({ initial, entities, people, busy, error, onSave, onCancel }: {
  initial: Partial<FinReport>; entities: { id: string; name: string }[]; people: { id: string; full_name: string }[]; busy: boolean; error: string | null;
  onSave: (r: Partial<FinReport>) => void; onCancel: () => void;
}) {
  const [f, setF] = useState<Partial<FinReport>>(initial);
  const [metrics, setMetrics] = useState<Metric[]>(initial.metrics ?? DEFAULT_METRICS);
  const [newMetric, setNewMetric] = useState({ label: "", unit: "money" as Metric["unit"], budget: true });
  const keyOf = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").replace(/^(\d)/, "m$1").slice(0, 40) || "measure";
  return (
    <div className="card form">
      <h2>{initial.id ? "Change set-up" : "Set up financial reporting"}</h2>
      <label htmlFor="fs-name">Name</label>
      <input id="fs-name" value={f.name ?? ""} onChange={(e) => setF({ ...f, name: e.target.value })} />
      <div className="row wrap">
        <span className="field">
          <label htmlFor="fs-ent">For</label>
          <select id="fs-ent" value={f.entity_id ?? ""} onChange={(e) => setF({ ...f, entity_id: e.target.value || null })}>
            <option value="">The whole group</option>
            {entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </span>
        <span className="field">
          <label htmlFor="fs-freq">How often</label>
          <select id="fs-freq" value={f.frequency} onChange={(e) => setF({ ...f, frequency: e.target.value })}>
            {Object.entries(FREQUENCIES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </span>
        <span className="field">
          <label htmlFor="fs-start">First period starts</label>
          <input id="fs-start" type="date" value={f.first_period_start ?? ""} onChange={(e) => setF({ ...f, first_period_start: e.target.value })} />
        </span>
      </div>
      <p className="muted small">Quarters, halves and years run from this date, so start it on the first day of your financial year (1 July by default).
        {initial.id && " Changing how often or the start date rebuilds the periods not yet filled in."}</p>
      <div className="row wrap">
        <span className="field">
          <label htmlFor="fs-prep">Prepared by</label>
          <select id="fs-prep" value={f.preparer_person_id ?? ""} onChange={(e) => setF({ ...f, preparer_person_id: e.target.value || null })}>
            <option value="">Choose a person</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
        </span>
        <span className="field narrow">
          <label htmlFor="fs-due">Due (days after period)</label>
          <input id="fs-due" type="number" min={0} max={120} value={f.due_days ?? 15} onChange={(e) => setF({ ...f, due_days: Number(e.target.value) })} />
        </span>
        <span className="field narrow">
          <label htmlFor="fs-cur">Currency</label>
          <input id="fs-cur" maxLength={3} value={f.currency ?? "AUD"} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} />
        </span>
      </div>
      <p className="muted small">Only people who have signed in can be chosen; they see these results and get them in For you each period.</p>

      <fieldset className="reader-group">
        <legend>Measures</legend>
        <ul className="plain">
          {metrics.map((m, i) => (
            <li key={m.key} className="row wrap">
              <span>{m.label} <span className="muted small">({m.unit}{m.budget ? ", with budget" : ""})</span></span>
              <button type="button" className="link-dark small" disabled={i === 0} onClick={() => { const x = [...metrics]; [x[i - 1], x[i]] = [x[i], x[i - 1]]; setMetrics(x); }}>up</button>
              <button type="button" className="link-dark small" disabled={metrics.length === 1} onClick={() => setMetrics(metrics.filter((x) => x.key !== m.key))}>remove</button>
            </li>
          ))}
        </ul>
        <div className="row wrap">
          <span className="field"><label htmlFor="fs-ml">Add a measure</label><input id="fs-ml" placeholder="e.g. Gross margin, ARR, Headcount" value={newMetric.label} onChange={(e) => setNewMetric({ ...newMetric, label: e.target.value })} /></span>
          <span className="field narrow"><label htmlFor="fs-mu">Kind</label>
            <select id="fs-mu" value={newMetric.unit} onChange={(e) => setNewMetric({ ...newMetric, unit: e.target.value as Metric["unit"] })}>
              <option value="money">Money</option><option value="percent">Percent</option><option value="number">Number</option>
            </select></span>
        </div>
        <label className="check"><input type="checkbox" checked={newMetric.budget} onChange={(e) => setNewMetric({ ...newMetric, budget: e.target.checked })} /> Compare with a budget</label>
        <button type="button" className="quiet" disabled={newMetric.label.trim().length < 1 || metrics.some((m) => m.key === keyOf(newMetric.label))}
          onClick={() => { setMetrics([...metrics, { key: keyOf(newMetric.label), label: newMetric.label.trim(), unit: newMetric.unit, budget: newMetric.budget }]); setNewMetric({ label: "", unit: "money", budget: true }); }}>
          Add measure
        </button>
      </fieldset>
      {error && <p className="error small" role="alert">{error}</p>}
      <div className="row">
        <button type="button" disabled={busy || !f.first_period_start || (f.name ?? "").trim().length < 2} onClick={() => onSave({
          id: initial.id, name: (f.name ?? "").trim(), entity_id: f.entity_id ?? null, frequency: f.frequency, first_period_start: f.first_period_start,
          due_days: f.due_days ?? 15, preparer_person_id: f.preparer_person_id ?? null, currency: f.currency || "AUD", metrics,
        })}>Save</button>
        <button type="button" className="quiet" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
