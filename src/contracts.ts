import { supabase } from "./supabase";

export type ContractStatus = "draft" | "pending_approval" | "approved" | "rejected" | "signed" | "terminated";

export type Contract = {
  id: string;
  entity_id: string;
  title: string;
  transaction_type: string;
  value_amount: number | null;
  starts_on: string | null;
  ends_on: string | null;
  notice_by: string | null;
  auto_renews: boolean;
  summary: string | null;
  status: ContractStatus;
  created_at: string;
  /** The outside party; null for an intercompany arrangement. */
  counterparty: { id: string; name: string } | null;
  /** The other group entity, for an intercompany arrangement. */
  counterparty_entity_id?: string | null;
  arrangement_type?: string | null;
  pricing_basis?: string | null;
  interest_rate?: number | null;
};

export type Approval = {
  id: string;
  contract_id: string;
  /** Which side this approval is for. Absent on records made before intercompany was added. */
  entity_id?: string | null;
  required_holder: string;
  basis: string;
  status: "pending" | "approved" | "rejected";
  decided_by: string | null;
  decided_at: string | null;
  on_behalf: boolean;
  comment: string | null;
  created_at: string;
};

export type Signature = { id: string; contract_id: string; entity_id?: string | null; capacity: string; signed_by: string; signed_on: string };
export type AuthorityException = { id: string; contract_id: string; kind: string; detail: string; created_at: string };
export type Reminder = { id: string; subject_id: string; title: string; due_at: string | null; status: string };

export type ContractsData = {
  contracts: Contract[];
  approvals: Approval[];
  signatures: Signature[];
  exceptions: AuthorityException[];
  reminders: Reminder[];
  counterparties: { id: string; name: string; risk_rating?: string | null; dd_status?: string | null }[];
  people: { user_id: string | null; full_name: string }[];
  /** Latest sanctions assessment per third party (empty before migration 0038, or if not visible) */
  sanctions: { counterparty_id: string; status: string; outcome: string | null; licence_reference: string | null; next_screen_on: string | null; risk_level: string }[];
  /** Third parties recorded as out of scope for due diligence */
  exempt: string[];
};

/** What stands between a contract and its approval: blocks (the database refuses) and flags (warnings) */
export function partyGate(data: ContractsData, partyId: string | undefined, today: string): { blocks: string[]; flags: string[]; cleared: string[] } {
  const blocks: string[] = [];
  const flags: string[] = [];
  const cleared: string[] = [];
  if (!partyId) return { blocks, flags, cleared };
  const p = data.counterparties.find((x) => x.id === partyId);
  if (!p?.dd_status) {
    if (data.exempt.includes(partyId)) cleared.push("Recorded as out of scope for due diligence.");
    else flags.push("No due diligence on record for the other party.");
  } else if (p.dd_status === "rejected") blocks.push("The other party was rejected in due diligence.");
  else if (p.dd_status === "open") blocks.push("Due diligence on the other party is not finished.");
  else cleared.push(`Due diligence: cleared${p.dd_status === "cleared_with_conditions" ? " with conditions" : ""} (${p.risk_rating ?? "unrated"} risk).`);
  const s = data.sanctions.find((x) => x.counterparty_id === partyId);
  if (!s) flags.push("No sanctions assessment for the other party.");
  else if (s.status === "draft" || s.status === "submitted") blocks.push("The sanctions assessment is not decided.");
  else if (s.outcome === "do_not_proceed") blocks.push("The sanctions decision is do not proceed.");
  else if (s.outcome === "licence_required" && !s.licence_reference) blocks.push("A sanctions permit or licence is needed first.");
  else if (s.next_screen_on && s.next_screen_on < today) blocks.push("The sanctions re-screen is overdue.");
  else cleared.push(`Sanctions: ${s.outcome === "licence_required" ? "permit recorded" : s.outcome === "proceed_conditions" ? "proceed with conditions" : "proceed"}${s.next_screen_on ? `, re-screen by ${s.next_screen_on}` : ""}.`);
  return { blocks, flags, cleared };
}

export const CONTRACT_STATUS: Record<ContractStatus, string> = {
  draft: "Draft",
  pending_approval: "Awaiting approval",
  approved: "Approved, awaiting signature",
  rejected: "Not approved",
  signed: "Signed",
  terminated: "Terminated",
};

function db() {
  if (!supabase) throw new Error("The site is not connected to its database.");
  return supabase;
}

function check(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

export async function loadContracts(organisationId: string): Promise<ContractsData> {
  const client = db();
  const [contracts, approvals, signatures, exceptions, reminders, counterparties, people] = await Promise.all([
    client
      .from("contracts")
      .select("*, counterparty:counterparties(id, name)")
      .eq("organisation_id", organisationId)
      .order("created_at", { ascending: false }),
    client
      .from("contract_approvals")
      .select("*")
      .eq("organisation_id", organisationId)
      .order("created_at", { ascending: false }),
    client
      .from("contract_signatures")
      .select("*")
      .eq("organisation_id", organisationId),
    client
      .from("authority_exceptions")
      .select("id, contract_id, kind, detail, created_at")
      .eq("organisation_id", organisationId)
      .order("created_at", { ascending: false }),
    client
      .from("tasks")
      .select("id, subject_id, title, due_at, status")
      .eq("organisation_id", organisationId)
      .eq("subject_table", "contracts")
      .order("due_at"),
    client.from("counterparties").select("*").eq("organisation_id", organisationId).order("name"),
    client.from("people").select("user_id, full_name").eq("organisation_id", organisationId),
  ]);
  const [sanctions, exempt] = await Promise.all([
    client.from("sanctions_assessments").select("counterparty_id, status, outcome, licence_reference, next_screen_on, risk_level, created_at").eq("organisation_id", organisationId).neq("status", "withdrawn").not("counterparty_id", "is", null).order("created_at", { ascending: false }),
    client.from("dd_exemptions").select("counterparty_id").eq("organisation_id", organisationId),
  ]);
  const latest = new Map<string, ContractsData["sanctions"][number]>();
  for (const r of (sanctions.data ?? []) as ContractsData["sanctions"]) if (!latest.has(r.counterparty_id)) latest.set(r.counterparty_id, r);
  check(
    contracts.error ??
      approvals.error ??
      signatures.error ??
      exceptions.error ??
      reminders.error ??
      counterparties.error ??
      people.error,
  );
  return {
    contracts: ((contracts.data ?? []) as unknown as Contract[]).map((c) => ({
      ...c,
      value_amount: c.value_amount == null ? null : Number(c.value_amount),
    })),
    approvals: (approvals.data ?? []) as Approval[],
    signatures: (signatures.data ?? []) as Signature[],
    exceptions: (exceptions.data ?? []) as AuthorityException[],
    reminders: (reminders.data ?? []) as Reminder[],
    counterparties: (counterparties.data ?? []) as ContractsData["counterparties"],
    people: (people.data ?? []) as { user_id: string | null; full_name: string }[],
    sanctions: [...latest.values()],
    exempt: ((exempt.data ?? []) as { counterparty_id: string }[]).map((x) => x.counterparty_id),
  };
}

export type NewContract = {
  entityId: string;
  counterpartyName: string;
  title: string;
  transactionType: string;
  value: number | null;
  startsOn: string | null;
  endsOn: string | null;
  noticeBy: string | null;
  autoRenews: boolean;
  summary: string;
};

/** Files the contract and sends it for approval. The approver is worked out by the database from the delegation rules. */
export async function fileContract(organisationId: string, data: ContractsData, c: NewContract): Promise<string> {
  const client = db();
  const name = c.counterpartyName.trim();
  let counterpartyId = data.counterparties.find((p) => p.name.toLowerCase() === name.toLowerCase())?.id;
  if (!counterpartyId) {
    const created = await client
      .from("counterparties")
      .insert({ organisation_id: organisationId, name })
      .select("id")
      .single();
    check(created.error);
    counterpartyId = created.data!.id as string;
  }
  const contract = await client
    .from("contracts")
    .insert({
      organisation_id: organisationId,
      entity_id: c.entityId,
      counterparty_id: counterpartyId,
      title: c.title.trim(),
      transaction_type: c.transactionType.trim() || "Any",
      value_amount: c.value,
      starts_on: c.startsOn,
      ends_on: c.endsOn,
      notice_by: c.noticeBy,
      auto_renews: c.autoRenews,
      summary: c.summary.trim() || null,
    })
    .select("id")
    .single();
  check(contract.error);
  const id = contract.data!.id as string;
  check((await client.rpc("submit_contract", { p_contract: id })).error);
  return id;
}

export async function resubmitContract(contractId: string) {
  check((await db().rpc("submit_contract", { p_contract: contractId })).error);
}

export async function decideApproval(approvalId: string, approve: boolean, comment: string) {
  check(
    (await db().rpc("decide_contract_approval", { p_approval: approvalId, p_approve: approve, p_comment: comment })).error,
  );
}

/** Returns the number of exceptions the signature raised. */
export async function recordSignature(
  contractId: string,
  ruleId: string | null,
  signedBy: string,
  signedOn: string,
  entityId?: string,
) {
  const args: Record<string, unknown> = {
    p_contract: contractId,
    p_rule: ruleId,
    p_signed_by: signedBy,
    p_signed_on: signedOn,
  };
  // Only sent for intercompany arrangements, so ordinary contracts work before that migration is run.
  if (entityId) args.p_entity = entityId;
  const { data, error } = await db().rpc("record_contract_signature", args);
  check(error);
  return Number(data ?? 0);
}

export const EXCEPTION_LABELS: Record<string, string> = {
  signed_before_approval: "Signed before approval",
  signed_outside_authority: "Signed outside authority",
};

export const ARRANGEMENT_TYPES = [
  "Services",
  "Loan",
  "Distribution",
  "Intellectual property licence",
  "Cost sharing",
  "Guarantee",
  "Secondment",
];
export const INTERCOMPANY_TYPE = "Intercompany";

export type NewArrangement = {
  providerId: string;
  recipientId: string;
  arrangementType: string;
  title: string;
  value: number | null;
  pricingBasis: string;
  interestRate: number | null;
  startsOn: string | null;
  endsOn: string | null;
  reviewBy: string | null;
};

/** Files an intercompany arrangement and sends it to both sides for approval. */
export async function fileArrangement(organisationId: string, a: NewArrangement): Promise<string> {
  const client = db();
  const contract = await client
    .from("contracts")
    .insert({
      organisation_id: organisationId,
      entity_id: a.providerId,
      counterparty_entity_id: a.recipientId,
      title: a.title.trim(),
      transaction_type: INTERCOMPANY_TYPE,
      arrangement_type: a.arrangementType,
      value_amount: a.value,
      pricing_basis: a.pricingBasis.trim() || null,
      interest_rate: a.interestRate,
      starts_on: a.startsOn,
      ends_on: a.endsOn,
      notice_by: a.reviewBy,
    })
    .select("id")
    .single();
  check(contract.error);
  const id = contract.data!.id as string;
  check((await client.rpc("submit_contract", { p_contract: id })).error);
  return id;
}
