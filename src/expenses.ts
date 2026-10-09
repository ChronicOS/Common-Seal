import { supabase } from "./supabase";

export type ExpenseStatus = "draft" | "submitted" | "approved" | "rejected" | "paid";
export type Claim = {
  id: string;
  claimant_user_id: string;
  claimant_name: string;
  purpose: string;
  entity_id: string | null;
  status: ExpenseStatus;
  submitted_at: string | null;
  decided_at: string | null;
  decision_note: string | null;
  paid_at: string | null;
  created_at: string;
};
export type Line = {
  id: string;
  claim_id: string;
  incurred_on: string;
  category: string;
  description: string;
  amount: number;
  has_receipt: boolean;
  other_party: string | null;
  public_official: boolean;
  gift_entry_id: string | null;
};
export type ExpenseData = { claims: Claim[]; lines: Line[]; gifts: Record<string, string>; receiptThreshold: number };
export type NewLine = Omit<Line, "id" | "claim_id" | "gift_entry_id">;

export const EXPENSE_CATEGORIES = ["Travel", "Accommodation", "Meals", "Entertainment and hospitality", "Gifts", "Training and conferences", "Equipment and software", "Other"];
export const DECLARED_CATEGORIES = ["Entertainment and hospitality", "Gifts"];
export const EXPENSE_STATUS: Record<ExpenseStatus, string> = {
  draft: "Draft",
  submitted: "Awaiting decision",
  approved: "Approved, to be paid",
  rejected: "Rejected",
  paid: "Paid",
};

function db() {
  if (!supabase) throw new Error("The site is not connected to its database.");
  return supabase;
}
function check(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

export async function loadExpenses(organisationId: string): Promise<ExpenseData> {
  const client = db();
  const [claims, lines, gifts, org] = await Promise.all([
    client.from("expense_claims").select("*").eq("organisation_id", organisationId).order("created_at", { ascending: false }),
    client.from("expense_lines").select("*").eq("organisation_id", organisationId).order("incurred_on"),
    client.from("gift_entries").select("id, status").eq("organisation_id", organisationId),
    client.from("organisations").select("expense_receipt_threshold").eq("id", organisationId).maybeSingle(),
  ]);
  check(claims.error ?? lines.error);
  return {
    claims: (claims.data ?? []) as Claim[],
    lines: ((lines.data ?? []) as Line[]).map((l) => ({ ...l, amount: Number(l.amount) })),
    gifts: Object.fromEntries(((gifts.data ?? []) as { id: string; status: string }[]).map((g) => [g.id, g.status])),
    receiptThreshold: Number((org.data as { expense_receipt_threshold?: number } | null)?.expense_receipt_threshold ?? 82.5),
  };
}

export async function createClaim(organisationId: string, userId: string, name: string, purpose: string, entityId: string | null) {
  const { data, error } = await db()
    .from("expense_claims")
    .insert({ organisation_id: organisationId, claimant_user_id: userId, claimant_name: name.trim(), purpose: purpose.trim(), entity_id: entityId })
    .select("id")
    .single();
  check(error);
  return data!.id as string;
}
export async function addLine(organisationId: string, claimId: string, line: NewLine) {
  check((await db().from("expense_lines").insert({ organisation_id: organisationId, claim_id: claimId, ...line })).error);
}
export async function removeLine(lineId: string) {
  check((await db().from("expense_lines").delete().eq("id", lineId)).error);
}
/** Returns how many gift or hospitality declarations were made from the claim. */
export async function submitClaim(claimId: string) {
  const { data, error } = await db().rpc("submit_expense_claim", { p_claim: claimId });
  check(error);
  return Number(data ?? 0);
}
export async function decideClaim(claimId: string, approve: boolean, note: string) {
  check((await db().rpc("decide_expense_claim", { p_claim: claimId, p_approve: approve, p_note: note })).error);
}
export async function markPaid(claimId: string) {
  check((await db().rpc("mark_expense_paid", { p_claim: claimId })).error);
}

/** The reasons an approver should look twice at a line. */
export function lineFlags(line: Line, data: ExpenseData): string[] {
  const flags: string[] = [];
  if (!line.has_receipt && line.amount >= data.receiptThreshold) flags.push("No receipt");
  if (line.public_official) flags.push("Public official");
  const gift = line.gift_entry_id ? data.gifts[line.gift_entry_id] : null;
  if (gift === "pending") flags.push("Gift declaration awaiting decision");
  if (gift === "declined") flags.push("Gift declaration declined");
  return flags;
}

export type ExpenseSummary = { awaiting: number };
/** For the overview. Counts the claims this person can see that are waiting for a decision. */
export async function loadExpenseSummary(organisationId: string): Promise<ExpenseSummary> {
  const { data, error } = await db().from("expense_claims").select("id").eq("organisation_id", organisationId).eq("status", "submitted");
  return { awaiting: error ? 0 : (data ?? []).length };
}
