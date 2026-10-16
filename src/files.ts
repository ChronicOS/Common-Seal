import { supabase } from "./supabase";

function db() {
  if (!supabase) throw new Error("The site is not connected to its database.");
  return supabase;
}

/** Stores a file against a record, with its SHA-256 fingerprint. Returns the document's id. */
export async function attachFile(subjectTable: string, subjectId: string, file: File): Promise<string> {
  const client = db();
  if (file.size > 10 * 1024 * 1024) throw new Error("Files can be up to 10 MB.");
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  const sha = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const registered = await client.rpc("attach_document", { p_table: subjectTable, p_id: subjectId, p_file_name: file.name, p_mime: file.type, p_size: file.size, p_sha256: sha });
  if (registered.error) throw new Error(registered.error.message);
  const { path, link_id, document_id } = registered.data as { path: string; link_id: string; document_id: string };
  const stored = await client.storage.from("documents").upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (stored.error) {
    await client.rpc("remove_attachment", { p_link: link_id });
    throw new Error(`The file could not be stored: ${stored.error.message}`);
  }
  return document_id;
}

/** Downloads a stored file under its own name */
export async function downloadFile(storagePath: string, fileName: string) {
  const { data, error } = await db().storage.from("documents").createSignedUrl(storagePath, 60, { download: fileName });
  if (error || !data) throw new Error("The file could not be downloaded.");
  window.location.assign(data.signedUrl);
}

export type LinkedFile = { subject_id: string; file_name: string; storage_path: string; created_at: string };
/** Files attached to some records of one kind. Empty if none, or if they cannot be read. */
export async function listFiles(subjectTable: string, subjectIds: string[]): Promise<LinkedFile[]> {
  if (!subjectIds.length) return [];
  const client = db();
  const links = await client.from("document_links").select("document_id, subject_id, created_at").eq("subject_table", subjectTable).in("subject_id", subjectIds).order("created_at");
  if (links.error || !links.data?.length) return [];
  const versions = await client.from("document_versions").select("document_id, file_name, storage_path").in("document_id", links.data.map((l) => l.document_id as string));
  if (versions.error) return [];
  const byDoc = new Map((versions.data ?? []).map((v) => [v.document_id as string, v]));
  return links.data.flatMap((l) => {
    const v = byDoc.get(l.document_id as string);
    return v ? [{ subject_id: l.subject_id as string, file_name: v.file_name as string, storage_path: v.storage_path as string, created_at: l.created_at as string }] : [];
  });
}
