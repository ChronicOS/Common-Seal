import { supabase } from "./supabase";

/** Filing contracts: agreement types, business functions, families and names (migration 0068) */

function db() {
  if (!supabase) throw new Error("The site is not connected to its database.");
  return supabase;
}

export const AGREEMENT_TYPES: { code: string; label: string; group: string }[] = [
  { code: "NDA", label: "Confidentiality (NDA)", group: "Confidentiality" },
  { code: "SUP", label: "Supply", group: "Buying" },
  { code: "MSA", label: "Master services", group: "Buying" },
  { code: "SOW", label: "Statement of work or order", group: "Buying" },
  { code: "SVC", label: "Services", group: "Buying" },
  { code: "SAAS", label: "Software and SaaS", group: "Buying" },
  { code: "DIST", label: "Distribution", group: "Selling" },
  { code: "AGY", label: "Agency", group: "Selling" },
  { code: "CUST", label: "Customer terms", group: "Selling" },
  { code: "LIC", label: "Licence", group: "IP and R&D" },
  { code: "IPA", label: "IP assignment", group: "IP and R&D" },
  { code: "RD", label: "Research and collaboration", group: "IP and R&D" },
  { code: "QA", label: "Quality agreement", group: "Regulatory and quality" },
  { code: "PV", label: "Pharmacovigilance", group: "Regulatory and quality" },
  { code: "DPA", label: "Data processing", group: "Regulatory and quality" },
  { code: "LEASE", label: "Lease", group: "Property" },
  { code: "LOAN", label: "Loan", group: "Finance" },
  { code: "GTEE", label: "Guarantee", group: "Finance" },
  { code: "SHA", label: "Shareholders", group: "Corporate" },
  { code: "SPA", label: "Sale and purchase", group: "Corporate" },
  { code: "JV", label: "Joint venture", group: "Corporate" },
  { code: "TERMS", label: "Online terms", group: "Online" },
  { code: "OTH", label: "Other", group: "Other" },
];
export const TYPE_GROUPS = [...new Set(AGREEMENT_TYPES.map((t) => t.group))];
export const typeLabel = (code: string | null | undefined, other?: string | null) =>
  code === "OTH" && other ? other : AGREEMENT_TYPES.find((t) => t.code === code)?.label ?? "Not classified";

export const FUNCTIONS: Record<string, string> = {
  commercial: "Sales and commercial",
  marketing: "Marketing",
  procurement: "Supply chain and procurement",
  operations: "Operations and manufacturing",
  finance: "Finance",
  it: "IT",
  people: "People",
  rdq: "R&D, regulatory and quality",
  legal: "Legal and corporate",
};

export const FAMILY_ROLES: Record<string, string> = {
  amendment: "Amendment",
  sow: "Statement of work",
  variation: "Variation",
  renewal: "Renewal",
  side_letter: "Side letter",
};

const SUFFIX =
  /[,.]?\s+(pty\.?\s*(ltd|limited)\.?|proprietary\s+limited|limited|ltd\.?|inc\.?|incorporated|llc|l\.l\.c\.|plc|gmbh|ag|s\.?a\.?|b\.?v\.?|n\.?v\.?|pte\.?\s*ltd\.?|sdn\.?\s*bhd\.?|corporation|corp\.?|co\.?|k\.?k\.?|s\.?r\.?l\.?|oy|ab|as)\s*$/i;
export const shortParty = (name: string) => name.trim().replace(SUFFIX, "").replace(/\s+/g, " ").trim();

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthYear = (iso: string | null | undefined) => (iso && /^\d{4}-\d{2}/.test(iso) ? `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}` : "Undated");

/** A preview of the filing name. The database sets the real one (and adds (2) if it clashes). Mirrors app.contract_base_name. */
export function previewName(v: { type: string; other?: string; party: string; start?: string; signedOn?: string; role?: string; parentName?: string | null; signed: boolean }) {
  if (v.parentName && v.role) {
    const base = v.parentName.replace(/( - DRAFT)?( \(\d+\))?$/, "");
    return `${base} - ${v.role === "sow" ? "SOW" : FAMILY_ROLES[v.role] ?? "Amendment"} …${v.signed ? "" : " - DRAFT"}`;
  }
  const type = v.type === "OTH" && v.other?.trim() ? v.other.trim() : v.type || "OTH";
  return `${type} - ${shortParty(v.party) || "Unknown party"} - ${monthYear(v.start || v.signedOn)}${v.signed ? "" : " - DRAFT"}`;
}

export type SignatoryCheck = { verdict: "authorised" | "outside" | "check"; summary: string; notes?: string[]; s127?: string | null; group?: string; scope?: string; checked_at?: string };
export const VERDICT_LABEL: Record<SignatoryCheck["verdict"], string> = { authorised: "Within authority", outside: "Outside authority", check: "Needs checking" };

export const signatoryText = (list: { name: string; title?: string | null }[] | null | undefined) =>
  (list ?? []).map((s) => (s.title ? `${s.name} (${s.title})` : s.name)).join("; ");

const missing = (m: string) => (/could not find the function|schema cache|does not exist/i.test(m) ? "This needs migration 0068 to be run in Supabase." : m);

export async function setFiling(contractId: string, f: { type: string; other: string; fn: string; parentId: string | null; role: string; name: string; value: number | null; basis: string }) {
  const r = await db().rpc("set_contract_filing", {
    p_contract: contractId, p_type: f.type, p_type_other: f.other, p_function: f.fn, p_parent: f.parentId, p_role: f.role, p_name: f.name, p_value: f.value, p_value_basis: f.basis,
  });
  if (r.error) throw new Error(missing(r.error.message));
  return r.data as string;
}

export async function setSignatories(contractId: string, signatories: string, signedOn: string | null) {
  const r = await db().rpc("set_contract_signatories", { p_contract: contractId, p_signatories: signatories, p_signed_on: signedOn || null });
  if (r.error) throw new Error(missing(r.error.message));
  return r.data as SignatoryCheck;
}
