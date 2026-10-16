import { supabase } from "./supabase";

// Sanctions assessments (migration 0038).

export type Level = "stop" | "high" | "medium" | "low" | "incomplete";
export type Status = "draft" | "submitted" | "decided" | "withdrawn";
export type Outcome = "proceed" | "proceed_conditions" | "licence_required" | "do_not_proceed";
export type Result = "no_match" | "potential_match" | "confirmed_match";
export type Answer = "yes" | "no" | "unknown";
export type CountryLevel = "comprehensive" | "extensive" | "targeted";

export type Assessment = {
  id: string;
  counterparty_id: string | null;
  contract_id: string | null;
  entity_id: string | null;
  subject_name: string;
  subject_type: "company" | "individual" | "vessel" | "other";
  description: string | null;
  countries: string[];
  screened_on: string | null;
  screened_by: string | null;
  screening_tool: string | null;
  lists_checked: string[];
  persons_screened: string | null;
  screening_result: Result | null;
  screening_notes: string | null;
  answers: Record<string, Answer>;
  risk_level: Level;
  risk_reasons: string[];
  status: Status;
  submitted_at: string | null;
  outcome: Outcome | null;
  conditions: string | null;
  decision_note: string | null;
  decided_by: string | null;
  decided_at: string | null;
  licence_reference: string | null;
  licence_expires_on: string | null;
  next_screen_on: string | null;
  previous_id: string | null;
  created_by: string | null;
  created_at: string;
};
export type AssessmentValues = Pick<
  Assessment,
  "counterparty_id" | "contract_id" | "entity_id" | "subject_name" | "subject_type" | "description" | "countries" | "screened_on" | "screened_by" | "screening_tool" | "lists_checked" | "persons_screened" | "screening_result" | "screening_notes" | "answers"
>;
export type Country = { id: string; country: string; level: CountryLevel; regimes: string | null; notes: string | null; updated_at: string };

export const LEVEL_LABELS: Record<Level, string> = { stop: "Stop", high: "High risk", medium: "Medium risk", low: "Low risk", incomplete: "Incomplete" };
export const STATUS_LABELS: Record<Status, string> = { draft: "Draft", submitted: "Awaiting decision", decided: "Decided", withdrawn: "Withdrawn" };
export const OUTCOME_LABELS: Record<Outcome, string> = {
  proceed: "Proceed",
  proceed_conditions: "Proceed with conditions",
  licence_required: "Permit or licence required",
  do_not_proceed: "Do not proceed",
};
export const RESULT_LABELS: Record<Result, string> = { no_match: "No match", potential_match: "Potential match, not yet ruled out", confirmed_match: "Confirmed match" };
export const COUNTRY_LEVELS: Record<CountryLevel, string> = { comprehensive: "Comprehensive", extensive: "Extensive", targeted: "Targeted" };
export const SUBJECT_TYPES = { company: "Company or organisation", individual: "Individual", vessel: "Vessel or aircraft", other: "Other" } as const;

export const LISTS = [
  "DFAT Consolidated List (Australia)",
  "UN Security Council Consolidated List",
  "OFAC SDN and other US lists",
  "UK Sanctions List",
  "EU Consolidated Financial Sanctions List",
];
export const SOURCES: { label: string; url: string }[] = [
  { label: "DFAT Consolidated List", url: "https://www.dfat.gov.au/international-relations/security/sanctions/consolidated-list" },
  { label: "Australian sanctions regimes (DFAT)", url: "https://www.dfat.gov.au/international-relations/security/sanctions/sanctions-regimes-currently-implemented-under-australian-sanction-law" },
  { label: "OFAC Sanctions List Search (US)", url: "https://ofac.treasury.gov/sanctions-list-search-tool" },
  { label: "UK Sanctions List", url: "https://www.gov.uk/government/publications/the-uk-sanctions-list" },
  { label: "EU Sanctions Map", url: "https://www.sanctionsmap.eu/" },
];

export type Question = { key: string; text: string; help?: string; adverse: "yes" | "no"; label: string };
/** Mirrors app.sanctions_questions() and the labels in app.rate_sanctions() */
export const QUESTIONS: Question[] = [
  { key: "owned_controlled", label: "ownership or control", adverse: "yes", text: "Is the party owned or controlled by a government, or by anyone in a listed country?", help: "Include owners of 50% or more, alone or together, and anyone who controls it." },
  { key: "military_dual_use", label: "military or dual-use goods", adverse: "yes", text: "Does it involve military, dual-use or export-controlled goods, software or technology?", help: "For example items on the Defence and Strategic Goods List." },
  { key: "restricted_sector", label: "sanctioned sectors", adverse: "yes", text: "Does it involve a commonly sanctioned sector?", help: "Energy, oil and gas, mining and metals, financial services, shipping, defence, advanced technology, luxury goods." },
  { key: "end_use_known", label: "end user and end use", adverse: "no", text: "Do we know who the end user is and what the end use will be?" },
  { key: "transshipment", label: "re-export or transshipment", adverse: "yes", text: "Could the goods be re-exported, or pass through another country on the way?" },
  { key: "us_nexus", label: "US connection", adverse: "yes", text: "Is there a US connection?", help: "US dollar payments, US people or companies involved, or US-origin goods, software or technology." },
  { key: "eu_uk_nexus", label: "UK or EU connection", adverse: "yes", text: "Is there a UK or EU connection?", help: "UK or EU companies, staff, banks or goods." },
  { key: "red_flags", label: "red flags", adverse: "yes", text: "Are there any red flags?", help: "Unusual payment routes or third-party payers, reluctance to share ownership or end-use information, unusual shipping routes, prices or terms." },
  { key: "contract_clause", label: "sanctions clause", adverse: "no", text: "Will the contract include a sanctions clause?", help: "A compliance warranty and a right to suspend or end the contract." },
];

/** Mirrors app.rate_sanctions() so the form shows the result as you answer */
export function rate(v: AssessmentValues, countries: Country[], todayIso: string): { level: Level; reasons: string[] } {
  let rank = 1;
  const reasons: string[] = [];
  const missing: string[] = [];
  const a = v.answers ?? {};
  if (!v.screening_result) missing.push("not screened");
  else if (v.screening_result === "confirmed_match") {
    rank = 4;
    reasons.push("Screening found a confirmed match on a sanctions list");
  } else if (v.screening_result === "potential_match") {
    rank = Math.max(rank, 3);
    reasons.push("Screening found a potential match that has not been ruled out");
  }
  if (v.screening_result && v.screened_on) {
    const days = Math.round((new Date(`${todayIso}T00:00:00`).getTime() - new Date(`${v.screened_on}T00:00:00`).getTime()) / 86_400_000);
    if (days > 30) reasons.push(`Screening is ${days} days old`);
  }
  if (v.screening_result && v.lists_checked.length === 0) missing.push("lists checked not recorded");
  const names = v.countries.map((c) => c.trim().toLowerCase()).filter(Boolean);
  if (!names.length) missing.push("countries not recorded");
  let listed = false;
  let serious = false;
  for (const c of countries.filter((x) => names.includes(x.country.toLowerCase()))) {
    listed = true;
    if (c.level !== "targeted") serious = true;
    if (c.level === "comprehensive") {
      rank = 4;
      reasons.push(`${c.country}: comprehensive sanctions`);
    } else if (c.level === "extensive") {
      rank = Math.max(rank, 3);
      reasons.push(`${c.country}: extensive sanctions`);
    } else {
      rank = Math.max(rank, 2);
      reasons.push(`${c.country}: targeted sanctions`);
    }
  }
  for (const q of QUESTIONS) if (a[q.key] !== "yes" && a[q.key] !== "no") missing.push(`${q.label} not known`);
  if (a.military_dual_use === "yes") { rank = Math.max(rank, 3); reasons.push("Military, dual-use or export-controlled items"); }
  if (a.red_flags === "yes") { rank = Math.max(rank, 3); reasons.push("Red flags noted"); }
  if (a.owned_controlled === "yes") { rank = Math.max(rank, serious ? 3 : 2); reasons.push(`Owned or controlled by a government or by people in a listed country${listed ? ", with a listed country involved" : ""}`); }
  if (a.us_nexus === "yes" && listed) { rank = Math.max(rank, serious ? 3 : 2); reasons.push("US connection with a listed country involved"); }
  if (a.eu_uk_nexus === "yes" && listed) { rank = Math.max(rank, 2); reasons.push("UK or EU connection with a listed country involved"); }
  if (a.restricted_sector === "yes") { rank = Math.max(rank, 2); reasons.push("Sanctioned sector"); }
  if (a.transshipment === "yes") { rank = Math.max(rank, 2); reasons.push("Re-export or transshipment possible"); }
  if (a.end_use_known === "no") { rank = Math.max(rank, 2); reasons.push("End user or end use not known"); }
  if (a.contract_clause === "no") { rank = Math.max(rank, 2); reasons.push("No sanctions clause in the contract"); }
  if (missing.length) reasons.push(`Missing: ${missing.join(", ")}`);
  const level: Level = rank === 4 ? "stop" : rank === 3 ? "high" : missing.length ? "incomplete" : rank === 2 ? "medium" : "low";
  return { level, reasons };
}

export const blankValues = (): AssessmentValues => ({
  counterparty_id: null, contract_id: null, entity_id: null, subject_name: "", subject_type: "company", description: null, countries: [],
  screened_on: null, screened_by: null, screening_tool: null, lists_checked: [], persons_screened: null, screening_result: null, screening_notes: null, answers: {},
});

function db() {
  if (!supabase) throw new Error("The site is not connected to its database.");
  return supabase;
}
function check(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

export type SanctionsData = {
  ready: boolean;
  assessments: Assessment[];
  countries: Country[];
  parties: { id: string; name: string; country: string | null }[];
  contracts: { id: string; title: string; counterparty_id: string | null; status: string; entity_id: string }[];
  people: { user_id: string | null; full_name: string }[];
};

export async function loadSanctions(organisationId: string): Promise<SanctionsData> {
  const client = db();
  // The starter country list is added the first time anyone opens Sanctions
  const seeded = await client.rpc("ensure_sanctions_countries", { p_org: organisationId });
  const [assessments, countries, parties, contracts, people] = await Promise.all([
    client.from("sanctions_assessments").select("*").eq("organisation_id", organisationId).order("created_at", { ascending: false }),
    client.from("sanctions_countries").select("id, country, level, regimes, notes, updated_at").eq("organisation_id", organisationId).order("country"),
    client.from("counterparties").select("id, name, country").eq("organisation_id", organisationId).order("name"),
    client.from("contracts").select("id, title, counterparty_id, status, entity_id").eq("organisation_id", organisationId).order("title"),
    client.from("people").select("user_id, full_name").eq("organisation_id", organisationId),
  ]);
  if (seeded.error && assessments.error) return { ready: false, assessments: [], countries: [], parties: [], contracts: [], people: [] };
  check(assessments.error ?? countries.error);
  return {
    ready: true,
    assessments: (assessments.data ?? []) as Assessment[],
    countries: (countries.data ?? []) as Country[],
    parties: (parties.data ?? []) as SanctionsData["parties"],
    contracts: (contracts.data ?? []) as SanctionsData["contracts"],
    people: (people.data ?? []) as SanctionsData["people"],
  };
}

const tidy = (v: AssessmentValues) => ({
  ...v,
  subject_name: v.subject_name.trim(),
  description: v.description?.trim() || null,
  countries: v.countries.map((c) => c.trim()).filter(Boolean),
  screened_on: v.screened_on || null,
  screened_by: v.screened_by?.trim() || null,
  screening_tool: v.screening_tool?.trim() || null,
  persons_screened: v.persons_screened?.trim() || null,
  screening_notes: v.screening_notes?.trim() || null,
});
export async function saveAssessment(organisationId: string, id: string | null, v: AssessmentValues, previousId: string | null = null): Promise<string> {
  if (id) {
    check((await db().from("sanctions_assessments").update(tidy(v)).eq("id", id)).error);
    return id;
  }
  const { data, error } = await db().from("sanctions_assessments").insert({ ...tidy(v), organisation_id: organisationId, previous_id: previousId }).select("id").single();
  check(error);
  return data!.id as string;
}
export async function submitAssessment(id: string): Promise<Level> {
  const { data, error } = await db().rpc("submit_sanctions", { p_assessment: id });
  check(error);
  return data as Level;
}
export async function decideAssessment(id: string, outcome: Outcome, conditions: string, note: string, nextScreenOn: string) {
  check((await db().rpc("decide_sanctions", { p_assessment: id, p_outcome: outcome, p_conditions: conditions, p_note: note, p_next_screen_on: nextScreenOn || null })).error);
}
export async function recordLicence(id: string, reference: string, expiresOn: string) {
  check((await db().rpc("record_sanctions_licence", { p_assessment: id, p_reference: reference, p_expires_on: expiresOn || null })).error);
}
export async function reopenAssessment(id: string, withdraw: boolean) {
  check((await db().rpc("reopen_sanctions", { p_assessment: id, p_withdraw: withdraw })).error);
}
export async function saveCountry(organisationId: string, id: string | null, c: { country: string; level: CountryLevel; regimes: string; notes: string }) {
  const row = { country: c.country.trim(), level: c.level, regimes: c.regimes.trim() || null, notes: c.notes.trim() || null };
  if (id) check((await db().from("sanctions_countries").update(row).eq("id", id)).error);
  else check((await db().from("sanctions_countries").insert({ ...row, organisation_id: organisationId })).error);
}
export async function removeCountry(id: string) {
  check((await db().from("sanctions_countries").delete().eq("id", id)).error);
}
