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
