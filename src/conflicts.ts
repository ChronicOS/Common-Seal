import { supabase } from "./supabase";

// Conflict of interest register (conflict_declarations, extended by migration 0034).

export type ConflictType = "personal" | "financial";
export type RiskLevel = "actual" | "potential" | "perceived";
export type Status = "open" | "managed" | "closed";
export type ConflictRow = {
  id: string;
  declared_by: string | null;
  person_name: string;
  person_user_id: string | null;
  person_position: string | null;
  entity_id: string | null;
  description: string;
  related_party: string | null;
  conflict_type: ConflictType | null;
  risk_level: RiskLevel | null;
  declared_on: string;
  status: Status;
  management_plan: string | null;
  review_on: string | null;
  reviewed_at: string | null;
};

export const TYPES: { value: ConflictType; label: string; help: string }[] = [
  {
    value: "personal",
    label: "Personal conflict of interest",
    help: "Arises from personal relationships, family ties, friendships or loyalties that can consciously or unconsciously sway professional judgement.",
  },
  {
    value: "financial",
    label: "Financial conflict of interest",
    help: "Arises when a person or organisation stands to gain or lose money, equity, shares or paid contracts from a decision or outcome, such as shares in a vendor or competitor.",
  },
];
export const LEVELS: { value: RiskLevel; label: string; help: string }[] = [
  { value: "actual", label: "Actual conflict", help: "A direct, active clash between private interests and official duties." },
  { value: "potential", label: "Potential conflict", help: "Private interests could foreseeably turn into a clash with duties in the future." },
  { value: "perceived", label: "Perceived (apparent) conflict", help: "No actual wrongdoing, but an outside observer could reasonably suspect that personal interests are influencing decisions." },
];
export const STATUS: Record<Status, string> = { open: "Open: not yet assessed", managed: "Managed", closed: "Closed" };
export const typeLabel = (t: ConflictType | null) => TYPES.find((x) => x.value === t)?.label.replace(" conflict of interest", "") ?? "Not recorded";
export const levelLabel = (l: RiskLevel | null) => LEVELS.find((x) => x.value === l)?.label.replace(" conflict", "").replace(" (apparent)", "") ?? "Not recorded";

function db() {
  if (!supabase) throw new Error("The site is not connected to its database.");
  return supabase;
}
function check(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

export async function loadConflicts(organisationId: string): Promise<ConflictRow[]> {
  const client = db();
  const read = (columns: string) => client.from("conflict_declarations").select(columns)
.eq("organisation_id", organisationId).order("declared_on", { ascending: false });
  let { data, error } = await read("id, declared_by, person_name, person_user_id, person_position, entity_id, description, related_party, conflict_type, risk_level, declared_on, status, management_plan, review_on, reviewed_at");
  // Before migration 0034 the register columns do not exist yet
  if (error) ({ data, error } = await read("id, declared_by, person_name, description, related_party, declared_on, status, management_plan, reviewed_at"));
  check(error);
  return ((data ?? []) as unknown as Partial<ConflictRow>[]).map((c) => ({
    person_user_id: null,
    person_position: null,
    entity_id: null,
    conflict_type: null,
    risk_level: null,
    review_on: null,
    ...c,
  })) as ConflictRow[];
}

export async function declare(
  organisationId: string,
  c: { personName: string; personUserId: string | null; position: string; entityId: string | null; type: ConflictType; level: RiskLevel; description: string; relatedParty: string },
) {
  check(
    (
      await db().from("conflict_declarations").insert({
        organisation_id: organisationId,
        person_name: c.personName.trim(),
        person_user_id: c.personUserId,
        person_position: c.position.trim() || null,
        entity_id: c.entityId,
        conflict_type: c.type,
        risk_level: c.level,
        description: c.description.trim(),
        related_party: c.relatedParty.trim() || null,
      })
    ).error,
  );
}

export async function assess(id: string, patch: { status: Status; risk_level: RiskLevel; management_plan: string; review_on: string }) {
  check(
    (
      await db()
        .from("conflict_declarations")
        .update({ status: patch.status, risk_level: patch.risk_level, management_plan: patch.management_plan.trim() || null, review_on: patch.review_on || null })
        .eq("id", id)
    ).error,
  );
}
