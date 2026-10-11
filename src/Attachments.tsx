import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";

type Row = { id: string; document_id: string; created_at: string; file_name: string; size_bytes: number | null; sha256: string; storage_path: string };
type Props = {
  subjectTable: "expense_claims" | "contracts" | "policies" | "workflow_run_steps" | "register_entries" | "dd_cases" | "ms_statements";
  subjectId: string;
  canAttach: boolean;
  label?: string;
};

const MAX_BYTES = 10 * 1024 * 1024;
const size = (n: number | null) => (n == null ? "" : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

async function fingerprint(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Files attached to one record. Each is stored with a fingerprint so it can be shown to be unchanged. */
export default function Attachments({ subjectTable, subjectId, canAttach, label = "Evidence" }: Props) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    if (!supabase) return;
    const links = await supabase.from("document_links").select("id, document_id, created_at").eq("subject_table", subjectTable).eq("subject_id", subjectId).order("created_at");
    // Before the attachments migration is run there is simply nothing to show
    if (links.error) return setRows(null);
    const ids = (links.data ?? []).map((l) => l.document_id as string);
    const versions = ids.length
      ? await supabase.from("document_versions").select("document_id, file_name, size_bytes, sha256, storage_path").in("document_id", ids)
      : { data: [], error: null };
    const byDoc = new Map(((versions.data ?? []) as Omit<Row, "id" | "created_at">[]).map((v) => [v.document_id, v]));
    setRows(
      (links.data ?? []).flatMap((l) => {
        const v = byDoc.get(l.document_id as string);
        return v ? [{ ...v, id: l.id as string, created_at: l.created_at as string }] : [];
      }),
    );
  }, [subjectTable, subjectId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (rows === null) return null;

  async function upload(file: File) {
    if (!supabase) return;
    if (file.size > MAX_BYTES) return setError("Files can be up to 10 MB.");
    setBusy(true);
    setError(null);
    try {
      const sha = await fingerprint(file);
      const registered = await supabase.rpc("attach_document", {
        p_table: subjectTable,
        p_id: subjectId,
        p_file_name: file.name,
        p_mime: file.type,
        p_size: file.size,
        p_sha256: sha,
      });
      if (registered.error) throw new Error(registered.error.message);
      const { path, link_id } = registered.data as { path: string; link_id: string };
      const stored = await supabase.storage.from("documents").upload(path, file, { contentType: file.type || undefined, upsert: false });
      if (stored.error) {
        // Do not leave a record pointing at a file that never arrived
        await supabase.rpc("remove_attachment", { p_link: link_id });
        throw new Error(`The file could not be stored: ${stored.error.message}`);
      }
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not attach the file.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  async function open(row: Row) {
    if (!supabase) return;
    setError(null);
    const { data, error: failed } = await supabase.storage.from("documents").createSignedUrl(row.storage_path, 60);
    if (failed || !data) return setError("The file could not be opened.");
    window.open(data.signedUrl, "_blank", "noopener");
  }

  async function remove(row: Row) {
    if (!supabase || !window.confirm(`Remove "${row.file_name}" from this record? The file itself is kept on record.`)) return;
    const { error: failed } = await supabase.rpc("remove_attachment", { p_link: row.id });
    if (failed) return setError(failed.message);
    await reload();
  }

  if (rows.length === 0 && !canAttach) return null;

  return (
    <div className="attachments">
      <strong>{label}</strong>
      {rows.length === 0 ? (
        <span className="muted"> · none attached</span>
      ) : (
        <ul className="plain">
          {rows.map((r) => (
            <li key={r.id} className="row">
              <button type="button" className="link-dark" onClick={() => void open(r)}>
                {r.file_name}
              </button>
              <span className="muted" title={`SHA-256 ${r.sha256}`}>
                {size(r.size_bytes)} · fingerprint {r.sha256.slice(0, 8)}
              </span>
              {canAttach && (
                <button type="button" className="link-dark" onClick={() => void remove(r)}>
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canAttach && (
        <label className="attach-button">
          <input
            ref={input}
            type="file"
            className="visually-hidden"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file);
            }}
          />
          <span className="quiet-button">{busy ? "Attaching…" : "Attach a file"}</span>
        </label>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
