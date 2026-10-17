import { supabase } from "./supabase";

// Regulatory checks: employment law, consumer law and climate reporting (migration 0052), and merger control (0053)

export type Programme = "employment" | "consumer" | "climate";
export type Status = "in_place" | "partly" | "gap" | "not_applicable";
export type Answers = Record<string, string | number | boolean | null>;
export type Profile = { id: string; entity_id: string | null; programme: Programme; answers: Answers };
export type Check = { id: string; entity_id: string | null; programme: Programme; item_key: string; status: Status | null; notes: string | null; evidence: string | null; owner_user_id: string | null; review_on: string | null; reviewed_at: string | null };
/** What other modules' records say about an item */
export type Auto = { level: "ok" | "warn" | "gap"; text: string; tab?: string } | null;
/** Facts gathered from other modules, used for "From the records" */
export type Signals = { policies: { title: string; next_review_on: string | null }[]; modules: string[]; psychosocial: number; obligations: string[]; contracts: StandardContract[] };
export type Question = { key: string; label: string; hint?: string; kind: "number" | "yesno" | "choice" | "money"; options?: { value: string; label: string }[] };
export type Item = {
  key: string;
  label: string;
  hint: string;
  law: string;
  /** Not yet law: shown as coming, never as a gap */
  coming?: boolean;
  /** true applies, false does not, null not known yet (answer the profile) */
  applies?: (a: Answers) => boolean | null;
  auto?: (s: Signals, a: Answers) => Auto;
};
export const STATUS_LABELS: Record<Status, string> = { in_place: "In place", partly: "Partly in place", gap: "Gap", not_applicable: "Not applicable" };

/** Combine what was recorded with what the records show. Unknown is never green. */
export function effective(check: Check | undefined, auto: Auto, applies: boolean | null, coming = false): { status: Status | "not_assessed" | "coming" | "unknown_scope"; reason: string | null } {
  if (applies === false) return { status: "not_applicable", reason: "Does not apply on the profile answers." };
  const manual = check?.status ?? null;
  if (coming && !manual) return { status: "coming", reason: null };
  if (applies === null && !manual) return { status: "unknown_scope", reason: null };
  const autoStatus: Status | null = auto ? (auto.level === "gap" ? "gap" : auto.level === "warn" ? "partly" : "in_place") : null;
  if (!manual && !autoStatus) return { status: "not_assessed", reason: null };
  if (manual === "not_applicable") return { status: "not_applicable", reason: null };
  if (!manual) return autoStatus === "in_place" ? { status: "partly", reason: "The records look good, but no one has confirmed this yet." } : { status: autoStatus!, reason: null };
  if (!autoStatus) return { status: manual, reason: null };
  const rank: Record<Status, number> = { gap: 0, partly: 1, in_place: 2, not_applicable: 3 };
  return rank[autoStatus] < rank[manual] ? { status: autoStatus, reason: "The records show less than was recorded." } : { status: manual, reason: null };
}
export const EFFECTIVE_LABELS = { ...STATUS_LABELS, not_assessed: "Not assessed", coming: "Coming", unknown_scope: "Answer the profile" } as const;
export const EFFECTIVE_CLASS: Record<keyof typeof EFFECTIVE_LABELS, string> = {
  in_place: "ok-text", partly: "warning-text", gap: "warning-text", not_applicable: "muted", not_assessed: "warning-text", coming: "muted", unknown_scope: "warning-text",
};

// Unfair contract terms: the kinds of term the ACL gives as examples (s 25), and other common problems
export type Finding = "ok" | "risk" | "fixed" | "na";
export const UCT_TERMS: { key: string; label: string; hint: string }[] = [
  { key: "unilateral_variation", label: "One side can change the terms, price or what is supplied", hint: "Without the other side's agreement or a right to exit." },
  { key: "unilateral_termination", label: "One side can end the contract and the other cannot", hint: "Or only one side can avoid or limit performance." },
  { key: "one_sided_penalties", label: "Only one side pays for breach or ending the contract", hint: "Early exit fees, liquidated damages or forfeiture that only bite one way." },
  { key: "limits_liability", label: "Liability or the right to sue is limited for one side only", hint: "Including exclusions of consumer guarantees, which cannot be excluded." },
  { key: "auto_renewal", label: "Renews automatically without notice or an easy way out", hint: "" },
  { key: "assignment", label: "One side can assign the contract without the other's consent", hint: "Especially to the other side's detriment." },
  { key: "unilateral_interpretation", label: "One side decides what the contract means", hint: "Or whether the other side has breached it." },
  { key: "evidence_limits", label: "Limits the evidence one side can rely on", hint: "Or deems facts against them." },
  { key: "broad_indemnity", label: "Broad one-way indemnities", hint: "The customer covers losses the supplier caused." },
  { key: "agent_representations", label: "Disowns what the supplier's staff or agents said", hint: "" },
];
export type StandardContract = {
  id: string; entity_id: string | null; name: string; kind: "customer" | "supplier" | "distributor" | "licence" | "subscription" | "website" | "other";
  used_with: "consumers" | "small_business" | "both" | "neither"; version: string | null; findings: Record<string, Finding>; notes: string | null;
  owner_user_id: string | null; last_reviewed_on: string | null; next_review_on: string | null; status: "current" | "retired";
};
export type StandardContractValues = Omit<StandardContract, "id">;

export type Acquisition = {
  id: string; entity_id: string | null; name: string; target: string; kind: "shares" | "assets" | "business" | "units" | "other"; market: string | null;
  acquirer_group_revenue: number | null; target_revenue: number | null; transaction_value: number | null; gives_control: boolean | null; target_in_australia: boolean | null;
  exception: string | null; related_ids: string[]; aggregated_target_revenue: number | null; notification: "required" | "not_required" | "unknown"; reasons: string | null;
  status: "considering" | "notified" | "determined" | "completed" | "abandoned"; planned_completion_on: string | null; accc_notified_on: string | null; accc_reference: string | null;
  determination: "approved" | "approved_with_conditions" | "waiver" | "not_approved" | null; determined_on: string | null; conditions: string | null; completed_on: string | null; notes: string | null; created_at: string;
};
export type AcquisitionValues = Omit<Acquisition, "id" | "aggregated_target_revenue" | "notification" | "reasons" | "created_at">;

function db() {
  if (!supabase) throw new Error("The site is not connected to its database.");
  return supabase;
}
function check(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}
const tidy = (v: object) => Object.fromEntries(Object.entries(v).map(([k, x]) => [k, typeof x === "string" ? x.trim() || null : x]));

export type RegData = { ready: boolean; allowed: boolean; profiles: Profile[]; checks: Check[]; contracts: StandardContract[]; people: { user_id: string | null; full_name: string }[]; signals: Signals };
export async function loadRegulatory(organisationId: string, programme: Programme): Promise<RegData> {
  const c = db();
  const [profiles, checks, contracts, people, policies, modules, hazards, obligations] = await Promise.all([
    c.from("programme_profiles").select("*").eq("organisation_id", organisationId).eq("programme", programme),
    c.from("compliance_checks").select("*").eq("organisation_id", organisationId).eq("programme", programme),
    programme === "consumer" ? c.from("standard_form_contracts").select("*").eq("organisation_id", organisationId).order("name") : Promise.resolve({ data: [], error: null }),
    c.from("people").select("user_id, full_name").eq("organisation_id", organisationId),
    c.from("policies").select("title, next_review_on, is_retired").eq("organisation_id", organisationId),
    c.from("training_modules").select("title, status").eq("organisation_id", organisationId),
    c.from("whs_hazards").select("kind, status").eq("organisation_id", organisationId),
    c.from("compliance_obligations").select("template_key, is_active").eq("organisation_id", organisationId),
  ]);
  const empty: Signals = { policies: [], modules: [], psychosocial: 0, obligations: [], contracts: [] };
  if (checks.error) return { ready: false, allowed: false, profiles: [], checks: [], contracts: [], people: [], signals: empty };
  const list = (contracts.data ?? []) as StandardContract[];
  return {
    ready: true,
    allowed: !profiles.error,
    profiles: (profiles.data ?? []) as Profile[],
    checks: (checks.data ?? []) as Check[],
    contracts: list,
    people: (people.data ?? []) as RegData["people"],
    signals: {
      policies: ((policies.data ?? []) as { title: string; next_review_on: string | null; is_retired: boolean }[]).filter((p) => !p.is_retired),
      modules: ((modules.data ?? []) as { title: string; status: string }[]).filter((m) => m.status === "published").map((m) => m.title),
      psychosocial: ((hazards.data ?? []) as { kind: string; status: string }[]).filter((h) => h.kind === "psychosocial" && h.status === "active").length,
      obligations: ((obligations.data ?? []) as { template_key: string | null; is_active: boolean }[]).filter((o) => o.is_active && o.template_key).map((o) => o.template_key!),
      contracts: list,
    },
  };
}
export async function saveProfile(organisationId: string, programme: Programme, entityId: string | null, existing: Profile | undefined, answers: Answers) {
  if (existing) check((await db().from("programme_profiles").update({ answers }).eq("id", existing.id)).error);
  else check((await db().from("programme_profiles").insert({ organisation_id: organisationId, programme, entity_id: entityId, answers })).error);
}
export async function saveCheck(organisationId: string, programme: Programme, entityId: string | null, existing: Check | undefined, key: string, v: Pick<Check, "status" | "notes" | "evidence" | "owner_user_id" | "review_on">) {
  if (existing) {
    check((await db().from("compliance_checks").update(tidy(v)).eq("id", existing.id)).error);
    return existing.id;
  }
  const { data, error } = await db().from("compliance_checks").insert({ ...tidy(v), organisation_id: organisationId, programme, entity_id: entityId, item_key: key }).select("id").single();
  check(error);
  return data!.id as string;
}
export async function saveContract(organisationId: string, id: string | null, v: StandardContractValues) {
  if (id) check((await db().from("standard_form_contracts").update(tidy(v)).eq("id", id)).error);
  else check((await db().from("standard_form_contracts").insert({ ...tidy(v), organisation_id: organisationId })).error);
}
export async function loadAcquisitions(organisationId: string) {
  const c = db();
  const deals = await c.from("acquisitions").select("*").eq("organisation_id", organisationId).order("created_at", { ascending: false });
  if (deals.error) return { ready: !/does not exist|schema cache/i.test(deals.error.message), deals: [] as Acquisition[] };
  return { ready: true, deals: ((deals.data ?? []) as Acquisition[]).map((d) => ({ ...d, acquirer_group_revenue: num(d.acquirer_group_revenue), target_revenue: num(d.target_revenue), transaction_value: num(d.transaction_value), aggregated_target_revenue: num(d.aggregated_target_revenue) })) };
}
const num = (x: unknown) => (x === null || x === undefined || x === "" ? null : Number(x));
export async function saveAcquisition(organisationId: string, id: string | null, v: Partial<AcquisitionValues>) {
  if (id) {
    check((await db().from("acquisitions").update(tidy(v)).eq("id", id)).error);
    return id;
  }
  const { data, error } = await db().from("acquisitions").insert({ ...tidy(v), organisation_id: organisationId }).select("id").single();
  check(error);
  return data!.id as string;
}

// Helpers for the item libraries
export const yes = (a: Answers, k: string) => (a[k] === null || a[k] === undefined || a[k] === "" ? null : a[k] === true || a[k] === "yes");
export const n = (a: Answers, k: string) => (a[k] === null || a[k] === undefined || a[k] === "" ? null : Number(a[k]));
export const hasPolicy = (s: Signals, re: RegExp) => s.policies.filter((p) => re.test(p.title));
export const hasModule = (s: Signals, re: RegExp) => s.modules.filter((m) => re.test(m));
