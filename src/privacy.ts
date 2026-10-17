import { supabase } from "./supabase";

// Privacy and cyber incidents (migration 0050)

export type InfoKind = "contact" | "identity" | "government_id" | "tfn" | "financial" | "credit" | "health" | "sensitive" | "biometric" | "children" | "employee" | "location" | "online" | "other";
export type OtherNotice = { body: string; due_at?: string | null; done_at?: string | null; reference?: string | null };
export type Breach = {
  id: string;
  entity_id: string | null;
  title: string;
  suspected_on: string;
  assessment_due_on: string;
  occurred_on: string | null;
  description: string;
  cause: "malicious_cyber" | "malicious_other" | "system_fault" | "human_error" | null;
  info_kinds: InfoKind[];
  individuals_affected: number | null;
  contained_at: string | null;
  remedial_action: string | null;
  eligible: boolean | null;
  assessment_basis: string | null;
  assessed_at: string | null;
  oaic_notified_at: string | null;
  oaic_reference: string | null;
  individuals_notified_at: string | null;
  notify_option: "all" | "at_risk" | "publish" | null;
  notify_exception: string | null;
  ransom_demanded: boolean;
  ransom_paid: boolean;
  ransom_paid_at: string | null;
  ransom_reported_at: string | null;
  ransom_reference: string | null;
  other_notifications: OtherNotice[];
  lessons: string | null;
  status: "open" | "closed";
  closed_at: string | null;
  reported_by: string | null;
  created_at: string;
};
export type Holding = {
  id: string;
  entity_id: string | null;
  name: string;
  system: string | null;
  info_kinds: InfoKind[];
  individuals: "under_1k" | "1k_10k" | "10k_100k" | "100k_1m" | "over_1m" | null;
  whose: string | null;
  purpose: string | null;
  collected_from: string | null;
  disclosed_to: string | null;
  overseas: string | null;
  retention: string | null;
  deletion: string | null;
  security_controls: string | null;
  owner_user_id: string | null;
  review_on: string | null;
  status: "active" | "retired";
};
export type HoldingValues = Omit<Holding, "id">;
export type Decision = {
  id: string;
  name: string;
  decision: string;
  role: "solely" | "substantially";
  significant: boolean;
  info_kinds: InfoKind[];
  info_detail: string | null;
  holding_id: string | null;
  human_review: string | null;
  owner_user_id: string | null;
  review_on: string | null;
  status: "active" | "retired";
};
export type DecisionValues = Omit<Decision, "id">;

export const INFO_LABELS: Record<InfoKind, string> = {
  contact: "Contact details", identity: "Identity details (name, date of birth)", government_id: "Government identifiers (licence, passport, Medicare)", tfn: "Tax file numbers",
  financial: "Financial or bank details", credit: "Credit information", health: "Health information", sensitive: "Other sensitive information (racial or ethnic origin, political, religious, sexual orientation, criminal record)",
  biometric: "Biometric information", children: "Children's information", employee: "Employee records", location: "Location information", online: "Online identifiers (IP addresses, device IDs, cookies)", other: "Other",
};
/** Kinds that usually make serious harm more likely */
export const HIGH_RISK: InfoKind[] = ["government_id", "tfn", "financial", "credit", "health", "sensitive", "biometric", "children"];
export const CAUSE_LABELS: Record<NonNullable<Breach["cause"]>, string> = {
  malicious_cyber: "Cyber attack (hacking, ransomware, phishing)", malicious_other: "Theft or other deliberate act", system_fault: "System fault", human_error: "Human error (wrong recipient, lost device)",
};
export const SIZE_LABELS: Record<NonNullable<Holding["individuals"]>, string> = {
  under_1k: "Fewer than 1,000", "1k_10k": "1,000 to 10,000", "10k_100k": "10,000 to 100,000", "100k_1m": "100,000 to 1 million", over_1m: "Over 1 million",
};
/** Other notices often needed after a breach or cyber incident; hours is the usual deadline from becoming aware */
export const OTHER_NOTICES: { body: string; hours: number | null; when: string }[] = [
  { body: "Cyber insurer", hours: null, when: "As the policy requires (often within 24 to 72 hours, and before paying any ransom)" },
  { body: "APRA (CPS 234)", hours: 72, when: "APRA-regulated entities: a material information security incident within 72 hours" },
  { body: "Australian Signals Directorate (SOCI)", hours: 12, when: "Critical infrastructure assets: 12 hours for a significant impact, 72 hours for a relevant impact" },
  { body: "Australian Signals Directorate (ReportCyber)", hours: null, when: "Voluntary report of a cyber incident, for help and to warn others" },
  { body: "ASX (continuous disclosure)", hours: null, when: "Listed entities: immediately, if a reasonable person would expect it to affect the price" },
  { body: "Police", hours: null, when: "Theft, extortion or other crime" },
  { body: "Banks and card schemes", hours: null, when: "If card or bank details were taken" },
  { body: "Overseas regulators", hours: null, when: "If people overseas are affected (for example under the GDPR, 72 hours)" },
];
export const ADM_DEADLINE = "2026-12-10";

const join = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
/** The privacy policy wording APP 1.7 to 1.9 needs, from the active automated decisions that significantly affect people */
export function policyWording(decisions: Decision[], organisationName: string) {
  const list = decisions.filter((d) => d.status === "active" && d.significant);
  if (list.length === 0) return null;
  const solely = list.filter((d) => d.role === "solely");
  const helped = list.filter((d) => d.role === "substantially");
  const kinds = [...new Set(list.flatMap((d) => d.info_kinds))].filter((k) => k !== "other").map((k) => INFO_LABELS[k].split(" (")[0].toLowerCase());
  const extra = list.map((d) => d.info_detail?.trim()).filter(Boolean) as string[];
  const lines = [
    "Automated decisions",
    "",
    `${organisationName} uses computer programs to make, or to help make, some decisions that could significantly affect your rights or interests.`,
  ];
  if (solely.length) lines.push("", "Decisions made by a computer program on its own:", ...solely.map((d) => `• ${d.decision.trim()}`));
  if (helped.length) lines.push("", "Decisions where a computer program does something substantially and directly related to making the decision:", ...helped.map((d) => `• ${d.decision.trim()}`));
  lines.push("", `The kinds of personal information these programs use are: ${join([...kinds, ...extra]) || "described when we collect it"}.`);
  const review = list.map((d) => d.human_review?.trim()).filter(Boolean) as string[];
  lines.push("", review.length ? `If you would like a person to look at a decision, ${review[0].replace(/^./, (c) => c.toLowerCase())}` : "If you would like a person to look at a decision about you, contact us using the details in this policy.");
  return lines.join("\n");
}

function db() {
  if (!supabase) throw new Error("The site is not connected to its database.");
  return supabase;
}
function check(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}
const tidy = (v: object) => Object.fromEntries(Object.entries(v).map(([k, x]) => [k, typeof x === "string" ? x.trim() || null : x]));

export type PrivacyData = { ready: boolean; breaches: Breach[]; holdings: Holding[]; decisions: Decision[]; people: { user_id: string | null; full_name: string }[] };
export async function loadPrivacy(organisationId: string): Promise<PrivacyData> {
  const c = db();
  const [breaches, holdings, decisions, people] = await Promise.all([
    c.from("privacy_breaches").select("*").eq("organisation_id", organisationId).order("suspected_on", { ascending: false }),
    c.from("personal_info_holdings").select("*").eq("organisation_id", organisationId).order("name"),
    c.from("automated_decisions").select("*").eq("organisation_id", organisationId).order("name"),
    c.from("people").select("user_id, full_name").eq("organisation_id", organisationId),
  ]);
  if (breaches.error) return { ready: false, breaches: [], holdings: [], decisions: [], people: [] };
  return {
    ready: true,
    breaches: (breaches.data ?? []) as Breach[],
    holdings: (holdings.data ?? []) as Holding[],
    decisions: (decisions.data ?? []) as Decision[],
    people: (people.data ?? []) as PrivacyData["people"],
  };
}
export async function reportBreach(organisationId: string, v: Partial<Breach>) {
  const { data, error } = await db().from("privacy_breaches").insert({ ...tidy(v), organisation_id: organisationId }).select("id").single();
  check(error);
  return data!.id as string;
}
export async function updateBreach(id: string, patch: Partial<Breach>) {
  check((await db().from("privacy_breaches").update(tidy(patch)).eq("id", id)).error);
}
export async function saveHolding(organisationId: string, id: string | null, v: HoldingValues) {
  if (id) check((await db().from("personal_info_holdings").update(tidy(v)).eq("id", id)).error);
  else check((await db().from("personal_info_holdings").insert({ ...tidy(v), organisation_id: organisationId })).error);
}
export async function saveDecision(organisationId: string, id: string | null, v: DecisionValues) {
  if (id) check((await db().from("automated_decisions").update(tidy(v)).eq("id", id)).error);
  else check((await db().from("automated_decisions").insert({ ...tidy(v), organisation_id: organisationId })).error);
}

/** Days from today to an ISO date (negative when past) */
export function daysTo(iso: string, today: string) {
  return Math.round((new Date(`${iso}T12:00:00`).getTime() - new Date(`${today}T12:00:00`).getTime()) / 864e5);
}
