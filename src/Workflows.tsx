import { useCallback, useEffect, useState, type FormEvent } from "react";
import Attachments from "./Attachments";
import { formatDay, loadMembers, type Member } from "./board";
import { today } from "./training";
import type { Entity } from "./types";
import {
  completeStep,
  createWorkflow,
  EXAMPLES,
  loadWorkflows,
  ROLE_LABELS,
  RUN_STATUS,
  setWorkflowStatus,
  startWorkflow,
  STEP_KINDS,
  stopRun,
  type NewStep,
  type Run,
  type RunStep,
  type StepKind,
  type WorkflowData,
} from "./workflows";
import { MODULE_STATUS } from "./training";

type Props = { organisationId: string; role: string; entities: Entity[] };
type View = { kind: "home" } | { kind: "workflow"; id: string } | { kind: "run"; id: string };

const MANAGE_ROLES = ["owner", "admin", "secretary", "legal", "compliance"];
const blankStep = (): NewStep => ({ title: "", instructions: "", kind: "confirm", role: "", dueDays: 7 });
const who = (role: string | null) => ROLE_LABELS[role ?? ""] ?? role ?? "";

const STEP_STATUS: Record<RunStep["status"], string> = {
  waiting: "Not started",
  open: "Open",
  done: "Done",
  refused: "Refused",
  cancelled: "Cancelled",
};

/** The form for whoever holds the open step. */
function StepAction({ step, busy, onComplete }: { step: RunStep; busy: boolean; onComplete: (response: string, approve: boolean) => void }) {
  const [response, setResponse] = useState("");
  const label = step.kind === "answer" ? "Your answer" : step.kind === "approve" ? "Comment (needed if you refuse)" : "Note (optional)";
  return (
    <div className="form review">
      <label htmlFor={`ws-${step.id}`}>{label}</label>
      <textarea id={`ws-${step.id}`} rows={step.kind === "answer" ? 4 : 2} value={response} onChange={(e) => setResponse(e.target.value)} />
      <div className="row">
        <button type="button" disabled={busy} onClick={() => onComplete(response, true)}>
          {step.kind === "approve" ? "Approve" : step.kind === "answer" ? "Save answer" : "Mark as done"}
        </button>
        {step.kind === "approve" && (
          <button type="button" className="quiet" disabled={busy} onClick={() => onComplete(response, false)}>
            Refuse
          </button>
        )}
      </div>
    </div>
  );
}

export default function Workflows({ organisationId, role, entities }: Props) {
  const canManage = MANAGE_ROLES.includes(role);

  const [data, setData] = useState<WorkflowData | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [view, setView] = useState<View>({ kind: "home" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Building
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [steps, setSteps] = useState<NewStep[]>([blankStep()]);

  // Starting and stopping
  const [subject, setSubject] = useState("");
  const [entityId, setEntityId] = useState("");
  const [stopReason, setStopReason] = useState("");

  const reload = useCallback(async () => {
    const [workflows, people] = await Promise.all([loadWorkflows(organisationId), loadMembers(organisationId).catch(() => [])]);
    setData(workflows);
    setMembers(people);
  }, [organisationId]);

  useEffect(() => {
    reload().catch((e) => setError(e instanceof Error ? e.message : "Could not load workflows."));
  }, [reload]);

  async function run(action: () => Promise<void>): Promise<boolean> {
    setBusy(true);
    setError(null);
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

  const workflowOf = (id: string) => data.workflows.find((w) => w.id === id);
  const stepsOfRun = (id: string) => data.runSteps.filter((s) => s.run_id === id);
  const memberName = (id: string | null) => members.find((m) => m.user_id === id)?.name ?? "someone";
  const canDo = (s: RunStep) => canManage || (s.assignee_role !== null && s.assignee_role === role);
  const progress = (r: Run) => {
    const all = stepsOfRun(r.id);
    const open = all.find((s) => s.status === "open");
    const done = all.filter((s) => s.status === "done").length;
    if (!open) return `${done} of ${all.length} steps done`;
    return `Step ${open.position} of ${all.length}: ${open.title} · with ${who(open.assignee_role).toLowerCase()} · due ${open.due_on ? formatDay(open.due_on) : "soon"}`;
  };
  const isLate = (r: Run) => stepsOfRun(r.id).some((s) => s.status === "open" && s.due_on !== null && s.due_on < today());

  const back = (
    <p>
      <button type="button" className="link-dark" onClick={() => go({ kind: "home" })}>
        ← Back to workflows
      </button>
    </p>
  );
  const errorBlock = error && (
    <p className="error block" role="alert">
      {error}
    </p>
  );

  if (view.kind === "run") {
    const r = data.runs.find((x) => x.id === view.id);
    if (r) {
      const entity = entities.find((e) => e.id === r.entity_id);
      return (
        <>
          {back}
          <p className="eyebrow">{workflowOf(r.workflow_id)?.name ?? "Workflow"}</p>
          <h1>{r.subject}</h1>
          <p className="lead">
            <span className={r.status === "stopped" ? "chip chip-alert" : "chip"}>{RUN_STATUS[r.status]}</span>{" "}
            {entity ? `${entity.name} · ` : ""}started {formatDay(r.started_at)} by {memberName(r.started_by)}
            {r.finished_at ? ` · finished ${formatDay(r.finished_at)}` : ""}
          </p>
          {r.stop_reason && <p className="card warning">{r.stop_reason}</p>}
          {errorBlock}
          <ol className="steps">
            {stepsOfRun(r.id).map((s) => (
              <li key={s.id} className={s.status === "open" ? "card step-open" : "card"}>
                <span className="row spread">
                  <strong>
                    {s.position}. {s.title}
                  </strong>
                  <span className={s.status === "refused" || (s.status === "open" && s.due_on !== null && s.due_on < today()) ? "chip chip-alert" : "chip"}>
                    {s.status === "open" && s.due_on && s.due_on < today() ? "Overdue" : STEP_STATUS[s.status]}
                  </span>
                </span>
                <span className="muted">
                  {STEP_KINDS[s.kind]} · {who(s.assignee_role)}
                  {s.status === "open" && s.due_on ? ` · due ${formatDay(s.due_on)}` : ""}
                </span>
                {s.instructions && <p>{s.instructions}</p>}
                {s.completed_at && (
                  <p>
                    {s.status === "refused" ? "Refused" : s.kind === "approve" ? "Approved" : "Done"} by {memberName(s.completed_by)} on{" "}
                    {formatDay(s.completed_at)}
                    {s.response ? `: ${s.response}` : "."}
                  </p>
                )}
                {s.status !== "waiting" && s.status !== "cancelled" && (
                  <Attachments subjectTable="workflow_run_steps" subjectId={s.id} canAttach={s.status === "open" && canDo(s)} />
                )}
                {s.status === "open" &&
                  (canDo(s) ? (
                    <StepAction key={s.id} step={s} busy={busy} onComplete={(response, approve) => void run(() => completeStep(s.id, response, approve))} />
                  ) : (
                    <p className="muted">Waiting on {who(s.assignee_role).toLowerCase()}.</p>
                  ))}
              </li>
            ))}
          </ol>
          {canManage && r.status === "open" && (
            <form
              className="block form"
              onSubmit={(e) => {
                e.preventDefault();
                void run(() => stopRun(r.id, stopReason)).then((ok) => ok && setStopReason(""));
              }}
            >
              <h2>Stop this run</h2>
              <label htmlFor="w-stop">Reason</label>
              <input id="w-stop" value={stopReason} onChange={(e) => setStopReason(e.target.value)} />
              <button type="submit" className="quiet" disabled={busy}>
                Stop the run
              </button>
            </form>
          )}
        </>
      );
    }
  }

  if (view.kind === "workflow") {
    const w = workflowOf(view.id);
    if (w) {
      const runs = data.runs.filter((r) => r.workflow_id === w.id);
      return (
        <>
          {back}
          <p className="eyebrow">Workflow</p>
          <h1>{w.name}</h1>
          <p className="lead">
            <span className="chip">{MODULE_STATUS[w.status]}</span> {w.purpose}
          </p>
          {errorBlock}

          {canManage && w.status === "draft" && (
            <section className="card warning">
              <h2>Check, then publish</h2>
              <p>
                Once published the steps are fixed, so every run follows the same process. To change it later, retire it
                and publish a new one.
              </p>
              <button type="button" disabled={busy} onClick={() => void run(() => setWorkflowStatus(w.id, "published"))}>
                Publish
              </button>
            </section>
          )}

          {canManage && w.status === "published" && (
            <form
              className="card form"
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                if (subject.trim().length < 3) return setError("Say what this run is about.");
                let id = "";
                void run(async () => {
                  id = await startWorkflow(w.id, subject, entityId || null);
                }).then((ok) => {
                  if (!ok) return;
                  setSubject("");
                  setEntityId("");
                  go({ kind: "run", id });
                });
              }}
            >
              <h2>Start a run</h2>
              <label htmlFor="w-subject">What is this run about?</label>
              <input id="w-subject" placeholder="e.g. Privacy Act reforms, tranche 2" value={subject} onChange={(e) => setSubject(e.target.value)} />
              <label htmlFor="w-entity">Entity (optional)</label>
              <select id="w-entity" value={entityId} onChange={(e) => setEntityId(e.target.value)}>
                <option value="">The whole group</option>
                {entities.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
              <button type="submit" disabled={busy}>
                Start
              </button>
            </form>
          )}

          <section className="block">
            <h2>Steps</h2>
            <ol className="steps">
              {data.steps
                .filter((s) => s.workflow_id === w.id)
                .map((s) => (
                  <li key={s.id} className="card">
                    <strong>
                      {s.position}. {s.title}
                    </strong>
                    <span className="muted">
                      {STEP_KINDS[s.kind]} · {who(s.assignee_role)} · {s.due_days} {s.due_days === 1 ? "day" : "days"} to do it
                    </span>
                    {s.instructions && <p>{s.instructions}</p>}
                  </li>
                ))}
            </ol>
          </section>

          {runs.length > 0 && (
            <section className="block">
              <h2>Runs</h2>
              <ul className="entity-list">
                {runs.map((r) => (
                  <li key={r.id}>
                    <button type="button" className="entity-row" onClick={() => go({ kind: "run", id: r.id })}>
                      <span>
                        <span className="entity-name">{r.subject}</span>
                        <br />
                        <span className="muted">{progress(r)}</span>
                      </span>
                      <span className={r.status === "stopped" ? "chip chip-alert" : "chip"}>{RUN_STATUS[r.status]}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {canManage && w.status === "published" && (
            <section className="block">
              <button
                type="button"
                className="quiet"
                disabled={busy}
                onClick={() => {
                  if (window.confirm("Retire this workflow? It cannot be started again. Runs already started carry on.")) void run(() => setWorkflowStatus(w.id, "retired"));
                }}
              >
                Retire this workflow
              </button>
            </section>
          )}
        </>
      );
    }
  }

  async function submitWorkflow(event: FormEvent) {
    event.preventDefault();
    if (name.trim().length < 3) return setError("Give the workflow a name.");
    if (steps.length === 0) return setError("Add at least one step.");
    for (const [i, s] of steps.entries()) {
      if (s.title.trim().length < 3) return setError(`Step ${i + 1} needs a name.`);
      if (!Number.isInteger(s.dueDays) || s.dueDays < 0 || s.dueDays > 365) return setError(`Step ${i + 1}: days to do it is a whole number from 0 to 365.`);
    }
    let id = "";
    const ok = await run(async () => {
      id = await createWorkflow(organisationId, name, purpose, steps);
    });
    if (ok) {
      setName("");
      setPurpose("");
      setSteps([blankStep()]);
      go({ kind: "workflow", id });
    }
  }

  const setStep = (i: number, patch: Partial<NewStep>) => setSteps(steps.map((s, n) => (n === i ? { ...s, ...patch } : s)));
  const move = (i: number, by: number) => {
    const next = [...steps];
    const [s] = next.splice(i, 1);
    next.splice(i + by, 0, s);
    setSteps(next);
  };
  const openRuns = data.runs.filter((r) => r.status === "open");
  const finished = data.runs.filter((r) => r.status !== "open");
  const runRow = (r: Run) => (
    <li key={r.id}>
      <button type="button" className="entity-row" onClick={() => go({ kind: "run", id: r.id })}>
        <span>
          <span className="entity-name">{r.subject}</span>
          <span className="muted"> · {workflowOf(r.workflow_id)?.name}</span>
          <br />
          <span className="muted">{progress(r)}</span>
        </span>
        <span className={r.status === "stopped" || isLate(r) ? "chip chip-alert" : "chip"}>{isLate(r) ? "Overdue" : RUN_STATUS[r.status]}</span>
      </button>
    </li>
  );

  return (
    <>
      <p className="eyebrow">Your own processes</p>
      <h1>Workflows</h1>
      {errorBlock}

      <section className="block">
        <h2>In progress</h2>
        {openRuns.length === 0 ? <p className="muted">Nothing is running.</p> : <ul className="entity-list">{openRuns.map(runRow)}</ul>}
      </section>

      <section className="block">
        <h2>Workflows</h2>
        {data.workflows.length === 0 ? (
          <p className="muted">{canManage ? "None yet. Build one below." : "None have been published."}</p>
        ) : (
          <ul className="entity-list">
            {data.workflows.map((w) => (
              <li key={w.id}>
                <button type="button" className="entity-row" onClick={() => go({ kind: "workflow", id: w.id })}>
                  <span>
                    <span className="entity-name">{w.name}</span>
                    <br />
                    <span className="muted">
                      {data.steps.filter((s) => s.workflow_id === w.id).length} steps · {data.runs.filter((r) => r.workflow_id === w.id).length} runs
                    </span>
                  </span>
                  <span className="chip">{MODULE_STATUS[w.status]}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {finished.length > 0 && (
        <section className="block">
          <h2>Finished</h2>
          <ul className="entity-list">{finished.map(runRow)}</ul>
        </section>
      )}

      {canManage && (
        <form className="card form" onSubmit={submitWorkflow}>
          <h2>Build a workflow</h2>
          <p className="muted">Start from an example, or from blank. Steps run one after another, in order.</p>
          <div className="row">
            {EXAMPLES.map((x) => (
              <button
                key={x.name}
                type="button"
                className="quiet"
                onClick={() => {
                  setName(x.name);
                  setPurpose(x.purpose);
                  setSteps(x.steps.map((s) => ({ ...s })));
                }}
              >
                Use "{x.name}"
              </button>
            ))}
          </div>
          <label htmlFor="wf-name">Name</label>
          <input id="wf-name" value={name} onChange={(e) => setName(e.target.value)} />
          <label htmlFor="wf-purpose">What it is for (optional)</label>
          <input id="wf-purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)} />
          {steps.map((s, i) => (
            <fieldset key={i} className="plain-fieldset question">
              <legend>Step {i + 1}</legend>
              <label htmlFor={`wf-title-${i}`}>What happens</label>
              <input id={`wf-title-${i}`} value={s.title} onChange={(e) => setStep(i, { title: e.target.value })} />
              <label htmlFor={`wf-how-${i}`}>Instructions (optional)</label>
              <input id={`wf-how-${i}`} value={s.instructions} onChange={(e) => setStep(i, { instructions: e.target.value })} />
              <div className="row">
                <span className="field">
                  <label htmlFor={`wf-kind-${i}`}>The person must</label>
                  <select id={`wf-kind-${i}`} value={s.kind} onChange={(e) => setStep(i, { kind: e.target.value as StepKind })}>
                    {Object.entries(STEP_KINDS).map(([k, label]) => (
                      <option key={k} value={k}>
                        {label}
                      </option>
                    ))}
                  </select>
                </span>
                <span className="field">
                  <label htmlFor={`wf-role-${i}`}>Who does it</label>
                  <select id={`wf-role-${i}`} value={s.role} onChange={(e) => setStep(i, { role: e.target.value })}>
                    {Object.entries(ROLE_LABELS).map(([k, label]) => (
                      <option key={k} value={k}>
                        {label}
                      </option>
                    ))}
                  </select>
                </span>
                <span className="field">
                  <label htmlFor={`wf-days-${i}`}>Days to do it</label>
                  <input
                    id={`wf-days-${i}`}
                    className="short"
                    inputMode="numeric"
                    value={Number.isNaN(s.dueDays) ? "" : s.dueDays}
                    onChange={(e) => setStep(i, { dueDays: e.target.value.trim() === "" ? NaN : Number(e.target.value) })}
                  />
                </span>
              </div>
              <div className="row">
                {i > 0 && (
                  <button type="button" className="link-dark" onClick={() => move(i, -1)}>
                    Move up
                  </button>
                )}
                {i < steps.length - 1 && (
                  <button type="button" className="link-dark" onClick={() => move(i, 1)}>
                    Move down
                  </button>
                )}
                {steps.length > 1 && (
                  <button type="button" className="link-dark" onClick={() => setSteps(steps.filter((_, n) => n !== i))}>
                    Remove step
                  </button>
                )}
              </div>
            </fieldset>
          ))}
          <button type="button" className="quiet" onClick={() => setSteps([...steps, blankStep()])}>
            Add a step
          </button>
          <button type="submit" disabled={busy}>
            Save as a draft
          </button>
        </form>
      )}
    </>
  );
}
