import { supabase } from "./supabase";
import type { Entity } from "./types";

export type Level = "local" | "regional" | "global";
export type Kind = "risk" | "obligation";
export type EntryStatus = "proposed" | "active" | "closed";
export type Raci = "responsible" | "accountable" | "consulted" | "informed";

export type Entry = {
  id: string;
  level: Level;
  entity_id: string | null;
  region: string | null;
  kind: Kind;
  category: string;
  title: string;
  description: string | null;
  controls: string | null;
  likelihood: number | null;
  impact: number | null;
  review_on: string | null;
  review_every_months: number;
  last_reviewed_on: string | null;
  status: EntryStatus;
  source: "manual" | "template";
};

export type Assignment = {
  id: string;
  entry_id: string;
  raci: Raci;
  is_backup: boolean;
  person: { id: string; full_name: string };
};

export type RegisterData = {
  entries: Entry[];
  assignments: Assignment[];
  people: { id: string; full_name: string }[];
  sectors: string[];
};

export const CATEGORIES = [
  "Commercial",
  "Financial",
  "Legal",
  "Cyber and IT",
  "AI",
  "Regulatory",
  "Training",
  "People",
  "Disputes",
];
export const SECTOR_LABELS: Record<string, string> = {
  "Financial services": "Financial services",
  "Consumer goods": "Consumer goods, including pharma",
};
export const LEVEL_LABELS: Record<Level, string> = { local: "Local", regional: "Regional", global: "Global" };
export const RACI_LABELS: Record<Raci, { name: string; meaning: string }> = {
  responsible: { name: "Responsible", meaning: "Does the work and keeps the evidence" },
  accountable: { name: "Accountable", meaning: "The one person who answers for it" },
  consulted: { name: "Consulted", meaning: "Gives input before a decision" },
  informed: { name: "Informed", meaning: "Told when the status changes" },
};
export const LIKELIHOOD = ["Rare", "Unlikely", "Possible", "Likely", "Almost certain"];
export const IMPACT = ["Insignificant", "Minor", "Moderate", "Major", "Severe"];

function db() {
  if (!supabase) throw new Error("The site is not connected to its database.");
  return supabase;
}

function check(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

export const localDate = (offsetDays = 0, from = new Date()) => {
  const d = new Date(from);
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export async function loadRegister(organisationId: string): Promise<RegisterData> {
  const client = db();
  const [entries, assignments, people, templates] = await Promise.all([
    client
      .from("register_entries")
      .select(
        "id, level, entity_id, region, kind, category, title, description, controls, likelihood, impact, review_on, review_every_months, last_reviewed_on, status, source",
      )
      .eq("organisation_id", organisationId)
      .order("created_at"),
    client
      .from("register_assignments")
      .select("id, entry_id, raci, is_backup, person:people(id, full_name)")
      .eq("organisation_id", organisationId)
      .order("created_at"),
    client.from("people").select("id, full_name").eq("organisation_id", organisationId).order("full_name"),
    client.from("register_templates").select("sector"),
  ]);
  check(entries.error ?? assignments.error ?? people.error ?? templates.error);
  return {
    entries: (entries.data ?? []) as Entry[],
    assignments: (assignments.data ?? []) as unknown as Assignment[],
    people: (people.data ?? []) as { id: string; full_name: string }[],
    sectors: [...new Set(((templates.data ?? []) as { sector: string }[]).map((t) => t.sector))].sort(),
  };
}

export type Scope = { level: Level; entityId?: string; region?: string };

/** Entries in view at a level: its own, plus everything rolled up from the levels beneath it. */
export function entriesInScope(data: RegisterData, entities: Entity[], scope: Scope): Entry[] {
  if (scope.level === "global") return data.entries;
  if (scope.level === "regional") {
    const inRegion = new Set(entities.filter((e) => e.region === scope.region).map((e) => e.id));
    return data.entries.filter(
      (e) =>
        (e.level === "regional" && e.region === scope.region) ||
        (e.level === "local" && e.entity_id !== null && inRegion.has(e.entity_id)),
    );
  }
  return data.entries.filter((e) => e.level === "local" && e.entity_id === scope.entityId);
}

export function regions(data: RegisterData, entities: Entity[]): string[] {
  return [
    ...new Set([
      ...entities.map((e) => e.region).filter((r): r is string => Boolean(r)),
      ...data.entries.map((e) => e.region).filter((r): r is string => Boolean(r)),
    ]),
  ].sort();
}

export function origin(entry: Entry, entities: Entity[]): string {
  if (entry.level === "global") return "Group";
  if (entry.level === "regional") return entry.region ?? "Region";
  return entities.find((e) => e.id === entry.entity_id)?.name ?? "Entity";
}

export function rating(entry: Entry): { score: number; label: string } | null {
  if (!entry.likelihood || !entry.impact) return null;
  const score = entry.likelihood * entry.impact;
  return { score, label: score >= 17 ? "Critical" : score >= 10 ? "High" : score >= 5 ? "Medium" : "Low" };
}

/** Ownership gaps: missing owners and missing backups. */
export function gaps(entry: Entry, assignments: Assignment[]): string[] {
  const mine = assignments.filter((a) => a.entry_id === entry.id);
  const has = (raci: Raci, backup: boolean) => mine.some((a) => a.raci === raci && a.is_backup === backup);
  const found: string[] = [];
  if (!has("accountable", false)) found.push("No one is accountable");
  if (!has("responsible", false)) found.push("No one is responsible");
  if (has("accountable", false) && !has("accountable", true)) found.push("No backup for the accountable person");
  if (has("responsible", false) && !has("responsible", true)) found.push("No backup for the responsible person");
  return found;
}

/** How far an overdue review has escalated. The steps are 7, 14 and 30 days. */
export function escalation(entry: Entry): { days: number; to: string } | null {
  if (entry.status !== "active" || !entry.review_on) return null;
  const today = localDate();
  if (entry.review_on >= today) return null;
  const days = Math.round((Date.parse(today) - Date.parse(entry.review_on)) / 86_400_000);
  const to =
    days <= 7
      ? "the responsible person"
      : days <= 14
        ? "the accountable person"
        : days <= 30
          ? entry.level === "global"
            ? "the group lead"
            : "the regional lead"
          : "the board";
  return { days, to };
}

export async function createEntry(organisationId: string, scope: Scope, kind: Kind, category: string, title: string) {
  const { data, error } = await db()
    .from("register_entries")
    .insert({
      organisation_id: organisationId,
      level: scope.level,
      entity_id: scope.level === "local" ? scope.entityId : null,
      region: scope.level === "regional" ? scope.region : null,
      kind,
      category: category.trim(),
      title: title.trim(),
      review_on: localDate(365),
    })
    .select("id")
    .single();
  check(error);
  return data!.id as string;
}

export async function updateEntry(id: string, patch: Partial<Entry>) {
  check((await db().from("register_entries").update(patch).eq("id", id)).error);
}

export async function assign(
  organisationId: string,
  data: RegisterData,
  entryId: string,
  raci: Raci,
  fullName: string,
  isBackup: boolean,
) {
  const client = db();
  const name = fullName.trim();
  let personId = data.people.find((p) => p.full_name.toLowerCase() === name.toLowerCase())?.id;
  if (!personId) {
    const person = await client
      .from("people")
      .insert({ organisation_id: organisationId, full_name: name })
      .select("id")
      .single();
    check(person.error);
    personId = person.data!.id as string;
  }
  check(
    (
      await client.from("register_assignments").insert({
        organisation_id: organisationId,
        entry_id: entryId,
        raci,
        person_id: personId,
        is_backup: isBackup,
      })
    ).error,
  );
}

export async function unassign(assignmentId: string) {
  check((await db().from("register_assignments").delete().eq("id", assignmentId)).error);
}

export async function applyTemplate(organisationId: string, sector: string, scope: Scope): Promise<number> {
  const { data, error } = await db().rpc("apply_register_template", {
    p_org: organisationId,
    p_sector: sector,
    p_level: scope.level,
    p_entity: scope.level === "local" ? scope.entityId : null,
    p_region: scope.level === "regional" ? scope.region : null,
  });
  check(error);
  return Number(data ?? 0);
}

export async function setEntityRegion(entityId: string, region: string) {
  check((await db().from("entities").update({ region: region.trim() || null }).eq("id", entityId)).error);
}

export async function setTier(organisationId: string, tier: string) {
  check((await db().from("organisations").update({ tier }).eq("id", organisationId)).error);
}

export type RegisterSummary = { active: number; proposed: number; overdue: number; withGaps: number };

export function summarise(entries: Entry[], assignments: Assignment[]): RegisterSummary {
  const active = entries.filter((e) => e.status === "active");
  return {
    active: active.length,
    proposed: entries.filter((e) => e.status === "proposed").length,
    overdue: active.filter((e) => escalation(e)).length,
    withGaps: active.filter((e) => gaps(e, assignments).length > 0).length,
  };
}

/** For the overview. Reads as empty until the register migration has been run. */
export async function loadRegisterSummary(organisationId: string): Promise<RegisterSummary> {
  try {
    const data = await loadRegister(organisationId);
    return summarise(data.entries, data.assignments);
  } catch {
    return { active: 0, proposed: 0, overdue: 0, withGaps: 0 };
  }
}
