import { supabase } from "./supabase";

export type CaseStatus = "new" | "assessing" | "investigating" | "closed";
export type SpeakUpCase = {
  id: string;
  reference: string;
  category: string;
  description: string;
  is_anonymous: boolean;
  reporter_user_id: string | null;
  status: CaseStatus;
  protection: "unassessed" | "yes" | "no";
  investigator_user_id: string | null;
  findings: string | null;
  outcome: string | null;
  received_at: string;
  closed_at: string | null;
};
export type CaseMessage = { id?: string; case_id?: string; from_reporter: boolean; author_user_id?: string | null; body: string; created_at: string };
export type CaseNote = { id: string; case_id: string; author_user_id: string | null; body: string; created_at: string };
export type CaseEvent = { id: number; case_id: string; actor_user_id: string | null; event: string; created_at: string };
export type CaseAccess = { case_id: string; user_id: string };
export type SpeakUpData = {
  handlers: string[];
  cases: SpeakUpCase[];
  messages: CaseMessage[];
  notes: CaseNote[];
  events: CaseEvent[];
  access: CaseAccess[];
};
export type FollowUp = { reference: string; status: CaseStatus; received_at: string; closed_at: string | null; messages: CaseMessage[] };
export type SpeakUpSummary = {
  recipients: number;
  open: number;
  open_over_90_days: number;
  received_12_months: number;
  closed_12_months: number;
  substantiated_12_months: number;
};

export const CATEGORIES = [
  "Fraud or theft",
  "Bribery or corruption",
  "Bullying, harassment or discrimination",
  "Health and safety",
  "Breach of the law or a policy",
  "Retaliation for raising a concern",
  "Other",
];
export const CASE_STATUS: Record<CaseStatus, string> = { new: "New", assessing: "Being assessed", investigating: "Under investigation", closed: "Closed" };
export const OUTCOMES: Record<string, string> = {
  substantiated: "Substantiated",
  partly_substantiated: "Partly substantiated",
  not_substantiated: "Not substantiated",
  not_investigated: "Not investigated",
};
export const PROTECTION: Record<SpeakUpCase["protection"], string> = { unassessed: "Not yet assessed", yes: "Yes", no: "No" };

function db() {
  if (!supabase) throw new Error("The site is not connected to its database.");
  return supabase;
}
function check(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

const CASE_COLUMNS =
  "id, reference, category, description, is_anonymous, reporter_user_id, status, protection, investigator_user_id, findings, outcome, received_at, closed_at";

/** Cases, messages and notes come back only for cases this person has been given access to. */
export async function loadSpeakUp(organisationId: string): Promise<SpeakUpData> {
  const client = db();
  const [handlers, cases, messages, notes, events, access] = await Promise.all([
    client.from("speak_up_handlers").select("user_id").eq("organisation_id", organisationId),
    client.from("speak_up_cases").select(CASE_COLUMNS).eq("organisation_id", organisationId).order("received_at", { ascending: false }),
    client.from("speak_up_messages").select("*").eq("organisation_id", organisationId).order("created_at"),
    client.from("speak_up_notes").select("*").eq("organisation_id", organisationId).order("created_at"),
    client.from("speak_up_events").select("*").eq("organisation_id", organisationId).order("id"),
    client.from("speak_up_case_access").select("case_id, user_id"),
  ]);
  check(handlers.error ?? cases.error ?? messages.error ?? notes.error ?? events.error ?? access.error);
  return {
    handlers: ((handlers.data ?? []) as { user_id: string }[]).map((h) => h.user_id),
    cases: (cases.data ?? []) as SpeakUpCase[],
    messages: (messages.data ?? []) as CaseMessage[],
    notes: (notes.data ?? []) as CaseNote[],
    events: (events.data ?? []) as CaseEvent[],
    access: (access.data ?? []) as CaseAccess[],
  };
}

export async function submitReport(organisationId: string, category: string, description: string, anonymous: boolean, exclude: string[]) {
  const { data, error } = await db().rpc("submit_speak_up", {
    p_org: organisationId,
    p_category: category,
    p_description: description,
    p_anonymous: anonymous,
    p_exclude: exclude,
  });
  check(error);
  return data as { reference: string; code: string };
}
export async function followUp(code: string): Promise<FollowUp> {
  const { data, error } = await db().rpc("speak_up_follow_up", { p_code: code });
  check(error);
  return data as FollowUp;
}
export async function replyAsReporter(code: string, body: string) {
  check((await db().rpc("speak_up_reply", { p_code: code, p_body: body })).error);
}
export async function addHandler(organisationId: string, userId: string) {
  check((await db().from("speak_up_handlers").insert({ organisation_id: organisationId, user_id: userId })).error);
}
export async function removeHandler(organisationId: string, userId: string) {
  check((await db().from("speak_up_handlers").delete().eq("organisation_id", organisationId).eq("user_id", userId)).error);
}
export async function updateCase(
  c: SpeakUpCase,
  patch: { status: CaseStatus; protection: string; investigator: string | null; findings: string; outcome: string },
) {
  check(
    (
      await db().rpc("update_speak_up_case", {
        p_case: c.id,
        p_status: patch.status,
        p_protection: patch.protection,
        p_investigator: patch.investigator,
        p_findings: patch.findings,
        p_outcome: patch.outcome,
      })
    ).error,
  );
}
export async function grantAccess(caseId: string, userId: string) {
  check((await db().rpc("grant_speak_up_access", { p_case: caseId, p_user: userId })).error);
}
export async function sendMessage(caseId: string, body: string) {
  check((await db().from("speak_up_messages").insert({ case_id: caseId, body })).error);
}
export async function addNote(caseId: string, body: string) {
  check((await db().from("speak_up_notes").insert({ case_id: caseId, body })).error);
}

/** Numbers only. Null when the person may not see them or the migration has not been run. */
export async function loadSpeakUpSummary(organisationId: string): Promise<SpeakUpSummary | null> {
  const { data, error } = await db().rpc("speak_up_summary", { p_org: organisationId });
  return error ? null : (data as SpeakUpSummary);
}
