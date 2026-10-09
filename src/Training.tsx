import { useCallback, useEffect, useState, type FormEvent } from "react";
import { formatDay, loadMembers, type Member } from "./board";
import {
  adoptModule,
  assignTraining,
  createModule,
  isCurrent,
  isOverdue,
  loadAnswerKey,
  loadTraining,
  MODULE_STATUS,
  setModuleStatus,
  setRefresh,
  submitTraining,
  today,
  withdrawAssignment,
  type Assignment,
  type MarkResult,
  type NewQuestion,
  type Question,
  type TrainingData,
  type TrainingModule,
} from "./training";

type Props = { organisationId: string; role: string; userId: string };
type View = { kind: "home" } | { kind: "take"; assignmentId: string } | { kind: "module"; moduleId: string };
type DraftQuestion = { prompt: string; options: string; correct: number };

const MANAGE_ROLES = ["owner", "admin", "secretary", "legal", "compliance"];
const SEE_ALL_ROLES = [...MANAGE_ROLES, "director", "auditor"];

const inDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const paragraphs = (text: string) =>
  text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

function assignmentLabel(a: Assignment) {
  if (a.completed_at) {
    const expired = a.expires_on && a.expires_on < today();
    return `${expired ? "Expired" : "Completed"} · ${a.score ?? 0}%`;
  }
  return isOverdue(a) ? "Overdue" : "To do";
}

/** The page a person reads and answers. */
function Take({
  module,
  questions,
  assignment,
  onDone,
}: {
  module: TrainingModule;
  questions: Question[];
  assignment: Assignment;
  onDone: () => Promise<void>;
}) {
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [result, setResult] = useState<MarkResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const done = Boolean(assignment.completed_at);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (questions.some((q) => answers[q.id] === undefined)) return setError("Answer every question.");
    setBusy(true);
    setError(null);
    try {
      const marked = await submitTraining(
        assignment.id,
        questions.map((q) => answers[q.id]),
      );
      setResult(marked);
      if (marked.passed) await onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not record your answers.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p className="eyebrow">Training</p>
      <h1>{module.title}</h1>
      <p className="lead">
        {done
          ? `Completed on ${formatDay(assignment.completed_at!)} with ${assignment.score ?? 0}%.`
          : `Due ${formatDay(assignment.due_on)}. Pass mark ${module.pass_mark}%.`}
      </p>
      <section className="card reading">
        {paragraphs(module.content).map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </section>

      {!done && !result?.passed && (
        <form className="block" onSubmit={submit}>
          {questions.length > 0 && <h2>Questions</h2>}
          {questions.map((q, qi) => (
            <fieldset key={q.id} className="plain-fieldset question">
              <legend>
                {qi + 1}. {q.prompt}
                {result && !result.passed && (
                  <span className={result.marks[qi] ? "muted" : "warning-text"}> {result.marks[qi] ? "Correct" : "Not correct"}</span>
                )}
              </legend>
              {q.options.map((option, oi) => (
                <label key={oi} className="check">
                  <input
                    type="radio"
                    name={q.id}
                    checked={answers[q.id] === oi}
                    onChange={() => {
                      setAnswers({ ...answers, [q.id]: oi });
                    }}
                  />{" "}
                  {option}
                </label>
              ))}
            </fieldset>
          ))}
          {result && !result.passed && (
            <p className="card warning" role="status">
              You scored {result.score}%. The pass mark is {result.pass_mark}%. Read the material again, change your answers
              and resubmit. Each attempt is recorded.
            </p>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" disabled={busy}>
            {busy ? "Recording…" : questions.length === 0 ? "I have read and understood this" : result ? "Submit again" : "Submit answers"}
          </button>
        </form>
      )}
      {result?.passed && (
        <p className="card note" role="status">
          {questions.length === 0 ? "Recorded. Thank you." : `Passed with ${result.score}%. Your completion is recorded.`}
        </p>
      )}
    </>
  );
}

export default function Training({ organisationId, role, userId }: Props) {
  const canManage = MANAGE_ROLES.includes(role);
  const seesAll = SEE_ALL_ROLES.includes(role);

  const [data, setData] = useState<TrainingData | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [view, setView] = useState<View>({ kind: "home" });
  const [answerKey, setAnswerKey] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Assigning
  const [dueOn, setDueOn] = useState(() => inDays(14));
  const [everyone, setEveryone] = useState(true);
  const [chosen, setChosen] = useState<string[]>([]);

  // Writing a module
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [content, setContent] = useState("");
  const [passMark, setPassMark] = useState("80");
  const [refresh, setRefresh_] = useState("12");
  const [drafts, setDrafts] = useState<DraftQuestion[]>([]);

  const reload = useCallback(async () => {
    const [training, people] = await Promise.all([loadTraining(organisationId), seesAll ? loadMembers(organisationId) : Promise.resolve([])]);
    setData(training);
    setMembers(people);
  }, [organisationId, seesAll]);

  useEffect(() => {
    reload().catch((e) => setError(e instanceof Error ? e.message : "Could not load training."));
  }, [reload]);

  const openModuleId = view.kind === "module" ? view.moduleId : null;
  useEffect(() => {
    setAnswerKey({});
    if (!openModuleId || !canManage) return;
    loadAnswerKey(openModuleId).then(setAnswerKey, () => setAnswerKey({}));
  }, [openModuleId, canManage]);

  async function run(action: () => Promise<void>): Promise<boolean> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      await reload();
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
  const memberName = (id: string) => members.find((m) => m.user_id === id)?.name ?? "Unknown user";
  // Status counts ignore completions that a later assignment has replaced
  const live = (id: string) => data.assignments.filter((a) => a.module_id === id && (!a.completed_at || isCurrent(a)));
  const mine = data.assignments
    .filter((a) => a.user_id === userId && moduleOf(a.module_id))
    .sort((a, b) => Number(Boolean(a.completed_at)) - Number(Boolean(b.completed_at)) || a.due_on.localeCompare(b.due_on));

  const back = (
    <p>
      <button type="button" className="link-dark" onClick={() => go({ kind: "home" })}>
        ← Back to training
      </button>
    </p>
  );

  if (view.kind === "take") {
    const assignment = data.assignments.find((a) => a.id === view.assignmentId);
    const module = assignment && moduleOf(assignment.module_id);
    if (assignment && module) {
      return (
        <>
          {back}
          <Take key={assignment.id} module={module} questions={questionsOf(module.id)} assignment={assignment} onDone={reload} />
        </>
      );
    }
  }

  if (view.kind === "module") {
    const module = moduleOf(view.moduleId);
    if (module) {
      const questions = questionsOf(module.id);
      const assigned = data.assignments.filter((a) => a.module_id === module.id);
      const active = members.filter((m) => m.is_active);
      return (
        <>
          {back}
          <p className="eyebrow">{module.source === "library" ? "From the standard library" : "Written by your organisation"}</p>
          <h1>{module.title}</h1>
          <p className="lead">
            <span className="chip">{MODULE_STATUS[module.status]}</span> Pass mark {module.pass_mark}% ·{" "}
            {module.refresh_every_months ? `repeats every ${module.refresh_every_months} months` : "does not repeat"}
          </p>
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

          {canManage && module.status === "draft" && (
            <section className="card warning">
              <h2>Review, then publish</h2>
              <p>
                {module.source === "library"
                  ? "This is starter wording. Check it against your own policies before you publish."
                  : "Check the wording and the questions before you publish."}{" "}
                Once published the wording and questions are fixed, so every completion points at the text the person
                actually read. To change it later, retire it and publish a new one.
              </p>
              <button type="button" disabled={busy} onClick={() => void run(() => setModuleStatus(module.id, "published"))}>
                Publish
              </button>
            </section>
          )}

          {canManage && module.status === "published" && (
            <form
              className="card form"
              onSubmit={(e) => {
                e.preventDefault();
                if (!everyone && chosen.length === 0) return setError("Choose at least one person.");
                void run(async () => {
                  const n = await assignTraining(module.id, everyone ? null : chosen, dueOn);
                  setNotice(
                    n === 0
                      ? "Nobody new was assigned. Everyone chosen already has it open or has a current completion."
                      : `Assigned to ${n} ${n === 1 ? "person" : "people"}.`,
                  );
                  setChosen([]);
                });
              }}
            >
              <h2>Assign</h2>
              <label className="check">
                <input type="radio" name="who" checked={everyone} onChange={() => setEveryone(true)} />{" "}
                {module.audience === "directors" ? "All directors" : "Everyone except auditors"}
              </label>
              <label className="check">
                <input type="radio" name="who" checked={!everyone} onChange={() => setEveryone(false)} /> Choose people
              </label>
              {!everyone && (
                <fieldset className="plain-fieldset">
                  <legend>People</legend>
                  {active.map((m) => (
                    <label key={m.user_id} className="check">
                      <input
                        type="checkbox"
                        checked={chosen.includes(m.user_id)}
                        onChange={(e) => setChosen(e.target.checked ? [...chosen, m.user_id] : chosen.filter((id) => id !== m.user_id))}
                      />{" "}
                      {m.name} <span className="muted capitalise">· {m.role}</span>
                    </label>
                  ))}
                </fieldset>
              )}
              <label htmlFor="t-due">Due</label>
              <input id="t-due" type="date" className="short-wide" min={today()} value={dueOn} onChange={(e) => setDueOn(e.target.value)} />
              <p className="muted">People who have not signed in yet cannot be assigned. Assign again after they join.</p>
              <button type="submit" disabled={busy}>
                Assign
              </button>
            </form>
          )}

          <section className="block">
            <h2>Who has done it</h2>
            {assigned.length === 0 ? (
              <p className="muted">Not assigned to anyone yet.</p>
            ) : (
              <ul className="plain rows">
                {assigned.map((a) => (
                  <li key={a.id} className="row spread">
                    <span>
                      <strong>{memberName(a.user_id)}</strong>
                      <br />
                      <span className="muted">
                        {a.completed_at
                          ? `Completed ${formatDay(a.completed_at)}${a.expires_on ? ` · refresh due ${formatDay(a.expires_on)}` : ""}`
                          : `Due ${formatDay(a.due_on)}`}
                      </span>
                    </span>
                    <span className="row">
                      <span className={isOverdue(a) ? "chip chip-alert" : "chip"}>{assignmentLabel(a)}</span>
                      {canManage && !a.completed_at && (
                        <button type="button" className="link-dark" disabled={busy} onClick={() => void run(() => withdrawAssignment(a.id))}>
                          Withdraw
                        </button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="block">
            <h2>What people read</h2>
            <div className="card reading">
              {paragraphs(module.content).map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
            <h2>Questions</h2>
            {questions.length === 0 ? (
              <p className="muted">No questions. People confirm they have read and understood it.</p>
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

          {canManage && module.status === "published" && (
            <section className="block">
              <h2>Housekeeping</h2>
              <div className="row">
                <button
                  type="button"
                  className="quiet"
                  disabled={busy}
                  onClick={() => void run(() => setRefresh(module.id, module.refresh_every_months ? null : 12))}
                >
                  {module.refresh_every_months ? "Stop repeating" : "Repeat every 12 months"}
                </button>
                <button
                  type="button"
                  className="quiet"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm("Retire this module? It cannot be assigned again. Completions are kept.")) void run(() => setModuleStatus(module.id, "retired"));
                  }}
                >
                  Retire
                </button>
              </div>
            </section>
          )}
        </>
      );
    }
  }

  async function submitModule(event: FormEvent) {
    event.preventDefault();
    const mark = Number(passMark);
    const months = refresh.trim() === "" ? null : Number(refresh);
    if (title.trim().length < 3) return setError("Give the module a title.");
    if (content.trim().length < 20) return setError("Add the material people will read.");
    if (!Number.isInteger(mark) || mark < 0 || mark > 100) return setError("The pass mark is a whole number from 0 to 100.");
    if (months !== null && (!Number.isInteger(months) || months < 1 || months > 60)) return setError("Repeat every 1 to 60 months, or leave it blank.");
    const questions: NewQuestion[] = [];
    for (const [i, d] of drafts.entries()) {
      const options = d.options
        .split("\n")
        .map((o) => o.trim())
        .filter(Boolean);
      if (d.prompt.trim().length < 5) return setError(`Question ${i + 1} needs its wording.`);
      if (options.length < 2 || options.length > 6) return setError(`Question ${i + 1} needs between two and six answers, one per line.`);
      if (d.correct > options.length) return setError(`Question ${i + 1}: the correct answer number is higher than the number of answers.`);
      questions.push({ prompt: d.prompt, options, correct: d.correct - 1 });
    }
    let id = "";
    const ok = await run(async () => {
      id = await createModule(organisationId, { title, summary, content, passMark: mark, refreshMonths: months, questions });
    });
    if (ok) {
      setTitle("");
      setSummary("");
      setContent("");
      setDrafts([]);
      go({ kind: "module", moduleId: id });
    }
  }

  const setDraft = (i: number, patch: Partial<DraftQuestion>) => setDrafts(drafts.map((d, n) => (n === i ? { ...d, ...patch } : d)));
  const visibleModules = data.modules.filter((m) => canManage || m.status !== "draft");

  return (
    <>
      <p className="eyebrow">Compliance training</p>
      <h1>Training</h1>
      {error && (
        <p className="error block" role="alert">
          {error}
        </p>
      )}

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
                  <span className={isOverdue(a) ? "chip chip-alert" : "chip"}>{assignmentLabel(a)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {seesAll && (
        <section className="block">
          <h2>Modules</h2>
          {visibleModules.length === 0 ? (
            <p className="muted">
              {canManage ? "No modules yet. Add one from the standard library below, or write your own." : "No modules have been published."}
            </p>
          ) : (
            <ul className="entity-list">
              {visibleModules.map((m) => {
                const rows = live(m.id);
                const overdue = rows.filter(isOverdue).length;
                return (
                  <li key={m.id}>
                    <button type="button" className="entity-row" onClick={() => go({ kind: "module", moduleId: m.id })}>
                      <span>
                        <span className="entity-name">{m.title}</span>
                        <br />
                        <span className="muted">
                          {m.status === "draft"
                            ? "Waiting for review"
                            : rows.length === 0
                              ? "Not assigned to anyone"
                              : `${rows.filter(isCurrent).length} of ${rows.length} complete`}
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
      )}

      {canManage && (
        <>
          <section className="block">
            <h2>Standard library</h2>
            <p className="muted">Starter modules in plain English. Each arrives as a draft for you to review before publishing.</p>
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
                      <button
                        type="button"
                        className="quiet"
                        disabled={busy}
                        aria-label={`Add ${l.title}`}
                        onClick={() => {
                          let id = "";
                          void run(async () => {
                            id = await adoptModule(organisationId, l.id);
                          }).then((ok) => ok && go({ kind: "module", moduleId: id }));
                        }}
                      >
                        Add
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>

          <form className="card form" onSubmit={submitModule}>
            <h2>Write your own</h2>
            <label htmlFor="tm-title">Title</label>
            <input id="tm-title" value={title} onChange={(e) => setTitle(e.target.value)} />
            <label htmlFor="tm-summary">One-line summary (optional)</label>
            <input id="tm-summary" value={summary} onChange={(e) => setSummary(e.target.value)} />
            <label htmlFor="tm-content">What people will read</label>
            <textarea id="tm-content" rows={8} placeholder="Leave a blank line between paragraphs." value={content} onChange={(e) => setContent(e.target.value)} />
            <div className="row">
              <span className="field">
                <label htmlFor="tm-pass">Pass mark, %</label>
                <input id="tm-pass" className="short" inputMode="numeric" value={passMark} onChange={(e) => setPassMark(e.target.value)} />
              </span>
              <span className="field">
                <label htmlFor="tm-refresh">Repeat every (months, blank for never)</label>
                <input id="tm-refresh" className="short" inputMode="numeric" value={refresh} onChange={(e) => setRefresh_(e.target.value)} />
              </span>
            </div>
            {drafts.map((d, i) => (
              <fieldset key={i} className="plain-fieldset question">
                <legend>Question {i + 1}</legend>
                <label htmlFor={`tq-prompt-${i}`}>Wording</label>
                <input id={`tq-prompt-${i}`} value={d.prompt} onChange={(e) => setDraft(i, { prompt: e.target.value })} />
                <label htmlFor={`tq-options-${i}`}>Answers, one per line</label>
                <textarea id={`tq-options-${i}`} rows={4} value={d.options} onChange={(e) => setDraft(i, { options: e.target.value })} />
                <div className="row">
                  <span className="field">
                    <label htmlFor={`tq-correct-${i}`}>Which line is correct</label>
                    <select id={`tq-correct-${i}`} value={d.correct} onChange={(e) => setDraft(i, { correct: Number(e.target.value) })}>
                      {[1, 2, 3, 4, 5, 6].map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </span>
                  <button type="button" className="link-dark" onClick={() => setDrafts(drafts.filter((_, n) => n !== i))}>
                    Remove question
                  </button>
                </div>
              </fieldset>
            ))}
            <button type="button" className="quiet" onClick={() => setDrafts([...drafts, { prompt: "", options: "", correct: 1 }])}>
              Add a question
            </button>
            <p className="muted">With no questions, people simply confirm they have read and understood the material.</p>
            <button type="submit" disabled={busy}>
              Save as a draft
            </button>
          </form>
        </>
      )}
    </>
  );
}
