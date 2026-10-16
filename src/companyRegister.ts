import { supabase } from "./supabase";

// Company register (migration 0047)

export type Officer = {
  id: string;
  entity_id: string;
  role: "director" | "alternate_director" | "chair" | "secretary" | "public_officer";
  appointed_on: string | null;
  ceased_on: string | null;
  person: { id: string; full_name: string; user_id: string | null };
};
export type OfficerDetails = {
  person_id: string;
  date_of_birth: string | null;
  place_of_birth: string | null;
  residential_address: string | null;
  former_names: string | null;
  director_id_confirmed_on: string | null;
  director_id: string | null;
};
export type DocCategory =
  | "certificate_of_registration" | "constitution" | "application_for_registration" | "asic_extract" | "company_statement" | "consent_to_act"
  | "share_certificate" | "member_application" | "resolution" | "shareholders_agreement" | "trust_deed" | "registered_office_consent" | "director_id" | "other";
export type CorporateDoc = {
  id: string;
  category: DocCategory;
  title: string;
  effective_on: string | null;
  person_id: string | null;
  share_movement_id: string | null;
  notes: string | null;
  created_at: string;
};
export type FilingKind = "appoint_officer" | "cease_officer" | "officer_details" | "registered_office" | "principal_place" | "ultimate_holding" | "company_name" | "solvency" | "other";
export type Filing = {
  id: string;
  form: "484" | "205" | "485" | "other";
  kind: FilingKind;
  title: string;
  detail: Record<string, unknown>;
  source_table: string | null;
  source_id: string | null;
  event_on: string | null;
  due_on: string | null;
  status: "to_check" | "to_lodge" | "lodged" | "not_required";
  lodged_on: string | null;
  reference: string | null;
  not_required_reason: string | null;
  created_at: string;
};
export type AnnualReview = {
  id: string;
  review_date: string;
  statement_received_on: string | null;
  details_checked_on: string | null;
  fee_paid_on: string | null;
  financial_report_lodged: boolean;
  solvency_outcome: "positive" | "negative" | null;
  solvency_resolution_on: string | null;
  resolution_id: string | null;
  form485_lodged_on: string | null;
  notes: string | null;
};

export const DOC_CATEGORIES: { id: DocCategory; label: string }[] = [
  { id: "certificate_of_registration", label: "Certificate of registration" },
  { id: "constitution", label: "Constitution" },
  { id: "application_for_registration", label: "Application for registration (Form 201)" },
  { id: "asic_extract", label: "ASIC company extract" },
  { id: "company_statement", label: "Annual company statement" },
  { id: "consent_to_act", label: "Consent to act (director or secretary)" },
  { id: "share_certificate", label: "Share certificate" },
  { id: "member_application", label: "Application for shares" },
  { id: "resolution", label: "Resolution or minutes" },
  { id: "shareholders_agreement", label: "Shareholders' agreement" },
  { id: "trust_deed", label: "Trust deed" },
  { id: "registered_office_consent", label: "Occupier's consent to registered office" },
  { id: "director_id", label: "Director ID confirmation" },
  { id: "other", label: "Other" },
];
export const docLabel = (c: DocCategory) => DOC_CATEGORIES.find((x) => x.id === c)?.label ?? c;
export const ROLE_LABELS: Record<Officer["role"], string> = {
  director: "Director",
  alternate_director: "Alternate director",
  chair: "Chair",
  secretary: "Company secretary",
  public_officer: "Public officer",
};
export const ASIC_ROLES: Officer["role"][] = ["director", "alternate_director", "secretary"];
export const FORM_LABELS: Record<Filing["form"], string> = { "484": "Form 484", "205": "Form 205", "485": "Form 485", other: "Other" };

function db() {
  if (!supabase) throw new Error("The site is not connected to its database.");
  return supabase;
}
function check(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}
const tidy = (v: object) => Object.fromEntries(Object.entries(v).map(([k, x]) => [k, typeof x === "string" ? x.trim() || null : x]));

export type RegisterData = {
  ready: boolean;
  officers: Officer[];
  details: OfficerDetails[];
  docs: CorporateDoc[];
  filings: Filing[];
  reviews: AnnualReview[];
};

export async function loadCompanyRegister(organisationId: string, entityId: string): Promise<RegisterData> {
  const c = db();
  const [officers, docs, filings, reviews] = await Promise.all([
    c.from("officeholdings").select("id, entity_id, role, appointed_on, ceased_on, person:people(id, full_name, user_id)").eq("entity_id", entityId).order("appointed_on", { ascending: true, nullsFirst: true }),
    c.from("corporate_documents").select("*").eq("entity_id", entityId).order("effective_on", { ascending: false }),
    c.from("asic_filings").select("*").eq("entity_id", entityId).order("created_at", { ascending: false }),
    c.from("annual_reviews").select("*").eq("entity_id", entityId).order("review_date", { ascending: false }),
  ]);
  if (docs.error) return { ready: false, officers: [], details: [], docs: [], filings: [], reviews: [] };
  const list = (officers.data ?? []) as unknown as Officer[];
  const ids = [...new Set(list.map((o) => o.person.id))];
  const details = ids.length ? await c.from("officer_details").select("*").eq("organisation_id", organisationId).in("person_id", ids) : { data: [] };
  return {
    ready: true,
    officers: list,
    details: (details.data ?? []) as OfficerDetails[],
    docs: (docs.data ?? []) as CorporateDoc[],
    filings: (filings.data ?? []) as Filing[],
    reviews: (reviews.data ?? []) as AnnualReview[],
  };
}

export async function updateCompany(entityId: string, patch: Record<string, unknown>) {
  check((await db().from("entities").update(tidy(patch)).eq("id", entityId)).error);
}
export async function appointOfficer(organisationId: string, entityId: string, v: { personId: string | null; fullName: string; role: Officer["role"]; appointedOn: string | null }) {
  let personId = v.personId;
  if (!personId) {
    const p = await db().from("people").insert({ organisation_id: organisationId, full_name: v.fullName.trim() }).select("id").single();
    check(p.error);
    personId = p.data!.id as string;
  }
  check((await db().from("officeholdings").insert({ organisation_id: organisationId, entity_id: entityId, person_id: personId, role: v.role, appointed_on: v.appointedOn })).error);
}
export async function setOfficerDates(id: string, patch: { appointed_on?: string | null; ceased_on?: string | null }) {
  check((await db().from("officeholdings").update(patch).eq("id", id)).error);
}
export async function saveOfficerDetails(organisationId: string, personId: string, exists: boolean, v: Omit<OfficerDetails, "person_id">) {
  if (exists) check((await db().from("officer_details").update(tidy(v)).eq("person_id", personId)).error);
  else check((await db().from("officer_details").insert({ ...tidy(v), person_id: personId, organisation_id: organisationId })).error);
}
export async function addDocument(organisationId: string, entityId: string, v: { category: DocCategory; title: string; effective_on: string | null; person_id: string | null; share_movement_id: string | null; notes: string | null }) {
  const { data, error } = await db().from("corporate_documents").insert({ ...tidy(v), organisation_id: organisationId, entity_id: entityId }).select("id").single();
  check(error);
  return data!.id as string;
}
export async function decideFiling(id: string, needed: boolean, eventOn: string | null, reason: string | null) {
  check((await db().rpc("decide_filing", { p_filing: id, p_needed: needed, p_event_on: eventOn, p_reason: reason })).error);
}
export async function lodgeFiling(id: string, lodgedOn: string, reference: string) {
  check((await db().rpc("lodge_filing", { p_filing: id, p_lodged_on: lodgedOn, p_reference: reference || null })).error);
}
export async function addFiling(entityId: string, form: Filing["form"], title: string, eventOn: string | null) {
  check((await db().rpc("add_asic_filing", { p_entity: entityId, p_form: form, p_title: title, p_event_on: eventOn })).error);
}
export async function saveReview(organisationId: string, entityId: string, existing: AnnualReview | undefined, reviewDate: string, patch: Partial<AnnualReview>) {
  const values = tidy(patch);
  if (existing) check((await db().from("annual_reviews").update(values).eq("id", existing.id)).error);
  else check((await db().from("annual_reviews").insert({ ...values, organisation_id: organisationId, entity_id: entityId, review_date: reviewDate })).error);
}

// ---------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------
export const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
export const addMonths = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setMonth(d.getMonth() + n);
  return d.toISOString().slice(0, 10);
};
/** The most recent annual review date on or before today (the registration anniversary), or null if not yet a year old */
export function currentReviewDate(incorporatedOn: string | null, today: string): string | null {
  if (!incorporatedOn) return null;
  const [, m, d] = incorporatedOn.split("-").map(Number);
  const y = Number(today.slice(0, 4));
  // The anniversary, with 29 February becoming 28 February in other years
  const on = (year: number) => `${year}-${String(m).padStart(2, "0")}-${String(Math.min(d, new Date(year, m, 0).getDate())).padStart(2, "0")}`;
  const r = on(y) <= today ? on(y) : on(y - 1);
  return r > incorporatedOn ? r : null;
}
export const nextReviewDate = (incorporatedOn: string | null, today: string) => {
  const cur = currentReviewDate(incorporatedOn, today);
  if (cur) return addMonths(cur, 12);
  if (!incorporatedOn) return null;
  return addMonths(incorporatedOn, 12);
};
