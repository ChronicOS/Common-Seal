import { supabase } from "./supabase";

// Work health and safety (migration 0049)

export type Incident = {
  id: string;
  entity_id: string | null;
  occurred_at: string;
  location: string | null;
  state: string | null;
  kind: "injury" | "illness" | "near_miss" | "dangerous_incident" | "psychosocial" | "property" | "other";
  description: string;
  persons_involved: string | null;
  severity: "none" | "first_aid" | "medical_treatment" | "lost_time" | "serious" | "fatality" | null;
  immediate_action: string | null;
  notifiable: boolean | null;
  notifiable_reason: "death" | "serious_injury_illness" | "dangerous_incident" | null;
  notifiable_basis: string | null;
  assessed_at: string | null;
  regulator: string | null;
  regulator_notified_at: string | null;
  regulator_reference: string | null;
  written_notice_at: string | null;
  site_preserved: boolean | null;
  investigation_status: "not_started" | "in_progress" | "complete";
  root_cause: string | null;
  corrective_actions: string | null;
  actions_due_on: string | null;
  actions_done_on: string | null;
  status: "open" | "closed";
  closed_at: string | null;
  reported_by: string | null;
  created_at: string;
};
export type Hazard = {
  id: string;
  entity_id: string | null;
  title: string;
  kind: "physical" | "psychosocial" | "chemical" | "plant" | "ergonomic" | "biological" | "other";
  psychosocial_type: string | null;
  where_who: string | null;
  likelihood: number;
  consequence: number;
  controls: string | null;
  control_level: "eliminate" | "substitute" | "isolate" | "engineering" | "administrative" | "ppe" | null;
  residual_likelihood: number | null;
  residual_consequence: number | null;
  owner_user_id: string | null;
  review_on: string | null;
  status: "active" | "closed";
};
export type HazardValues = Omit<Hazard, "id">;
export type DdReview = {
  id: string;
  period_end: string;
  answers: Record<string, { status?: "met" | "partly" | "not_met"; evidence?: string }>;
  summary: Summary | null;
  signed_off_by: string | null;
  signed_off_at: string | null;
  resolution_id: string | null;
};
export type Summary = {
  incidents: number;
  by_kind: Record<string, number>;
  by_severity: Record<string, number>;
  lost_time: number;
  notifiable: { occurred_on: string; kind: string; reason: string; notified_at: string | null; regulator: string | null; status: string; investigation: string }[];
  not_assessed: number;
  open_incidents: number;
  actions_overdue: number;
  hazards: number;
  hazards_high: number;
  psychosocial: number;
  hazards_review_overdue: number;
};

export const KIND_LABELS: Record<Incident["kind"], string> = {
  injury: "Injury", illness: "Illness", near_miss: "Near miss", dangerous_incident: "Dangerous incident", psychosocial: "Psychosocial (bullying, harassment, violence, stress)", property: "Property or plant damage", other: "Other",
};
export const SEVERITY_LABELS: Record<NonNullable<Incident["severity"]>, string> = {
  none: "No injury", first_aid: "First aid only", medical_treatment: "Medical treatment", lost_time: "Time off work", serious: "Serious injury or illness", fatality: "Death",
};
export const REASON_LABELS: Record<NonNullable<Incident["notifiable_reason"]>, string> = {
  death: "A death", serious_injury_illness: "A serious injury or illness", dangerous_incident: "A dangerous incident",
};
export const STATES = ["NSW", "VIC", "QLD", "WA", "SA", "TAS", "ACT", "NT", "Commonwealth", "Overseas"] as const;
export const REGULATORS: Record<string, string> = {
  NSW: "SafeWork NSW", VIC: "WorkSafe Victoria", QLD: "Workplace Health and Safety Queensland", WA: "WorkSafe WA", SA: "SafeWork SA",
  TAS: "WorkSafe Tasmania", ACT: "WorkSafe ACT", NT: "NT WorkSafe", Commonwealth: "Comcare", Overseas: "The local regulator",
};
/** The WHS Act's examples of a serious injury or illness (s 36) */
export const SERIOUS = [
  "Immediate treatment as an in-patient in a hospital",
  "Immediate treatment for an amputation, serious head or eye injury, serious burn, degloving or scalping, spinal injury, loss of a bodily function or serious lacerations",
  "Medical treatment within 48 hours of exposure to a substance",
  "A serious infection to which the work significantly contributed (for example from work with micro-organisms, animals or human blood)",
];
/** The WHS Act's dangerous incidents (s 37): exposing someone to a serious risk, even if no one was hurt */
export const DANGEROUS = [
  "Uncontrolled escape, spillage or leakage of a substance",
  "Uncontrolled implosion, explosion or fire",
  "Uncontrolled escape of gas, steam or a pressurised substance",
  "Electric shock",
  "Fall or release from a height of plant, a substance or a thing",
  "Collapse, overturning, failure or malfunction of plant that must be authorised",
  "Collapse or partial collapse of a structure, or of an excavation",
  "Inrush of water, mud or gas, or loss of ventilation, in underground workings",
];
export const PSYCHOSOCIAL: { id: string; label: string }[] = [
  { id: "job_demands", label: "High or low job demands" }, { id: "low_control", label: "Low job control" }, { id: "poor_support", label: "Poor support" },
  { id: "role_clarity", label: "Lack of role clarity" }, { id: "change_management", label: "Poor change management" }, { id: "recognition", label: "Inadequate reward and recognition" },
  { id: "justice", label: "Poor organisational justice" }, { id: "environment", label: "Poor environmental conditions" }, { id: "remote_isolated", label: "Remote or isolated work" },
  { id: "conflict", label: "Poor workplace relationships or conflict" }, { id: "bullying", label: "Bullying" }, { id: "harassment", label: "Harassment" },
  { id: "sexual_harassment", label: "Sexual harassment" }, { id: "violence_aggression", label: "Violence and aggression" }, { id: "traumatic_events", label: "Traumatic events or material" },
  { id: "other", label: "Other" },
];
export const CONTROL_LABELS: Record<NonNullable<Hazard["control_level"]>, string> = {
  eliminate: "Eliminate the hazard", substitute: "Substitute something safer", isolate: "Isolate people from it", engineering: "Engineering controls", administrative: "Administrative controls (procedures, training)", ppe: "Personal protective equipment",
};
export const ELEMENTS: { key: string; label: string; prompt: string }[] = [
  { key: "knowledge", label: "Knowledge", prompt: "Directors acquire and keep up to date knowledge of work health and safety matters (s 27(5)(a))." },
  { key: "operations", label: "Understanding the operations", prompt: "Directors understand the operations and their hazards and risks (s 27(5)(b))." },
  { key: "resources", label: "Resources and processes", prompt: "Appropriate resources and processes to eliminate or minimise risks are available and used (s 27(5)(c))." },
  { key: "information", label: "Information and response", prompt: "There are processes to receive and consider information about incidents, hazards and risks, and respond in time (s 27(5)(d))." },
  { key: "compliance", label: "Compliance with duties", prompt: "There are processes to comply with every duty under the Act, such as notifying incidents and consulting workers (s 27(5)(e))." },
  { key: "verification", label: "Verification", prompt: "Directors verify that the resources and processes are provided and used, for example through audits and site visits (s 27(5)(f))." },
];
export const score = (h: Pick<Hazard, "likelihood" | "consequence" | "residual_likelihood" | "residual_consequence">) =>
  (h.residual_likelihood ?? h.likelihood) * (h.residual_consequence ?? h.consequence);
export const scoreLabel = (n: number) => (n >= 15 ? "High" : n >= 8 ? "Medium" : "Low");

function db() {
  if (!supabase) throw new Error("The site is not connected to its database.");
  return supabase;
}
function check(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}
const tidy = (v: object) => Object.fromEntries(Object.entries(v).map(([k, x]) => [k, typeof x === "string" ? x.trim() || null : x]));

export type WhsData = { ready: boolean; incidents: Incident[]; hazards: Hazard[]; reviews: DdReview[]; people: { user_id: string | null; full_name: string }[] };
export async function loadWhs(organisationId: string): Promise<WhsData> {
  const c = db();
  const [incidents, hazards, reviews, people] = await Promise.all([
    c.from("whs_incidents").select("*").eq("organisation_id", organisationId).order("occurred_at", { ascending: false }),
    c.from("whs_hazards").select("*").eq("organisation_id", organisationId).order("created_at"),
    c.from("whs_due_diligence").select("*").eq("organisation_id", organisationId).order("period_end", { ascending: false }),
    c.from("people").select("user_id, full_name").eq("organisation_id", organisationId),
  ]);
  if (hazards.error) return { ready: false, incidents: [], hazards: [], reviews: [], people: [] };
  return {
    ready: true,
    incidents: (incidents.data ?? []) as Incident[],
    hazards: (hazards.data ?? []) as Hazard[],
    reviews: (reviews.data ?? []) as DdReview[],
    people: (people.data ?? []) as WhsData["people"],
  };
}
export async function loadSummary(organisationId: string, from: string, to: string): Promise<Summary | null> {
  const { data, error } = await db().rpc("whs_summary", { p_org: organisationId, p_from: from, p_to: to });
  if (error) return null;
  return data as Summary;
}
export async function reportIncident(organisationId: string, v: Partial<Incident>) {
  const { data, error } = await db().from("whs_incidents").insert({ ...tidy(v), organisation_id: organisationId }).select("id").single();
  check(error);
  return data!.id as string;
}
export async function updateIncident(id: string, patch: Partial<Incident>) {
  check((await db().from("whs_incidents").update(tidy(patch)).eq("id", id)).error);
}
export async function saveHazard(organisationId: string, id: string | null, v: HazardValues) {
  if (id) check((await db().from("whs_hazards").update(tidy(v)).eq("id", id)).error);
  else check((await db().from("whs_hazards").insert({ ...tidy(v), organisation_id: organisationId })).error);
}
export async function saveReview(organisationId: string, id: string | null, periodEnd: string, answers: DdReview["answers"]) {
  if (id) check((await db().from("whs_due_diligence").update({ answers }).eq("id", id)).error);
  else check((await db().from("whs_due_diligence").insert({ organisation_id: organisationId, period_end: periodEnd, answers })).error);
}
export async function signOffReview(id: string) {
  check((await db().rpc("sign_off_whs_review", { p_review: id })).error);
}
