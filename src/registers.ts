import { supabase } from "./supabase";

// Key employees, key contracts and disputes (migration 0037), and their feed into the Risk Register.

function db() {
  if (!supabase) throw new Error("Supabase is not configured");
  return supabase;
}
function check(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const blank = (v: string | null | undefined) => (v ?? "").trim() || null;
const notReady = (e: { message: string }) => /key_employees|disputes|is_key|does not exist|schema cache/.test(e.message);

export type Member = { user_id: string; full_name: string; email: string | null };
export async function loadMembers(organisationId: string): Promise<Member[]> {
  const { data } = await db().from("people").select("user_id, full_name, email").eq("organisation_id", organisationId).not("user_id", "is", null).order("full_name");
  return (data ?? []) as Member[];
}

// ---- Key employees ----
export type Readiness = "ready_now" | "within_12_months" | "longer" | "none";
export type YesNo = "yes" | "no" | "unknown";
export type KeyEmployee = {
  id: string;
  entity_id: string | null;
  full_name: string;
  position_title: string;
  function_name: string | null;
  why_key: string;
  status: "in_role" | "leaving" | "vacant";
  leaving_on: string | null;
  successor_name: string | null;
  succession_readiness: Readiness | null;
  notice_period: string | null;
  restraint: YesNo;
  retention_notes: string | null;
  key_person_insurance: YesNo;
  review_on: string | null;
  last_reviewed_on: string | null;
  is_active: boolean;
};
export type KeyEmployeeValues = Omit<KeyEmployee, "id" | "is_active" | "last_reviewed_on">;
export const READINESS: Record<Readiness, string> = { ready_now: "Ready now", within_12_months: "Ready within 12 months", longer: "More than 12 months away", none: "No successor" };
export const EMPLOYEE_STATUS: Record<KeyEmployee["status"], string> = { in_role: "In role", leaving: "Leaving", vacant: "Role vacant" };
export const YES_NO: Record<YesNo, string> = { yes: "Yes", no: "No", unknown: "Not known" };
export const blankKeyEmployee = (): KeyEmployeeValues => ({
  entity_id: null, full_name: "", position_title: "", function_name: null, why_key: "", status: "in_role", leaving_on: null, successor_name: null,
  succession_readiness: null, notice_period: null, restraint: "unknown", retention_notes: null, key_person_insurance: "unknown", review_on: null,
});
/** True when the succession picture is a risk: leaving, vacant, or no successor ready now (not assessed counts) */
export const successionGap = (k: KeyEmployee) => k.status !== "in_role" || k.succession_readiness !== "ready_now";

export async function loadKeyEmployees(organisationId: string): Promise<{ ready: boolean; rows: KeyEmployee[] }> {
  const { data, error } = await db().from("key_employees").select("*").eq("organisation_id", organisationId).order("full_name");
  if (error) {
    if (notReady(error)) return { ready: false, rows: [] };
    throw new Error(error.message);
  }
  return { ready: true, rows: (data ?? []) as KeyEmployee[] };
}
const tidyEmployee = (v: Partial<KeyEmployeeValues>) => {
  const out: Record<string, unknown> = { ...v };
  for (const k of ["function_name", "leaving_on", "successor_name", "notice_period", "retention_notes", "review_on", "entity_id"] as const) if (k in v) out[k] = blank(v[k] as string | null);
  for (const k of ["full_name", "position_title", "why_key"] as const) if (k in v) out[k] = (v[k] ?? "").trim();
  return out;
};
export async function saveKeyEmployee(organisationId: string, id: string | null, v: Partial<KeyEmployeeValues> & { is_active?: boolean; last_reviewed_on?: string }) {
  const row = tidyEmployee(v);
  if (id) check((await db().from("key_employees").update(row).eq("id", id)).error);
  else check((await db().from("key_employees").insert({ ...row, organisation_id: organisationId })).error);
}

// ---- Key contracts ----
export type KeyContract = {
  id: string;
  entity_id: string;
  title: string;
  value_amount: number | null;
  currency: string;
  starts_on: string | null;
  ends_on: string | null;
  notice_by: string | null;
  auto_renews: boolean;
  status: string;
  is_key: boolean;
  key_reason: string | null;
  key_contingency: string | null;
  key_change_of_control: YesNo;
  key_owner: string | null;
  key_marked_at: string | null;
  counterparty: { id: string; name: string } | null;
};
export async function loadKeyContracts(organisationId: string): Promise<{ ready: boolean; rows: KeyContract[] }> {
  const { data, error } = await db()
    .from("contracts")
    .select("id, entity_id, title, value_amount, currency, starts_on, ends_on, notice_by, auto_renews, status, is_key, key_reason, key_contingency, key_change_of_control, key_owner, key_marked_at, counterparty:counterparties(id, name)")
    .eq("organisation_id", organisationId)
    .order("title");
  if (error) {
    if (notReady(error)) return { ready: false, rows: [] };
    throw new Error(error.message);
  }
  return { ready: true, rows: ((data ?? []) as unknown as KeyContract[]).map((c) => ({ ...c, value_amount: num(c.value_amount) })) };
}
export async function setKeyContract(id: string, v: { is_key: boolean; reason: string; contingency: string; change_of_control: YesNo; owner: string }) {
  check(
    (await db().rpc("set_key_contract", { p_contract: id, p_is_key: v.is_key, p_reason: v.reason, p_contingency: v.contingency, p_change_of_control: v.change_of_control, p_owner: v.owner })).error,
  );
}

// ---- Disputes ----
export type DisputeKind = "litigation" | "complaint" | "employee";
export type Dispute = {
  id: string;
  entity_id: string | null;
  kind: DisputeKind;
  direction: "by_us" | "against_us" | null;
  stage: "active" | "potential" | null;
  title: string;
  other_party: string | null;
  claim_type: string | null;
  forum: string | null;
  reference: string | null;
  particulars: string;
  amount_claimed: number | null;
  exposure_estimate: number | null;
  currency: string;
  prospects: "strong" | "reasonable" | "weak" | "unknown";
  regulator_involved: string | null;
  external_advisers: string | null;
  next_step: string | null;
  next_date: string | null;
  owner_user_id: string | null;
  opened_on: string | null;
  status: "open" | "closed";
  closed_on: string | null;
  outcome: string | null;
  created_at: string;
};
export type DisputeValues = Omit<Dispute, "id" | "kind" | "status" | "closed_on" | "outcome" | "created_at">;
export const PROSPECTS: Record<Dispute["prospects"], string> = { strong: "Strong", reasonable: "Reasonable", weak: "Weak", unknown: "Not assessed" };
export const EMPLOYEE_CLAIMS = ["Unfair dismissal", "General protections", "Discrimination", "Bullying or harassment", "Underpayment or wages", "Workplace health and safety", "Workers compensation", "Grievance", "Other"];
export const blankDispute = (kind: DisputeKind): DisputeValues => ({
  entity_id: null, direction: kind === "litigation" ? "against_us" : null, stage: kind === "employee" ? "active" : null, title: "", other_party: null, claim_type: null,
  forum: null, reference: null, particulars: "", amount_claimed: null, exposure_estimate: null, currency: "AUD", prospects: "unknown", regulator_involved: null,
  external_advisers: null, next_step: null, next_date: null, owner_user_id: null, opened_on: null,
});
export async function loadDisputes(organisationId: string): Promise<{ ready: boolean; rows: Dispute[] }> {
  const { data, error } = await db().from("disputes").select("*").eq("organisation_id", organisationId).order("opened_on", { ascending: false, nullsFirst: false });
  if (error) {
    if (notReady(error)) return { ready: false, rows: [] };
    throw new Error(error.message);
  }
  return { ready: true, rows: ((data ?? []) as Dispute[]).map((d) => ({ ...d, amount_claimed: num(d.amount_claimed), exposure_estimate: num(d.exposure_estimate) })) };
}
export async function saveDispute(organisationId: string, kind: DisputeKind, id: string | null, v: DisputeValues) {
  const row: Record<string, unknown> = { ...v, title: v.title.trim(), particulars: v.particulars.trim() };
  for (const k of ["entity_id", "other_party", "claim_type", "forum", "reference", "regulator_involved", "external_advisers", "next_step", "next_date", "owner_user_id", "opened_on"] as const) row[k] = blank(v[k]);
  row.currency = (v.currency || "AUD").trim().toUpperCase();
  if (id) check((await db().from("disputes").update(row).eq("id", id)).error);
  else check((await db().from("disputes").insert({ ...row, kind, organisation_id: organisationId })).error);
}
export async function closeDispute(id: string, outcome: string, closedOn: string) {
  check((await db().from("disputes").update({ status: "closed", outcome: outcome.trim(), closed_on: closedOn }).eq("id", id)).error);
}
export async function reopenDispute(id: string) {
  check((await db().from("disputes").update({ status: "open" }).eq("id", id)).error);
}

// ---- Feed into the Risk Register ----
export type FeedItem = {
  source_table: "key_employees" | "disputes" | "contracts";
  source_id: string;
  register: string;
  category_id: string | null;
  category_name: string | null;
  title: string;
  action: string;
  actioner: string | null;
  due_on: string | null;
};
/** What Key Employees, Key Contracts and Disputes say should be in a review. Empty before migration 0037. */
export async function loadRiskFeed(reviewId: string): Promise<FeedItem[]> {
  const { data, error } = await db().rpc("risk_feed", { p_review: reviewId });
  if (error) return [];
  return (data ?? []) as FeedItem[];
}
export async function addRiskFeed(reviewId: string, sourceId: string | null, categoryId: string | null = null): Promise<number> {
  const { data, error } = await db().rpc("add_risk_feed", { p_review: reviewId, p_source: sourceId, p_category: categoryId });
  check(error);
  return Number(data ?? 0);
}

export const money = (n: number | null, currency = "AUD") => (n === null ? "" : `${currency} ${n.toLocaleString("en-AU", { maximumFractionDigits: 0 })}`);
