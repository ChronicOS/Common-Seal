import { supabase } from "./supabase";

export type Round = { id: string; name: string; due_on: string; status: "open" | "closed"; closed_at: string | null; closing_note: string | null; created_at: string };
export type AttestationItem = {
  id: string;
  round_id: string;
  subject_table: "register_entries" | "policies";
  title: string;
  statement: string;
  attester_user_id: string | null;
  attester_name: string | null;
  response: "confirmed" | "exception" | null;
  comment: string | null;
  responded_at: string | null;
};
export type AttestationData = { rounds: Round[]; items: AttestationItem[] };
export type RoundTally = { total: number; confirmed: number; exceptions: number; waiting: number; nobody: number };

function db() {
  if (!supabase) throw new Error("The site is not connected to its database.");
  return supabase;
}
function check(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

export async function loadAttestations(organisationId: string): Promise<AttestationData> {
  const client = db();
  const [rounds, items] = await Promise.all([
    client.from("attestation_rounds").select("*").eq("organisation_id", organisationId).order("created_at", { ascending: false }),
    client.from("attestation_items").select("*").eq("organisation_id", organisationId).order("title"),
  ]);
  check(rounds.error ?? items.error);
  return { rounds: (rounds.data ?? []) as Round[], items: (items.data ?? []) as AttestationItem[] };
}

/** An item nobody can answer is counted on its own. It is never treated as confirmed. */
export function tally(items: AttestationItem[]): RoundTally {
  return {
    total: items.length,
    confirmed: items.filter((i) => i.response === "confirmed").length,
    exceptions: items.filter((i) => i.response === "exception").length,
    waiting: items.filter((i) => !i.response && i.attester_user_id).length,
    nobody: items.filter((i) => !i.response && !i.attester_user_id).length,
  };
}

export async function openRound(organisationId: string, name: string, dueOn: string) {
  check((await db().rpc("open_attestation_round", { p_org: organisationId, p_name: name, p_due: dueOn })).error);
}
export async function respond(itemId: string, confirm: boolean, comment: string) {
  check((await db().rpc("respond_attestation", { p_item: itemId, p_confirm: confirm, p_comment: comment })).error);
}
export async function closeRound(roundId: string, note: string) {
  check((await db().rpc("close_attestation_round", { p_round: roundId, p_note: note })).error);
}
