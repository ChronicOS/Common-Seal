export type Organisation = { id: string; name: string; tier: string; data_region: string };
export type Membership = { role: string; organisation: Organisation };

export type EntityForm =
  | "proprietary_company"
  | "public_company"
  | "trust"
  | "partnership"
  | "foreign_company"
  | "other";

export type Entity = {
  id: string;
  organisation_id: string;
  name: string;
  legal_form: EntityForm | null;
  jurisdiction: string;
  acn: string | null;
  abn: string | null;
  registered_office: string | null;
  incorporated_on: string | null;
  is_listed: boolean;
  status: string;
  created_at: string;
};

export type Relationship = {
  id: string;
  parent_entity_id: string;
  child_entity_id: string;
  ownership_pct: number | null;
  ends_on: string | null;
};

export type OfficeRole = "director" | "alternate_director" | "chair" | "secretary" | "public_officer";

export type Officeholding = {
  id: string;
  entity_id: string;
  role: OfficeRole;
  ceased_on: string | null;
  person: { id: string; full_name: string };
};

export type PromptStatus = "skipped" | "snoozed" | "not_applicable" | "done";

export type PromptRow = {
  subject_table: string;
  subject_id: string;
  field_key: string;
  status: PromptStatus;
  remind_after: string | null;
};

export type GroupData = {
  entities: Entity[];
  relationships: Relationship[];
  officeholdings: Officeholding[];
  prompts: PromptRow[];
};

export const FORM_LABELS: Record<EntityForm, string> = {
  proprietary_company: "Proprietary company (Pty Ltd)",
  public_company: "Public company (Ltd)",
  trust: "Trust",
  partnership: "Partnership",
  foreign_company: "Foreign company",
  other: "Other",
};
