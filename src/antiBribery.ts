import type { Check } from "./regulatory";
import { supabase } from "./supabase";

// Anti-bribery programme (migration 0051)

export type Area = "third_parties" | "government" | "gifts_hospitality" | "donations_sponsorships" | "facilitation" | "countries" | "sector" | "transactions" | "joint_ventures" | "acquisitions" | "hiring" | "procurement" | "other";
export type Assessment = {
  id: string; title: string; assessed_on: string; scope: string | null; next_review_on: string | null; status: "draft" | "approved";
  approved_by: string | null; approved_at: string | null; approval_note: string | null;
};
export type Risk = {
  id: string; assessment_id: string; area: Area; description: string; countries: string | null; likelihood: number; impact: number; controls: string | null;
  residual_likelihood: number | null; residual_impact: number | null; actions: string | null; action_due_on: string | null; owner_user_id: string | null;
};
export type RiskValues = Omit<Risk, "id" | "assessment_id">;
export type Status = "in_place" | "partly" | "gap" | "not_applicable";
export type Evidence = {
  policy: { abc: number; abc_overdue: number; gifts: number; speak_up: number; conflicts: number };
  training: { modules: number; assigned: number; current: number; overdue: number };
  gifts: { entries: number; public_official: number; pending: number; declined: number };
  conflicts: { declared: number; open: number };
  due_diligence: { third_parties: number; agents: number; agents_cleared: number; review_overdue: number; open_cases: number; high_risk: number };
  sanctions: { rescreen_overdue: number };
  speak_up: { handlers: number; reports: number; bribery: number; bribery_open: number };
  assessment: { approved_at: string; next_review_on: string | null; risks: number; high: number; no_owner: number } | null;
};
/** What the platform's own records say about an element: ok, a warning, a gap, or nothing to say */
export type Auto = { level: "ok" | "warn" | "gap"; text: string; tab?: string } | null;

export const AREA_LABELS: Record<Area, string> = {
  third_parties: "Agents, intermediaries and other third parties", government: "Dealings with government (licences, permits, tenders, inspections)", gifts_hospitality: "Gifts, hospitality and travel",
  donations_sponsorships: "Donations and sponsorships", facilitation: "Facilitation payments", countries: "High-risk countries", sector: "High-risk sector", transactions: "Large or unusual transactions",
  joint_ventures: "Joint ventures and partners", acquisitions: "Acquisitions", hiring: "Hiring (including relatives of officials)", procurement: "Procurement and suppliers", other: "Other",
};
export const STATUS_LABELS: Record<Status, string> = { in_place: "In place", partly: "Partly in place", gap: "Gap", not_applicable: "Not applicable" };
export const score = (r: Pick<Risk, "likelihood" | "impact" | "residual_likelihood" | "residual_impact">) => (r.residual_likelihood ?? r.likelihood) * (r.residual_impact ?? r.impact);
export const scoreLabel = (n: number) => (n >= 15 ? "High" : n >= 8 ? "Medium" : "Low");

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
type Element = { key: string; label: string; hint: string; law?: string; auto?: (e: Evidence, today: string) => Auto };
export const PRINCIPLES: { key: string; label: string; elements: Element[] }[] = [
  {
    key: "control", label: "1. A proportionate control environment",
    elements: [
      { key: "abc_policy", label: "Anti-bribery policy, approved and in date", hint: "Bans bribery of anyone, including foreign public officials, and says what to do instead.",
        auto: (e) => (e.policy.abc === 0 ? { level: "gap", text: "No approved anti-bribery policy in Policies.", tab: "policies" } : e.policy.abc_overdue ? { level: "warn", text: "The anti-bribery policy is overdue for review.", tab: "policies" } : { level: "ok", text: "Approved anti-bribery policy, in date.", tab: "policies" }) },
      { key: "gifts", label: "Gifts and hospitality rules, with approval for anything to a public official", hint: "Thresholds, a register, and pre-approval for public officials.",
        auto: (e) => (e.policy.gifts === 0 && e.gifts.entries === 0 ? { level: "gap", text: "No gifts policy and nothing in the gifts register.", tab: "declarations" }
          : { level: e.gifts.pending ? "warn" : "ok", text: `${plural(e.gifts.entries, "entry", "entries")} in the gifts register in the last 12 months, ${e.gifts.public_official} involving a public official, ${e.gifts.declined} declined${e.gifts.pending ? `; ${e.gifts.pending} waiting for a decision` : ""}.${e.policy.gifts ? "" : " No gifts policy found."}`, tab: "declarations" }) },
      { key: "conflicts", label: "Conflicts of interest declared and managed", hint: "Including relationships with public officials.",
        auto: (e) => ({ level: e.conflicts.open ? "warn" : "ok", text: `${plural(e.conflicts.declared, "conflict")} declared in the last 12 months${e.conflicts.open ? `; ${e.conflicts.open} still open` : ""}.`, tab: "conflicts" }) },
      { key: "third_party_dd", label: "Due diligence on agents, intermediaries and partners before appointment and on renewal", hint: "Risk-based, with contract clauses and payment controls.",
        auto: (e) => (e.due_diligence.third_parties === 0 ? null
          : { level: e.due_diligence.agents_cleared < e.due_diligence.agents || e.due_diligence.review_overdue ? "warn" : "ok",
              text: `${e.due_diligence.agents_cleared} of ${plural(e.due_diligence.agents, "agent")} cleared; ${plural(e.due_diligence.third_parties, "third party", "third parties")} recorded; ${e.due_diligence.open_cases} open due diligence cases${e.due_diligence.review_overdue ? `; ${e.due_diligence.review_overdue} overdue for review` : ""}${e.sanctions.rescreen_overdue ? `; ${e.sanctions.rescreen_overdue} sanctions re-screens overdue` : ""}.`, tab: "parties" }) },
      { key: "books_records", label: "Accurate books and payment controls", hint: "No off-book accounts; approval and support for payments to third parties, commissions and cash." },
      { key: "facilitation", label: "Facilitation payments banned or tightly controlled and recorded", hint: "Australian law still allows minor facilitation payments only if recorded; many companies ban them." },
      { key: "donations", label: "Political and charitable donations and sponsorships approved and checked", hint: "Who receives them, and whether a public official is connected." },
    ],
  },
  {
    key: "leadership", label: "2. Top-level commitment",
    elements: [
      { key: "board_commitment", label: "The board approves the programme and receives regular reports", hint: "Minutes show the board considering bribery risk.",
        auto: (e) => (e.assessment ? { level: "ok", text: `The board approved the bribery risk assessment on ${new Date(e.assessment.approved_at).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}.` } : null) },
      { key: "responsible_officer", label: "A senior person is responsible, with the authority and resources to act", hint: "Name them, and say how they report to the board." },
      { key: "tone", label: "Leaders communicate zero tolerance", hint: "Messages from the chief executive, town halls, the code of conduct." },
    ],
  },
  {
    key: "risk", label: "3. Risk assessment",
    elements: [
      { key: "risk_assessment", label: "Bribery risk assessment, approved within the last 12 months", hint: "Countries, sector, transactions, business opportunities and partners.",
        auto: (e, t) => (!e.assessment ? { level: "gap", text: "No approved bribery risk assessment." } : e.assessment.next_review_on && e.assessment.next_review_on < t ? { level: "gap", text: "The approved risk assessment is overdue for review." } : { level: "ok", text: `Approved, ${plural(e.assessment.risks, "risk")} assessed.` }) },
      { key: "risk_controls", label: "Every significant risk has controls, an owner and actions", hint: "High residual risks are reported to the board.",
        auto: (e) => (!e.assessment ? null : { level: e.assessment.high || e.assessment.no_owner ? "warn" : "ok", text: `${plural(e.assessment.high, "high risk")} after controls; ${plural(e.assessment.no_owner, "risk")} without an owner.` }) },
    ],
  },
  {
    key: "training", label: "4. Communication and training",
    elements: [
      { key: "training", label: "Anti-bribery training for directors and staff, refreshed regularly", hint: "Proportionate to risk; at induction and at least every two years.",
        auto: (e) => (e.training.modules === 0 ? { level: "gap", text: "No published anti-bribery training module.", tab: "training" }
          : { level: e.training.overdue || e.training.current < e.training.assigned ? "warn" : "ok", text: `${e.training.current} of ${e.training.assigned} assigned people are current${e.training.overdue ? `; ${e.training.overdue} overdue` : ""}.`, tab: "training" }) },
      { key: "high_risk_training", label: "Targeted training for high-risk roles, agents and partners", hint: "Sales, procurement, government relations; associates who act for you." },
      { key: "associates_communicated", label: "The policy is communicated to agents, contractors and partners", hint: "In contracts, onboarding packs and the supplier code." },
    ],
  },
  {
    key: "reporting", label: "5. Reporting",
    elements: [
      { key: "speak_up", label: "A confidential speak-up channel, with protection for people who use it", hint: "Visible, secure, accessible, and open to associates.",
        auto: (e) => (e.speak_up.handlers === 0 ? { level: "gap", text: "No one is set up to receive speak-up reports.", tab: "speakup" }
          : { level: e.policy.speak_up ? "ok" : "warn", text: `${plural(e.speak_up.handlers, "person", "people")} receive reports; ${plural(e.speak_up.reports, "report")} in the last 12 months.${e.policy.speak_up ? "" : " No speak-up or whistleblower policy found."}`, tab: "speakup" }) },
      { key: "investigations", label: "Bribery concerns are investigated and acted on", hint: "Including lessons learned and reporting to regulators where appropriate.",
        auto: (e) => ({ level: e.speak_up.bribery_open ? "warn" : "ok", text: `${plural(e.speak_up.bribery, "bribery or corruption report")} in the last 12 months${e.speak_up.bribery_open ? `; ${e.speak_up.bribery_open} still open` : ""}.`, tab: "speakup" }) },
    ],
  },
  {
    key: "monitoring", label: "6. Monitoring and review",
    elements: [
      { key: "programme_review", label: "The programme is reviewed at least yearly, and after a trigger", hint: "New markets, new activities, an incident, or a change in the law." },
      { key: "testing", label: "Controls are tested or audited", hint: "Internal audit, a legal audit, or an external review of payments, agents and gifts." },
      { key: "red_flags", label: "Gifts, expenses and payments are reviewed for red flags", hint: "Unusual commissions, round sums, payments to third countries, cash." },
    ],
  },
];
export const ELEMENT_LABEL = Object.fromEntries(PRINCIPLES.flatMap((p) => p.elements.map((e) => [e.key, e.label])));

function db() {
  if (!supabase) throw new Error("The site is not connected to its database.");
  return supabase;
}
function check(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}
const tidy = (v: object) => Object.fromEntries(Object.entries(v).map(([k, x]) => [k, typeof x === "string" ? x.trim() || null : x]));

export type AbcData = { ready: boolean; allowed: boolean; assessments: Assessment[]; risks: Risk[]; programme: Check[]; evidence: Evidence | null; people: { user_id: string | null; full_name: string }[] };
export async function loadAbc(organisationId: string): Promise<AbcData> {
  const c = db();
  const [assessments, risks, programme, evidence, people] = await Promise.all([
    c.from("abc_assessments").select("*").eq("organisation_id", organisationId).order("assessed_on", { ascending: false }),
    c.from("abc_risks").select("*").eq("organisation_id", organisationId).order("created_at"),
    c.from("compliance_checks").select("*").eq("organisation_id", organisationId).eq("programme", "anti_bribery"),
    c.rpc("abc_evidence", { p_org: organisationId }),
    c.from("people").select("user_id, full_name").eq("organisation_id", organisationId),
  ]);
  if (assessments.error) return { ready: false, allowed: false, assessments: [], risks: [], programme: [], evidence: null, people: [] };
  return {
    ready: true,
    allowed: !evidence.error,
    assessments: (assessments.data ?? []) as Assessment[],
    risks: (risks.data ?? []) as Risk[],
    programme: (programme.data ?? []) as Check[],
    evidence: (evidence.data ?? null) as Evidence | null,
    people: (people.data ?? []) as AbcData["people"],
  };
}
/** A new draft, starting from the risks of the last approved assessment */
export async function startAssessment(organisationId: string, title: string, from: Risk[]) {
  const { data, error } = await db().from("abc_assessments").insert({ organisation_id: organisationId, title }).select("id").single();
  check(error);
  const id = data!.id as string;
  if (from.length) {
    check((await db().from("abc_risks").insert(from.map(({ id: _id, assessment_id: _a, ...r }) => ({ ...r, organisation_id: organisationId, assessment_id: id })))).error);
  }
  return id;
}
export async function updateAssessment(id: string, v: Partial<Pick<Assessment, "title" | "assessed_on" | "scope" | "next_review_on">>) {
  check((await db().from("abc_assessments").update(tidy(v)).eq("id", id)).error);
}
export async function saveRisk(organisationId: string, assessmentId: string, id: string | null, v: Partial<RiskValues>) {
  if (id) check((await db().from("abc_risks").update(tidy(v)).eq("id", id)).error);
  else check((await db().from("abc_risks").insert({ ...tidy(v), organisation_id: organisationId, assessment_id: assessmentId })).error);
}
export async function deleteRisk(id: string) {
  check((await db().from("abc_risks").delete().eq("id", id)).error);
}
export async function approveAssessment(id: string, note: string) {
  check((await db().rpc("approve_abc_assessment", { p_assessment: id, p_note: note || null })).error);
}
