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
  counterparty: { id: string; name: string };
};

export type Approval = {
  id: string;
  contract_id: string;
  required_holder: string;
  basis: string;
  status: "pending" | "approved" | "rejected";
  decided_by: string | null;
  decided_at: string | null;
  on_behalf: boolean;
  comment: string | null;
  created_at: string;
};

export type Signature = { id: string; contract_id: string; capacity: string; signed_by: string; signed_on: string };
export type AuthorityException = { id: string; contract_id: string; kind: string; detail: string; created_at: string };
export type Reminder = { id: string; subject_id: string; title: string; due_at: string | null; status: string };

export type ContractsData = {
  contracts: Contract[];
  approvals: Approval[];
  signatures: Signature[];
  exceptions: AuthorityException[];
  reminders: Reminder[];
  counterparties: { id: string; name: string }[];
  people: { user_id: string | null; full_name: string }[];
};

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
      .select(
        "id, entity_id, title, transaction_type, value_amount, starts_on, ends_on, notice_by, auto_renews, summary, status, created_at, counterparty:counterparties(id, name)",
      )
      .eq("organisation_id", organisationId)
      .order("created_at", { ascending: false }),
    client
      .from("contract_approvals")
      .select("id, contract_id, required_holder, basis, status, decided_by, decided_at, on_behalf, comment, created_at")
      .eq("organisation_id", organisationId)
      .order("created_at", { ascending: false }),
    client
      .from("contract_signatures")
      .select("id, contract_id, capacity, signed_by, signed_on")
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
    client.from("counterparties").select("id, name").eq("organisation_id", organisationId).order("name"),
    client.from("people").select("user_id, full_name").eq("organisation_id", organisationId),
  ]);
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
    counterparties: (counterparties.data ?? []) as { id: string; name: string }[],
    people: (people.data ?? []) as { user_id: string | null; full_name: string }[],
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
export async function recordSignature(contractId: string, ruleId: string | null, signedBy: string, signedOn: string) {
  const { data, error } = await db().rpc("record_contract_signature", {
    p_contract: contractId,
    p_rule: ruleId,
    p_signed_by: signedBy,
    p_signed_on: signedOn,
  });
  check(error);
  return Number(data ?? 0);
}

export const EXCEPTION_LABELS: Record<string, string> = {
  signed_before_approval: "Signed before approval",
  signed_outside_authority: "Signed outside authority",
};
