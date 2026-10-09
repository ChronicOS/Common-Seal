import { supabase } from "./supabase";

export type LibraryModule = {
  id: string;
  title: string;
  summary: string;
  audience: "everyone" | "directors";
  minutes: number;
  is_placeholder: boolean;
};

export type TrainingModule = {
  id: string;
  title: string;
  summary: string | null;
  content: string;
  audience: "everyone" | "directors";
  pass_mark: number;
  refresh_every_months: number | null;
  status: "draft" | "published" | "retired";
  source: "custom" | "library";
  library_id: string | null;
};

export type Question = { id: string; module_id: string; position: number; prompt: string; options: string[] };

export type Assignment = {
  id: string;
  module_id: string;
  user_id: string;
  due_on: string;
  completed_at: string | null;
  score: number | null;
  expires_on: string | null;
};

export type TrainingData = {
  library: LibraryModule[];
  modules: TrainingModule[];
  questions: Question[];
  assignments: Assignment[];
};

export type MarkResult = { score: number; passed: boolean; pass_mark: number; marks: boolean[] };
export type NewQuestion = { prompt: string; options: string[]; correct: number };
export type NewModule = {
  title: string;
  summary: string;
  content: string;
  passMark: number;
  refreshMonths: number | null;
  questions: NewQuestion[];
};

export const MODULE_STATUS: Record<TrainingModule["status"], string> = { draft: "Draft", published: "Published", retired: "Retired" };

function db() {
  if (!supabase) throw new Error("The site is not connected to its database.");
  return supabase;
}

function check(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export const isOverdue = (a: Assignment) => !a.completed_at && a.due_on < today();
/** A completion counts until its refresh date passes. */
export const isCurrent = (a: Assignment) => Boolean(a.completed_at) && (!a.expires_on || a.expires_on >= today());

const ASSIGNMENT_COLUMNS = "id, module_id, user_id, due_on, completed_at, score, expires_on";

export async function loadTraining(organisationId: string): Promise<TrainingData> {
  const client = db();
  const [library, modules, questions, assignments] = await Promise.all([
    client.from("training_library").select("id, title, summary, audience, minutes, is_placeholder").order("position"),
    client
      .from("training_modules")
      .select("id, title, summary, content, audience, pass_mark, refresh_every_months, status, source, library_id")
      .eq("organisation_id", organisationId)
      .order("created_at"),
    // The correct answers are not readable here; they stay in the database
    client
      .from("training_questions")
      .select("id, module_id, position, prompt, options")
      .eq("organisation_id", organisationId)
      .order("position"),
    client.from("training_assignments").select(ASSIGNMENT_COLUMNS).eq("organisation_id", organisationId).order("due_on"),
  ]);
  check(library.error ?? modules.error ?? questions.error ?? assignments.error);
  return {
    library: (library.data ?? []) as LibraryModule[],
    modules: (modules.data ?? []) as TrainingModule[],
    questions: (questions.data ?? []) as Question[],
    assignments: (assignments.data ?? []) as Assignment[],
  };
}

export async function adoptModule(organisationId: string, libraryId: string): Promise<string> {
  const { data, error } = await db().rpc("adopt_training_module", { p_org: organisationId, p_library: libraryId });
  check(error);
  return data as string;
}

export async function createModule(organisationId: string, m: NewModule): Promise<string> {
  const client = db();
  const created = await client
    .from("training_modules")
    .insert({
      organisation_id: organisationId,
      title: m.title.trim(),
      summary: m.summary.trim() || null,
      content: m.content.trim(),
      pass_mark: m.passMark,
      refresh_every_months: m.refreshMonths,
    })
    .select("id")
    .single();
  check(created.error);
  const id = created.data!.id as string;
  if (m.questions.length > 0) {
    const { error } = await client.from("training_questions").insert(
      m.questions.map((q, i) => ({
        organisation_id: organisationId,
        module_id: id,
        position: i + 1,
        prompt: q.prompt.trim(),
        options: q.options,
        correct_index: q.correct,
      })),
    );
    check(error);
  }
  return id;
}

export async function setModuleStatus(moduleId: string, status: "published" | "retired") {
  check((await db().from("training_modules").update({ status }).eq("id", moduleId)).error);
}

export async function setRefresh(moduleId: string, months: number | null) {
  check((await db().from("training_modules").update({ refresh_every_months: months }).eq("id", moduleId)).error);
}

/** Returns how many people were newly assigned. Pass null to assign everyone the module is for. */
export async function assignTraining(moduleId: string, userIds: string[] | null, dueOn: string): Promise<number> {
  const { data, error } = await db().rpc("assign_training", { p_module: moduleId, p_users: userIds, p_due: dueOn });
  check(error);
  return Number(data ?? 0);
}

export async function withdrawAssignment(assignmentId: string) {
  check((await db().from("training_assignments").delete().eq("id", assignmentId)).error);
}

export async function submitTraining(assignmentId: string, answers: number[]): Promise<MarkResult> {
  const { data, error } = await db().rpc("submit_training", { p_assignment: assignmentId, p_answers: answers });
  check(error);
  return data as MarkResult;
}

/** Question id to the index of its correct option. Only for people who manage training. */
export async function loadAnswerKey(moduleId: string): Promise<Record<string, number>> {
  const { data, error } = await db().rpc("training_answer_key", { p_module: moduleId });
  check(error);
  return Object.fromEntries(((data ?? []) as { question_id: string; correct_index: number }[]).map((r) => [r.question_id, r.correct_index]));
}

export type TrainingSummary = { assigned: number; complete: number; overdue: number };

/** For the overview. Reads as empty until the training migration has been run. */
export async function loadTrainingSummary(organisationId: string): Promise<TrainingSummary> {
  const { data, error } = await db().from("training_assignments").select(ASSIGNMENT_COLUMNS).eq("organisation_id", organisationId);
  if (error) return { assigned: 0, complete: 0, overdue: 0 };
  // Superseded completions (refreshed since) are history, not current status
  const rows = ((data ?? []) as Assignment[]).filter((a) => !a.completed_at || isCurrent(a));
  return { assigned: rows.length, complete: rows.filter(isCurrent).length, overdue: rows.filter(isOverdue).length };
}
