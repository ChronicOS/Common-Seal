import { supabase } from "./supabase";

export type RiskLevel = "low" | "medium" | "high";
export type CaseStatus = "open" | "cleared" | "cleared_with_conditions" | "rejected";
export type PartyKind = "third_party" | "customer";
export type Topic = "abc" | "sanctions" | "modern_slavery" | "aml_kyc";

export type Party = {
  id: string;
  name: string;
  kind: PartyKind;
  country: string | null;
  risk_rating: RiskLevel | null;
  dd_status: CaseStatus | null;
  next_review_on: string | null;
};

export type Answers = {
  country_risk: RiskLevel;
  government_links: boolean;
  acts_on_our_behalf: boolean;
  high_risk_sector: boolean;
  annual_value: "under_100k" | "100k_to_1m" | "over_1m";
};

export type DdCase = {
  id: string;
  counterparty_id: string;
  answers: Partial<Answers>;
  risk_rating: RiskLevel;
  status: CaseStatus;
  conditions: string | null;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
};

export type DdCheck = { id: string; case_id: string; topic: Topic; result: "pending" | "clear" | "concern"; notes: string | null };

export type PartiesData = {
  parties: Party[];
  cases: DdCase[];
  checks: DdCheck[];
  people: { user_id: string | null; full_name: string }[];
};

export const TOPIC_LABELS: Record<Topic, string> = {
  abc: "Anti-bribery and corruption",
  sanctions: "Sanctions and politically exposed persons",
  modern_slavery: "Modern slavery",
  aml_kyc: "Customer identification",
};
export const DEFAULT_TOPICS: Record<PartyKind, Topic[]> = {
  third_party: ["abc", "sanctions", "modern_slavery"],
  customer: ["aml_kyc", "sanctions"],
};
export const RISK_LABELS: Record<RiskLevel, string> = { low: "Low risk", medium: "Medium risk", high: "High risk" };
export const DD_LABELS: Record<CaseStatus, string> = {
  open: "Due diligence open",
  cleared: "Cleared",
  cleared_with_conditions: "Cleared with conditions",
  rejected: "Rejected",
};
export const KIND_LABELS: Record<PartyKind, string> = { third_party: "Third party", customer: "Customer" };

export const BLANK_ANSWERS: Answers = {
  country_risk: "low",
  government_links: false,
  acts_on_our_behalf: false,
  high_risk_sector: false,
  annual_value: "under_100k",
};

/** Mirrors the database's rating rules so the form can show a provisional rating as you answer. */
export function provisionalRating(a: Answers): RiskLevel {
  if (a.government_links || a.country_risk === "high" || (a.acts_on_our_behalf && a.country_risk !== "low")) return "high";
  if (a.country_risk === "medium" || a.acts_on_our_behalf || a.high_risk_sector || a.annual_value === "over_1m") return "medium";
  return "low";
}

function db() {
  if (!supabase) throw new Error("The site is not connected to its database.");
  return supabase;
}

function check(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

export async function loadParties(organisationId: string): Promise<PartiesData> {
  const client = db();
  const [parties, cases, checks, people] = await Promise.all([
    client
      .from("counterparties")
      .select("id, name, kind, country, risk_rating, dd_status, next_review_on")
      .eq("organisation_id", organisationId)
      .order("name"),
    client
      .from("dd_cases")
      .select("id, counterparty_id, answers, risk_rating, status, conditions, decided_by, decided_at, created_at")
      .eq("organisation_id", organisationId)
      .order("created_at", { ascending: false }),
    client.from("dd_checks").select("id, case_id, topic, result, notes").eq("organisation_id", organisationId).order("created_at"),
    client.from("people").select("user_id, full_name").eq("organisation_id", organisationId),
  ]);
  check(parties.error ?? cases.error ?? checks.error ?? people.error);
  return {
    parties: (parties.data ?? []) as Party[],
    cases: (cases.data ?? []) as DdCase[],
    checks: (checks.data ?? []) as DdCheck[],
    people: (people.data ?? []) as { user_id: string | null; full_name: string }[],
  };
}

export async function addParty(organisationId: string, name: string, kind: PartyKind, country: string): Promise<string> {
  const { data, error } = await db()
    .from("counterparties")
    .insert({ organisation_id: organisationId, name: name.trim(), kind, country: country.trim() || null })
    .select("id")
    .single();
  check(error);
  return data!.id as string;
}

export async function openCase(partyId: string, answers: Answers, topics: Topic[]) {
  check((await db().rpc("open_dd_case", { p_counterparty: partyId, p_answers: answers, p_topics: topics })).error);
}

export async function saveCheck(checkId: string, result: DdCheck["result"], notes: string) {
  check((await db().from("dd_checks").update({ result, notes: notes.trim() || null }).eq("id", checkId)).error);
}

export async function decideCase(caseId: string, outcome: Exclude<CaseStatus, "open">, conditions: string) {
  check((await db().rpc("decide_dd_case", { p_case: caseId, p_outcome: outcome, p_conditions: conditions })).error);
}

export type PartySummary = { total: number; highRisk: number; open: number; rejected: number };

/** For the overview. Reads as empty until the due diligence migration has been run. */
export async function loadPartySummary(organisationId: string): Promise<PartySummary> {
  const { data, error } = await db()
    .from("counterparties")
    .select("risk_rating, dd_status")
    .eq("organisation_id", organisationId);
  if (error) return { total: 0, highRisk: 0, open: 0, rejected: 0 };
  const rows = (data ?? []) as { risk_rating: RiskLevel | null; dd_status: CaseStatus | null }[];
  return {
    total: rows.length,
    highRisk: rows.filter((r) => r.risk_rating === "high").length,
    open: rows.filter((r) => r.dd_status === "open").length,
    rejected: rows.filter((r) => r.dd_status === "rejected").length,
  };
}
