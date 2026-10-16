import { supabase } from "./supabase";

// Finance details for each company (migration 0046)

export type BankAccount = {
  id: string;
  entity_id: string;
  bank: string;
  account_name: string;
  bsb: string | null;
  account_number: string | null;
  swift_bic: string | null;
  iban: string | null;
  currency: string;
  country: string;
  purpose: Purpose;
  is_main: boolean;
  signatories: string | null;
  authorisation_rule: string | null;
  online_banking: string | null;
  opened_on: string | null;
  closed_on: string | null;
  status: "open" | "closed";
  notes: string | null;
  details_changed_at: string | null;
  details_changed_by: string | null;
  verified_at: string | null;
  verified_by: string | null;
  verified_how: string | null;
};
export type Purpose = "operating" | "payroll" | "receipts" | "savings" | "term_deposit" | "trust" | "tax" | "loan" | "card" | "other";
export type AccountValues = Pick<BankAccount, "bank" | "account_name" | "bsb" | "account_number" | "swift_bic" | "iban" | "currency" | "country" | "purpose" | "is_main"
  | "signatories" | "authorisation_rule" | "online_banking" | "opened_on" | "closed_on" | "status" | "notes">;

export type FacilityKind = "overdraft" | "revolving" | "term_loan" | "trade_finance" | "credit_card" | "bank_guarantee" | "lease" | "invoice_finance" | "other";
export type Facility = {
  id: string;
  entity_id: string;
  lender: string;
  kind: FacilityKind;
  reference: string | null;
  limit_amount: number | null;
  currency: string;
  drawn_amount: number | null;
  drawn_as_at: string | null;
  interest_rate: string | null;
  fees: string | null;
  starts_on: string | null;
  maturity_on: string | null;
  review_on: string | null;
  security: string | null;
  guarantors: string | null;
  covenants: string | null;
  next_covenant_test_on: string | null;
  bank_account_id: string | null;
  status: "active" | "repaid" | "cancelled" | "expired";
  notes: string | null;
};
export type FacilityValues = Omit<Facility, "id" | "entity_id">;

export const PURPOSE_LABELS: Record<Purpose, string> = {
  operating: "Operating",
  payroll: "Payroll",
  receipts: "Receipts",
  savings: "Savings or cash management",
  term_deposit: "Term deposit",
  trust: "Trust account",
  tax: "Tax",
  loan: "Loan account",
  card: "Card account",
  other: "Other",
};
export const FACILITY_LABELS: Record<FacilityKind, string> = {
  overdraft: "Overdraft",
  revolving: "Revolving credit",
  term_loan: "Term loan",
  trade_finance: "Trade finance",
  credit_card: "Corporate cards",
  bank_guarantee: "Bank guarantee",
  lease: "Lease or equipment finance",
  invoice_finance: "Invoice finance",
  other: "Other",
};

export const blankAccount = (): AccountValues => ({
  bank: "", account_name: "", bsb: null, account_number: null, swift_bic: null, iban: null, currency: "AUD", country: "Australia", purpose: "operating", is_main: false,
  signatories: null, authorisation_rule: null, online_banking: null, opened_on: null, closed_on: null, status: "open", notes: null,
});
export const blankFacility = (): FacilityValues => ({
  lender: "", kind: "revolving", reference: null, limit_amount: null, currency: "AUD", drawn_amount: null, drawn_as_at: null, interest_rate: null, fees: null,
  starts_on: null, maturity_on: null, review_on: null, security: null, guarantors: null, covenants: null, next_covenant_test_on: null, bank_account_id: null,
  status: "active", notes: null,
});

function db() {
  if (!supabase) throw new Error("The site is not connected to its database.");
  return supabase;
}
function check(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}
const tidy = (v: object) => Object.fromEntries(Object.entries(v).map(([k, x]) => [k, typeof x === "string" ? x.trim() || null : x]));

export type FinanceData = { ready: boolean; accounts: BankAccount[]; facilities: Facility[]; people: { user_id: string | null; full_name: string }[] };

/** One company, or every company when entityId is null */
export async function loadFinance(organisationId: string, entityId: string | null): Promise<FinanceData> {
  const c = db();
  let a = c.from("bank_accounts").select("*").eq("organisation_id", organisationId);
  let f = c.from("credit_facilities").select("*").eq("organisation_id", organisationId);
  if (entityId) {
    a = a.eq("entity_id", entityId);
    f = f.eq("entity_id", entityId);
  }
  const [accounts, facilities, people] = await Promise.all([
    a.order("is_main", { ascending: false }).order("created_at"),
    f.order("created_at"),
    c.from("people").select("user_id, full_name").eq("organisation_id", organisationId),
  ]);
  if (accounts.error) return { ready: false, accounts: [], facilities: [], people: [] };
  return {
    ready: true,
    accounts: (accounts.data ?? []) as BankAccount[],
    facilities: ((facilities.data ?? []) as Facility[]).map((x) => ({ ...x, limit_amount: x.limit_amount == null ? null : Number(x.limit_amount), drawn_amount: x.drawn_amount == null ? null : Number(x.drawn_amount) })),
    people: (people.data ?? []) as FinanceData["people"],
  };
}

export async function saveAccount(organisationId: string, entityId: string, id: string | null, v: AccountValues) {
  if (id) check((await db().from("bank_accounts").update(tidy(v)).eq("id", id)).error);
  else check((await db().from("bank_accounts").insert({ ...tidy(v), organisation_id: organisationId, entity_id: entityId })).error);
}
export async function saveFacility(organisationId: string, entityId: string, id: string | null, v: FacilityValues) {
  if (id) check((await db().from("credit_facilities").update(tidy(v)).eq("id", id)).error);
  else check((await db().from("credit_facilities").insert({ ...tidy(v), organisation_id: organisationId, entity_id: entityId })).error);
}
export async function verifyAccount(id: string, how: string) {
  check((await db().rpc("verify_bank_account", { p_account: id, p_how: how })).error);
}
export async function currentUserId(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

/** Last four digits only, for lists and summaries */
export const masked = (n: string | null) => (n ? `···${n.slice(-4)}` : "");
export const accountLine = (a: BankAccount) =>
  a.bsb ? `BSB ${a.bsb} · Account ${a.account_number ?? ""}` : [a.account_number && `Account ${a.account_number}`, a.iban && `IBAN ${a.iban}`, a.swift_bic && `SWIFT ${a.swift_bic}`].filter(Boolean).join(" · ");
export const amount = (n: number | null, currency = "AUD") => (n == null ? "" : `${currency === "AUD" ? "$" : `${currency} `}${n.toLocaleString("en-AU", { maximumFractionDigits: 2 })}`);
export const daysUntil = (iso: string, today: string) => Math.round((new Date(`${iso}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / 86_400_000);
/** Unverified: never confirmed, or changed since it was confirmed */
export const unverified = (a: BankAccount) => a.status === "open" && !a.verified_at;
