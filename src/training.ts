import { supabase } from "./supabase";
import { attachFile, downloadFile } from "./files";

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
  /** Set by migration 0036 */
  policy_id?: string | null;
  reassign_on_new_version?: boolean;
  due_days?: number;
  declaration_text?: string;
};

export type Question = { id: string; module_id: string; position: number; prompt: string; options: string[] };

export type Assignment = {
  id: string;
  module_id: string;
  user_id: string | null;
  person_id?: string | null;
  due_on: string;
  completed_at: string | null;
  score: number | null;
  expires_on: string | null;
  policy_version_no?: number | null;
  signed_name?: string | null;
  agreed_at?: string | null;
  completed_by_link?: boolean;
  reminder_before_sent_at?: string | null;
  reminder_due_sent_at?: string | null;
  overdue_sent_at?: string | null;
  overdue_count?: number;
  reason?: string | null;
};

/** Everyone who can be assigned training, with or without an account */
export type Person = {
  id: string;
  full_name: string;
  email: string | null;
  function_name: string | null;
  manager_name: string | null;
  manager_email: string | null;
  start_date: string | null;
  user_id: string | null;
  is_active: boolean;
};
export type Target = { id: string; module_id: string; kind: "all" | "function" | "person"; function_name: string | null; person_id: string | null };
export type MaterialFile = { module_id: string; file_name: string; storage_path: string };
export type LinkedPolicy = { id: string; title: string; version_no: number | null; content: string | null; document_id: string | null };

export type TrainingData = {
  library: LibraryModule[];
  modules: TrainingModule[];
  questions: Question[];
  assignments: Assignment[];
  /** Empty until migration 0036 is run */
  people: Person[];
  targets: Target[];
  files: MaterialFile[];
  policies: LinkedPolicy[];
  policyFiles: { document_id: string; file_name: string; storage_path: string }[];
  ready: boolean;
};

export type MarkResult = { score: number; passed: boolean; pass_mark: number; marks: boolean[]; completed?: boolean };
export type NewQuestion = { prompt: string; options: string[]; correct: number };
export type NewModule = {
  title: string;
  summary: string;
  content: string;
  passMark: number;
  refreshMonths: number | null;
  questions: NewQuestion[];
  policyId?: string | null;
  dueDays?: number;
  declarationText?: string;
};

export const MODULE_STATUS: Record<TrainingModule["status"], string> = { draft: "Draft", published: "Published", retired: "Retired" };
export const FREQUENCIES: { months: number | null; label: string }[] = [
  { months: null, label: "Once only" },
  { months: 3, label: "Quarterly" },
  { months: 6, label: "Half yearly" },
  { months: 12, label: "Annually" },
  { months: 24, label: "Every two years" },
  { months: 36, label: "Every three years" },
];
export const frequencyLabel = (m: number | null) => FREQUENCIES.find((f) => f.months === m)?.label ?? `Every ${m} months`;
export const DEFAULT_FUNCTIONS = ["Corporate", "Finance", "Operations", "IT"];
export const DEFAULT_DECLARATION = "I have read and understood this material and I agree to comply with its terms.";

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
export const addDays = (iso: string, n: number) => {
  const [y, m, d] = iso.split("-").map(Number);
  const x = new Date(y, m - 1, d + n);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};

export const isOverdue = (a: Assignment) => !a.completed_at && a.due_on < today();
/** A completion counts until its refresh date passes. */
export const isCurrent = (a: Assignment) => Boolean(a.completed_at) && (!a.expires_on || a.expires_on >= today());

const OLD_COLUMNS = "id, module_id, user_id, due_on, completed_at, score, expires_on";
const NEW_COLUMNS = `${OLD_COLUMNS}, person_id, policy_version_no, signed_name, agreed_at, completed_by_link, reminder_before_sent_at, reminder_due_sent_at, overdue_sent_at, overdue_count, reason`;

export async function loadTraining(organisationId: string): Promise<TrainingData> {
  const client = db();
  // Refreshers that have fallen due, and members joining the roster (migration 0036)
  const refreshed = await client.rpc("refresh_due_training", { p_org: organisationId });
  const ready = !refreshed.error;
  const [library, modules, questions, assignments] = await Promise.all([
    client.from("training_library").select("id, title, summary, audience, minutes, is_placeholder").order("position"),
    client.from("training_modules").select("*").eq("organisation_id", organisationId).order("created_at"),
    // The correct answers are not readable here; they stay in the database
    client.from("training_questions").select("id, module_id, position, prompt, options").eq("organisation_id", organisationId).order("position"),
    client.from("training_assignments").select(ready ? NEW_COLUMNS : OLD_COLUMNS).eq("organisation_id", organisationId).order("due_on"),
  ]);
  check(library.error ?? modules.error ?? questions.error ?? assignments.error);
  const list = (modules.data ?? []) as TrainingModule[];
  let people: Person[] = [];
  let targets: Target[] = [];
  let files: MaterialFile[] = [];
  let policies: LinkedPolicy[] = [];
  let policyFiles: TrainingData["policyFiles"] = [];
  if (ready) {
    const [p, t, links, pol, ver] = await Promise.all([
      client.from("training_people").select("*").eq("organisation_id", organisationId).order("full_name"),
      client.from("training_targets").select("id, module_id, kind, function_name, person_id").eq("organisation_id", organisationId),
      client.from("document_links").select("document_id, subject_id").eq("subject_table", "training_modules").eq("organisation_id", organisationId),
      client.from("policies").select("id, title").eq("organisation_id", organisationId).eq("is_retired", false).order("title"),
      client.from("policy_versions").select("policy_id, version_no, content, document_id").eq("organisation_id", organisationId).eq("status", "approved"),
    ]);
    people = (p.data ?? []) as Person[];
    targets = (t.data ?? []) as Target[];
    const versions = (ver.data ?? []) as { policy_id: string; version_no: number; content: string; document_id: string | null }[];
    policies = ((pol.data ?? []) as { id: string; title: string }[]).map((x) => {
      const v = versions.find((y) => y.policy_id === x.id);
      return { id: x.id, title: x.title, version_no: v?.version_no ?? null, content: v?.content ?? null, document_id: v?.document_id ?? null };
    });
    const docIds = [...new Set([...((links.data ?? []) as { document_id: string }[]).map((l) => l.document_id), ...policies.flatMap((x) => (x.document_id ? [x.document_id] : []))])];
    if (docIds.length) {
      const dv = await client.from("document_versions").select("document_id, file_name, storage_path").in("document_id", docIds);
      const byDoc = new Map(((dv.data ?? []) as { document_id: string; file_name: string; storage_path: string }[]).map((d) => [d.document_id, d]));
      files = ((links.data ?? []) as { document_id: string; subject_id: string }[]).flatMap((l) => {
        const d = byDoc.get(l.document_id);
        return d ? [{ module_id: l.subject_id, file_name: d.file_name, storage_path: d.storage_path }] : [];
      });
      policyFiles = [...byDoc.values()];
    }
  }
  return {
    library: (library.data ?? []) as LibraryModule[],
    modules: list,
    questions: (questions.data ?? []) as Question[],
    assignments: (assignments.data ?? []) as unknown as Assignment[],
    people,
    targets,
    files,
    policies,
    policyFiles,
    ready,
  };
}

/** What a person reads for a module: the linked policy's version in force, or the module's own text */
export function readingFor(data: TrainingData, m: TrainingModule) {
  const policy = m.policy_id ? data.policies.find((p) => p.id === m.policy_id) : undefined;
  const files = [
    ...data.files.filter((f) => f.module_id === m.id),
    ...(policy?.document_id ? data.policyFiles.filter((f) => f.document_id === policy.document_id).map((f) => ({ module_id: m.id, file_name: f.file_name, storage_path: f.storage_path })) : []),
  ];
  return { content: policy?.content || m.content, policy, files };
}

export async function adoptModule(organisationId: string, libraryId: string): Promise<string> {
  const { data, error } = await db().rpc("adopt_training_module", { p_org: organisationId, p_library: libraryId });
  check(error);
  return data as string;
}

export async function createModule(organisationId: string, m: NewModule): Promise<string> {
  const client = db();
  const row: Record<string, unknown> = {
    organisation_id: organisationId,
    title: m.title.trim(),
    summary: m.summary.trim() || null,
    content: m.content.trim(),
    pass_mark: m.passMark,
    refresh_every_months: m.refreshMonths,
  };
  if (m.policyId !== undefined) row.policy_id = m.policyId;
  if (m.dueDays !== undefined) row.due_days = m.dueDays;
  if (m.declarationText) row.declaration_text = m.declarationText.trim();
  let created = await client.from("training_modules").insert(row).select("id").single();
  // Before migration 0036 the new columns do not exist
  if (created.error && /policy_id|due_days|declaration_text/.test(created.error.message)) {
    delete row.policy_id;
    delete row.due_days;
    delete row.declaration_text;
    created = await client.from("training_modules").insert(row).select("id").single();
  }
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

export async function attachMaterial(moduleId: string, file: File) {
  await attachFile("training_modules", moduleId, file);
}
export const downloadMaterial = (f: { storage_path: string; file_name: string }) => downloadFile(f.storage_path, f.file_name);

export async function setModuleStatus(moduleId: string, status: "published" | "retired") {
  check((await db().from("training_modules").update({ status }).eq("id", moduleId)).error);
}

export async function setRefresh(moduleId: string, months: number | null) {
  check((await db().from("training_modules").update({ refresh_every_months: months }).eq("id", moduleId)).error);
}
export async function updateModuleSettings(moduleId: string, patch: Partial<Pick<TrainingModule, "refresh_every_months" | "due_days" | "reassign_on_new_version" | "policy_id">>) {
  check((await db().from("training_modules").update(patch).eq("id", moduleId)).error);
}

/** Who the training is for. Returns how many people were newly assigned. */
export async function setTargets(moduleId: string, t: { all: boolean; functions: string[]; people: string[]; dueOn: string | null }): Promise<number> {
  const { data, error } = await db().rpc("set_training_targets", { p_module: moduleId, p_all: t.all, p_functions: t.functions, p_people: t.people, p_due: t.dueOn || null });
  check(error);
  return Number(data ?? 0);
}

/** Returns how many people were newly assigned. Pass null to assign everyone the module is for. (Before migration 0036.) */
export async function assignTraining(moduleId: string, userIds: string[] | null, dueOn: string): Promise<number> {
  const { data, error } = await db().rpc("assign_training", { p_module: moduleId, p_users: userIds, p_due: dueOn });
  check(error);
  return Number(data ?? 0);
}

export async function withdrawAssignment(assignmentId: string) {
  check((await db().from("training_assignments").delete().eq("id", assignmentId)).error);
}

/** Answers (if any) and the declaration; completes on a pass */
export async function completeTraining(assignmentId: string, answers: number[], signedName: string, agreed: boolean): Promise<MarkResult> {
  const { data, error } = await db().rpc("complete_training", { p_assignment: assignmentId, p_answers: answers, p_signed_name: signedName, p_agreed: agreed });
  check(error);
  return data as MarkResult;
}

/** Before migration 0036: answers only, no declaration */
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

// ---- Roster ----
export type PersonValues = Pick<Person, "full_name" | "email" | "function_name" | "manager_name" | "manager_email" | "start_date">;
const tidyPerson = (p: PersonValues) => ({
  full_name: p.full_name.trim(),
  email: p.email?.trim().toLowerCase() || null,
  function_name: p.function_name?.trim() || null,
  manager_name: p.manager_name?.trim() || null,
  manager_email: p.manager_email?.trim().toLowerCase() || null,
  start_date: p.start_date || null,
});
export async function addPerson(organisationId: string, p: PersonValues) {
  check((await db().from("training_people").insert({ organisation_id: organisationId, ...tidyPerson(p) })).error);
}
export async function updatePerson(id: string, p: Partial<PersonValues> & { is_active?: boolean }) {
  const patch: Record<string, unknown> = { ...p };
  if (p.full_name !== undefined) Object.assign(patch, tidyPerson({ full_name: p.full_name, email: p.email ?? null, function_name: p.function_name ?? null, manager_name: p.manager_name ?? null, manager_email: p.manager_email ?? null, start_date: p.start_date ?? null }));
  check((await db().from("training_people").update(patch).eq("id", id)).error);
}

/** Reads a roster from CSV: name, email, function, manager name, manager email, start date (a header row is optional) */
export function parseRoster(text: string): { rows: PersonValues[]; problems: string[] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const cells = (line: string) => {
    const out: string[] = [];
    let cur = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"' && line[i + 1] === '"' && quoted) {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = !quoted;
      else if ((ch === "," || ch === "\t") && !quoted) {
        out.push(cur.trim());
        cur = "";
      } else cur += ch;
    }
    out.push(cur.trim());
    return out;
  };
  const rows: PersonValues[] = [];
  const problems: string[] = [];
  const toIso = (v: string) => {
    const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(v) ?? null;
    if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "";
  };
  lines.forEach((line, n) => {
    const c = cells(line);
    if (n === 0 && /name/i.test(c[0] ?? "") && /mail/i.test(c[1] ?? "")) return;
    const [full_name, email, function_name, manager_name, manager_email, start] = c;
    if (!full_name || full_name.length < 2) return problems.push(`Line ${n + 1}: no name`);
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return problems.push(`Line ${n + 1}: "${email}" is not an email address`);
    if (manager_email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(manager_email)) return problems.push(`Line ${n + 1}: manager email "${manager_email}" is not valid`);
    rows.push({ full_name, email: email || null, function_name: function_name || null, manager_name: manager_name || null, manager_email: manager_email || null, start_date: start ? toIso(start) || null : null });
  });
  return { rows, problems };
}

// ---- Reminders ----
export type ReminderKind = "before" | "due" | "overdue";
/** The reminder due now for an open assignment, if any */
export function reminderDue(a: Assignment, t = today()): ReminderKind | null {
  if (a.completed_at) return null;
  if (a.due_on < t) {
    if (!a.overdue_sent_at || a.overdue_sent_at.slice(0, 10) <= addDays(t, -7)) return "overdue";
    return null;
  }
  if (a.due_on === t) return a.reminder_due_sent_at ? null : "due";
  if (addDays(a.due_on, -7) <= t && !a.reminder_before_sent_at) return "before";
  return null;
}
export async function markReminderSent(assignmentId: string, kind: ReminderKind) {
  check((await db().rpc("mark_training_reminder_sent", { p_assignment: assignmentId, p_kind: kind })).error);
}
/** Personal links for people without an account */
export async function loadLinks(organisationId: string): Promise<Record<string, string>> {
  const { data, error } = await db().rpc("training_links", { p_org: organisationId });
  if (error) return {};
  return Object.fromEntries(((data ?? []) as { assignment_id: string; token: string }[]).map((r) => [r.assignment_id, r.token]));
}

// ---- Public page (personal link) ----
export type LinkTraining = {
  organisation: string;
  title: string;
  summary: string | null;
  content: string;
  pass_mark: number;
  declaration: string;
  name: string;
  due_on: string;
  policy_version: number | null;
  available: boolean;
  completed_at: string | null;
  signed_name: string | null;
  score: number | null;
  questions: { position: number; prompt: string; options: string[] }[];
  files: { file_name: string; path: string }[];
};
export async function openLinkTraining(token: string): Promise<LinkTraining> {
  const { data, error } = await db().rpc("training_by_link", { p_token: token });
  check(error);
  return data as LinkTraining;
}
export async function completeByLink(token: string, answers: number[], signedName: string, agreed: boolean): Promise<MarkResult> {
  const { data, error } = await db().rpc("complete_training_by_link", { p_token: token, p_answers: answers, p_signed_name: signedName, p_agreed: agreed });
  check(error);
  return data as MarkResult;
}
/** Downloads material on the personal-link page (allowed only while the training is open) */
export async function downloadLinkMaterial(f: { file_name: string; path: string }) {
  const { data, error } = await db().storage.from("documents").download(f.path);
  if (error || !data) throw new Error("The file could not be downloaded.");
  const url = URL.createObjectURL(data);
  const a = document.createElement("a");
  a.href = url;
  a.download = f.file_name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export type TrainingSummary = { assigned: number; complete: number; overdue: number };

/** For the overview. Reads as empty until the training migration has been run. */
export async function loadTrainingSummary(organisationId: string): Promise<TrainingSummary> {
  const { data, error } = await db().from("training_assignments").select(OLD_COLUMNS).eq("organisation_id", organisationId);
  if (error) return { assigned: 0, complete: 0, overdue: 0 };
  // Superseded completions (refreshed since) are history, not current status
  const rows = ((data ?? []) as Assignment[]).filter((a) => !a.completed_at || isCurrent(a));
  return { assigned: rows.length, complete: rows.filter(isCurrent).length, overdue: rows.filter(isOverdue).length };
}

/** The training module already set up for a policy, if any (not retired) */
export async function moduleForPolicy(policyId: string): Promise<string | null> {
  const { data, error } = await db().from("training_modules").select("id").eq("policy_id", policyId).neq("status", "retired").order("created_at", { ascending: false }).limit(1);
  if (error) return null;
  return data?.[0]?.id ?? null;
}
