import { supabase } from "./supabase";
import type { Entity, GroupData, OfficeRole, Officeholding, PromptRow, PromptStatus, Relationship } from "./types";

function client() {
  if (!supabase) throw new Error("The site is not connected to its database.");
  return supabase;
}

function fail(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

export async function loadGroup(organisationId: string): Promise<GroupData> {
  const db = client();
  const [entities, relationships, officeholdings, prompts] = await Promise.all([
    db.from("entities").select("*").eq("organisation_id", organisationId).order("created_at"),
    db
      .from("entity_relationships")
      .select("id, parent_entity_id, child_entity_id, ownership_pct, ends_on")
      .eq("organisation_id", organisationId),
    db
      .from("officeholdings")
      .select("id, entity_id, role, ceased_on, person:people(id, full_name)")
      .eq("organisation_id", organisationId)
      .order("created_at"),
    db
      .from("profile_prompts")
      .select("subject_table, subject_id, field_key, status, remind_after")
      .eq("organisation_id", organisationId),
  ]);
  fail(entities.error ?? relationships.error ?? officeholdings.error ?? prompts.error);
  return {
    entities: (entities.data ?? []) as Entity[],
    relationships: (relationships.data ?? []) as Relationship[],
    officeholdings: (officeholdings.data ?? []) as unknown as Officeholding[],
    prompts: (prompts.data ?? []) as PromptRow[],
  };
}

export async function createEntity(organisationId: string, name: string): Promise<Entity> {
  const { data, error } = await client()
    .from("entities")
    .insert({ organisation_id: organisationId, name: name.trim() })
    .select("*")
    .single();
  fail(error);
  return data as Entity;
}

export async function updateEntity(id: string, patch: Partial<Entity>): Promise<void> {
  const { error } = await client().from("entities").update(patch).eq("id", id);
  fail(error);
}

export async function addOfficeholder(
  organisationId: string,
  entityId: string,
  fullName: string,
  role: OfficeRole,
): Promise<void> {
  const db = client();
  const person = await db
    .from("people")
    .insert({ organisation_id: organisationId, full_name: fullName.trim() })
    .select("id")
    .single();
  fail(person.error);
  const { error } = await db
    .from("officeholdings")
    .insert({ organisation_id: organisationId, entity_id: entityId, person_id: person.data!.id, role });
  fail(error);
}

export async function addOwner(
  organisationId: string,
  childId: string,
  parentId: string,
  ownershipPct: number | null,
): Promise<void> {
  const { error } = await client().from("entity_relationships").insert({
    organisation_id: organisationId,
    parent_entity_id: parentId,
    child_entity_id: childId,
    ownership_pct: ownershipPct,
  });
  fail(error);
}

export async function setPrompt(
  organisationId: string,
  entityId: string,
  fieldKey: string,
  status: PromptStatus,
  remindAfter: Date | null = null,
): Promise<void> {
  const { error } = await client()
    .from("profile_prompts")
    .upsert(
      {
        organisation_id: organisationId,
        subject_table: "entities",
        subject_id: entityId,
        field_key: fieldKey,
        status,
        remind_after: remindAfter ? remindAfter.toISOString() : null,
      },
      { onConflict: "subject_table,subject_id,field_key" },
    );
  fail(error);
}
