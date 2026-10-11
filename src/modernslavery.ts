import { supabase } from "./supabase";

export type Statement = {
  id: string;
  reporting_entity_id: string;
  period_start: string;
  period_end: string;
  due_on: string;
  status: "draft" | "approved" | "lodged";
  approved_body: string | null;
  approved_on: string | null;
  signed_by: string | null;
  signed_role: string | null;
  lodged_on: string | null;
  is_joint: boolean;
  covered_entity_ids: string[];
  product_info_checked: boolean;
  approval_method: "meeting" | "circular" | null;
  ceo_signed_by: string | null;
  website_published_on: string | null;
  website_url: string | null;
  revenue_band: string | null;
  register_account_holder: string | null;
};
export type QuestionResult = { code: string; section: string; prompt: string; yes: number; no: number; total: number; favourable: number };
export type SurveyFacts = {
  name: string;
  sent: number;
  answered: number;
  high: number;
  medium: number;
  low: number;
  unrated: number;
  concerns: number;
  resolved: number;
  countries: string[];
  highCountries: string[];
  countrySource: string | null;
  audits: number | null;
  priorAudits: number | null;
  prior: { sent: number; answered: number; high: number; concerns: number } | null;
  migrant: { yes: number; total: number } | null;
  workers: number | null;
  sections: string[];
  /** One row per yes/no question. "favourable" counts the answers that raise no flag. */
  results: QuestionResult[];
};
export type Section = { statement_id: string; criterion: number; content: string };
export type SupplierAnswers = {
  higher_risk_country?: boolean;
  vulnerable_labour?: boolean;
  higher_risk_sector?: boolean;
  has_policy?: boolean;
  audits_suppliers?: boolean;
  known_incident?: boolean;
};
export type SupplierReview = { id: string; statement_id: string; counterparty_id: string; answers: SupplierAnswers; risk: "low" | "medium" | "high"; actions: string | null };
export type MsData = { statements: Statement[]; sections: Section[]; reviews: SupplierReview[]; suppliers: { id: string; name: string }[] };
export type MsFacts = { ddCases: number; trainingDone: number; policies: string[]; survey: SurveyFacts | null };

/** The seven mandatory criteria for a statement. */
export const CRITERIA: { n: number; title: string; guide: string }[] = [
  { n: 1, title: "The reporting entity", guide: "Identify the entity giving this statement." },
  { n: 2, title: "Structure, operations and supply chains", guide: "Describe how the entity is organised, what it does and where its goods and services come from." },
  { n: 3, title: "Risks of modern slavery", guide: "Describe the risks in the operations and supply chains of the entity and of any entities it owns or controls." },
  { n: 4, title: "Actions taken", guide: "Describe what was done to assess and address those risks, including due diligence and remediation." },
  { n: 5, title: "How effectiveness is assessed", guide: "Describe how the entity checks whether its actions are working." },
  { n: 6, title: "Consultation", guide: "Describe how the entities it owns or controls were consulted in preparing this statement." },
  { n: 7, title: "Other relevant information", guide: "Anything else that is relevant. If there is nothing, say so." },
];
export const SUPPLIER_QUESTIONS: { key: keyof SupplierAnswers; label: string }[] = [
  { key: "higher_risk_country", label: "Operates in, or sources from, a higher-risk country" },
  { key: "vulnerable_labour", label: "Uses labour hire, migrant, seasonal or low-skilled workers" },
  { key: "higher_risk_sector", label: "Works in a higher-risk sector (for example agriculture, textiles, electronics, cleaning, construction)" },
  { key: "has_policy", label: "Has its own modern slavery policy or supplier code" },
  { key: "audits_suppliers", label: "Checks or audits its own suppliers" },
  { key: "known_incident", label: "Has a known incident or credible allegation" },
];
export const MS_STATUS: Record<Statement["status"], string> = { draft: "Draft", approved: "Approved, to be published", lodged: "Published and lodged" };

function db() {
  if (!supabase) throw new Error("The site is not connected to its database.");
  return supabase;
}
function check(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

export async function loadModernSlavery(organisationId: string): Promise<MsData> {
  const client = db();
  const [statements, sections, reviews, suppliers] = await Promise.all([
    client.from("ms_statements").select("*").eq("organisation_id", organisationId).order("period_end", { ascending: false }),
    client.from("ms_sections").select("statement_id, criterion, content").eq("organisation_id", organisationId),
    client.from("ms_supplier_reviews").select("id, statement_id, counterparty_id, answers, risk, actions").eq("organisation_id", organisationId),
    client.from("counterparties").select("id, name").eq("organisation_id", organisationId).order("name"),
  ]);
  check(statements.error ?? sections.error);
  return {
    statements: (statements.data ?? []) as Statement[],
    sections: (sections.data ?? []) as Section[],
    // Reviews are visible to the board and compliance roles only
    reviews: (reviews.data ?? []) as SupplierReview[],
    suppliers: (suppliers.data ?? []) as { id: string; name: string }[],
  };
}

/** Figures from the rest of the platform, used to suggest wording. Any that cannot be read count as zero. */
export async function loadFacts(organisationId: string, s: Statement): Promise<MsFacts> {
  const client = db();
  const [cases, modules, assignments, policies, versions, campaigns] = await Promise.all([
    client.from("dd_cases").select("id, created_at").eq("organisation_id", organisationId).gte("created_at", s.period_start).lte("created_at", `${s.period_end}T23:59:59`),
    client.from("training_modules").select("id, title").eq("organisation_id", organisationId),
    client.from("training_assignments").select("module_id, completed_at").eq("organisation_id", organisationId).not("completed_at", "is", null),
    client.from("policies").select("id, title, is_retired").eq("organisation_id", organisationId),
    client.from("policy_versions").select("policy_id").eq("organisation_id", organisationId).eq("status", "approved"),
    client.from("ms_campaigns").select("id, name, audits_conducted, survey_year, sector_pack").eq("organisation_id", organisationId).eq("statement_id", s.id).limit(1),
  ]);
  let survey: SurveyFacts | null = null;
  const campaign = ((campaigns.data ?? []) as { id: string; name: string; audits_conducted: number | null; survey_year: number; sector_pack?: string | null }[])[0];
  if (campaign) {
    type R = { submitted_at: string | null; risk_level: string | null; countries: string[] | null; answers: Record<string, { a: string }> | null };
    const [recipients, concerns, questions, ratings, priorCampaigns] = await Promise.all([
      client.from("ms_recipients").select("submitted_at, risk_level, countries, answers").eq("campaign_id", campaign.id),
      client.from("ms_concerns").select("status").eq("campaign_id", campaign.id),
      client.from("ms_questions").select("*").order("position"),
      client.from("ms_country_ratings").select("country, rating, source").eq("organisation_id", organisationId),
      client.from("ms_campaigns").select("id, audits_conducted").eq("organisation_id", organisationId).eq("survey_year", campaign.survey_year - 1).limit(1),
    ]);
    const rs = (recipients.data ?? []) as R[];
    const done = rs.filter((r) => r.submitted_at);
    const ks = (concerns.data ?? []) as { status: string }[];
    // Questions asked in this survey: the core set plus its sector pack. One that has since been switched off still shows if it was answered.
    const qs = ((questions.data ?? []) as { code: string; section: string; prompt: string; kind: string; adverse: string | null; is_active?: boolean; sector?: string | null }[]).filter(
      (q) =>
        q.kind === "yesno" &&
        (!q.sector || q.sector === campaign.sector_pack) &&
        (q.is_active !== false || (recipients.data ?? []).some((r) => (r as R).answers?.[q.code])),
    );
    const cr = (ratings.data ?? []) as { country: string; rating: string; source: string | null }[];
    const named = [...new Set(done.flatMap((r) => r.countries ?? []))].sort();
    const results: QuestionResult[] = qs.map((q) => {
      const yes = done.filter((r) => r.answers?.[q.code]?.a === "yes").length;
      const no = done.filter((r) => r.answers?.[q.code]?.a === "no").length;
      return { code: q.code, section: q.section, prompt: q.prompt.replace(/(the )?\{organisation\}/g, "our"), yes, no, total: yes + no, favourable: q.adverse === "yes" ? no : q.adverse === "no" ? yes : yes };
    });
    const migrant = results.find((r) => r.code === "migrant_workers");
    let prior: SurveyFacts["prior"] = null;
    const priorCampaign = ((priorCampaigns.data ?? []) as { id: string; audits_conducted: number | null }[])[0];
    if (priorCampaign) {
      const [pr, pk] = await Promise.all([
        client.from("ms_recipients").select("submitted_at, risk_level").eq("campaign_id", priorCampaign.id),
        client.from("ms_concerns").select("id").eq("campaign_id", priorCampaign.id),
      ]);
      const prs = (pr.data ?? []) as { submitted_at: string | null; risk_level: string | null }[];
      prior = { sent: prs.length, answered: prs.filter((r) => r.submitted_at).length, high: prs.filter((r) => r.risk_level === "high").length, concerns: (pk.data ?? []).length };
    }
    survey = {
      name: campaign.name,
      sent: rs.length,
      answered: done.length,
      high: done.filter((r) => r.risk_level === "high").length,
      medium: done.filter((r) => r.risk_level === "medium").length,
      low: done.filter((r) => r.risk_level === "low").length,
      unrated: done.filter((r) => !r.risk_level).length,
      concerns: ks.length,
      resolved: ks.filter((k) => k.status === "resolved").length,
      countries: named,
      highCountries: named.filter((n) => cr.some((k) => k.rating === "high" && k.country.trim().toLowerCase() === n.trim().toLowerCase())),
      countrySource: cr.find((k) => k.source)?.source ?? null,
      audits: campaign.audits_conducted,
      priorAudits: priorCampaign?.audits_conducted ?? null,
      prior,
      migrant: migrant ? { yes: migrant.yes, total: migrant.total } : null,
      workers: done.some((r) => r.answers?.workforce_size) ? done.reduce((sum, r) => sum + (Number(r.answers?.workforce_size?.a) || 0), 0) : null,
      sections: [...new Set(qs.map((q) => q.section))],
      results,
    };
  }
  const slavery = new Set(((modules.data ?? []) as { id: string; title: string }[]).filter((m) => /slavery/i.test(m.title)).map((m) => m.id));
  const inForce = new Set(((versions.data ?? []) as { policy_id: string }[]).map((v) => v.policy_id));
  return {
    ddCases: (cases.data ?? []).length,
    trainingDone: ((assignments.data ?? []) as { module_id: string; completed_at: string }[]).filter(
      (a) => slavery.has(a.module_id) && a.completed_at.slice(0, 10) >= s.period_start && a.completed_at.slice(0, 10) <= s.period_end,
    ).length,
    policies: ((policies.data ?? []) as { id: string; title: string; is_retired: boolean }[])
      .filter((p) => !p.is_retired && inForce.has(p.id) && /slavery|supplier|speak|whistle|procure/i.test(p.title))
      .map((p) => p.title),
    survey,
  };
}

export async function createStatement(organisationId: string, entityId: string, start: string, end: string) {
  const { data, error } = await db()
    .from("ms_statements")
    .insert({ organisation_id: organisationId, reporting_entity_id: entityId, period_start: start, period_end: end })
    .select("id")
    .single();
  check(error);
  return data!.id as string;
}
export async function saveSections(organisationId: string, statementId: string, contents: Record<number, string>) {
  const rows = Object.entries(contents).map(([n, content]) => ({ organisation_id: organisationId, statement_id: statementId, criterion: Number(n), content }));
  check((await db().from("ms_sections").upsert(rows, { onConflict: "statement_id,criterion" })).error);
}
export async function saveReview(organisationId: string, statementId: string, counterpartyId: string, answers: SupplierAnswers, actions: string) {
  check(
    (
      await db()
        .from("ms_supplier_reviews")
        .upsert(
          { organisation_id: organisationId, statement_id: statementId, counterparty_id: counterpartyId, answers, actions: actions.trim() || null, risk: "low" },
          { onConflict: "statement_id,counterparty_id" },
        )
    ).error,
  );
}
export async function setStatementScope(id: string, joint: boolean, covered: string[], productChecked: boolean) {
  check((await db().rpc("set_ms_statement_scope", { p_statement: id, p_joint: joint, p_covered: covered, p_product_checked: productChecked })).error);
}
export async function approveStatement(id: string, body: string, on: string, method: string, ceo: string) {
  check((await db().rpc("approve_ms_statement", { p_statement: id, p_body: body, p_approved_on: on, p_method: method, p_ceo: ceo })).error);
}
export async function publishStatement(id: string, p: { websiteOn: string; websiteUrl: string; registerOn: string; revenueBand: string; accountHolder: string }) {
  check(
    (
      await db().rpc("publish_ms_statement", {
        p_statement: id,
        p_website_on: p.websiteOn,
        p_website_url: p.websiteUrl,
        p_register_on: p.registerOn,
        p_revenue_band: p.revenueBand,
        p_account_holder: p.accountHolder,
      })
    ).error,
  );
}

export type MsSummary = { latest: Statement | null };
export async function loadMsSummary(organisationId: string): Promise<MsSummary> {
  const { data, error } = await db().from("ms_statements").select("*").eq("organisation_id", organisationId).order("period_end", { ascending: false }).limit(1);
  return { latest: error ? null : (((data ?? []) as Statement[])[0] ?? null) };
}
