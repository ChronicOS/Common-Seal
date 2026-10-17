import { supabase } from "./supabase";

// Legal Audit (migration 0040). Question keys match app.legal_audit_questions().

export type Answer = "yes" | "no" | "na";
export type Audit = {
  id: string;
  entity_id: string | null;
  country: string | null;
  title: string;
  audit_date: string;
  auditor_name: string | null;
  with_names: string | null;
  management_comments: string | null;
  status: "open" | "signed_off";
  signed_off_name: string | null;
  signed_off_title: string | null;
  signed_off_at: string | null;
  previous_id: string | null;
  created_at: string;
};
export type AuditValues = Pick<Audit, "entity_id" | "country" | "title" | "audit_date" | "auditor_name" | "with_names" | "management_comments">;
export type AnswerRow = { audit_id: string; question_key: string; answer: Answer | null; response: string | null; responsible: string | null };
export type Action = { id: string; audit_id: string; question_key: string | null; action: string; owner_name: string | null; due_on: string | null; done_at: string | null; done_note: string | null };

export type Item = {
  key: string;
  text: string;
  help?: string;
  /** The answer that needs a comment or an agreed action */
  adverse: Answer;
  /** Ask who is responsible */
  responsible?: boolean;
  optional?: boolean;
  /** Evidence VeraPhius can show for this question */
  evidence?: EvidenceKey;
};
export type Question = { id: string; text: string; help?: string; items: Item[] };
export type Section = { id: string; title: string; questions: Question[] };
type EvidenceKey = "delegations" | "retention" | "code" | "dawn_raid" | "competition" | "training_overdue" | "risk_reviews" | "long_contracts" | "employee_disputes" | "litigation" | "regulators" | "sanctions" | "anti_bribery" | "key_contracts";

const area = (key: string, text: string, evidence?: EvidenceKey, optional = false): Item => ({ key, text, adverse: "no", responsible: true, evidence, optional });
const one = (key: string, text: string, adverse: Answer, help?: string, evidence?: EvidenceKey): Question => ({ id: key, text, help, items: [{ key, text, adverse, evidence }] });

export const SECTIONS: Section[] = [
  {
    id: "A",
    title: "A. Legal and regulatory compliance",
    questions: [
      {
        id: "a1",
        text: "Is someone responsible for compliance, and for keeping up with changes, in each of these areas? Name the person responsible.",
        items: [
          area("a1_competition", "Competition and consumer law", "competition"),
          area("a1_product_regulation", "Product regulation, labelling and registration"),
          area("a1_claims_advertising", "Product claims and advertising clearance"),
          area("a1_ip", "Intellectual property (trade marks, patents, designs)"),
          area("a1_tax", "Tax"),
          area("a1_environment", "Environment"),
          area("a1_company_law", "Company law, including directors' and officers' duties"),
          area("a1_whs", "Work health and safety"),
          area("a1_employment", "Employment"),
          area("a1_privacy", "Privacy and data protection"),
          area("a1_sanctions_export", "Sanctions and export controls", "sanctions"),
          area("a1_anti_bribery", "Anti-bribery and corruption", "anti_bribery"),
          area("a1_other", "Other (say which)", undefined, true),
        ],
      },
      one("a2_management_review", "Does senior management or the board regularly consider legal and regulatory compliance and upcoming legal changes, with briefings from legal?", "no", "Note any major legal or regulatory change that could affect the business, and what is being done about it.", "risk_reviews"),
      one("a3_training_needs", "Are there training needs in any legal or regulatory area?", "yes", "Say which areas, and how training is given (in person, online for new joiners, as needed).", "training_overdue"),
    ],
  },
  {
    id: "B",
    title: "B. Group legal",
    questions: [
      one("b4_group_notification", "Are these notified to group or head-office legal: proposed material contracts, significant intellectual property issues (infringement, copies), major disputes, and proposed acquisitions, disposals or joint ventures?", "no", undefined, "key_contracts"),
    ],
  },
  {
    id: "C",
    title: "C. Internal formalities",
    questions: [
      one("c5_retention", "Is there a document retention policy that prevents records being destroyed or lost too early (accounts, filings, tax records, contracts)?", "no", "Attach or name the policy.", "retention"),
      one("c6_delegations", "Are there clear delegated authorities setting out who can commit the company to what, and how are they communicated?", "no", undefined, "delegations"),
      one("c7_code", "How is the code of conduct communicated to employees, and who certifies compliance with it?", "no", undefined, "code"),
    ],
  },
  {
    id: "D",
    title: "D. Competition",
    questions: [
      one("d8_dawn_raid", "Is there a clear procedure for unannounced visits (dawn raids) by competition or other regulators, and how is it communicated?", "no", undefined, "dawn_raid"),
      one("d9_competition_programme", "Is there a competition law compliance programme?", "no", "Give details: policy, training, approvals.", "competition"),
      one("d10_trade_associations", "Does the business take part in any trade associations or buying groups?", "yes", "Give details. Competitors meet at these, so they need care."),
      one("d11_category_management", "Does the business act as category manager or adviser for any retailer?", "yes", "Give details and the people involved."),
    ],
  },
  {
    id: "E",
    title: "E. Contracts and legal documents",
    questions: [
      one("e12_originals", "Are original signed contracts and key legal documents (assignments of intellectual property, leases, deeds) kept securely in a known place?", "no", "Say where they are kept."),
      {
        id: "e13",
        text: "Is legal advice (internal or external) sought before entering into material commitments in these areas?",
        items: [
          { key: "e13_acquisitions", text: "Acquisitions, disposals and joint ventures", adverse: "no" },
          { key: "e13_property", text: "Property (leases, purchases, sales)", adverse: "no" },
          { key: "e13_supply", text: "Supply and procurement (manufacturing, co-packing, distribution, logistics)", adverse: "no" },
          { key: "e13_international", text: "International trading agreements", adverse: "no" },
          { key: "e13_it", text: "Information technology (hardware, software, maintenance, outsourcing)", adverse: "no" },
        ],
      },
      one("e14_terms", "Are there written contracts or standard terms for all customers and key suppliers (payment terms, retention of title, product liability)?", "no"),
      one("e15_ip_ownership", "Is the right documentation in place (agency, design and joint development agreements) so that intellectual property created for us belongs to us?", "no"),
      one("e16_onerous", "Are there any unusual or onerous contracts: longer than three years, exclusivity that restricts the business, guarantees of third parties?", "yes", "Give details.", "long_contracts"),
      one("e17_terminations", "Before a customer, distributor or supplier is consolidated or terminated, is the effect on the business considered and legal advice sought?", "no"),
      one("e18_employment_contracts", "Are there written contracts for all employees and individual contractors?", "no"),
      one("e18_employee_disputes", "Are there any union disputes or major employee claims?", "yes", "Give details.", "employee_disputes"),
    ],
  },
  {
    id: "F",
    title: "F. Litigation and investigations",
    questions: [
      one("f19_major_litigation", "Is there any actual or potential litigation (as claimant or defendant) worth more than AUD 500,000, or any settlement over AUD 500,000 in the last 12 months?", "yes", "For each: a short overview, where it stands, the maximum and likely exposure, and any provision.", "litigation"),
      one("f20_investigations", "Are there any actual or potential audits or investigations by a government body or regulator (competition, tax, product, health and safety, environment)?", "yes", "Give details.", "regulators"),
    ],
  },
];
export const ALL_ITEMS: Item[] = SECTIONS.flatMap((s) => s.questions.flatMap((q) => q.items));
export const ANSWER_LABELS: Record<Answer, string> = { yes: "Yes", no: "No", na: "Not applicable" };

function db() {
  if (!supabase) throw new Error("The site is not connected to its database.");
  return supabase;
}
function check(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

export type AuditData = { ready: boolean; audits: Audit[]; answers: AnswerRow[]; actions: Action[] };
export async function loadAudits(organisationId: string): Promise<AuditData> {
  const client = db();
  const [audits, answers, actions] = await Promise.all([
    client.from("legal_audits").select("*").eq("organisation_id", organisationId).order("audit_date", { ascending: false }),
    client.from("legal_audit_answers").select("audit_id, question_key, answer, response, responsible").eq("organisation_id", organisationId),
    client.from("legal_audit_actions").select("id, audit_id, question_key, action, owner_name, due_on, done_at, done_note").eq("organisation_id", organisationId).order("created_at"),
  ]);
  if (audits.error) return { ready: false, audits: [], answers: [], actions: [] };
  check(answers.error ?? actions.error);
  return { ready: true, audits: (audits.data ?? []) as Audit[], answers: (answers.data ?? []) as AnswerRow[], actions: (actions.data ?? []) as Action[] };
}

export async function createAudit(organisationId: string, v: AuditValues): Promise<string> {
  const { data, error } = await db().from("legal_audits").insert({ ...v, organisation_id: organisationId }).select("id").single();
  check(error);
  return data!.id as string;
}
export async function updateAudit(id: string, v: Partial<AuditValues>) {
  check((await db().from("legal_audits").update(v).eq("id", id)).error);
}
export async function saveAnswer(organisationId: string, auditId: string, key: string, v: { answer: Answer | null; response: string; responsible: string }) {
  check(
    (
      await db()
        .from("legal_audit_answers")
        .upsert({ organisation_id: organisationId, audit_id: auditId, question_key: key, answer: v.answer, response: v.response.trim() || null, responsible: v.responsible.trim() || null }, { onConflict: "audit_id,question_key" })
    ).error,
  );
}
export async function addAction(organisationId: string, auditId: string, key: string, a: { action: string; owner: string; due: string }) {
  check((await db().from("legal_audit_actions").insert({ organisation_id: organisationId, audit_id: auditId, question_key: key, action: a.action.trim(), owner_name: a.owner.trim() || null, due_on: a.due || null })).error);
}
export async function removeAction(id: string) {
  check((await db().from("legal_audit_actions").delete().eq("id", id)).error);
}
export async function completeAction(id: string, note: string) {
  check((await db().from("legal_audit_actions").update({ done_at: new Date().toISOString(), done_note: note.trim() || null }).eq("id", id)).error);
}
export async function signOff(id: string, name: string, title: string) {
  check((await db().rpc("sign_off_legal_audit", { p_audit: id, p_name: name, p_title: title })).error);
}
export async function startFollowUp(id: string, title: string): Promise<string> {
  const { data, error } = await db().rpc("start_legal_audit_from", { p_previous: id, p_title: title });
  check(error);
  return data as string;
}

/** What VeraPhius already holds that bears on a question. Each is best-effort: anything not readable is left out. */
export type Evidence = Partial<Record<EvidenceKey, string>>;
export async function loadEvidence(organisationId: string): Promise<Evidence> {
  const client = db();
  const today = new Date().toLocaleDateString("en-CA");
  const yearAgo = new Date(Date.now() - 365 * 86_400_000).toISOString();
  const q = await Promise.allSettled([
    client.from("auth_versions").select("kind, number, in_force_from").eq("organisation_id", organisationId).eq("status", "in_force"),
    client.from("policies").select("id, title, kind, audience, is_retired, next_review_on").eq("organisation_id", organisationId).eq("is_retired", false),
    client.from("training_modules").select("id, title, policy_id, status").eq("organisation_id", organisationId).eq("status", "published"),
    client.from("training_assignments").select("module_id, due_on, completed_at").eq("organisation_id", organisationId),
    client.from("risk_reviews").select("name, status, finalised_at").eq("organisation_id", organisationId).eq("status", "final").gte("finalised_at", yearAgo),
    client.from("contracts").select("title, starts_on, ends_on, status, is_key").eq("organisation_id", organisationId),
    client.from("disputes").select("kind, stage, title, status, amount_claimed, exposure_estimate, currency, regulator_involved, forum").eq("organisation_id", organisationId).eq("status", "open"),
    client.from("sanctions_assessments").select("status, outcome").eq("organisation_id", organisationId).neq("status", "withdrawn"),
  ]);
  const rows = <T,>(i: number): T[] | null => {
    const r = q[i];
    if (r.status !== "fulfilled" || r.value.error) return null;
    return (r.value.data ?? []) as T[];
  };
  const e: Evidence = {};
  const auth = rows<{ kind: string; number: number; in_force_from: string | null }>(0);
  if (auth) e.delegations = auth.length ? auth.map((a) => `${a.kind === "financial" ? "Financial approval matrix" : "Signing delegation"} version ${a.number} in force${a.in_force_from ? ` since ${a.in_force_from.slice(0, 10)}` : ""}`).join("; ") + " (Board, Authorities)." : "No delegated authorities are in force under Board, Authorities.";
  const policies = rows<{ id: string; title: string; kind: string; audience: string; next_review_on: string | null }>(1);
  const modules = rows<{ id: string; title: string; policy_id: string | null }>(2);
  const assigns = rows<{ module_id: string; due_on: string; completed_at: string | null }>(3);
  const find = (re: RegExp) => (policies ?? []).filter((p) => re.test(p.title));
  if (policies) {
    const ret = find(/retention|records? management/i);
    e.retention = ret.length ? `Policy on file: ${ret.map((p) => p.title).join(", ")}.` : "No document retention policy under Policies.";
    const dr = find(/dawn raid|unannounced|regulator visit/i);
    e.dawn_raid = dr.length ? `Policy on file: ${dr.map((p) => p.title).join(", ")}.` : "No dawn raid procedure under Policies.";
    const ab = find(/brib|corrupt/i);
    e.anti_bribery = ab.length ? `Policy on file: ${ab.map((p) => p.title).join(", ")}.` : "No anti-bribery policy under Policies.";
    const comp = find(/competition|antitrust|anti-trust/i);
    const compTraining = (modules ?? []).filter((m) => /competition|antitrust/i.test(m.title));
    e.competition = `${comp.length ? `Policy: ${comp.map((p) => p.title).join(", ")}` : "No competition policy under Policies"}${modules ? `; ${compTraining.length ? `training: ${compTraining.map((m) => m.title).join(", ")}` : "no competition training module"}` : ""}.`;
    const codes = policies.filter((p) => p.kind === "code" && p.audience === "internal");
    if (codes.length) {
      const linked = (modules ?? []).filter((m) => codes.some((c) => c.id === m.policy_id));
      const done = (assigns ?? []).filter((a) => linked.some((m) => m.id === a.module_id));
      const rate = done.length ? Math.round((100 * done.filter((a) => a.completed_at).length) / done.length) : null;
      e.code = `${codes.map((c) => c.title).join(", ")} on file${linked.length ? `; acknowledged through Training (${rate === null ? "not yet assigned" : `${rate}% complete`})` : "; no read-and-acknowledge training set up"}.`;
    } else e.code = "No internal code of conduct under Policies.";
  }
  if (assigns) {
    const overdue = assigns.filter((a) => !a.completed_at && a.due_on < today).length;
    e.training_overdue = overdue ? `${overdue} training assignments are overdue (Risk and compliance, Training).` : "No overdue training.";
  }
  const reviews = rows<{ name: string }>(4);
  if (reviews) e.risk_reviews = reviews.length ? `${reviews.length} risk review${reviews.length === 1 ? "" : "s"} finalised in the last 12 months.` : "No risk review finalised in the last 12 months.";
  const contracts = rows<{ title: string; starts_on: string | null; ends_on: string | null; status: string; is_key?: boolean }>(5);
  if (contracts) {
    const live = contracts.filter((c) => !["terminated", "rejected"].includes(c.status));
    const long = live.filter((c) => c.starts_on && c.ends_on && new Date(c.ends_on).getTime() - new Date(c.starts_on).getTime() > 3 * 365.25 * 86_400_000);
    e.long_contracts = long.length ? `Contracts longer than three years: ${long.map((c) => c.title).join(", ")}.` : "No contract on file runs longer than three years.";
    const key = live.filter((c) => c.is_key);
    e.key_contracts = key.length ? `${key.length} key contract${key.length === 1 ? "" : "s"} on file (Contracts, Key Contracts).` : "No key contracts marked.";
  }
  const disputes = rows<{ kind: string; stage: string | null; title: string; amount_claimed: number | null; exposure_estimate: number | null; currency: string; regulator_involved: string | null; forum: string | null }>(6);
  if (disputes) {
    const big = disputes.filter((d) => d.kind === "litigation" && Math.max(Number(d.amount_claimed ?? 0), Number(d.exposure_estimate ?? 0)) >= 500_000);
    const unsized = disputes.filter((d) => d.kind === "litigation" && d.amount_claimed == null && d.exposure_estimate == null);
    e.litigation = `${big.length ? `Open litigation over AUD 500,000: ${big.map((d) => d.title).join("; ")}` : "No open litigation over AUD 500,000 recorded"}${unsized.length ? `; ${unsized.length} open matter${unsized.length === 1 ? "" : "s"} without an amount` : ""} (Third parties, Disputes).`;
    const emp = disputes.filter((d) => d.kind === "employee");
    e.employee_disputes = emp.length ? `${emp.filter((d) => d.stage === "active").length} active and ${emp.filter((d) => d.stage === "potential").length} potential employee disputes (Company, Employees).` : "No open employee disputes recorded.";
    const reg = disputes.filter((d) => d.regulator_involved);
    e.regulators = reg.length ? `Regulator involved in: ${reg.map((d) => `${d.title} (${d.regulator_involved})`).join("; ")}.` : "No open dispute or complaint records a regulator.";
  }
  const sanctions = rows<{ status: string; outcome: string | null }>(7);
  if (sanctions) e.sanctions = `${sanctions.length} sanctions assessment${sanctions.length === 1 ? "" : "s"} on file (Contracts, Sanctions).`;
  return e;
}
