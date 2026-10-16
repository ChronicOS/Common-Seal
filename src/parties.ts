import { supabase } from "./supabase";

// Third-party due diligence (migrations 0009 and 0039).

export type RiskLevel = "low" | "medium" | "high";
export type CaseStatus = "open" | "cleared" | "cleared_with_conditions" | "rejected";
export type PartyKind = "third_party" | "customer";
export type YesNo = "yes" | "no" | "unknown";
export type Topic =
  | "abc" | "sanctions" | "modern_slavery" | "aml_kyc"
  | "pep" | "sip" | "official_lists" | "sanctions_ownership" | "state_owned" | "adverse_media"
  | "red_flag" | "enhanced" | "questionnaire";

export type PartyType =
  | "supplier" | "service_provider" | "distributor" | "sales_agent" | "process_agent" | "joint_venture"
  | "sub_contractor" | "research_partner" | "customer" | "donation_recipient" | "other";

export type Party = {
  id: string;
  name: string;
  kind: PartyKind;
  country: string | null;
  risk_rating: RiskLevel | null;
  dd_status: CaseStatus | null;
  next_review_on: string | null;
  party_type?: PartyType | null;
  registration_number?: string | null;
  website?: string | null;
  countries?: string[];
  description?: string | null;
  business_owner_user_id?: string | null;
  annual_value?: number | null;
  currency?: string;
};

export type DdCase = {
  id: string;
  counterparty_id: string;
  answers: Record<string, string | boolean | undefined>;
  risk_rating: RiskLevel;
  risk_reasons?: string[];
  status: CaseStatus;
  conditions: string | null;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
  trigger_reason?: string | null;
  requested_by?: string | null;
  target_on?: string | null;
  concerns?: string | null;
  escalation_note?: string | null;
  escalated_at?: string | null;
  final_decision?: "proceed" | "proceed_conditions" | "do_not_proceed" | null;
  final_decided_by_name?: string | null;
  final_decision_note?: string | null;
  final_decided_at?: string | null;
};

export type DdCheck = { id: string; case_id: string; topic: Topic; result: "pending" | "clear" | "concern"; notes: string | null };
export type Mitigation = { id: string; case_id: string; action: string; timing: "before" | "during"; owner_name: string | null; due_on: string | null; done_at: string | null; done_note: string | null };
export type Exemption = { id: string; counterparty_id: string; exemption: ExemptionKey; reason: string; evidence: string | null; recorded_by: string | null; created_at: string };

export type PartiesData = {
  parties: Party[];
  cases: DdCase[];
  checks: DdCheck[];
  mitigations: Mitigation[];
  exemptions: Exemption[];
  people: { user_id: string | null; full_name: string }[];
  /** Migration 0039 has been run */
  ready: boolean;
};

export const PARTY_TYPES: { id: PartyType; label: string; help: string }[] = [
  { id: "supplier", label: "Supplier or vendor", help: "Supplies goods, materials or parts" },
  { id: "service_provider", label: "Service provider", help: "Logistics, IT, marketing, professional or other services" },
  { id: "distributor", label: "Distributor", help: "Buys from us and resells" },
  { id: "sales_agent", label: "Sales agent or introducer", help: "Wins or negotiates business for us" },
  { id: "process_agent", label: "Process agent", help: "Obtains permits, licences, visas or customs clearance for us" },
  { id: "joint_venture", label: "Joint venture partner", help: "" },
  { id: "sub_contractor", label: "Sub-contractor", help: "Delivers 25% or more of a third party's services to us" },
  { id: "research_partner", label: "Research partner", help: "" },
  { id: "customer", label: "Customer", help: "" },
  { id: "donation_recipient", label: "Donation, sponsorship or grant recipient", help: "" },
  { id: "other", label: "Other", help: "" },
];
export const partyTypeLabel = (t: PartyType | null | undefined) => PARTY_TYPES.find((x) => x.id === t)?.label ?? null;

export const TRIGGERS = [
  "New third party",
  "New or renewed contract",
  "Change in the third party's name, services, structure or ownership",
  "Large engagement (over AUD 250,000 a year)",
  "Donation, sponsorship or grant",
  "Periodic review",
  "Existing third party never checked",
];

export type ExemptionKey =
  | "nda_only" | "temporary_worker" | "health_professional" | "government_charges" | "retailer_or_consumer"
  | "corporate_card" | "single_event" | "office_supplies" | "low_value_low_risk";
export const EXEMPTIONS: { id: ExemptionKey; label: string; note: string }[] = [
  { id: "nda_only", label: "A confidentiality agreement only", note: "Nothing else is being agreed. Any other engagement needs due diligence." },
  { id: "temporary_worker", label: "An individual temporary worker through an agency", note: "The agency itself still needs due diligence." },
  { id: "health_professional", label: "A health care professional engaged directly", note: "Follow the health care professional policy and keep the fair market value assessment." },
  { id: "government_charges", label: "Standard published government fees, taxes or charges", note: "For example a business licence fee." },
  { id: "retailer_or_consumer", label: "A retailer selling to consumers, or an end consumer", note: "" },
  { id: "corporate_card", label: "A purchase on a corporate card under the expenses policy", note: "" },
  { id: "single_event", label: "Hospitality, venue or catering for a single event", note: "In the ordinary course of the supplier's business." },
  { id: "office_supplies", label: "Office supplies under AUD 15,000 a year", note: "Does not cover IT equipment." },
  { id: "low_value_low_risk", label: "Under AUD 15,000 in total, in low corruption-risk countries only", note: "Every country involved scores 60 or more on the Transparency International Corruption Perceptions Index." },
];

export type Question = { key: string; text: string; help?: string; adverse: "yes" | "no"; weight: "high" | "medium" };
/** Mirrors app.dd_questions() in migration 0039 */
export const QUESTIONS: Question[] = [
  { key: "government_interaction", text: "Will they deal with government officials or state bodies for us?", help: "Licences, permits, customs, tenders, inspections, regulators.", adverse: "yes", weight: "high" },
  { key: "government_links", text: "Is the third party, or an owner, director or key employee, a government official, a politically exposed person, or state-owned or controlled?", adverse: "yes", weight: "high" },
  { key: "acts_on_our_behalf", text: "Will they act on our behalf?", help: "As an agent, distributor, introducer, consultant or lobbyist.", adverse: "yes", weight: "medium" },
  { key: "unusual_payment", text: "Have they asked for unusual payment terms?", help: "Cash, payment to another person or an offshore account, large upfront or success fees, unusually high commission.", adverse: "yes", weight: "high" },
  { key: "ownership_unclear", text: "Is the ownership unclear, or have they been reluctant to say who owns or controls them?", adverse: "yes", weight: "high" },
  { key: "adverse_history", text: "Do you know of any history of bribery, fraud, money laundering, sanctions breaches, regulatory action, significant litigation, insolvency, or human rights, labour or environmental issues?", adverse: "yes", weight: "high" },
  { key: "high_risk_sector", text: "Do they work in a higher-risk sector?", help: "Extractives, construction, defence, health care with professional or official contact, logistics and customs, telecoms, real estate, financial intermediaries.", adverse: "yes", weight: "medium" },
  { key: "large_value", text: "Is the expected value over AUD 250,000 a year?", adverse: "yes", weight: "medium" },
  { key: "sub_contractors", text: "Will they use sub-contractors for 25% or more of the work?", help: "They must tell us who, and those sub-contractors need due diligence too.", adverse: "yes", weight: "medium" },
  { key: "labour_risk", text: "Are there modern slavery risk indicators?", help: "Low-skilled, migrant or labour-hire workers, or a higher-risk country or sector.", adverse: "yes", weight: "medium" },
  { key: "has_compliance_policies", text: "Do they have their own code of conduct and anti-bribery policy?", adverse: "no", weight: "medium" },
];
export const COUNTRY_RISK: { id: "low" | "medium" | "high"; label: string }[] = [
  { id: "low", label: "Low: every country scores 60 or more" },
  { id: "medium", label: "Medium: lowest score 40 to 59" },
  { id: "high", label: "High: a country scores below 40" },
];

/** Mirrors app.dd_assess() so the form shows the rating as you answer */
export function assess(a: Record<string, string | undefined>): { level: RiskLevel; reasons: string[] } {
  let rank = 1;
  const reasons: string[] = [];
  const unknown: string[] = [];
  if (a.country_risk === "high") {
    rank = 3;
    reasons.push("Countries with a high corruption risk (CPI below 40)");
  } else if (a.country_risk === "medium") {
    rank = Math.max(rank, 2);
    reasons.push("Countries with a medium corruption risk (CPI 40 to 59)");
  } else if (a.country_risk !== "low") unknown.push("country corruption risk");
  for (const q of QUESTIONS) {
    const v = a[q.key];
    if (v !== "yes" && v !== "no") unknown.push(q.text.replace(/\?$/, "").toLowerCase());
    else if (v === q.adverse) {
      rank = Math.max(rank, q.weight === "high" ? 3 : 2);
      reasons.push(q.text.replace(/\?$/, ""));
    }
  }
  if (a.acts_on_our_behalf === "yes" && (a.country_risk === "medium" || a.country_risk === "high")) rank = 3;
  if (unknown.length) {
    rank = Math.max(rank, 2);
    reasons.push(`Not known: ${unknown.length} ${unknown.length === 1 ? "answer" : "answers"}`);
  }
  return { level: rank === 3 ? "high" : rank === 2 ? "medium" : "low", reasons };
}

export const TOPIC_LABELS: Record<Topic, string> = {
  abc: "Anti-bribery and corruption",
  sanctions: "Sanctions lists",
  modern_slavery: "Modern slavery",
  aml_kyc: "Customer identification (know your customer)",
  pep: "Politically exposed persons",
  sip: "Special interest persons",
  official_lists: "Other official lists (debarment, enforcement, watch lists)",
  sanctions_ownership: "Ownership or control by sanctioned persons",
  state_owned: "State ownership",
  adverse_media: "Adverse media",
  red_flag: "Red flag report",
  enhanced: "Enhanced due diligence report",
  questionnaire: "Questionnaire to the third party",
};
export const TOPIC_HELP: Partial<Record<Topic, string>> = {
  adverse_media: "Bribery, sanctions, money laundering, fraud, political links, regulatory breaches and litigation, human rights, labour and environmental issues.",
  red_flag: "Registration and nature of business, immediate owners, screening of owners and principals, adverse research including litigation and insolvency, local-language sources.",
  enhanced: "A deep-dive investigation by a specialist, across all jurisdictions and in the local language.",
  questionnaire: "Their compliance programme: code of conduct, anti-bribery and other policies, training, sub-contractors. Ask for copies.",
  sanctions: "For a full sanctions assessment use Contracts, Sanctions.",
};
export const STAGES: { label: string; topics: Topic[] }[] = [
  { label: "Basic screening", topics: ["pep", "sip", "sanctions", "sanctions_ownership", "state_owned", "official_lists", "adverse_media"] },
  { label: "Further checks", topics: ["aml_kyc", "modern_slavery", "abc", "red_flag", "enhanced", "questionnaire"] },
];
export const RISK_LABELS: Record<RiskLevel, string> = { low: "Low risk", medium: "Medium risk", high: "High risk" };
export const DD_LABELS: Record<CaseStatus, string> = {
  open: "Due diligence open",
  cleared: "Cleared",
  cleared_with_conditions: "Cleared with conditions",
  rejected: "Rejected",
};
export const FINAL_LABELS = { proceed: "Proceed", proceed_conditions: "Proceed with conditions", do_not_proceed: "Do not proceed" } as const;
export const KIND_LABELS: Record<PartyKind, string> = { third_party: "Third party", customer: "Customer" };

function db() {
  if (!supabase) throw new Error("The site is not connected to its database.");
  return supabase;
}

function check(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

export async function loadParties(organisationId: string): Promise<PartiesData> {
  const client = db();
  const [parties, cases, checks, people, mitigations, exemptions] = await Promise.all([
    client.from("counterparties").select("*").eq("organisation_id", organisationId).order("name"),
    client.from("dd_cases").select("*").eq("organisation_id", organisationId).order("created_at", { ascending: false }),
    client.from("dd_checks").select("id, case_id, topic, result, notes").eq("organisation_id", organisationId).order("created_at"),
    client.from("people").select("user_id, full_name").eq("organisation_id", organisationId),
    client.from("dd_mitigations").select("id, case_id, action, timing, owner_name, due_on, done_at, done_note").eq("organisation_id", organisationId).order("created_at"),
    client.from("dd_exemptions").select("id, counterparty_id, exemption, reason, evidence, recorded_by, created_at").eq("organisation_id", organisationId).order("created_at", { ascending: false }),
  ]);
  check(parties.error ?? cases.error ?? checks.error ?? people.error);
  return {
    parties: ((parties.data ?? []) as Party[]).map((p) => ({ ...p, annual_value: p.annual_value === null || p.annual_value === undefined ? null : Number(p.annual_value) })),
    cases: (cases.data ?? []) as DdCase[],
    checks: (checks.data ?? []) as DdCheck[],
    people: (people.data ?? []) as { user_id: string | null; full_name: string }[],
    mitigations: (mitigations.data ?? []) as Mitigation[],
    exemptions: (exemptions.data ?? []) as Exemption[],
    ready: !mitigations.error,
  };
}

export type PartyDetails = {
  name: string;
  party_type: PartyType | "";
  country: string;
  countries: string[];
  registration_number: string;
  website: string;
  description: string;
  business_owner_user_id: string;
  annual_value: string;
};

export async function requestDueDiligence(organisationId: string, partyId: string | null, details: PartyDetails, trigger: string, answers: Record<string, string>): Promise<string> {
  const { data, error } = await db().rpc("request_due_diligence", {
    p_org: organisationId,
    p_counterparty: partyId,
    p_party: { ...details, annual_value: details.annual_value.replace(/[,\s$]/g, "") },
    p_trigger: trigger,
    p_answers: answers,
  });
  check(error);
  // The new case's third party, so the page can open it
  const created = await db().from("dd_cases").select("counterparty_id").eq("id", data as string).maybeSingle();
  return (created.data?.counterparty_id as string | undefined) ?? partyId ?? "";
}

export async function recordExemption(organisationId: string, partyId: string | null, details: PartyDetails, exemption: ExemptionKey, reason: string, evidence: string) {
  const { error } = await db().rpc("record_dd_exemption", { p_org: organisationId, p_counterparty: partyId, p_party: details, p_exemption: exemption, p_reason: reason, p_evidence: evidence });
  check(error);
}

/** Before migration 0039: legal or compliance opens a case on an existing party */
export async function openCase(partyId: string, answers: Record<string, unknown>, topics: Topic[]) {
  check((await db().rpc("open_dd_case", { p_counterparty: partyId, p_answers: answers, p_topics: topics })).error);
}
export async function addParty(organisationId: string, name: string, kind: PartyKind, country: string): Promise<string> {
  const { data, error } = await db().from("counterparties").insert({ organisation_id: organisationId, name: name.trim(), kind, country: country.trim() || null }).select("id").single();
  check(error);
  return data!.id as string;
}

export async function saveCheck(checkId: string, result: DdCheck["result"], notes: string) {
  check((await db().from("dd_checks").update({ result, notes: notes.trim() || null }).eq("id", checkId)).error);
}
export async function decideCase(caseId: string, outcome: Exclude<CaseStatus, "open">, conditions: string) {
  check((await db().rpc("decide_dd_case", { p_case: caseId, p_outcome: outcome, p_conditions: conditions })).error);
}
export async function setConcerns(caseId: string, concerns: string) {
  check((await db().rpc("set_dd_concerns", { p_case: caseId, p_concerns: concerns })).error);
}
export async function addMitigation(caseId: string, action: string, timing: "before" | "during", owner: string, due: string) {
  check((await db().rpc("add_dd_mitigation", { p_case: caseId, p_action: action, p_timing: timing, p_owner: owner, p_due: due || null })).error);
}
export async function completeMitigation(id: string, note: string) {
  check((await db().rpc("complete_dd_mitigation", { p_mitigation: id, p_note: note })).error);
}
export async function escalateCase(caseId: string, note: string) {
  check((await db().rpc("escalate_dd_case", { p_case: caseId, p_note: note })).error);
}
export async function resolveEscalation(caseId: string, decision: keyof typeof FINAL_LABELS, decidedBy: string, note: string) {
  check((await db().rpc("resolve_dd_escalation", { p_case: caseId, p_decision: decision, p_decided_by: decidedBy, p_note: note })).error);
}

export type PartySummary = { total: number; highRisk: number; open: number; rejected: number };

/** For the overview. Reads as empty until the due diligence migration has been run. */
export async function loadPartySummary(organisationId: string): Promise<PartySummary> {
  const { data, error } = await db().from("counterparties").select("risk_rating, dd_status").eq("organisation_id", organisationId);
  if (error) return { total: 0, highRisk: 0, open: 0, rejected: 0 };
  const rows = (data ?? []) as { risk_rating: RiskLevel | null; dd_status: CaseStatus | null }[];
  return {
    total: rows.length,
    highRisk: rows.filter((r) => r.risk_rating === "high").length,
    open: rows.filter((r) => r.dd_status === "open").length,
    rejected: rows.filter((r) => r.dd_status === "rejected").length,
  };
}
