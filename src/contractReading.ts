import { supabase } from "./supabase";

/** Reading contracts with Claude in Australia (migration 0067, edge function read-contract) */

function db() {
  if (!supabase) throw new Error("The site is not connected to its database.");
  return supabase;
}

export type ReadField = { value: string | null; quote: string | null };
export type ReadFields = Record<string, ReadField>;

/** What a person checks before saving. Keys match the AI's fields, so each answer is recorded as confirmed or corrected. */
export type ContractValues = {
  counterparty: string;
  title: string;
  description: string;
  purpose: string;
  start_date: string;
  end_date: string;
  tfc_available: string;
  tfc_by: string;
  tfc_notice: string;
  tfc_from: string;
  auto_renews: string;
  notice_by: string;
  renewal_terms: string;
};

export const EMPTY_VALUES: ContractValues = {
  counterparty: "", title: "", description: "", purpose: "", start_date: "", end_date: "",
  tfc_available: "", tfc_by: "", tfc_notice: "", tfc_from: "", auto_renews: "", notice_by: "", renewal_terms: "",
};

export const valuesFrom = (fields: ReadFields | null | undefined): ContractValues => {
  const out = { ...EMPTY_VALUES };
  for (const k of Object.keys(out) as (keyof ContractValues)[]) out[k] = fields?.[k]?.value ?? "";
  return out;
};

const missing = (m: string) => /could not find the function|schema cache|does not exist/i.test(m);

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await db().functions.invoke("read-contract", { body });
  if (error) {
    let message = error.message;
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.json === "function") message = ((await ctx.json()) as { error?: string }).error ?? message;
    } catch {
      // keep the general message
    }
    if (/Failed to send a request|FunctionsFetchError|not found/i.test(message))
      message = "Contract reading is not set up yet: the read-contract function has not been deployed (set-up guide, Part 7).";
    if (/^Unknown action$/i.test(message)) message = "The read-contract function in Supabase is out of date. Redeploy it from GitHub (set-up guide, Part 7).";
    throw new Error(message);
  }
  return data as T;
}

export async function readerStatus(): Promise<boolean> {
  try {
    return (await call<{ configured: boolean }>({ action: "status" })).configured;
  } catch {
    return false;
  }
}

const sha256 = async (file: File) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()))].map((b) => b.toString(16).padStart(2, "0")).join("");

export type Staged = { document_id: string; version_id: string; path: string; duplicate_of: string | null };

/** Stores the dropped file privately (only the person who dropped it can see it until it is saved) */
export async function stageFile(organisationId: string, entityId: string, file: File): Promise<Staged> {
  if (file.size > 10 * 1024 * 1024) throw new Error("Files can be up to 10 MB.");
  const client = db();
  const staged = await client.rpc("stage_contract_file", {
    p_org: organisationId, p_entity: entityId, p_file_name: file.name, p_mime: file.type, p_size: file.size, p_sha256: await sha256(file),
  });
  if (staged.error) throw new Error(missing(staged.error.message) ? "Contract reading needs migration 0067 to be run in Supabase." : staged.error.message);
  const s = staged.data as Staged;
  const stored = await client.storage.from("documents").upload(s.path, file, { contentType: file.type || undefined, upsert: false });
  if (stored.error) {
    await client.rpc("discard_contract_file", { p_document: s.document_id });
    throw new Error(`The file could not be stored: ${stored.error.message}`);
  }
  return s;
}

export const readFile = (versionId: string, entityId: string) =>
  call<{ extraction_id: string | null; fields: ReadFields }>({ action: "read_file", version_id: versionId, entity_id: entityId });

export const readUrl = (organisationId: string, entityId: string, url: string) =>
  call<{ fields: ReadFields }>({ action: "read_url", organisation_id: organisationId, entity_id: entityId, url });

export async function discardFile(documentId: string) {
  const r = await db().rpc("discard_contract_file", { p_document: documentId });
  if (r.error) throw new Error(r.error.message);
}

export type Saved = { contract_id: string; counterparty_id: string; new_counterparty: boolean; needs_due_diligence: boolean };

/** Saves after the person has checked every answer. Unsigned contracts then go for approval, as typed ones do. */
export async function saveRead(
  organisationId: string,
  entityId: string,
  signed: boolean,
  values: ContractValues,
  source: { versionId?: string; extractionId?: string | null; url?: string },
): Promise<Saved> {
  const v = { ...values } as Record<string, string>;
  // Online terms only carry the description and purpose
  if (source.url) for (const k of ["start_date", "end_date", "tfc_available", "tfc_by", "tfc_notice", "tfc_from", "auto_renews", "notice_by", "renewal_terms"]) v[k] = "";
  const saved = await db().rpc("save_read_contract", {
    p_org: organisationId, p_entity: entityId, p_signed: signed, p_values: v,
    p_version: source.versionId ?? null, p_extraction: source.extractionId ?? null, p_terms_url: source.url ?? null,
  });
  if (saved.error) throw new Error(missing(saved.error.message) ? "Contract reading needs migration 0067 to be run in Supabase." : saved.error.message);
  const s = saved.data as Saved;
  if (!signed) {
    const sent = await db().rpc("submit_contract", { p_contract: s.contract_id });
    if (sent.error) throw new Error(`Saved, but not sent for approval: ${sent.error.message}`);
  }
  return s;
}

export const TFC_BY: Record<string, string> = { either: "Either party", us: "Us only", them: "The other party only", unclear: "Unclear" };
export const YES_NO: Record<string, string> = { yes: "Yes", no: "No", unclear: "Unclear" };

/** One line on termination for convenience, for the contract page and list */
export function tfcLine(c: { tfc_available?: string | null; tfc_by?: string | null; tfc_notice?: string | null; tfc_from?: string | null }) {
  if (!c.tfc_available) return null;
  if (c.tfc_available === "no") return "No: neither party can end it just by giving notice";
  if (c.tfc_available === "unclear") return "Unclear from the contract";
  return [TFC_BY[c.tfc_by ?? ""] ?? "Yes", c.tfc_notice ? `on ${c.tfc_notice}` : null, c.tfc_from ? `(${c.tfc_from})` : null].filter(Boolean).join(" ");
}
