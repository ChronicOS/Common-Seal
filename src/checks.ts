import type { Entity, GroupData, PromptStatus } from "./types";

const digitsOnly = (value: string) => value.replace(/\s+/g, "");

/** Australian Company Number: nine digits, the last being a check digit. */
export function parseAcn(input: string): string | null {
  const acn = digitsOnly(input);
  if (!/^\d{9}$/.test(acn)) return null;
  const sum = [8, 7, 6, 5, 4, 3, 2, 1].reduce((total, weight, i) => total + weight * Number(acn[i]), 0);
  const check = (10 - (sum % 10)) % 10;
  return check === Number(acn[8]) ? acn : null;
}

/** Australian Business Number: eleven digits validated by the modulus 89 rule. */
export function parseAbn(input: string): string | null {
  const abn = digitsOnly(input);
  if (!/^\d{11}$/.test(abn)) return null;
  const weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  const sum = weights.reduce((total, weight, i) => total + weight * (Number(abn[i]) - (i === 0 ? 1 : 0)), 0);
  return sum % 89 === 0 ? abn : null;
}

export const formatAcn = (acn: string) => acn.replace(/(\d{3})(\d{3})(\d{3})/, "$1 $2 $3");
export const formatAbn = (abn: string) => abn.replace(/(\d{2})(\d{3})(\d{3})(\d{3})/, "$1 $2 $3 $4");

export type FieldKey =
  | "legal_form"
  | "acn"
  | "abn"
  | "incorporated_on"
  | "registered_office"
  | "is_listed"
  | "directors"
  | "secretary"
  | "parent";

export type FieldState = "complete" | "open" | "skipped" | "not_applicable";

export const FIELD_ORDER: FieldKey[] = [
  "legal_form",
  "acn",
  "abn",
  "incorporated_on",
  "registered_office",
  "is_listed",
  "directors",
  "secretary",
  "parent",
];

export const FIELD_LABELS: Record<FieldKey, string> = {
  legal_form: "Type of entity",
  acn: "ACN",
  abn: "ABN",
  incorporated_on: "Date registered",
  registered_office: "Registered office",
  is_listed: "Listed on an exchange",
  directors: "Directors",
  secretary: "Company secretary",
  parent: "Owner in the group",
};

/** The key used for the "come back to this entity" reminder on the home page. */
export const CHECKIN_KEY = "_checkin";

function promptStatus(data: GroupData, entityId: string, key: string): PromptStatus | null {
  const row = data.prompts.find(
    (p) => p.subject_table === "entities" && p.subject_id === entityId && p.field_key === key,
  );
  return row ? row.status : null;
}

/** Whether a question is relevant to this entity at all. */
export function applies(entity: Entity, key: FieldKey): boolean {
  const company = entity.legal_form === "proprietary_company" || entity.legal_form === "public_company";
  if (key === "acn") return entity.legal_form === null || company;
  if (key === "is_listed") return entity.legal_form === "public_company";
  if (key === "directors" || key === "secretary")
    return entity.legal_form === null || company || entity.legal_form === "foreign_company";
  return true;
}

export function fieldState(data: GroupData, entity: Entity, key: FieldKey): FieldState {
  if (!applies(entity, key)) return "not_applicable";
  const status = promptStatus(data, entity.id, key);
  const officers = data.officeholdings.filter((o) => o.entity_id === entity.id && !o.ceased_on);

  let complete = false;
  switch (key) {
    case "legal_form":
      complete = entity.legal_form !== null;
      break;
    case "acn":
      complete = Boolean(entity.acn);
      break;
    case "abn":
      complete = Boolean(entity.abn);
      break;
    case "incorporated_on":
      complete = Boolean(entity.incorporated_on);
      break;
    case "registered_office":
      complete = Boolean(entity.registered_office);
      break;
    case "is_listed":
      complete = status === "done";
      break;
    case "directors":
      complete = officers.some((o) => o.role === "director" || o.role === "chair");
      break;
    case "secretary":
      complete = officers.some((o) => o.role === "secretary");
      break;
    case "parent":
      complete = data.relationships.some((r) => r.child_entity_id === entity.id && !r.ends_on);
      break;
  }
  if (complete) return "complete";
  if (status === "not_applicable") return "not_applicable";
  if (status === "skipped") return "skipped";
  return "open";
}

export type Progress = {
  states: Record<FieldKey, FieldState>;
  /** Questions still to answer: never-asked first, then the ones skipped earlier. */
  queue: FieldKey[];
  answered: number;
  total: number;
};

export function progress(data: GroupData, entity: Entity): Progress {
  const states = {} as Record<FieldKey, FieldState>;
  for (const key of FIELD_ORDER) states[key] = fieldState(data, entity, key);
  const open = FIELD_ORDER.filter((k) => states[k] === "open");
  const skipped = FIELD_ORDER.filter((k) => states[k] === "skipped");
  const relevant = FIELD_ORDER.filter((k) => states[k] !== "not_applicable");
  return {
    states,
    queue: [...open, ...skipped],
    answered: relevant.filter((k) => states[k] === "complete").length,
    total: relevant.length,
  };
}

/** Entities with details outstanding whose reminder is not currently snoozed. */
export function dueCheckIns(data: GroupData, now = new Date()): Entity[] {
  return data.entities.filter((entity) => {
    if (progress(data, entity).queue.length === 0) return false;
    const snooze = data.prompts.find(
      (p) => p.subject_table === "entities" && p.subject_id === entity.id && p.field_key === CHECKIN_KEY,
    );
    return !(snooze && snooze.status === "snoozed" && snooze.remind_after && new Date(snooze.remind_after) > now);
  });
}
