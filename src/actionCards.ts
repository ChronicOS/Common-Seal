import { supabase } from "./supabase";
import { has } from "./roles";

/** Action cards: one decision each, for one person or role (migration 0070) */

function db() {
  if (!supabase) throw new Error("The site is not connected to its database.");
  return supabase;
}
const check = (e: { message: string } | null) => {
  if (e) throw new Error(/does not exist|schema cache|could not find/i.test(e.message) ? "Action cards need migration 0070 to be run in Supabase." : e.message);
};

export type CardKind = "minutes_approve" | "minutes_sign" | "minutes_revise" | "action_assigned" | "action_date" | "interest_update" | "follow_up";
export type ActionCard = {
  id: string; kind: CardKind; subject_table: string; subject_id: string; title: string; summary: string | null; decision: string; on_approval: string | null;
  evidence: { label: string; quote: string }[]; flags: string[]; payload: Record<string, unknown>; assignee_user_id: string | null; assignee_roles: string[] | null;
  prepared_by: string; status: string; due_on: string | null; created_at: string; first_seen_at: string | null;
};
export type Decision = "approve" | "change" | "send_back" | "done" | "ask_date";

/** Open cards this person decides (the records roles can see others' cards too, for oversight, but they are not shown here) */
export async function loadMyCards(organisationId: string, userId: string, role: string): Promise<ActionCard[]> {
  const { data, error } = await db().from("action_cards").select("*").eq("organisation_id", organisationId).eq("status", "open").order("due_on", { ascending: true, nullsFirst: false });
  if (error) {
    if (/does not exist|schema cache/i.test(error.message)) return [];
    throw new Error(error.message);
  }
  return ((data ?? []) as ActionCard[]).filter((c) => c.assignee_user_id === userId || (!c.assignee_user_id && (c.assignee_roles ?? []).some((r) => has(role, r))));
}

export async function cardSeen(id: string) {
  await db().rpc("card_seen", { p_card: id });
}

export async function decideCard(id: string, decision: Decision, note?: string, payload?: Record<string, unknown>) {
  const r = await db().rpc("decide_card", { p_card: id, p_decision: decision, p_note: note ?? null, p_payload: payload ?? {} });
  check(r.error);
  return r.data as string;
}

export async function loadMinutesText(minutesId: string): Promise<string> {
  const { data, error } = await db().from("minutes").select("content").eq("id", minutesId).maybeSingle();
  check(error);
  return (data as { content: string } | null)?.content ?? "";
}

export async function submitMinutes(meetingId: string, content: string) {
  check((await db().rpc("submit_minutes", { p_meeting: meetingId, p_content: content })).error);
}
