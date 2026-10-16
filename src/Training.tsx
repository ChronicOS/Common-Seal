import { has } from "./roles";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { formatDay } from "./board";
import { mailto } from "./risk";
import TrainingTake from "./TrainingTake";
import {
  addDays,
  addPerson,
  adoptModule,
  attachMaterial,
  completeTraining,
  createModule,
  DEFAULT_DECLARATION,
  DEFAULT_FUNCTIONS,
  downloadMaterial,
  FREQUENCIES,
  frequencyLabel,
  isCurrent,
  isOverdue,
  loadAnswerKey,
  loadLinks,
  loadTraining,
  markReminderSent,
  MODULE_STATUS,
  parseRoster,
  readingFor,
  reminderDue,
  setModuleStatus,
  setTargets,
  today,
  updateModuleSettings,
  updatePerson,
  withdrawAssignment,
  type Assignment,
  type NewQuestion,
  type Person,
  type PersonValues,
  type TrainingData,
  type TrainingModule,
} from "./training";

type Props = { organisationId: string; organisationName: string; role: string; userId: string; initialModuleId?: string | null };
type View = { kind: "home" } | { kind: "take"; assignmentId: string } | { kind: "module"; moduleId: string };
type Section = "mine" | "modules" | "roster" | "report" | "reminders";
type DraftQuestion = { prompt: string; options: string[]; correct: number };

const MANAGE_ROLES = ["owner", "admin", "secretary", "legal", "compliance"];
const SEE_ALL_ROLES = [...MANAGE_ROLES, "director", "auditor"];
const blankQuestion = (): DraftQuestion => ({ prompt: "", options: ["", "", "", ""], correct: 0 });
const blankPerson = (): PersonValues => ({ full_name: "", email: "", function_name: "", manager_name: "", manager_email: "", start_date: "" });
const pct = (n: number, d: number) => (d === 0 ? "–" : `${Math.round((100 * n) / d)}%`);

/** The latest assignment per person per module: the open one if there is one, otherwise the most recent completion */
function latest(assignments: Assignment[]) {
  const out = new Map<string, Assignment>();
  for (const a of assignments) {
    const key = `${a.module_id}:${a.person_id ?? a.user_id}`;
    const was = out.get(key);
    if (!was) out.set(key, a);
    else if (!a.completed_at && was.completed_at) out.set(key, a);
    else if (a.completed_at && was.completed_at && a.completed_at > was.completed_at) out.set(key, a);
  }
  return [...out.values()];
}
const statusOf = (a: Assignment) => (a.completed_at ? (isCurrent(a) ? "Complete" : "Expired") : isOverdue(a) ? "Overdue" : "To do");

function csvDownload(name: string, rows: (string | number)[][]) {
  const text = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Who a module is for, its due date and frequency */
function AssignPanel({ m, data, busy, onAssign, onSettings }: {
  m: TrainingModule;
  data: TrainingData;
  busy: boolean;
  onAssign: (t: { all: boolean; functions: string[]; people: string[]; dueOn: string | null }) => void;
  onSettings: (patch: Partial<Pick<TrainingModule, "refresh_every_months" | "due_days" | "reassign_on_new_version">>) => void;
}) {
  const targets = data.targets.filter((t) => t.module_id === m.id);
  const [all, setAll] = useState(targets.some((t) => t.kind === "all") || targets.length === 0);
  const [functions, setFunctions] = useState<string[]>(targets.flatMap((t) => (t.function_name ? [t.function_name] : [])));
  const [people, setPeople] = useState<string[]>(targets.flatMap((t) => (t.person_id ? [t.person_id] : [])));
  const [dueOn, setDueOn] = useState(addDays(today(), m.due_days ?? 30));
  const [filter, setFilter] = useState("");
  const allFunctions = [...new Set([...DEFAULT_FUNCTIONS, ...data.people.flatMap((p) => (p.function_name ? [p.function_name] : [])), ...functions])].sort();
  const active = data.people.filter((p) => p.is_active);
  const shown = active.filter((p) => !filter || `${p.full_name} ${p.email ?? ""} ${p.function_name ?? ""}`.toLowerCase().includes(filter.toLowerCase()));
  return (
    <section className="card form">
      <h2>Assign</h2>
      <fieldset className="plain-fieldset">
        <legend>Who it is for</legend>
        <label className="check">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Everyone on the roster
        </label>
        {!all && (
          <>
            <p className="muted small">Or choose functions, and any specific people (for example a new starter, or someone out of cycle):</p>
            <div className="row wrap">
              {allFunctions.map((f) => (
                <label key={f} className="check">
                  <input type="checkbox" checked={functions.includes(f)} onChange={(e) => setFunctions(e.target.checked ? [...functions, f] : functions.filter((x) => x !== f))} /> {f}
                </label>
              ))}
            </div>
          </>
        )}
      </fieldset>
      <fieldset className="plain-fieldset">
        <legend>Specific people{all ? " (in addition)" : ""}</legend>
        {active.length > 8 && <input aria-label="Find a person" placeholder="Find by name, email or function" value={filter} onChange={(e) => setFilter(e.target.value)} />}
        <div className="people-pick">
          {shown.map((p) => (
            <label key={p.id} className="check">
              <input type="checkbox" checked={people.includes(p.id)} onChange={(e) => setPeople(e.target.checked ? [...people, p.id] : people.filter((x) => x !== p.id))} /> {p.full_name}
              <span className="muted small"> {p.function_name ?? ""}</span>
            </label>
          ))}
          {active.length === 0 && <p className="muted">Nobody is on the roster yet. Add people under Roster.</p>}
        </div>
      </fieldset>
      <div className="row">
        <span className="field">
          <label htmlFor="as-due">Complete by</label>
          <input id="as-due" type="date" min={today()} value={dueOn} onChange={(e) => setDueOn(e.target.value)} />
        </span>
        <span className="field">
          <label htmlFor="as-freq">Re-assign</label>
          <select id="as-freq" value={m.refresh_every_months ?? ""} disabled={busy} onChange={(e) => onSettings({ refresh_every_months: e.target.value ? Number(e.target.value) : null })}>
            {FREQUENCIES.map((f) => (
              <option key={f.label} value={f.months ?? ""}>
                {f.label}
              </option>
            ))}
          </select>
        </span>
        <span className="field">
          <label htmlFor="as-days">Days to complete (new starters and repeats)</label>
          <input id="as-days" className="short" inputMode="numeric" defaultValue={m.due_days ?? 30} onBlur={(e) => { const n = Number(e.target.value); if (n >= 1 && n <= 365 && n !== m.due_days) onSettings({ due_days: n }); }} />
        </span>
      </div>
      {m.policy_id && (
        <label className="check">
          <input type="checkbox" checked={m.reassign_on_new_version ?? true} disabled={busy} onChange={(e) => onSettings({ reassign_on_new_version: e.target.checked })} /> Re-assign to everyone when a new version of the policy comes into force
        </label>
      )}
      <p className="muted">New people added to the roster who match are assigned automatically, due {m.due_days ?? 30} days after they start.</p>
      <button type="button" disabled={busy} onClick={() => onAssign({ all, functions: all ? [] : functions, people, dueOn })}>
        Assign
      </button>
    </section>
  );
}

function PersonRow({ p, busy, onSave }: { p: Person; busy: boolean; onSave: (v: Partial<PersonValues> & { is_active?: boolean }) => void }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState<PersonValues>({ full_name: p.full_name, email: p.email, function_name: p.function_name, manager_name: p.manager_name, manager_email: p.manager_email, start_date: p.start_date });
  if (!editing)
    return (
      <tr className={p.is_active ? undefined : "muted"}>
        <th scope="row">
          {p.full_name}
          {p.user_id ? <span className="chip chip-inline">Member</span> : null}
        </th>
        <td>{p.email ?? <span className="warning-text">No email</span>}</td>
        <td>{p.function_name ?? <span className="muted">Not set</span>}</td>
        <td>{p.manager_name ?? ""}{p.manager_email ? <span className="muted small"><br />{p.manager_email}</span> : null}</td>
        <td>{p.start_date ? formatDay(p.start_date) : ""}</td>
        <td>
          <button type="button" className="link-dark small" onClick={() => setEditing(true)}>
            Edit
          </button>{" "}
          <button type="button" className="link-dark small" disabled={busy} onClick={() => onSave({ is_active: !p.is_active })}>
            {p.is_active ? "Has left" : "Restore"}
          </button>
        </td>
      </tr>
    );
  return (
    <tr>
      <td colSpan={6}>
        <div className="row wrap">
          <input aria-label="Name" value={v.full_name} onChange={(e) => setV({ ...v, full_name: e.target.value })} />
          <input aria-label="Email" value={v.email ?? ""} onChange={(e) => setV({ ...v, email: e.target.value })} />
          <input aria-label="Function" list="tr-functions" value={v.function_name ?? ""} onChange={(e) => setV({ ...v, function_name: e.target.value })} />
          <input aria-label="Manager" placeholder="Manager" value={v.manager_name ?? ""} onChange={(e) => setV({ ...v, manager_name: e.target.value })} />
          <input aria-label="Manager email" placeholder="Manager email" value={v.manager_email ?? ""} onChange={(e) => setV({ ...v, manager_email: e.target.value })} />
          <input aria-label="Start date" type="date" value={v.start_date ?? ""} onChange={(e) => setV({ ...v, start_date: e.target.value })} />
          <button type="button" className="quiet" disabled={busy || v.full_name.trim().length < 2} onClick={() => { onSave(v); setEditing(false); }}>
            Save
          </button>
          <button type="button" className="link-dark" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </div>
      </td>
    </tr>
  );
}

export default function Training({ organisationId, organisationName, role, userId, initialModuleId }: Props) {
  const canManage = has(role, ...MANAGE_ROLES);
  const seesAll = has(role, ...SEE_ALL_ROLES);

  const [data, setData] = useState<TrainingData | null>(null);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [view, setView] = useState<View>(initialModuleId ? { kind: "module", moduleId: initialModuleId } : { kind: "home" });
  const [section, setSection] = useState<Section>("mine");
  const [answerKey, setAnswerKey] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Setting up a module
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [content, setContent] = useState("");
  const [policyId, setPolicyId] = useState("");
  const [material, setMaterial] = useState<File | null>(null);
  const [withQuiz, setWithQuiz] = useState(false);
  const [passMark, setPassMark] = useState("80");
  const [frequency, setFrequency] = useState("12");
  const [dueDays, setDueDays] = useState("30");
  const [drafts, setDrafts] = useState<DraftQuestion[]>([]);
  const materialInput = useRef<HTMLInputElement>(null);

  // Roster
  const [person, setPerson] = useState<PersonValues>(blankPerson());
  const [csv, setCsv] = useState("");
  // Report
  const [reportModule, setReportModule] = useState("");
  const [reportFunction, setReportFunction] = useState("");

  const reload = useCallback(async () => {
    const training = await loadTraining(organisationId);
    setData(training);
    if (canManage && training.ready) setLinks(await loadLinks(organisationId));
  }, [organisationId, canManage]);

  useEffect(() => {
    reload().catch((e) => setError(e instanceof Error ? e.message : "Could not load training."));
  }, [reload]);

  const openModuleId = view.kind === "module" ? view.moduleId : null;
  useEffect(() => {
    setAnswerKey({});
    if (!openModuleId || !canManage) return;
    loadAnswerKey(openModuleId).then(setAnswerKey, () => setAnswerKey({}));
  }, [openModuleId, canManage]);

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

  const go = (next: View) => {
    setError(null);
    setNotice(null);
    setView(next);
  };

  if (!data) {
    return error ? (
      <p className="error" role="alert">
        {error}
      </p>
    ) : (
      <p className="lead">Loading…</p>
    );
  }

  const moduleOf = (id: string) => data.modules.find((m) => m.id === id);
  const questionsOf = (id: string) => data.questions.filter((q) => q.module_id === id);
  const personOf = (a: Assignment) => data.people.find((p) => p.id === a.person_id) ?? data.people.find((p) => p.user_id === a.user_id);
  const nameOf = (a: Assignment) => personOf(a)?.full_name ?? "A member";
  const me = data.people.find((p) => p.user_id === userId);
  const mine = data.assignments
    .filter((a) => a.user_id === userId && moduleOf(a.module_id))
    .sort((a, b) => Number(Boolean(a.completed_at)) - Number(Boolean(b.completed_at)) || a.due_on.localeCompare(b.due_on));
  const current = latest(data.assignments.filter((a) => moduleOf(a.module_id)?.status !== "draft"));

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
  const back = (
    <p>
      <button type="button" className="link-dark" onClick={() => go({ kind: "home" })}>
        ← Back to training
      </button>
    </p>
  );

  // ---- Completing one's own training ----
  if (view.kind === "take") {
    const a = data.assignments.find((x) => x.id === view.assignmentId);
    const m = a && moduleOf(a.module_id);
    if (a && m) {
      const r = readingFor(data, m);
      return (
        <>
          {back}
          <p className="eyebrow">Training</p>
          <TrainingTake
            key={a.id}
            title={m.title}
            content={r.content}
            files={r.files.map((f) => ({ name: f.file_name, download: () => downloadMaterial(f) }))}
            questions={questionsOf(m.id).map((q) => ({ key: q.id, prompt: q.prompt, options: q.options }))}
            passMark={m.pass_mark}
            declaration={m.declaration_text ?? DEFAULT_DECLARATION}
            name={me?.full_name ?? nameOf(a)}
            dueOn={a.due_on}
            completedAt={a.completed_at}
            signedName={a.signed_name ?? null}
            score={a.score}
            policyVersion={a.policy_version_no}
            onSubmit={async (answers, signed, agreed) => {
              const res = await completeTraining(a.id, answers, signed, agreed);
              if (res.completed) await reload();
              return res;
            }}
          />
        </>
      );
    }
  }

  // ---- One module ----
  if (view.kind === "module") {
    const m = moduleOf(view.moduleId);
    if (m) {
      const questions = questionsOf(m.id);
      const rows = latest(data.assignments.filter((a) => a.module_id === m.id)).sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
      const r = readingFor(data, m);
      const done = rows.filter(isCurrent).length;
      return (
        <>
          {back}
          <p className="eyebrow">{r.policy ? `Policy: ${r.policy.title}` : m.source === "library" ? "From the standard library" : "Written by your organisation"}</p>
          <h1>{m.title}</h1>
          <p className="lead">
            <span className="chip">{MODULE_STATUS[m.status]}</span> {questions.length ? `Questionnaire, pass mark ${m.pass_mark}%` : "Declaration only"} · {frequencyLabel(m.refresh_every_months)}
            {rows.length ? ` · ${done} of ${rows.length} complete (${pct(done, rows.length)})` : ""}
          </p>
          {messages}

          {canManage && m.status === "draft" && (
            <section className="card warning">
              <h2>Review, then publish</h2>
              <p>Check the material and any questions. Once published they are fixed, so every completion points at what the person actually read.{r.policy ? " The policy text always shows the version in force." : ""}</p>
              <button type="button" disabled={busy} onClick={() => void run(() => setModuleStatus(m.id, "published"), "Published. Now assign it.")}>
                Publish
              </button>
            </section>
          )}

          {canManage && m.status === "published" && data.ready && (
            <AssignPanel
              key={m.id + data.targets.length}
              m={m}
              data={data}
              busy={busy}
              onAssign={(t) => void run(async () => { const n = await setTargets(m.id, t); setNotice(n === 0 ? "Saved. Nobody new needed assigning: everyone covered already has it open or completed." : `Assigned to ${n} ${n === 1 ? "person" : "people"}.`); })}
              onSettings={(patch) => void run(() => updateModuleSettings(m.id, patch), "Saved.")}
            />
          )}

          <section className="block">
            <h2>Who has done it</h2>
            {rows.length === 0 ? (
              <p className="muted">Not assigned to anyone yet.</p>
            ) : (
              <div className="table-scroll">
                <table className="report-table">
                  <thead>
                    <tr>
                      <th scope="col">Person</th>
                      <th scope="col">Status</th>
                      <th scope="col">Due</th>
                      <th scope="col">Completed and signed</th>
                      <th scope="col"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((a) => (
                      <tr key={a.id}>
                        <th scope="row">
                          {nameOf(a)}
                          <span className="muted small"><br />{personOf(a)?.function_name ?? ""}{a.reason ? ` · ${a.reason}` : ""}</span>
                        </th>
                        <td><span className={isOverdue(a) ? "chip chip-alert" : "chip"}>{statusOf(a)}</span></td>
                        <td>{formatDay(a.due_on)}</td>
                        <td>
                          {a.completed_at ? `${formatDay(a.completed_at)}${a.signed_name ? `, signed "${a.signed_name}"` : ""}${questions.length && a.score !== null ? ` · ${a.score}%` : ""}${a.completed_by_link ? " · by link" : ""}` : ""}
                          {a.expires_on && a.completed_at ? <span className="muted small"><br />Repeat due {formatDay(a.expires_on)}</span> : null}
                        </td>
                        <td>
                          {canManage && !a.completed_at && (
                            <button type="button" className="link-dark small" disabled={busy} onClick={() => void run(() => withdrawAssignment(a.id))}>
                              Withdraw
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="block">
            <h2>What people read</h2>
            {r.files.length > 0 && (
              <p>
                {r.files.map((f) => (
                  <button key={f.storage_path} type="button" className="quiet" onClick={() => void downloadMaterial(f).catch((e) => setError(e.message))}>
                    ⤓ {f.file_name}
                  </button>
                ))}
              </p>
            )}
            <div className="card reading">
              {r.content.split(/\n\s*\n/).filter(Boolean).map((p, i) => (
                <p key={i}>{p.replace(/^# /, "")}</p>
              ))}
            </div>
            <h2>Declaration</h2>
            <p>{m.declaration_text ?? DEFAULT_DECLARATION}</p>
            <h2>Questions</h2>
            {questions.length === 0 ? (
              <p className="muted">No questionnaire: people read the material and sign the declaration.</p>
            ) : (
              <ol className="question-list">
                {questions.map((q) => (
                  <li key={q.id}>
                    {q.prompt}
                    <ul>
                      {q.options.map((o, i) => (
                        <li key={i}>
                          {o}
                          {answerKey[q.id] === i && <strong> (correct)</strong>}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ol>
            )}
          </section>

          {canManage && m.status === "published" && (
            <p>
              <button
                type="button"
                className="quiet"
                disabled={busy}
                onClick={() => {
                  if (window.confirm("Retire this training? It can no longer be assigned. Completions are kept.")) void run(() => setModuleStatus(m.id, "retired"));
                }}
              >
                Retire
              </button>
            </p>
          )}
        </>
      );
    }
  }

  // ---- Home ----
  async function submitModule(event: FormEvent) {
    event.preventDefault();
    const mark = Number(passMark);
    const days = Number(dueDays);
    const linked = data!.policies.find((p) => p.id === policyId);
    const text = content.trim() || (linked ? `Read the ${linked.title}.` : material ? `Read the attached material: ${material.name}.` : "");
    if (title.trim().length < 3) return setError("Give the training a title.");
    if (!linked && !material && text.length < 20) return setError("Add the material: link a policy, upload a file, or write it below.");
    if (withQuiz && (!Number.isInteger(mark) || mark < 0 || mark > 100)) return setError("The pass mark is a whole number from 0 to 100.");
    if (!Number.isInteger(days) || days < 1 || days > 365) return setError("Days to complete must be 1 to 365.");
    const questions: NewQuestion[] = [];
    if (withQuiz) {
      if (drafts.length === 0) return setError("Add at least one question, or turn the questionnaire off.");
      for (const [i, d] of drafts.entries()) {
        const options = d.options.map((o) => o.trim()).filter(Boolean);
        if (d.prompt.trim().length < 5) return setError(`Question ${i + 1} needs its wording.`);
        if (options.length < 4) return setError(`Question ${i + 1} needs at least four answers.`);
        if (!d.options[d.correct]?.trim()) return setError(`Question ${i + 1}: choose which answer is correct.`);
        questions.push({ prompt: d.prompt, options, correct: options.indexOf(d.options[d.correct].trim()) });
      }
    }
    let id = "";
    const ok = await run(async () => {
      id = await createModule(organisationId, {
        title,
        summary,
        content: text.length >= 20 ? text : `${text} Read it in full before completing.`,
        passMark: withQuiz ? mark : 0,
        refreshMonths: frequency ? Number(frequency) : null,
        questions,
        policyId: linked?.id ?? null,
        dueDays: days,
      });
      if (material) await attachMaterial(id, material);
    });
    if (ok) {
      setTitle("");
      setSummary("");
      setContent("");
      setPolicyId("");
      setMaterial(null);
      setDrafts([]);
      setWithQuiz(false);
      go({ kind: "module", moduleId: id });
    }
  }
  const setDraft = (i: number, patch: Partial<DraftQuestion>) => setDrafts(drafts.map((d, n) => (n === i ? { ...d, ...patch } : d)));
  const visibleModules = data.modules.filter((m) => canManage || m.status !== "draft");

  // Reminders
  const reminders = canManage
    ? data.assignments
        .filter((a) => moduleOf(a.module_id)?.status === "published")
        .flatMap((a) => {
          const kind = reminderDue(a);
          return kind ? [{ a, kind, p: personOf(a), m: moduleOf(a.module_id)! }] : [];
        })
    : [];
  const origin = window.location.origin;
  const linkFor = (a: Assignment) => (a.user_id ? origin : links[a.id] ? `${origin}/?t=${links[a.id]}` : origin);

  const tabs: { id: Section; label: string }[] = [
    { id: "mine", label: "Your training" },
    ...(seesAll ? [{ id: "modules" as const, label: "Training" }] : []),
    ...(canManage && data.ready ? [{ id: "roster" as const, label: "Roster" }] : []),
    ...(seesAll ? [{ id: "report" as const, label: "Report" }] : []),
    ...(canManage && data.ready ? [{ id: "reminders" as const, label: `Reminders to send${reminders.length ? ` (${reminders.length})` : ""}` }] : []),
  ];

  // Report figures
  const functionsInUse = [...new Set(data.people.flatMap((p) => (p.function_name ? [p.function_name] : [])))].sort();
  const reportRows = current.filter((a) => (!reportModule || a.module_id === reportModule) && (!reportFunction || personOf(a)?.function_name === reportFunction));
  const overdueRows = reportRows.filter(isOverdue).sort((a, b) => a.due_on.localeCompare(b.due_on));
  const daysLate = (a: Assignment) => Math.round((new Date(`${today()}T00:00:00`).getTime() - new Date(`${a.due_on}T00:00:00`).getTime()) / 86_400_000);

  return (
    <>
      <p className="eyebrow">Compliance training</p>
      <h1>Training</h1>
      {!data.ready && canManage && <p className="card warning">Run migration 0036 to turn on the roster, declarations, personal links, reports and reminders.</p>}
      {tabs.length > 1 && (
        <span className="segmented block-gap" role="group" aria-label="Training sections">
          {tabs.map((t) => (
            <button key={t.id} type="button" className={section === t.id ? "on" : undefined} aria-pressed={section === t.id} onClick={() => { setSection(t.id); setNotice(null); setError(null); }}>
              {t.label}
            </button>
          ))}
        </span>
      )}
      {messages}

      {section === "mine" && (
        <section className="block">
          <h2>Your training</h2>
          {mine.length === 0 ? (
            <p className="muted">Nothing is assigned to you.</p>
          ) : (
            <ul className="entity-list">
              {mine.map((a) => (
                <li key={a.id}>
                  <button type="button" className="entity-row" onClick={() => go({ kind: "take", assignmentId: a.id })}>
                    <span>
                      <span className="entity-name">{moduleOf(a.module_id)!.title}</span>
                      <br />
                      <span className="muted">{a.completed_at ? `Completed ${formatDay(a.completed_at)}` : `Due ${formatDay(a.due_on)}`}</span>
                    </span>
                    <span className={isOverdue(a) ? "chip chip-alert" : "chip"}>{statusOf(a)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {section === "modules" && (
        <>
          <section className="block">
            <h2>Training modules</h2>
            {visibleModules.length === 0 ? (
              <p className="muted">{canManage ? "None yet. Set one up below, start from the standard library, or use Assign Training on a policy." : "None have been published."}</p>
            ) : (
              <ul className="entity-list">
                {visibleModules.map((m) => {
                  const rows = current.filter((a) => a.module_id === m.id);
                  const overdue = rows.filter(isOverdue).length;
                  return (
                    <li key={m.id}>
                      <button type="button" className="entity-row" onClick={() => go({ kind: "module", moduleId: m.id })}>
                        <span>
                          <span className="entity-name">{m.title}</span>
                          <br />
                          <span className="muted">
                            {m.status === "draft" ? "Waiting for review" : rows.length === 0 ? "Not assigned to anyone" : `${rows.filter(isCurrent).length} of ${rows.length} complete`} · {frequencyLabel(m.refresh_every_months)}
                          </span>
                          {overdue > 0 && <strong className="warning-text"> · {overdue} overdue</strong>}
                        </span>
                        <span className="chip">{MODULE_STATUS[m.status]}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {canManage && (
            <form className="card form" onSubmit={submitModule}>
              <h2>Set up training</h2>
              <label htmlFor="tm-title">Title</label>
              <input id="tm-title" value={title} onChange={(e) => setTitle(e.target.value)} />
              <label htmlFor="tm-summary">One-line summary (optional)</label>
              <input id="tm-summary" value={summary} onChange={(e) => setSummary(e.target.value)} />
              {data.ready && (
                <>
                  <label htmlFor="tm-policy">Policy or code it is about (optional)</label>
                  <select id="tm-policy" value={policyId} onChange={(e) => { setPolicyId(e.target.value); const p = data.policies.find((x) => x.id === e.target.value); if (p && !title) setTitle(`${p.title}: read and acknowledge`); }}>
                    <option value="">None</option>
                    {data.policies.filter((p) => p.version_no).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title} (version {p.version_no})
                      </option>
                    ))}
                  </select>
                  <label htmlFor="tm-file">Upload material (optional): policy, code, slides or other training</label>
                  <input ref={materialInput} id="tm-file" type="file" onChange={(e) => setMaterial(e.target.files?.[0] ?? null)} />
                </>
              )}
              <label htmlFor="tm-content">{policyId || material ? "Notes for the reader (optional)" : "What people will read"}</label>
              <textarea id="tm-content" rows={5} placeholder="Leave a blank line between paragraphs." value={content} onChange={(e) => setContent(e.target.value)} />
              <div className="row">
                <span className="field">
                  <label htmlFor="tm-freq">Re-assign</label>
                  <select id="tm-freq" value={frequency} onChange={(e) => setFrequency(e.target.value)}>
                    {FREQUENCIES.map((f) => (
                      <option key={f.label} value={f.months ?? ""}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </span>
                <span className="field">
                  <label htmlFor="tm-days">Days to complete</label>
                  <input id="tm-days" className="short" inputMode="numeric" value={dueDays} onChange={(e) => setDueDays(e.target.value)} />
                </span>
              </div>
              <p className="muted">Everyone signs the declaration: their name, the date, "I agree to comply with the terms of this policy", and their typed name in lieu of a signature.</p>
              <label className="check">
                <input type="checkbox" checked={withQuiz} onChange={(e) => { setWithQuiz(e.target.checked); if (e.target.checked && drafts.length === 0) setDrafts([blankQuestion()]); }} /> Add a questionnaire
              </label>
              {withQuiz && (
                <>
                  <label htmlFor="tm-pass">Pass mark, %</label>
                  <input id="tm-pass" className="short" inputMode="numeric" value={passMark} onChange={(e) => setPassMark(e.target.value)} />
                  {drafts.map((d, i) => (
                    <fieldset key={i} className="plain-fieldset question">
                      <legend>Question {i + 1}</legend>
                      <label htmlFor={`tq-prompt-${i}`}>Question</label>
                      <input id={`tq-prompt-${i}`} value={d.prompt} onChange={(e) => setDraft(i, { prompt: e.target.value })} />
                      <p className="muted small">Answers (at least four). Choose the correct one.</p>
                      {d.options.map((o, oi) => (
                        <div key={oi} className="row answer-row">
                          <input type="radio" name={`tq-correct-${i}`} aria-label={`Answer ${oi + 1} is correct`} checked={d.correct === oi} onChange={() => setDraft(i, { correct: oi })} />
                          <input aria-label={`Question ${i + 1}, answer ${oi + 1}`} className="grow" value={o} onChange={(e) => setDraft(i, { options: d.options.map((x, n) => (n === oi ? e.target.value : x)) })} />
                          {d.options.length > 4 && (
                            <button type="button" className="link-dark small" onClick={() => setDraft(i, { options: d.options.filter((_, n) => n !== oi), correct: d.correct > oi ? d.correct - 1 : d.correct === oi ? 0 : d.correct })}>
                              Remove
                            </button>
                          )}
                        </div>
                      ))}
                      <div className="row">
                        {d.options.length < 6 && (
                          <button type="button" className="link-dark small" onClick={() => setDraft(i, { options: [...d.options, ""] })}>
                            Add an answer
                          </button>
                        )}
                        <button type="button" className="link-dark small" onClick={() => setDrafts(drafts.filter((_, n) => n !== i))}>
                          Remove question
                        </button>
                      </div>
                    </fieldset>
                  ))}
                  <button type="button" className="quiet" onClick={() => setDrafts([...drafts, blankQuestion()])}>
                    Add a question
                  </button>
                </>
              )}
              <button type="submit" disabled={busy}>
                Save as a draft
              </button>
            </form>
          )}

          {canManage && (
            <details className="block">
              <summary>
                <strong>Standard library</strong> <span className="muted">· starter modules to review and adapt</span>
              </summary>
              <ul className="plain rows">
                {data.library.map((l) => {
                  const have = data.modules.some((m) => m.library_id === l.id && m.status !== "retired");
                  return (
                    <li key={l.id} className="row spread">
                      <span>
                        <strong>{l.title}</strong>
                        <br />
                        <span className="muted">
                          {l.summary}
                          {l.is_placeholder ? "" : ` About ${l.minutes} minutes.`}
                        </span>
                      </span>
                      {l.is_placeholder ? (
                        <span className="chip">Coming later</span>
                      ) : have ? (
                        <span className="chip">Added</span>
                      ) : (
                        <button type="button" className="quiet" disabled={busy} aria-label={`Add ${l.title}`} onClick={() => { let id = ""; void run(async () => { id = await adoptModule(organisationId, l.id); }).then((ok) => ok && go({ kind: "module", moduleId: id })); }}>
                          Add
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </details>
          )}
        </>
      )}

      {section === "roster" && (
        <>
          <section className="block">
            <h2>Roster</h2>
            <p className="muted">Everyone who can be assigned training. Common Seal members are added automatically; add anyone else here. People without an account complete training by a personal link.</p>
            <datalist id="tr-functions">
              {[...new Set([...DEFAULT_FUNCTIONS, ...functionsInUse])].map((f) => (
                <option key={f} value={f} />
              ))}
            </datalist>
            <div className="table-scroll">
              <table className="report-table">
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Email</th>
                    <th scope="col">Function</th>
                    <th scope="col">Manager</th>
                    <th scope="col">Start date</th>
                    <th scope="col"></th>
                  </tr>
                </thead>
                <tbody>
                  {data.people.map((p) => (
                    <PersonRow key={p.id} p={p} busy={busy} onSave={(v) => void run(() => updatePerson(p.id, v), "Saved.")} />
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="card form">
            <h2>Add a person</h2>
            <div className="row wrap">
              <span className="field">
                <label htmlFor="rp-name">Name</label>
                <input id="rp-name" value={person.full_name} onChange={(e) => setPerson({ ...person, full_name: e.target.value })} />
              </span>
              <span className="field">
                <label htmlFor="rp-email">Email</label>
                <input id="rp-email" type="email" value={person.email ?? ""} onChange={(e) => setPerson({ ...person, email: e.target.value })} />
              </span>
              <span className="field">
                <label htmlFor="rp-function">Function</label>
                <input id="rp-function" list="tr-functions" value={person.function_name ?? ""} onChange={(e) => setPerson({ ...person, function_name: e.target.value })} />
              </span>
            </div>
            <div className="row wrap">
              <span className="field">
                <label htmlFor="rp-manager">Manager</label>
                <input id="rp-manager" value={person.manager_name ?? ""} onChange={(e) => setPerson({ ...person, manager_name: e.target.value })} />
              </span>
              <span className="field">
                <label htmlFor="rp-manager-email">Manager's email</label>
                <input id="rp-manager-email" type="email" value={person.manager_email ?? ""} onChange={(e) => setPerson({ ...person, manager_email: e.target.value })} />
              </span>
              <span className="field">
                <label htmlFor="rp-start">Start date</label>
                <input id="rp-start" type="date" value={person.start_date ?? ""} onChange={(e) => setPerson({ ...person, start_date: e.target.value })} />
              </span>
            </div>
            <p className="muted">A new starter is assigned the training that applies to them (everyone, or their function), due after their start date.</p>
            <button type="button" disabled={busy || person.full_name.trim().length < 2} onClick={() => void run(() => addPerson(organisationId, person), `${person.full_name.trim()} added.`).then((ok) => ok && setPerson(blankPerson()))}>
              Add
            </button>
          </section>
          <section className="card form">
            <h2>Upload a roster</h2>
            <p className="muted">One person per line: name, email, function, manager name, manager email, start date. A header row is fine. Paste from a spreadsheet, or choose a CSV file.</p>
            <input type="file" accept=".csv,text/csv,text/plain" aria-label="Roster file" onChange={(e) => { const f = e.target.files?.[0]; if (f) void f.text().then(setCsv); }} />
            <textarea rows={5} aria-label="Roster lines" placeholder="Pat Plant, pat@company.com, Operations, Max Manager, max@company.com, 1/11/2026" value={csv} onChange={(e) => setCsv(e.target.value)} />
            {csv.trim() && (() => {
              const { rows, problems } = parseRoster(csv);
              const known = new Set(data.people.flatMap((p) => (p.email ? [p.email.toLowerCase()] : [])));
              const fresh = rows.filter((r) => !r.email || !known.has(r.email.toLowerCase()));
              return (
                <>
                  <p>
                    {fresh.length} to add{rows.length - fresh.length ? `, ${rows.length - fresh.length} already on the roster (skipped)` : ""}.
                  </p>
                  {problems.length > 0 && <ul className="warning-text">{problems.slice(0, 10).map((x) => <li key={x}>{x}</li>)}</ul>}
                  <button type="button" disabled={busy || fresh.length === 0} onClick={() => void run(async () => { for (const r of fresh) await addPerson(organisationId, r); }, `${fresh.length} added to the roster.`).then((ok) => ok && setCsv(""))}>
                    Add {fresh.length} {fresh.length === 1 ? "person" : "people"}
                  </button>
                </>
              );
            })()}
          </section>
        </>
      )}

      {section === "report" && (
        <>
          <div className="row block">
            <span className="field">
              <label htmlFor="rp-module">Training</label>
              <select id="rp-module" value={reportModule} onChange={(e) => setReportModule(e.target.value)}>
                <option value="">All training</option>
                {data.modules.filter((m) => m.status !== "draft").map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title}
                  </option>
                ))}
              </select>
            </span>
            <span className="field">
              <label htmlFor="rp-function-f">Function</label>
              <select id="rp-function-f" value={reportFunction} onChange={(e) => setReportFunction(e.target.value)}>
                <option value="">All functions</option>
                {functionsInUse.map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
            </span>
          </div>
          <dl className="facts">
            <div>
              <dt>Completion rate</dt>
              <dd>{pct(reportRows.filter(isCurrent).length, reportRows.length)}</dd>
            </div>
            <div>
              <dt>Complete</dt>
              <dd>{reportRows.filter(isCurrent).length}</dd>
            </div>
            <div>
              <dt>Not yet due</dt>
              <dd>{reportRows.filter((a) => !a.completed_at && !isOverdue(a)).length}</dd>
            </div>
            <div>
              <dt>Overdue</dt>
              <dd className={overdueRows.length ? "warning-text" : undefined}>{overdueRows.length}</dd>
            </div>
          </dl>
          <section className="block">
            <h2>By training</h2>
            <div className="table-scroll">
              <table className="report-table">
                <thead>
                  <tr>
                    <th scope="col">Training</th>
                    <th scope="col">Assigned</th>
                    <th scope="col">Complete</th>
                    <th scope="col">Overdue</th>
                    <th scope="col">Completion rate</th>
                  </tr>
                </thead>
                <tbody>
                  {data.modules.filter((m) => m.status !== "draft" && (!reportModule || m.id === reportModule)).map((m) => {
                    const rows = reportRows.filter((a) => a.module_id === m.id);
                    return (
                      <tr key={m.id}>
                        <th scope="row">{m.title}</th>
                        <td>{rows.length}</td>
                        <td>{rows.filter(isCurrent).length}</td>
                        <td className={rows.some(isOverdue) ? "warning-text" : undefined}>{rows.filter(isOverdue).length}</td>
                        <td>{pct(rows.filter(isCurrent).length, rows.length)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
          {functionsInUse.length > 0 && (
            <section className="block">
              <h2>By function</h2>
              <div className="table-scroll">
                <table className="report-table">
                  <thead>
                    <tr>
                      <th scope="col">Function</th>
                      <th scope="col">Assigned</th>
                      <th scope="col">Complete</th>
                      <th scope="col">Overdue</th>
                      <th scope="col">Completion rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...functionsInUse, ""].filter((f) => !reportFunction || f === reportFunction).map((f) => {
                      const rows = reportRows.filter((a) => (personOf(a)?.function_name ?? "") === f);
                      if (!rows.length) return null;
                      return (
                        <tr key={f || "none"}>
                          <th scope="row">{f || "No function recorded"}</th>
                          <td>{rows.length}</td>
                          <td>{rows.filter(isCurrent).length}</td>
                          <td className={rows.some(isOverdue) ? "warning-text" : undefined}>{rows.filter(isOverdue).length}</td>
                          <td>{pct(rows.filter(isCurrent).length, rows.length)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          <section className="block">
            <h2>Overdue</h2>
            {overdueRows.length === 0 ? (
              <p className="muted">Nothing is overdue.</p>
            ) : (
              <div className="table-scroll">
                <table className="report-table">
                  <thead>
                    <tr>
                      <th scope="col">Person</th>
                      <th scope="col">Function</th>
                      <th scope="col">Training</th>
                      <th scope="col">Due</th>
                      <th scope="col">Days overdue</th>
                      <th scope="col">Manager</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overdueRows.map((a) => (
                      <tr key={a.id}>
                        <th scope="row">{nameOf(a)}</th>
                        <td>{personOf(a)?.function_name ?? ""}</td>
                        <td>{moduleOf(a.module_id)?.title}</td>
                        <td>{formatDay(a.due_on)}</td>
                        <td className="warning-text">{daysLate(a)}</td>
                        <td>{personOf(a)?.manager_name ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <p className="row no-print">
            <button
              type="button"
              className="quiet"
              onClick={() =>
                csvDownload(`${organisationName} training ${today()}.csv`, [
                  ["Person", "Email", "Function", "Manager", "Training", "Status", "Due", "Completed", "Signed name", "Score", "Days overdue"],
                  ...reportRows.map((a) => [nameOf(a), personOf(a)?.email ?? "", personOf(a)?.function_name ?? "", personOf(a)?.manager_name ?? "", moduleOf(a.module_id)?.title ?? "", statusOf(a), a.due_on, a.completed_at?.slice(0, 10) ?? "", a.signed_name ?? "", a.completed_at && questionsOf(a.module_id).length ? a.score ?? "" : "", isOverdue(a) ? daysLate(a) : ""]),
                ])
              }
            >
              Download as a spreadsheet (CSV)
            </button>
            <button type="button" className="quiet" onClick={() => window.print()}>
              Print or save as PDF
            </button>
          </p>
        </>
      )}

      {section === "reminders" && (
        <section className="block">
          <h2>Reminders to send</h2>
          <p className="muted">7 days before the due date, on the due date, then weekly while overdue with the manager copied. Common Seal cannot send email yet, so each opens in your own email; mark it as sent once it has gone.</p>
          {reminders.length === 0 ? (
            <p className="muted">Nothing to send today.</p>
          ) : (
            <ul className="plain rows">
              {reminders.map(({ a, kind, p, m }) => {
                const to = p?.email ? [p.email] : [];
                const cc = kind === "overdue" && p?.manager_email ? [p.manager_email] : [];
                const subject = kind === "overdue" ? `Overdue: ${m.title}` : kind === "due" ? `Due today: ${m.title}` : `Reminder: ${m.title} is due ${formatDay(a.due_on)}`;
                const body = `Dear ${p?.full_name.split(" ")[0] ?? "colleague"},\n\n${
                  kind === "overdue" ? `Your training "${m.title}" was due on ${formatDay(a.due_on)} and is now overdue.${cc.length ? " Your manager is copied." : ""}` : kind === "due" ? `Your training "${m.title}" is due today.` : `Your training "${m.title}" is due on ${formatDay(a.due_on)}.`
                }\n\nPlease complete it here: ${linkFor(a)}\n\nIt takes a few minutes: read the material${questionsOf(m.id).length ? ", answer the questions" : ""} and sign the declaration.\n\nThank you`;
                return (
                  <li key={`${a.id}-${kind}`} className="row spread">
                    <span>
                      <strong>{p?.full_name ?? nameOf(a)}</strong> · {m.title}
                      <br />
                      <span className={kind === "overdue" ? "warning-text small" : "muted small"}>
                        {kind === "overdue" ? `Overdue since ${formatDay(a.due_on)}${a.overdue_count ? ` · reminder ${(a.overdue_count ?? 0) + 1}` : ""}${cc.length ? ` · copy to ${p?.manager_name ?? cc[0]}` : " · no manager recorded"}` : kind === "due" ? "Due today" : `Due ${formatDay(a.due_on)}`}
                        {!to.length ? " · no email recorded: add it on the Roster" : ""}
                      </span>
                    </span>
                    <span className="row">
                      {to.length > 0 && (
                        <a className="link-dark" href={mailto(to, subject, body, cc)}>
                          Open email
                        </a>
                      )}
                      <button type="button" className="quiet" disabled={busy} onClick={() => void run(() => markReminderSent(a.id, kind), "Recorded as sent.")}>
                        Mark as sent
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </>
  );
}
