import { supabase } from "./supabase";

export type Gift = {
  id: string;
  declared_by: string | null;
  staff_name: string;
  direction: "given" | "received";
  other_party: string;
  description: string;
  value_amount: number;
  occurred_on: string;
  public_official: boolean;
  status: "recorded" | "pending" | "approved" | "declined";
  decision_note: string | null;
};

export type Conflict = {
  id: string;
  person_name: string;
  description: string;
  related_party: string | null;
  declared_on: string;
  status: "open" | "managed" | "closed";
  management_plan: string | null;
};

export const GIFT_STATUS: Record<Gift["status"], string> = {
  recorded: "Recorded",
  pending: "Awaiting decision",
  approved: "Approved",
  declined: "Declined",
};
export const CONFLICT_STATUS: Record<Conflict["status"], string> = { open: "Open", managed: "Managed", closed: "Closed" };

function db() {
  if (!supabase) throw new Error("The site is not connected to its database.");
  return supabase;
}

function check(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

export async function loadDeclarations(organisationId: string): Promise<{ gifts: Gift[]; conflicts: Conflict[] }> {
  const client = db();
  const [gifts, conflicts] = await Promise.all([
    client
      .from("gift_entries")
      .select("id, declared_by, staff_name, direction, other_party, description, value_amount, occurred_on, public_official, status, decision_note")
      .eq("organisation_id", organisationId)
      .order("occurred_on", { ascending: false }),
    client
      .from("conflict_declarations")
      .select("id, person_name, description, related_party, declared_on, status, management_plan")
      .eq("organisation_id", organisationId)
      .order("declared_on", { ascending: false }),
  ]);
  check(gifts.error ?? conflicts.error);
  return {
    gifts: ((gifts.data ?? []) as Gift[]).map((g) => ({ ...g, value_amount: Number(g.value_amount) })),
    conflicts: (conflicts.data ?? []) as Conflict[],
  };
}

export async function declareGift(
  organisationId: string,
  g: Pick<Gift, "staff_name" | "direction" | "other_party" | "description" | "value_amount" | "occurred_on" | "public_official">,
): Promise<Gift["status"]> {
  const { data, error } = await db()
    .from("gift_entries")
    .insert({ organisation_id: organisationId, ...g })
    .select("status")
    .single();
  check(error);
  return data!.status as Gift["status"];
}

export async function decideGift(id: string, status: "approved" | "declined", note: string) {
  check((await db().from("gift_entries").update({ status, decision_note: note.trim() || null }).eq("id", id)).error);
}

export async function declareConflict(organisationId: string, personName: string, description: string, relatedParty: string) {
  check(
    (
      await db().from("conflict_declarations").insert({
        organisation_id: organisationId,
        person_name: personName.trim(),
        description: description.trim(),
        related_party: relatedParty.trim() || null,
      })
    ).error,
  );
}

export async function reviewConflict(id: string, status: Conflict["status"], plan: string) {
  check(
    (await db().from("conflict_declarations").update({ status, management_plan: plan.trim() || null }).eq("id", id)).error,
  );
}
