import { supabase } from "./supabase";

export type StepKind = "confirm" | "answer" | "approve";
export type Workflow = { id: string; name: string; purpose: string | null; status: "draft" | "published" | "retired" };
export type Step = {
  id: string;
  workflow_id: string;
  position: number;
  title: string;
  instructions: string | null;
  kind: StepKind;
  assignee_role: string | null;
  due_days: number;
};
export type Run = {
  id: string;
  workflow_id: string;
  subject: string;
  entity_id: string | null;
  status: "open" | "completed" | "stopped";
  stop_reason: string | null;
  started_by: string | null;
  started_at: string;
  finished_at: string | null;
};
export type RunStep = {
  id: string;
  run_id: string;
  position: number;
  title: string;
  instructions: string | null;
  kind: StepKind;
  assignee_role: string | null;
  due_on: string | null;
  status: "waiting" | "open" | "done" | "refused" | "cancelled";
  response: string | null;
  completed_by: string | null;
  completed_at: string | null;
};
export type WorkflowData = { workflows: Workflow[]; steps: Step[]; runs: Run[]; runSteps: RunStep[] };
export type NewStep = { title: string; instructions: string; kind: StepKind; role: string; dueDays: number };

export const STEP_KINDS: Record<StepKind, string> = {
  confirm: "Confirm it is done",
  answer: "Write an answer",
  approve: "Approve or refuse",
};
export const ROLE_LABELS: Record<string, string> = {
  "": "Legal, compliance or company secretary",
  owner: "Owner",
  admin: "Administrator",
  secretary: "Company secretary",
  legal: "Legal",
  compliance: "Compliance",
  director: "A director",
  member: "A staff member",
};
export const RUN_STATUS: Record<Run["status"], string> = { open: "In progress", completed: "Completed", stopped: "Stopped" };

/** Starting points for the builder. Nothing is saved until the form is. */
export const EXAMPLES: { name: string; purpose: string; steps: NewStep[] }[] = [
  {
    name: "New legislation assessment",
    purpose: "Work out what a new or changed law means for us, update what needs updating and have it signed off.",
    steps: [
      { title: "Summarise the change", instructions: "What the law requires, who it applies to and when it starts.", kind: "answer", role: "legal", dueDays: 10 },
      { title: "List what it affects", instructions: "Entities, policies, contracts, systems and training that need to change.", kind: "answer", role: "compliance", dueDays: 10 },
      { title: "Update the register", instructions: "Add or amend the obligation on the risk and compliance register and name its owners.", kind: "confirm", role: "compliance", dueDays: 7 },
      { title: "Update policies and training", instructions: "", kind: "confirm", role: "", dueDays: 30 },
      { title: "Sign off", instructions: "Confirm the organisation is ready for the start date.", kind: "approve", role: "legal", dueDays: 5 },
    ],
  },
  {
    name: "Annual policy review",
    purpose: "Review a policy each year, record what changed and have the new version approved.",
    steps: [
      { title: "Review the policy", instructions: "Note what is out of date and what should change.", kind: "answer", role: "", dueDays: 14 },
      { title: "Approve the changes", instructions: "", kind: "approve", role: "legal", dueDays: 7 },
      { title: "Publish and tell staff", instructions: "", kind: "confirm", role: "", dueDays: 7 },
    ],
  },
];

function db() {
  if (!supabase) throw new Error("The site is not connected to its database.");
  return supabase;
}

function check(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

export async function loadWorkflows(organisationId: string): Promise<WorkflowData> {
  const client = db();
  const [workflows, steps, runs, runSteps] = await Promise.all([
    client.from("workflows").select("id, name, purpose, status").eq("organisation_id", organisationId).order("created_at"),
    client.from("workflow_steps").select("*").eq("organisation_id", organisationId).order("position"),
    client.from("workflow_runs").select("*").eq("organisation_id", organisationId).order("started_at", { ascending: false }),
    client.from("workflow_run_steps").select("*").eq("organisation_id", organisationId).order("position"),
  ]);
  check(workflows.error ?? steps.error ?? runs.error ?? runSteps.error);
  return {
    workflows: (workflows.data ?? []) as Workflow[],
    steps: (steps.data ?? []) as Step[],
    runs: (runs.data ?? []) as Run[],
    runSteps: (runSteps.data ?? []) as RunStep[],
  };
}

export async function createWorkflow(organisationId: string, name: string, purpose: string, steps: NewStep[]): Promise<string> {
  const client = db();
  const created = await client
    .from("workflows")
    .insert({ organisation_id: organisationId, name: name.trim(), purpose: purpose.trim() || null })
    .select("id")
    .single();
  check(created.error);
  const id = created.data!.id as string;
  const { error } = await client.from("workflow_steps").insert(
    steps.map((s, i) => ({
      organisation_id: organisationId,
      workflow_id: id,
      position: i + 1,
      title: s.title.trim(),
      instructions: s.instructions.trim() || null,
      kind: s.kind,
      assignee_role: s.role || null,
      due_days: s.dueDays,
    })),
  );
  check(error);
  return id;
}

export async function setWorkflowStatus(workflowId: string, status: "published" | "retired") {
  check((await db().from("workflows").update({ status }).eq("id", workflowId)).error);
}

export async function startWorkflow(workflowId: string, subject: string, entityId: string | null): Promise<string> {
  const { data, error } = await db().rpc("start_workflow", { p_workflow: workflowId, p_subject: subject, p_entity: entityId });
  check(error);
  return data as string;
}

export async function completeStep(stepId: string, response: string, approve: boolean) {
  check((await db().rpc("complete_workflow_step", { p_step: stepId, p_response: response, p_approve: approve })).error);
}

export async function stopRun(runId: string, reason: string) {
  check((await db().rpc("stop_workflow_run", { p_run: runId, p_reason: reason })).error);
}

export type WorkflowSummary = { open: number; overdue: number };

/** For the overview. Reads as empty until the workflow migration has been run. */
export async function loadWorkflowSummary(organisationId: string, todayIso: string): Promise<WorkflowSummary> {
  const { data, error } = await db()
    .from("workflow_run_steps")
    .select("run_id, due_on, status")
    .eq("organisation_id", organisationId)
    .eq("status", "open");
  if (error) return { open: 0, overdue: 0 };
  const rows = (data ?? []) as { run_id: string; due_on: string | null }[];
  return { open: rows.length, overdue: rows.filter((r) => r.due_on && r.due_on < todayIso).length };
}
