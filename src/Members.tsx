import { useCallback, useEffect, useState, type FormEvent } from "react";
import { addMember, loadMembers, type Member } from "./board";

const ROLES: { value: string; label: string }[] = [
  { value: "secretary", label: "Company secretary" },
  { value: "director", label: "Director" },
  { value: "legal", label: "Legal" },
  { value: "compliance", label: "Compliance" },
  { value: "admin", label: "Admin" },
  { value: "member", label: "Member" },
  { value: "auditor", label: "Auditor (read only)" },
];

export default function Members({ organisationId, role }: { organisationId: string; role: string }) {
  const canAdd = role === "owner" || role === "admin";
  const [members, setMembers] = useState<Member[] | null>(null);
  const [email, setEmail] = useState("");
  const [newRole, setNewRole] = useState("secretary");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setMembers(await loadMembers(organisationId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load members.");
    }
  }, [organisationId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function add(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await addMember(organisationId, email, newRole);
      setDone(`${email.trim()} added.`);
      setEmail("");
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add that person.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p className="eyebrow">Access</p>
      <h1>People</h1>
      {members === null && !error && <p className="lead">Loading…</p>}
      {members && (
        <ul className="entity-list">
          {members.map((m) => (
            <li key={m.user_id} className="member-row">
              <span className="entity-name">{m.name}</span>
              <span className="chip capitalise">{m.role}</span>
            </li>
          ))}
        </ul>
      )}
      {!canAdd && <p className="muted">Only an owner or admin can see everyone and add people.</p>}

      {canAdd && (
        <form className="card form" onSubmit={add}>
          <h2>Add a person</h2>
          <p className="muted">They need to have signed in to Common Seal once before you can add them.</p>
          <label htmlFor="member-email">Email</label>
          <input id="member-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <label htmlFor="member-role">Role</label>
          <select id="member-role" value={newRole} onChange={(e) => setNewRole(e.target.value)}>
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          <button type="submit" disabled={busy}>
            {busy ? "Adding…" : "Add person"}
          </button>
          {done && <p role="status">{done}</p>}
        </form>
      )}
      {error && (
        <p className="error block" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
