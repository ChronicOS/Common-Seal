import { supabase } from "./supabase";

export type AuthorityKind = "approve" | "execute";
export type HolderKind = "position" | "statutory" | "attorney";

export type Rule = {
  id: string;
  entity_id: string;
  authority: AuthorityKind;
  transaction_type: string;
  holder_kind: HolderKind;
  position_id: string | null;
  power_of_attorney_id: string | null;
  statutory_basis: string | null;
  limit_amount: number | null;
  conditions: string | null;
  delegated_from_id: string | null;
  starts_on: string | null;
  ends_on: string | null;
};

export type Attorney = {
  id: string;
  entity_id: string;
  attorney_name: string;
  scope: string;
  granted_on: string | null;
  expires_on: string | null;
  revoked_on: string | null;
};

export type Position = { id: string; title: string };
export type Assignment = { position_id: string; ends_on: string | null; person: { full_name: string } };

export type AuthorityData = {
  rules: Rule[];
  attorneys: Attorney[];
  positions: Position[];
  assignments: Assignment[];
};

export const ANY = "Any";
export const TRANSACTION_TYPES = [
  ANY,
  "Sales contracts",
  "Procurement",
  "Employment",
  "Leases and property",
  "Banking and finance",
  "Intercompany",
  "Settlements and disputes",
];
export const STATUTORY_BASES = [
  "Two directors",
  "A director and the company secretary",
  "The sole director",
  "The board, by resolution",
];

function db() {
  if (!supabase) throw new Error("The site is not connected to its database.");
  return supabase;
}

function check(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

/** A calendar date in the reader's own time zone, as YYYY-MM-DD. */
const localDate = (offsetDays = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const today = () => localDate();

export async function loadAuthority(organisationId: string): Promise<AuthorityData> {
  const client = db();
  const [rules, attorneys, positions, assignments] = await Promise.all([
    client
      .from("delegation_rules")
      .select(
        "id, entity_id, authority, transaction_type, holder_kind, position_id, power_of_attorney_id, statutory_basis, limit_amount, conditions, delegated_from_id, starts_on, ends_on",
      )
      .eq("organisation_id", organisationId)
      .order("created_at"),
    client
      .from("powers_of_attorney")
      .select("id, entity_id, attorney_name, scope, granted_on, expires_on, revoked_on")
      .eq("organisation_id", organisationId)
      .order("created_at"),
    client.from("positions").select("id, title").eq("organisation_id", organisationId).order("title"),
    client
      .from("position_assignments")
      .select("position_id, ends_on, person:people(full_name)")
      .eq("organisation_id", organisationId),
  ]);
  check(rules.error ?? attorneys.error ?? positions.error ?? assignments.error);
  return {
    rules: ((rules.data ?? []) as Rule[]).map((r) => ({
      ...r,
      limit_amount: r.limit_amount == null ? null : Number(r.limit_amount),
    })),
    attorneys: (attorneys.data ?? []) as Attorney[],
    positions: (positions.data ?? []) as Position[],
    assignments: (assignments.data ?? []) as unknown as Assignment[],
  };
}

export const ruleIsCurrent = (r: Rule) => (!r.starts_on || r.starts_on <= today()) && (!r.ends_on || r.ends_on >= today());
export const attorneyIsCurrent = (a: Attorney) => !a.revoked_on && (!a.expires_on || a.expires_on >= today());

/** People currently holding a position. */
export function holders(data: AuthorityData, positionId: string): string[] {
  return data.assignments
    .filter((a) => a.position_id === positionId && (!a.ends_on || a.ends_on >= today()))
    .map((a) => a.person.full_name);
}

/** Current rules that cover a transaction of this type and value, smallest sufficient authority first. */
export function whoCan(data: AuthorityData, entityId: string, authority: AuthorityKind, type: string, amount: number): Rule[] {
  return data.rules
    .filter((r) => r.entity_id === entityId && r.authority === authority && ruleIsCurrent(r))
    .filter((r) => r.transaction_type === ANY || r.transaction_type === type)
    .filter((r) => r.limit_amount === null || r.limit_amount >= amount)
    .filter((r) => {
      if (r.holder_kind !== "attorney") return true;
      const attorney = data.attorneys.find((a) => a.id === r.power_of_attorney_id);
      return Boolean(attorney && attorneyIsCurrent(attorney));
    })
    .sort((a, b) => (a.limit_amount ?? Infinity) - (b.limit_amount ?? Infinity));
}

export type NewRule = {
  entityId: string;
  authority: AuthorityKind;
  transactionType: string;
  holderKind: HolderKind;
  positionTitle?: string;
  holderName?: string;
  statutoryBasis?: string;
  attorneyId?: string;
  limit: number | null;
  conditions: string;
  delegatedFromId: string | null;
};

export async function addRule(organisationId: string, data: AuthorityData, rule: NewRule): Promise<void> {
  const client = db();
  let positionId: string | null = null;

  if (rule.holderKind === "position") {
    const title = (rule.positionTitle ?? "").trim();
    const existing = data.positions.find((p) => p.title.toLowerCase() === title.toLowerCase());
    if (existing) {
      positionId = existing.id;
    } else {
      const created = await client
        .from("positions")
        .insert({ organisation_id: organisationId, title })
        .select("id")
        .single();
      check(created.error);
      positionId = created.data!.id as string;
    }
    const holder = (rule.holderName ?? "").trim();
    if (holder) {
      const person = await client
        .from("people")
        .insert({ organisation_id: organisationId, full_name: holder })
        .select("id")
        .single();
      check(person.error);
      check(
        (
          await client.from("position_assignments").insert({
            organisation_id: organisationId,
            position_id: positionId,
            person_id: person.data!.id,
          })
        ).error,
      );
    }
  }

  check(
    (
      await client.from("delegation_rules").insert({
        organisation_id: organisationId,
        entity_id: rule.entityId,
        authority: rule.authority,
        transaction_type: rule.transactionType.trim() || ANY,
        holder_kind: rule.holderKind,
        position_id: positionId,
        power_of_attorney_id: rule.holderKind === "attorney" ? rule.attorneyId : null,
        statutory_basis: rule.holderKind === "statutory" ? rule.statutoryBasis : null,
        limit_amount: rule.limit,
        conditions: rule.conditions.trim() || null,
        delegated_from_id: rule.delegatedFromId,
      })
    ).error,
  );
}

/** The usual ways a company executes a document under section 127 of the Corporations Act. */
export async function addStandardSigning(organisationId: string, entityId: string): Promise<void> {
  check(
    (
      await db()
        .from("delegation_rules")
        .insert(
          ["Two directors", "A director and the company secretary"].map((basis) => ({
            organisation_id: organisationId,
            entity_id: entityId,
            authority: "execute",
            transaction_type: ANY,
            holder_kind: "statutory",
            statutory_basis: basis,
          })),
        )
    ).error,
  );
}

/** Ends a rule immediately: its last effective day is yesterday. */
export async function endRule(id: string) {
  check((await db().from("delegation_rules").update({ ends_on: localDate(-1) }).eq("id", id)).error);
}

export async function addAttorney(
  organisationId: string,
  entityId: string,
  name: string,
  scope: string,
  grantedOn: string | null,
  expiresOn: string | null,
) {
  check(
    (
      await db().from("powers_of_attorney").insert({
        organisation_id: organisationId,
        entity_id: entityId,
        attorney_name: name.trim(),
        scope: scope.trim(),
        granted_on: grantedOn,
        expires_on: expiresOn,
      })
    ).error,
  );
}

export async function revokeAttorney(id: string) {
  check((await db().from("powers_of_attorney").update({ revoked_on: today() }).eq("id", id)).error);
}

export const money = (amount: number) =>
  new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(amount);
