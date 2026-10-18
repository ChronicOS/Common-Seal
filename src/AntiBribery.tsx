import { useCallback, useEffect, useState, type ReactNode } from "react";
import LawNote from "./LawNote";
import Attachments from "./Attachments";
import { today as todayIso } from "./authorities";
import { formatDay } from "./board";
import { has } from "./roles";
import { ItemRow } from "./RegulatoryPage";
import { effective, saveCheck } from "./regulatory";
import {
  approveAssessment, AREA_LABELS, deleteRisk, loadAbc, PRINCIPLES, saveRisk, score, scoreLabel, startAssessment, updateAssessment,
  type AbcData, type Area, type Assessment, type Risk, type RiskValues,
} from "./antiBribery";

type Sub = "map" | "risks";
type Props = { organisationId: string; role: string; userId: string; onOpen: (tab: string) => void };
const day = (iso: string | null | undefined) => (iso ? formatDay(`${iso.slice(0, 10)}T12:00:00`) : "");

function Field({ id, label, children, wide }: { id: string; label: string; children: ReactNode; wide?: boolean }) {
  return <span className={wide ? "field grow" : "field"}><label htmlFor={id}>{label}</label>{children}</span>;
}

/** Risk and compliance, Anti-bribery */
export default function AntiBribery({ organisationId, role, userId, onOpen }: Props) {
  const manage = has(role, "owner", "admin", "secretary", "legal", "compliance");
  const canApprove = has(role, "owner", "admin", "secretary", "director");
  const [sub, setSub] = useState<Sub>("map");
  const [data, setData] = useState<AbcData | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const t = todayIso();

  const reload = useCallback(async () => {
    try {
      setData(await loadAbc(organisationId));
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Could not load.");
    }
  }, [organisationId]);
  useEffect(() => {
    void reload();
  }, [reload]);
  const run = async (work: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setProblem(null);
    setNotice(null);
    try {
      await work();
      await reload();
      setNotice(done);
      return true;
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "That did not save.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const header = (
    <>
      <p className="eyebrow">Risk and compliance</p>
      <h1>Anti-bribery</h1>
      <p className="lead">A company is liable if anyone acting for it bribes a foreign public official to win or keep business, unless it had adequate procedures to prevent it. This maps your procedures against the six principles in the Attorney-General's guidance, using what is already recorded here as evidence.</p>
      <LawNote library="anti_bribery" />
      {problem && <p className="error" role="alert">{problem}</p>}
      {notice && <p className="card note" role="status">{notice}</p>}
    </>
  );
  if (!data) return <>{header}<p className="muted">Loading…</p></>;
  if (!data.ready) return <>{header}<p className="card warning">Not set up yet: run migration 0051 in Supabase.</p></>;
  if (!data.allowed || !data.evidence) return <>{header}<p className="muted">The anti-bribery programme is open to directors, the people who manage compliance, and auditors. To raise a concern about bribery, use Speak up.</p></>;

  return (
    <>
      {header}
      <span className="segmented block-gap" role="group" aria-label="Anti-bribery sections">
        <button type="button" className={sub === "map" ? "on" : undefined} aria-pressed={sub === "map"} onClick={() => setSub("map")}>Adequate procedures</button>
        <button type="button" className={sub === "risks" ? "on" : undefined} aria-pressed={sub === "risks"} onClick={() => setSub("risks")}>Risk assessment</button>
      </span>
      {sub === "map" && <ProcedureMap organisationId={organisationId} data={data} manage={manage} userId={userId} busy={busy} today={t} onOpen={onOpen} run={run} />}
      {sub === "risks" && <Risks organisationId={organisationId} data={data} manage={manage} canApprove={canApprove} userId={userId} busy={busy} today={t} run={run} />}
    </>
  );
}

function ProcedureMap({ organisationId, data, manage, userId, busy, today: t, onOpen, run }: {
  organisationId: string; data: AbcData; manage: boolean; userId: string; busy: boolean; today: string; onOpen: (tab: string) => void; run: (work: () => Promise<unknown>, done: string) => Promise<boolean>;
}) {
  const ev = data.evidence!;
  const rows = new Map(data.programme.map((r) => [r.item_key, r]));
  const all = PRINCIPLES.flatMap((p) => p.elements.map((el) => ({ el, auto: el.auto ? el.auto(ev, t) : null })));
  const eff = (key: string, auto: ReturnType<NonNullable<(typeof all)[number]["el"]["auto"]>> | null) => effective(rows.get(key), auto, true);
  const count = (s: string) => all.filter(({ el, auto }) => eff(el.key, auto).status === s).length;
  return (
    <>
      <dl className="facts">
        <div><dt>In place</dt><dd>{count("in_place")}</dd></div>
        <div><dt>Partly</dt><dd className={count("partly") ? "warning-text" : undefined}>{count("partly")}</dd></div>
        <div><dt>Gaps</dt><dd className={count("gap") ? "warning-text" : undefined}>{count("gap")}</dd></div>
        <div><dt>Not assessed</dt><dd className={count("not_assessed") ? "warning-text" : undefined}>{count("not_assessed")}</dd></div>
      </dl>
      <p className="small muted">An element only shows as in place when someone has confirmed it and the records agree. Where the records show less than was recorded, the records win.</p>
      {PRINCIPLES.map((p) => (
        <section key={p.key} className="card block">
          <h2>{p.label}</h2>
          <ul className="plain rows">
            {p.elements.map((el) => {
              const auto = el.auto ? el.auto(ev, t) : null;
              const row = rows.get(el.key);
              return (
                <ItemRow key={el.key} item={{ key: el.key, label: el.label, hint: el.hint, law: el.law }} applies auto={auto} eff={eff(el.key, auto)} check={row} people={data.people}
                  canEdit={manage || row?.owner_user_id === userId} manage={manage} busy={busy} today={t} onOpen={onOpen}
                  onSave={(v) => run(() => saveCheck(organisationId, "anti_bribery", null, row, el.key, v), "Saved.")} />
              );
            })}
          </ul>
        </section>
      ))}
    </>
  );
}

const blankRisk: RiskValues = { area: "third_parties", description: "", countries: null, likelihood: 3, impact: 3, controls: null, residual_likelihood: null, residual_impact: null, actions: null, action_due_on: null, owner_user_id: null };

function Risks({ organisationId, data, manage, canApprove, userId, busy, today: t, run }: {
  organisationId: string; data: AbcData; manage: boolean; canApprove: boolean; userId: string; busy: boolean; today: string; run: (work: () => Promise<unknown>, done: string) => Promise<boolean>;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<Risk | "new" | null>(null);
  const [note, setNote] = useState("");
  const draft = data.assessments.find((a) => a.status === "draft");
  const latest = data.assessments.find((a) => a.status === "approved");
  const current: Assessment | undefined = data.assessments.find((a) => a.id === selected) ?? draft ?? latest;
  const risks = current ? data.risks.filter((r) => r.assessment_id === current.id).sort((a, b) => score(b) - score(a)) : [];
  const who = (uid: string | null) => (uid ? data.people.find((p) => p.user_id === uid)?.full_name ?? "" : "");
  const isDraft = current?.status === "draft";

  if (!current) {
    return (
      <section className="card block">
        <h2>No bribery risk assessment yet</h2>
        <p className="small">Work through where bribery could happen: the countries you operate in, dealings with government, agents and other intermediaries, gifts and hospitality, donations and sponsorships, joint ventures and acquisitions. Then have the board approve it.</p>
        {manage && <button type="button" disabled={busy} onClick={() => run(() => startAssessment(organisationId, `Bribery risk assessment ${t.slice(0, 4)}`, []), "Started. Add the risks.")}>Start a risk assessment</button>}
      </section>
    );
  }
  if (editing) {
    return <RiskForm initial={editing === "new" ? null : editing} locked={!isDraft} people={data.people} busy={busy} onCancel={() => setEditing(null)}
      onDelete={editing !== "new" && isDraft && manage ? async () => { if (await run(() => deleteRisk(editing.id), "Removed.")) setEditing(null); } : undefined}
      onSave={async (v) => { if (await run(() => saveRisk(organisationId, current.id, editing === "new" ? null : editing.id, v), "Risk saved.")) setEditing(null); }} />;
  }
  return (
    <>
      {data.assessments.length > 1 && (
        <p className="row wrap">
          <label htmlFor="abc-pick" className="small">Assessment</label>
          <select id="abc-pick" value={current.id} onChange={(e) => setSelected(e.target.value)}>
            {data.assessments.map((a) => <option key={a.id} value={a.id}>{a.title} ({a.status === "approved" ? `approved ${day(a.approved_at)}` : "draft"})</option>)}
          </select>
        </p>
      )}
      <section className={isDraft ? "card block" : current.next_review_on && current.next_review_on < t ? "card warning block" : "card block"}>
        <h2>{current.title}</h2>
        {isDraft && manage ? (
          <div className="row wrap">
            <Field id="as-on" label="Assessed on"><input id="as-on" type="date" defaultValue={current.assessed_on} onBlur={(e) => e.target.value !== current.assessed_on && run(() => updateAssessment(current.id, { assessed_on: e.target.value }), "Saved.")} /></Field>
            <Field id="as-next" label="Review by"><input id="as-next" type="date" defaultValue={current.next_review_on ?? ""} onBlur={(e) => run(() => updateAssessment(current.id, { next_review_on: e.target.value || null }), "Saved.")} /></Field>
            <Field id="as-scope" label="Scope" wide><input id="as-scope" defaultValue={current.scope ?? ""} placeholder="All group companies and their agents" onBlur={(e) => e.target.value !== (current.scope ?? "") && run(() => updateAssessment(current.id, { scope: e.target.value }), "Saved.")} /></Field>
          </div>
        ) : (
          <p className="small">{isDraft ? "Draft" : `Approved ${day(current.approved_at)} by ${who(current.approved_by) || "a director"}${current.approval_note ? ` (${current.approval_note})` : ""}`} · assessed {day(current.assessed_on)}{current.scope ? ` · ${current.scope}` : ""}{current.next_review_on ? ` · review by ${day(current.next_review_on)}` : ""}</p>
        )}
        {risks.length === 0 ? <p className="muted">No risks added yet.</p> : (
          <div className="table-scroll">
            <table className="report-table wide">
              <thead><tr><th scope="col">Risk</th><th scope="col">Score</th><th scope="col">Controls</th><th scope="col">Owner and actions</th></tr></thead>
              <tbody>
                {risks.map((r) => {
                  const s = score(r);
                  const canOpen = manage || r.owner_user_id === userId;
                  return (
                    <tr key={r.id}>
                      <th scope="row">{canOpen ? <button type="button" className="link-dark" onClick={() => setEditing(r)}>{AREA_LABELS[r.area].split(" (")[0]}</button> : AREA_LABELS[r.area].split(" (")[0]}<span className="muted small"><br />{r.description}{r.countries ? ` · ${r.countries}` : ""}</span></th>
                      <td className={s >= 15 ? "warning-text" : undefined}>{scoreLabel(s)} ({s})<span className="muted small"><br />{r.residual_likelihood ? `after controls; ${r.likelihood * r.impact} before` : "before controls"}</span></td>
                      <td className="small">{r.controls ?? <span className="warning-text">None recorded</span>}</td>
                      <td className="small">{who(r.owner_user_id) || <span className="warning-text">No owner</span>}{r.actions ? <><br />{r.actions}</> : null}{r.action_due_on ? <span className={r.action_due_on < t ? "warning-text" : "muted"}> · by {day(r.action_due_on)}</span> : null}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {isDraft && manage && <p className="block"><button type="button" onClick={() => setEditing("new")}>Add a risk</button></p>}
        {isDraft && canApprove && (
          <div className="row wrap block">
            <Field id="as-note" label="Approval note (optional)" wide><input id="as-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Approved at the board meeting of 12 November 2026" /></Field>
            <button type="button" disabled={busy} onClick={() => run(() => approveAssessment(current.id, note), "Approved. The risks are now locked; their owners can still update the actions.")}>Approve the assessment</button>
          </div>
        )}
        <Attachments subjectTable="abc_assessments" subjectId={current.id} canAttach={manage} label="Board papers and workings" />
      </section>
      {!draft && manage && (
        <p><button type="button" className="quiet" disabled={busy} onClick={() => run(async () => { const id = await startAssessment(organisationId, `Bribery risk assessment ${t.slice(0, 4)}`, latest ? data.risks.filter((r) => r.assessment_id === latest.id) : []); setSelected(id); }, "New draft started from the last approved assessment.")}>Start the next review</button></p>
      )}
    </>
  );
}

function RiskForm({ initial, locked, people, busy, onSave, onCancel, onDelete }: { initial: Risk | null; locked: boolean; people: AbcData["people"]; busy: boolean; onSave: (v: Partial<RiskValues>) => void; onCancel: () => void; onDelete?: () => void }) {
  const [v, setV] = useState<RiskValues>(initial ? (({ id: _i, assessment_id: _a, ...r }) => r)(initial) : blankRisk);
  const set = (p: Partial<RiskValues>) => setV({ ...v, ...p });
  const scale = (id: string, label: string, value: number | null, on: (n: number | null) => void, optional = false) => (
    <Field id={id} label={label}>
      <select id={id} disabled={locked} value={value ?? ""} onChange={(e) => on(e.target.value ? Number(e.target.value) : null)}>
        {optional && <option value="">Not assessed</option>}
        {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
    </Field>
  );
  return (
    <div className="card form">
      <h2>{initial ? AREA_LABELS[initial.area] : "New bribery risk"}</h2>
      {locked && <p className="small muted">The assessment has been approved, so only the owner, actions and due date can change. Start the next review to reassess.</p>}
      <div className="row wrap">
        <Field id="r-area" label="Area"><select id="r-area" disabled={locked} value={v.area} onChange={(e) => set({ area: e.target.value as Area })}>{Object.entries(AREA_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field id="r-countries" label="Countries" wide><input id="r-countries" disabled={locked} value={v.countries ?? ""} onChange={(e) => set({ countries: e.target.value })} /></Field>
      </div>
      <Field id="r-desc" label="The risk" wide><input id="r-desc" disabled={locked} value={v.description} onChange={(e) => set({ description: e.target.value })} placeholder="Sales agents paid by commission in markets where officials expect payments" /></Field>
      <div className="row wrap">
        {scale("r-l", "Likelihood (1 to 5)", v.likelihood, (n) => set({ likelihood: n ?? 1 }))}
        {scale("r-i", "Impact (1 to 5)", v.impact, (n) => set({ impact: n ?? 1 }))}
        <span className="field"><span className="small">Before controls</span><strong className={v.likelihood * v.impact >= 15 ? "warning-text" : undefined}>{scoreLabel(v.likelihood * v.impact)} ({v.likelihood * v.impact})</strong></span>
      </div>
      <Field id="r-controls" label="Controls" wide><textarea id="r-controls" disabled={locked} rows={2} value={v.controls ?? ""} onChange={(e) => set({ controls: e.target.value })} /></Field>
      <div className="row wrap">
        {scale("r-rl", "Likelihood after controls", v.residual_likelihood, (n) => set({ residual_likelihood: n }), true)}
        {scale("r-ri", "Impact after controls", v.residual_impact, (n) => set({ residual_impact: n }), true)}
      </div>
      <Field id="r-actions" label="Further actions" wide><input id="r-actions" value={v.actions ?? ""} onChange={(e) => set({ actions: e.target.value })} /></Field>
      <div className="row wrap">
        <Field id="r-due" label="Actions due"><input id="r-due" type="date" value={v.action_due_on ?? ""} onChange={(e) => set({ action_due_on: e.target.value || null })} /></Field>
        <Field id="r-owner" label="Owner"><select id="r-owner" value={v.owner_user_id ?? ""} onChange={(e) => set({ owner_user_id: e.target.value || null })}><option value="">No owner yet</option>{people.filter((p) => p.user_id).map((p) => <option key={p.user_id!} value={p.user_id!}>{p.full_name}</option>)}</select></Field>
      </div>
      <div className="row">
        <button type="button" disabled={busy || v.description.trim().length < 5} onClick={() => onSave(locked ? { actions: v.actions, action_due_on: v.action_due_on, owner_user_id: v.owner_user_id } : v)}>Save</button>
        <button type="button" className="quiet" onClick={onCancel}>Cancel</button>
        {onDelete && <button type="button" className="quiet" disabled={busy} onClick={onDelete}>Remove</button>}
      </div>
    </div>
  );
}
