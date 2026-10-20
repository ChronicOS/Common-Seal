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

export type SubjectType = "entity" | "individual";
export type Party = {
  id: string;
  name: string;
  /** Migration 0061: an organisation or a person. Missing before then (treat as entity). */
  subject_type?: SubjectType;
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
  questionnaire: "Marked automatically when the third party returns its questionnaire: clear if nothing adverse is disclosed, otherwise a concern. Review the answers above.",
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

/** Database functions each update adds, so a missing one can be named in plain words */
const ADDED_BY: Record<string, string> = {
  dd_case_screen_targets: "0062", review_dd_screening_rest: "0063", dd_screening_target: "0061", review_dd_screening_hit: "0061", set_dd_subject_type: "0061",
};
function check(error: { message: string } | null) {
  if (!error) return;
  const missing = /Could not find the function public\.(\w+)/.exec(error.message);
  if (missing) {
    const n = ADDED_BY[missing[1]];
    throw new Error(`This needs the latest database update${n ? ` (migration ${n} and any after it)` : ""}. Run it in Supabase's SQL editor, then reload this page.`);
  }
  throw new Error(error.message);
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
  /** Migration 0061 */
  subject_type?: SubjectType;
  date_of_birth?: string;
  gender?: "male" | "female" | "";
  citizenship?: string;
  role_title?: string;
  employer?: string;
};

export async function requestDueDiligence(organisationId: string, partyId: string | null, details: PartyDetails, trigger: string, answers: Record<string, string>): Promise<{ partyId: string; caseId: string }> {
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
  return { partyId: (created.data?.counterparty_id as string | undefined) ?? partyId ?? "", caseId: data as string };
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

// ---- Questionnaire to the third party (migration 0042) ----
export type YesNoDetails = { answer: "yes" | "no" | ""; details: string };
export type QAnswers = {
  company: { legal_name: string; registration_number: string; incorporated_on: string; registered_address: string; website: string; is_corporation: "yes" | "no" | "" };
  officers: { name: string; role: string; appointed_on: string }[];
  shareholders: { name: string; percent: string }[];
  litigation: YesNoDetails;
  insolvency: YesNoDetails;
  press: YesNoDetails;
  licences: { confirmed: "yes" | "no" | ""; details: string; items: { name: string; number: string; issuer: string; expires_on: string }[] };
  connections: YesNoDetails;
  government: YesNoDetails;
  sanctions: YesNoDetails;
  ubos: { name: string; percent: string; via: string }[];
  ubo_none: string;
  bank: { country: string; own_name: "yes" | "no" | ""; details: string };
  trading_names: string;
  sub_contractors: YesNoDetails;
  data: { answer: "yes" | "no" | ""; details: string; security: "yes" | "no" | "" };
  /** Agents and introducers only */
  compensation?: { basis: string; rate: string; details: string };
  abc_policy?: { answer: "yes" | "no" | "" };
  declaration: { agreed: string; signed_name: string; position: string };
};
export type Upload = { path: string; kind: "company_extract" | "licence" | "insurance" | "policy" | "training" | "other"; file_name: string };
export const UPLOAD_KINDS: { id: Upload["kind"]; label: string }[] = [
  { id: "company_extract", label: "Current company extract or registration certificate" },
  { id: "licence", label: "Licence, permit or membership" },
  { id: "insurance", label: "Certificate of insurance" },
  { id: "policy", label: "Code of conduct or anti-corruption policy" },
  { id: "training", label: "Training materials" },
  { id: "other", label: "Other" },
];
export type Questionnaire = { id: string; case_id: string; contact_name: string | null; contact_email: string | null; status: "sent" | "submitted" | "cancelled"; sent_at: string | null; opened_at: string | null; submitted_at: string | null; answers: QAnswers | QAnswers2 | null; form?: number };
export type PublicQuestionnaire = { form?: number; organisation: string; party_name: string; party_type: PartyType | null; uploads: Upload[]; country: string | null; countries: string[] | null; registration_number: string | null; website: string | null; description: string | null; contact_name: string | null; submitted_at: string | null; answers: QAnswers | null };

export const Q_TEXT = {
  litigation: "Is the company, or any of its directors, involved in any active or threatened litigation, arbitration or regulatory proceedings?",
  insolvency: "Has the company, or any of its directors, been insolvent, bankrupt, or in administration, receivership or liquidation, or entered a scheme with creditors, in the last ten years?",
  press: "Has there been any press or media coverage alleging wrongdoing by the company or any of its directors (for example bribery, fraud, sanctions, money laundering, human rights, labour or environmental issues)?",
  licences: "Does the company hold all the licences, authorisations, permits, registrations and professional memberships it needs to operate its business in the jurisdictions where it proposes to work with us?",
  connections: "Is any director, shareholder or employee of the company related to, or in business with, anyone who works for us or sits on our board?",
  government: "Is any director, shareholder or owner a government official or politically exposed person (or a close family member or associate of one), or is the company owned or controlled by a government?",
  sanctions: "Is the company, or any of its owners or directors, on a sanctions list, or does the company do business in or with countries subject to sanctions?",
  sub_contractors: "Will you use sub-contractors for any of the work you do for us?",
  data: "Will you handle personal information for us, or have access to our IT systems?",
  security: "Do you have written privacy and information security policies, and will you tell us promptly of any data breach affecting us?",
  abc_policy: "Do you have a written anti-bribery and corruption policy that your staff follow?",
};
export const AGENT_TYPES: PartyType[] = ["sales_agent", "process_agent"];

export const blankQAnswers = (p?: { party_name?: string; registration_number?: string | null; website?: string | null }): QAnswers => ({
  company: { legal_name: p?.party_name ?? "", registration_number: p?.registration_number ?? "", incorporated_on: "", registered_address: "", website: p?.website ?? "", is_corporation: "" },
  officers: [{ name: "", role: "Director", appointed_on: "" }],
  shareholders: [{ name: "", percent: "" }],
  litigation: { answer: "", details: "" },
  insolvency: { answer: "", details: "" },
  press: { answer: "", details: "" },
  licences: { confirmed: "", details: "", items: [{ name: "", number: "", issuer: "", expires_on: "" }] },
  connections: { answer: "", details: "" },
  government: { answer: "", details: "" },
  sanctions: { answer: "", details: "" },
  ubos: [{ name: "", percent: "", via: "" }],
  ubo_none: "",
  bank: { country: "", own_name: "", details: "" },
  trading_names: "",
  sub_contractors: { answer: "", details: "" },
  data: { answer: "", details: "", security: "" },
  compensation: { basis: "", rate: "", details: "" },
  abc_policy: { answer: "" },
  declaration: { agreed: "", signed_name: "", position: "" },
});

export async function loadQuestionnaires(organisationId: string): Promise<Questionnaire[]> {
  const client = db();
  const read = (cols: string) => client.from("dd_questionnaires").select(cols).eq("organisation_id", organisationId).order("created_at", { ascending: false });
  let { data, error } = await read("id, case_id, contact_name, contact_email, status, sent_at, opened_at, submitted_at, answers, form");
  // Before migration 0062 there is no form column
  if (error) ({ data, error } = await read("id, case_id, contact_name, contact_email, status, sent_at, opened_at, submitted_at, answers"));
  if (error) return [];
  return (data ?? []) as unknown as Questionnaire[];
}
export async function sendQuestionnaire(caseId: string, name: string, email: string): Promise<string> {
  const { data, error } = await db().rpc("send_dd_questionnaire", { p_case: caseId, p_contact_name: name, p_contact_email: email });
  check(error);
  return data as string;
}
export async function questionnaireLink(caseId: string): Promise<string | null> {
  const { data, error } = await db().rpc("dd_questionnaire_link", { p_case: caseId });
  if (error) return null;
  return (data as string | null) ?? null;
}
export async function cancelQuestionnaire(id: string) {
  check((await db().rpc("cancel_dd_questionnaire", { p_questionnaire: id })).error);
}
export async function openPublicQuestionnaire(token: string): Promise<PublicQuestionnaire> {
  const { data, error } = await db().rpc("dd_questionnaire", { p_token: token });
  check(error);
  return data as PublicQuestionnaire;
}
/** Empty rows are dropped before sending */
export async function submitPublicQuestionnaire(token: string, a: QAnswers) {
  const clean: QAnswers = {
    ...a,
    officers: a.officers.filter((o) => o.name.trim()),
    shareholders: a.company.is_corporation === "yes" ? a.shareholders.filter((s) => s.name.trim()) : [],
    licences: { ...a.licences, items: a.licences.items.filter((i) => i.name.trim()) },
    ubos: a.company.is_corporation === "yes" && a.ubo_none !== "true" ? a.ubos.filter((u) => u.name.trim()) : [],
  };
  check((await db().rpc("submit_dd_questionnaire", { p_token: token, p_answers: clean })).error);
}
/** Form 2: empty rows are dropped before sending */
export async function submitQuestionnaire2(token: string, a: QAnswers2) {
  const clean: QAnswers2 = {
    ...a,
    owners: a.owners.filter((o) => o.name.trim()).map((o) => ({ ...o, percent: o.percent.trim(), dob: o.type === "individual" ? o.dob : "" })),
    officers: a.officers.filter((o) => o.name.trim()),
    management: a.management.filter((o) => o.name.trim()),
  };
  check((await db().rpc("submit_dd_questionnaire", { p_token: token, p_answers: clean })).error);
}

/** The third party uploads a file: a slot is registered first, then the file is stored at its path */
export async function uploadForQuestionnaire(token: string, kind: Upload["kind"], file: File): Promise<string> {
  if (file.size > 10 * 1024 * 1024) throw new Error("Files can be up to 10 MB.");
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  const sha = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const { data, error } = await db().rpc("register_dd_upload", { p_token: token, p_kind: kind, p_file_name: file.name, p_mime: file.type, p_size: file.size, p_sha256: sha });
  check(error);
  const path = data as string;
  const stored = await db().storage.from("documents").upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (stored.error) {
    await db().rpc("remove_dd_upload", { p_token: token, p_path: path });
    throw new Error(`The file could not be stored: ${stored.error.message}`);
  }
  return path;
}
export async function removeQuestionnaireUpload(token: string, path: string) {
  check((await db().rpc("remove_dd_upload", { p_token: token, p_path: path })).error);
}

// ---------------------------------------------------------------------
// Individuals and screening (migration 0061)
// ---------------------------------------------------------------------
export const subjectOf = (p: Pick<Party, "subject_type">): SubjectType => (p.subject_type === "individual" ? "individual" : "entity");

/** The kinds of engagement that make sense for a person engaged directly */
export const INDIVIDUAL_TYPES: { id: PartyType; label: string }[] = [
  { id: "service_provider", label: "Consultant, contractor or adviser" },
  { id: "sales_agent", label: "Sales agent, introducer or finder" },
  { id: "process_agent", label: "Agent for permits, licences, visas or customs" },
  { id: "research_partner", label: "Researcher or academic" },
  { id: "donation_recipient", label: "Recipient of a donation, sponsorship or grant" },
  { id: "customer", label: "Customer" },
  { id: "other", label: "Other" },
];

/** Mirrors app.dd_individual_questions() */
export const INDIVIDUAL_QUESTIONS: Question[] = [
  { key: "ind_official", text: "Is the person a government official or politically exposed person, or a close relative or associate of one?", help: "Includes employees of state-owned businesses, public hospitals and universities, and party officials.", adverse: "yes", weight: "high" },
  { key: "ind_dealings_officials", text: "Will they deal with government officials for us?", help: "Licences, permits, customs, tenders, inspections, regulators.", adverse: "yes", weight: "high" },
  { key: "ind_unusual_payment", text: "Have they asked for unusual payment terms?", help: "Cash, payment to another person or an offshore account, large upfront or success fees.", adverse: "yes", weight: "high" },
  { key: "ind_adverse", text: "Do you know of any history of fraud, bribery, sanctions issues, insolvency or criminal matters?", adverse: "yes", weight: "high" },
  { key: "ind_connections", text: "Are they related to, or were they recommended by, someone in our organisation, a customer or an official?", adverse: "yes", weight: "medium" },
  { key: "ind_qualified", text: "Have you confirmed they hold the qualifications or licences the work needs?", adverse: "no", weight: "medium" },
];

/** Mirrors the individual branch of app.dd_assess() so the form shows the rating as you answer */
export function assessIndividual(a: Record<string, string | undefined>, partyType: string): { level: RiskLevel; reasons: string[] } {
  let rank = partyType === "sales_agent" || partyType === "process_agent" ? 3 : partyType === "donation_recipient" ? 2 : 1;
  const reasons: string[] = rank === 3 ? ["Acts for us with customers or officials (agent)"] : rank === 2 ? ["Type of engagement carries more risk"] : [];
  const unknown: string[] = [];
  if (a.country_risk === "high") {
    rank = 3;
    reasons.push("Works in countries with a high corruption risk (CPI below 40)");
  } else if (a.country_risk === "medium") {
    rank = Math.max(rank, 2);
    reasons.push("Works in countries with a medium corruption risk (CPI 40 to 59)");
  } else if (a.country_risk !== "low") unknown.push("country corruption risk");
  for (const q of INDIVIDUAL_QUESTIONS) {
    const v = a[q.key];
    if (v !== "yes" && v !== "no") unknown.push(q.key);
    else if (v === q.adverse) {
      rank = Math.max(rank, q.weight === "high" ? 3 : 2);
      reasons.push(q.text.replace(/\?$/, ""));
    }
  }
  if (unknown.length) {
    rank = Math.max(rank, 2);
    reasons.push(`Not known: ${unknown.length} ${unknown.length === 1 ? "answer" : "answers"}`);
  }
  return { level: rank === 3 ? "high" : rank === 2 ? "medium" : "low", reasons };
}

export type IndividualDetails = { counterparty_id: string; date_of_birth: string | null; gender: "male" | "female" | null; citizenship: string | null; role_title: string | null; employer: string | null };
export async function loadIndividual(partyId: string): Promise<IndividualDetails | null> {
  const { data, error } = await db().from("dd_individual_details").select("counterparty_id, date_of_birth, gender, citizenship, role_title, employer").eq("counterparty_id", partyId).maybeSingle();
  return error ? null : ((data as IndividualDetails | null) ?? null);
}
export async function saveIndividual(organisationId: string, partyId: string, d: Omit<IndividualDetails, "counterparty_id">) {
  const row = { counterparty_id: partyId, organisation_id: organisationId, ...d, citizenship: d.citizenship ? d.citizenship.trim().toUpperCase() : null };
  check((await db().from("dd_individual_details").upsert(row, { onConflict: "counterparty_id" })).error);
}
export async function setSubjectType(partyId: string, type: SubjectType) {
  check((await db().rpc("set_dd_subject_type", { p_party: partyId, p_type: type })).error);
}

export type ScreeningHit = {
  id: string;
  name?: string;
  source_type?: string;
  source_id?: string;
  pep_type?: string;
  entity_type?: string;
  gender?: string;
  alias_names?: string[];
  date_of_birth?: string[];
  place_of_birth?: string[];
  citizenship?: string[];
  positions?: string[];
  sanction_details?: string[];
  description?: string[];
  address?: string[];
  links?: string[];
  jurisdiction?: string[] | string;
  company_number?: string[] | string;
};
export type HitReview = { decision: "match" | "not_a_match"; note: string; by: string; by_name: string | null; at: string };
export type Screening = {
  id: string;
  counterparty_id: string;
  case_id: string | null;
  provider: string;
  subject_type: SubjectType;
  query: Record<string, string | number>;
  total_hits: number;
  hits: ScreeningHit[];
  reviews: Record<string, HitReview>;
  outcome: "no_matches" | "to_review" | "cleared" | "match";
  screened_by: string | null;
  screened_at: string;
  /** Migration 0062: who in the case this screening was for */
  subject_key?: string;
  subject_name?: string | null;
  subject_role?: string | null;
  declared_pep?: boolean;
  /** Migration 0063: "lists" (sanctions, PEP, watch lists) or "media" (adverse media) */
  kind?: "lists" | "media";
};
/** An adverse media finding (stored as a screening "hit") */
export type MediaFinding = { id: string; source: "dilisense" | "claude"; category: string; headline: string; summary: string; url: string; publisher?: string; published?: string; language?: string; same_subject?: string };
export const MEDIA_CATEGORY_LABELS: Record<string, string> = {
  bribery_corruption: "Bribery or corruption", fraud: "Fraud", financial_crime: "Financial crime", sanctions: "Sanctions", regulatory: "Regulatory action",
  litigation_insolvency: "Litigation or insolvency", human_rights_environment: "Human rights, labour or environment", organized_crime: "Organised crime",
  violent_crime: "Violent crime", terrorism: "Terrorism", political: "Political", other: "Other",
};
export const SOURCE_LABELS: Record<string, string> = {
  SANCTION: "Sanctions list",
  PEP: "Politically exposed person",
  CRIMINAL: "Criminal or law enforcement list",
  NON_COMPLIANT_TAXPAYER: "Non-compliant taxpayer",
  OTHER: "Other watch list",
};
export const OUTCOME_LABELS: Record<Screening["outcome"], string> = {
  no_matches: "No possible matches",
  to_review: "Possible matches to review",
  cleared: "Reviewed: no match",
  match: "Confirmed match",
};

/** Null until migration 0061 has been run */
export async function loadScreenings(organisationId: string): Promise<Screening[] | null> {
  const { data, error } = await db().from("dd_screenings").select("*").eq("organisation_id", organisationId).order("screened_at", { ascending: false });
  return error ? null : (data as Screening[]);
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await db().functions.invoke("screen-party", { body });
  if (error) {
    // The function explains itself in the response body
    let message = error.message;
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.json === "function") message = ((await ctx.json()) as { error?: string }).error ?? message;
    } catch {
      // keep the general message
    }
    if (/Failed to send a request|FunctionsFetchError|not found/i.test(message)) message = "Screening is not set up yet: the screen-party function has not been deployed (see the README).";
    throw new Error(message);
  }
  return data as T;
}
export type ScreeningStatus = { configured: boolean; claude?: boolean; provider?: string; usage?: Record<string, number> | null };
export async function screeningStatus(): Promise<ScreeningStatus | null> {
  try {
    return await invoke<ScreeningStatus>({ action: "status" });
  } catch {
    return null;
  }
}
export async function screenParty(partyId: string, fuzzy: boolean): Promise<{ screening_id: string; total_hits: number; shown: number }> {
  return invoke({ action: "screen", party_id: partyId, fuzzy });
}
/** The provider's PDF report, as a file ready to attach */
export async function screeningReport(screening: Screening, partyName: string): Promise<File> {
  const r = await invoke<{ pdf_base64: string }>({ action: "report", screening_id: screening.id });
  const bin = atob(r.pdf_base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const day = new Date(screening.screened_at).toLocaleDateString("en-CA");
  return new File([bytes], `Screening report - ${partyName.replace(/[^\w .-]/g, "")} - ${day}.pdf`, { type: "application/pdf" });
}
export async function reviewHit(screeningId: string, recordId: string, decision: "match" | "not_a_match" | "undo", note: string): Promise<string> {
  const { data, error } = await db().rpc("review_dd_screening_hit", { p_screening: screeningId, p_record: recordId, p_decision: decision, p_note: note });
  check(error);
  return data as string;
}

// ---------------------------------------------------------------------
// The questionnaire, version 2 (migration 0062)
// ---------------------------------------------------------------------
export type YN = "yes" | "no" | "";
export type Owner2 = { name: string; type: "individual" | "company" | "government" | ""; percent: string; government: YN; country: string; dob: string };
export type Person2 = { name: string; position: string; country: string; dob: string };
export type Manager2 = { name: string; title: string; country: string; dob: string };
export type QAnswers2 = {
  form?: 2;
  business: { legal_name: string; website: string; countries: string; employees: string; years: string };
  contact: { name: string; phone: string; email: string; alt_email: string; address: string };
  owners: Owner2[];
  officers: Person2[];
  management: Manager2[];
  services: { description: string };
  gov_interaction: YesNoDetails;
  sub_contractors: YesNoDetails;
  record: YesNoDetails;
  government: YesNoDetails & { people: string[] };
  framework: { code: YN; training: YN; cannot_upload: string };
  declaration: { agreed: string; signed_name: string; title: string; signed_on?: string };
};
export const isForm2 = (a: unknown): a is QAnswers2 => Boolean(a && typeof a === "object" && "business" in (a as object));

export const Q2_TEXT = {
  gov_interaction: "Will your services involve dealing with government officials or agencies, or with regulated individuals such as financial advisers, health care professionals or lawyers?",
  sub_contractors: "Do you use, or propose to use, sub-contractors to provide the services?",
  record: 'Has your business, or any of its shareholders, office holders or management personnel ("key personnel"), ever been the subject of an investigation, legal proceedings or sanctions relating to compliance issues (including corruption or fraud)?',
  government: "Are any of your key personnel, or their family members, government officials, otherwise closely related to government officials, or have they formerly held positions as a government official?",
  code: "Do you have a written code of conduct, anti-corruption policy or similar policies?",
  training: "Are your personnel trained on these policies?",
};
export const attestation = (organisation: string) =>
  `By signing below, I affirm that the information submitted on this form and in any attachments is, to the best of my knowledge, accurate and complete, and I authorise ${organisation} to take such steps as it may require to verify the information provided. I have the requisite authority to sign this document in my or our capacity, or as authorised representative of my or our organisation (as applicable).`;

export const blankOwner = (): Owner2 => ({ name: "", type: "", percent: "", government: "", country: "", dob: "" });
export const blankQAnswers2 = (p?: { party_name?: string; website?: string | null; countries?: string[] | null; contact_name?: string | null }): QAnswers2 => ({
  business: { legal_name: p?.party_name ?? "", website: p?.website ?? "", countries: (p?.countries ?? []).join(", "), employees: "", years: "" },
  contact: { name: p?.contact_name ?? "", phone: "", email: "", alt_email: "", address: "" },
  owners: [blankOwner()],
  officers: [{ name: "", position: "Director", country: "", dob: "" }],
  management: [{ name: "", title: "", country: "", dob: "" }],
  services: { description: "" },
  gov_interaction: { answer: "", details: "" },
  sub_contractors: { answer: "", details: "" },
  record: { answer: "", details: "" },
  government: { answer: "", details: "", people: [] },
  framework: { code: "", training: "", cannot_upload: "" },
  declaration: { agreed: "", signed_name: "", title: "" },
});

/** Screens the third party and everyone its returned questionnaire names */
export async function screenCase(caseId: string, fuzzy: boolean): Promise<{ subjects: number; total_hits: number; skipped: number }> {
  return invoke({ action: "screen_case", case_id: caseId, fuzzy });
}

// ---------------------------------------------------------------------
// Adverse media (migration 0063)
// ---------------------------------------------------------------------
export type CaseTarget = { key: string; name: string; subject_type: SubjectType; role: string | null; declared_pep: boolean };
/** Who a case's searches cover: the third party, and everyone its returned questionnaire names */
export async function loadCaseTargets(caseId: string): Promise<CaseTarget[]> {
  const { data, error } = await db().rpc("dd_case_screen_targets", { p_case: caseId });
  check(error);
  return ((data as { targets?: CaseTarget[] } | null)?.targets ?? []) as CaseTarget[];
}
export async function mediaSearch(partyId: string, caseId: string | null, subjectKey: string): Promise<{ findings: number; sources: string; warnings: string[] }> {
  return invoke({ action: "media", party_id: partyId, case_id: caseId, subject_key: subjectKey });
}
export async function reviewRest(screeningId: string, note: string): Promise<string> {
  const { data, error } = await db().rpc("review_dd_screening_rest", { p_screening: screeningId, p_note: note });
  check(error);
  return data as string;
}
