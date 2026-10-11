import { supabase } from "./supabase";

export type RiskLevel = "low" | "medium" | "high";
export type Question = { code: string; position: number; section: string; prompt: string; kind: "yesno" | "countries"; adverse: "yes" | "no" | null; serious: boolean; detail_prompt: string | null; detail_on: "yes" | "no" | null; wording_to_confirm: boolean };
export type Campaign = {
  id: string;
  name: string;
  survey_year: number;
  statement_id: string | null;
  deadline: string;
  chaser1_on: string | null;
  chaser2_on: string | null;
  sender_email: string | null;
  relevant_policies: string | null;
  query_name: string | null;
  query_title: string | null;
  query_email: string | null;
  cover_subject: string;
  cover_body: string;
  chaser1_subject: string;
  chaser1_body: string;
  chaser2_subject: string;
  chaser2_body: string;
  spend_medium_from: number;
  spend_high_from: number;
  audits_conducted: number | null;
  status: "open" | "closed";
  closed_at: string | null;
};
export type Answer = { a: "yes" | "no"; d?: string };
export type Recipient = {
  id: string;
  campaign_id: string;
  counterparty_id: string;
  contact_name: string;
  contact_email: string;
  annual_spend: number | null;
  token: string;
  cover_sent_at: string | null;
  chaser1_sent_at: string | null;
  chaser2_sent_at: string | null;
  opened_at: string | null;
  submitted_at: string | null;
  respondent_name: string | null;
  respondent_email: string | null;
  respondent_company: string | null;
  answers: Record<string, Answer> | null;
  countries: string[] | null;
  revenue_rating: RiskLevel | null;
  country_rating: RiskLevel | null;
  risk_score: number | null;
  risk_level: RiskLevel | null;
  concerns_count: number;
  gaps_count: number;
};
export type Concern = { id: string; campaign_id: string; recipient_id: string; question_code: string; answer: string; detail: string | null; status: "open" | "resolved"; decision: string | null; decided_at: string | null };
export type CountryRating = { id: string; country: string; rating: RiskLevel; score: number | null; source: string | null };
export type SurveyData = {
  questions: Question[];
  campaigns: Campaign[];
  recipients: Recipient[];
  concerns: Concern[];
  countries: CountryRating[];
  suppliers: { id: string; name: string }[];
};
export type EmailKind = "cover" | "chaser1" | "chaser2";

/** The wording each new survey starts with. Each survey keeps its own copy, which can be edited before anything is sent. */
export const DEFAULT_TEMPLATES = {
  cover_subject: "{organisation}: modern slavery questionnaire",
  cover_body:
    "Dear Valued Partners of {organisation},\n\nAs part of our ongoing commitment to ethical sourcing and corporate social responsibility, we are conducting a review of our 3rd party partners to assess the risk of modern slavery and human trafficking. We kindly request your cooperation in completing the modern slavery questionnaire which is accessible through this link:\n\n{link}\n\nThe purpose of this questionnaire is to help {organisation} with our due diligence procedures to assess the risk of modern slavery, in compliance with our obligations under the Modern Slavery Act 2018 (Cth), our organisational values and ethics and our zero-tolerance approach to modern slavery.\n\nYour responses on behalf of your organisation to this questionnaire will help us to:\n\n- confirm your compliance with our {policies} (provided to you with this questionnaire);\n- confirm your compliance with the Modern Slavery Act 2018 (Cth) and where applicable, the Modern Slavery Act 2018 (NSW);\n- identify, assess and address the risk of modern slavery with our 3rd party partners; and\n- foster a collaborative relationship to help mitigate the risk of modern slavery and in appropriate circumstances remediate harm caused.\n\nINSTRUCTIONS FOR COMPLETING THE QUESTIONNAIRE\n\n- Provide your responses to the questionnaire, including appropriate supporting documents as soon as is practicable and no later than twenty (20) business days of receipt. We require your final answers no later than {deadline}.\n- This is an initial request for information and we may ask for further information in due course.\n- Include appropriate cross-references where the same information and documents are to be supplied in response to two or more different questions. You do not need to repeat your response.\n- Answer as openly as possible (there are no wrong answers).\n- Where uncertain as to the scope of a question or the relevance of any information or document, provide more rather than less information, or contact us for clarification.\n- Notify us and update your responses as more information becomes available or if subsequent events make any earlier responses inaccurate.\n\nTo assist in our due diligence review, we may hold interviews with your employees, subcontractors, agents, suppliers or other relevant stakeholders.\n\nFor any queries regarding this questionnaire, you can contact {query_name}, {query_title} at {query_email}",
  chaser1_subject: "Reminder: {organisation} modern slavery questionnaire",
  chaser1_body:
    "Dear all,\n\nWe have yet to receive any response from your end for the modern slavery questionnaire which is accessible through this link: {link}\n\nCould we please ask you take 30mins of your schedule to respond to the questionnaire, and/or providing appropriate supporting documents no later than five (5) business days from the date of this email.\n\nIf you have already completed the questionnaire, your response must have been received today, ahead of me sending this chaser. We thank you for your input & appreciate it.\n\nFor any queries regarding this questionnaire, you can contact {query_name}, {query_title} at {query_email}",
  chaser2_subject: "Checking in: {organisation} modern slavery questionnaire",
  chaser2_body:
    "Dear all, Trust you are doing well.\n\nWanted to check in to see if you would be planning on completing the questionnaire - {link}\n\nIf yes, when could we expect to receive your responses by?\n\nPlease kindly let me know if there are any questions/roadblocks with regards to the questionnaire – would be happy to help/clarify.",
};

export const RISK_LABEL: Record<RiskLevel, string> = { low: "Low", medium: "Medium", high: "High" };
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function db() {
  if (!supabase) throw new Error("The site is not connected to its database.");
  return supabase;
}
function check(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

export const surveyLink = (token: string) => `${window.location.origin}/?q=${token}`;

export function fill(text: string, values: Record<string, string>) {
  return text.replace(/\{(\w+)\}/g, (whole, key: string) => values[key] ?? whole);
}

/** The email for one supplier, ready to open in the sender's own mail program. */
export function buildEmail(kind: EmailKind, c: Campaign, r: Recipient, supplier: string, organisation: string, formatDay: (iso: string) => string) {
  const values = {
    contact: r.contact_name,
    supplier,
    organisation,
    deadline: formatDay(c.deadline),
    link: surveyLink(r.token),
    policies: c.relevant_policies || "[insert policies relevant to 3Ps]",
    query_name: c.query_name || "[insert name]",
    query_title: c.query_title || "[insert title]",
    query_email: c.query_email || c.sender_email || "[insert email]",
  };
  const subject = fill(c[`${kind}_subject`], values);
  const body = fill(c[`${kind}_body`], values);
  return { subject, body, incomplete: /\[insert /.test(body), mailto: `mailto:${encodeURIComponent(r.contact_email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}` };
}

/** Which email, if any, this supplier is due today. Nothing is due once they have answered. */
export function emailDue(c: Campaign, r: Recipient, on: string): EmailKind | null {
  if (c.status !== "open" || r.submitted_at) return null;
  if (!r.cover_sent_at) return "cover";
  if (c.chaser2_on && on >= c.chaser2_on && !r.chaser2_sent_at) return "chaser2";
  if (c.chaser1_on && on >= c.chaser1_on && !r.chaser1_sent_at && !r.chaser2_sent_at) return "chaser1";
  return null;
}

export async function loadSurveys(organisationId: string): Promise<SurveyData> {
  const client = db();
  const [questions, campaigns, recipients, concerns, countries, suppliers] = await Promise.all([
    client.from("ms_questions").select("*").order("position"),
    client.from("ms_campaigns").select("*").eq("organisation_id", organisationId).order("survey_year", { ascending: false }),
    client.from("ms_recipients").select("*").eq("organisation_id", organisationId).order("created_at"),
    client.from("ms_concerns").select("*").eq("organisation_id", organisationId).order("created_at"),
    client.from("ms_country_ratings").select("id, country, rating, score, source").eq("organisation_id", organisationId).order("country"),
    client.from("counterparties").select("id, name").eq("organisation_id", organisationId).order("name"),
  ]);
  check(questions.error ?? campaigns.error ?? countries.error);
  const num = (v: unknown) => (v == null ? null : Number(v));
  return {
    questions: (questions.data ?? []) as Question[],
    campaigns: ((campaigns.data ?? []) as Campaign[]).map((c) => ({ ...c, spend_medium_from: Number(c.spend_medium_from), spend_high_from: Number(c.spend_high_from) })),
    // Recipients and concerns are readable only by the people running the survey
    recipients: ((recipients.data ?? []) as Recipient[]).map((r) => ({ ...r, annual_spend: num(r.annual_spend) })),
    concerns: (concerns.data ?? []) as Concern[],
    countries: ((countries.data ?? []) as CountryRating[]).map((k) => ({ ...k, score: num(k.score) })),
    suppliers: (suppliers.data ?? []) as { id: string; name: string }[],
  };
}

export async function createCampaign(organisationId: string, c: { name: string; year: number; deadline: string; chaser1: string | null; chaser2: string | null; sender: string; statementId: string | null }) {
  const { data, error } = await db()
    .from("ms_campaigns")
    .insert({
      organisation_id: organisationId,
      name: c.name.trim(),
      survey_year: c.year,
      deadline: c.deadline,
      chaser1_on: c.chaser1,
      chaser2_on: c.chaser2,
      sender_email: c.sender.trim() || null,
      statement_id: c.statementId,
      ...DEFAULT_TEMPLATES,
    })
    .select("id")
    .single();
  check(error);
  return data!.id as string;
}
export async function updateCampaign(id: string, patch: Partial<Omit<Campaign, "id" | "status" | "closed_at">>) {
  check((await db().from("ms_campaigns").update(patch).eq("id", id)).error);
}
export async function addRecipient(organisationId: string, campaignId: string, r: { counterpartyId: string; name: string; email: string; spend: number | null }) {
  check(
    (
      await db()
        .from("ms_recipients")
        .insert({ organisation_id: organisationId, campaign_id: campaignId, counterparty_id: r.counterpartyId, contact_name: r.name.trim(), contact_email: r.email.trim(), annual_spend: r.spend, token: "set-by-the-database" })
    ).error,
  );
}
export async function removeRecipient(id: string) {
  check((await db().from("ms_recipients").delete().eq("id", id)).error);
}
export async function markSent(id: string, kind: EmailKind) {
  check((await db().from("ms_recipients").update({ [`${kind}_sent_at`]: new Date().toISOString() }).eq("id", id)).error);
}
export async function rateCampaign(id: string) {
  check((await db().rpc("rate_ms_campaign", { p_campaign: id })).error);
}
export async function decideConcern(id: string, decision: string) {
  check((await db().rpc("decide_ms_concern", { p_concern: id, p_decision: decision })).error);
}
export async function closeCampaign(id: string) {
  check((await db().rpc("close_ms_campaign", { p_campaign: id })).error);
}

/** Replaces the organisation's country ratings with the pasted table. Returns how many rows were read. */
export async function importCountryRatings(organisationId: string, pasted: string, source: string): Promise<number> {
  const rows: { organisation_id: string; country: string; rating: RiskLevel; score: number | null; source: string | null }[] = [];
  for (const [i, line] of pasted.split("\n").entries()) {
    if (!line.trim()) continue;
    const cells = line.split(/\t|,|;/).map((c) => c.trim());
    const rating = cells.map((c) => c.toLowerCase()).find((c): c is RiskLevel => c === "low" || c === "medium" || c === "high");
    if (!cells[0] || !rating) {
      // A first line with no rating is taken to be a heading
      if (i === 0) continue;
      throw new Error(`Line ${i + 1} needs a country and a rating of low, medium or high.`);
    }
    const score = cells.slice(1).map((c) => Number(c)).find((n) => Number.isFinite(n)) ?? null;
    rows.push({ organisation_id: organisationId, country: cells[0], rating, score, source: source.trim() || null });
  }
  if (rows.length === 0) throw new Error("Paste at least one line: a country, then low, medium or high.");
  const names = rows.map((r) => r.country.toLowerCase());
  if (new Set(names).size !== names.length) throw new Error("A country appears more than once.");
  const client = db();
  check((await client.from("ms_country_ratings").delete().eq("organisation_id", organisationId)).error);
  check((await client.from("ms_country_ratings").insert(rows)).error);
  return rows.length;
}

// ---- The supplier's side: no sign-in ----
export type PublicQuestionnaire = {
  organisation: string;
  supplier: string;
  contact_name: string;
  contact_email: string;
  deadline: string;
  closed: boolean;
  submitted_at: string | null;
  questions: Pick<Question, "code" | "section" | "prompt" | "kind" | "detail_prompt" | "detail_on">[];
};
export async function openQuestionnaire(token: string): Promise<PublicQuestionnaire> {
  const { data, error } = await db().rpc("ms_questionnaire", { p_token: token });
  check(error);
  return data as PublicQuestionnaire;
}
export async function submitQuestionnaire(token: string, who: { name: string; email: string; company: string }, answers: Record<string, Answer>, countries: string[]) {
  check(
    (await db().rpc("ms_submit_questionnaire", { p_token: token, p_name: who.name, p_email: who.email, p_company: who.company, p_answers: answers, p_countries: countries })).error,
  );
}
