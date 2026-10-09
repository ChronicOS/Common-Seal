import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  formatDay,
  inviteMember,
  loadInvitations,
  loadMembers,
  revokeInvitation,
  type Invitation,
  type Member,
} from "./board";

const ROLES: { value: string; label: string }[] = [
  { value: "secretary", label: "Company secretary" },
  { value: "director", label: "Director" },
  { value: "legal", label: "Legal" },
  { value: "compliance", label: "Compliance" },
  { value: "admin", label: "Admin" },
  { value: "member", label: "Member" },
  { value: "auditor", label: "Auditor (read only)" },
];
const roleLabel = (role: string) => ROLES.find((r) => r.value === role)?.label ?? role;

export default function Members({ organisationId, role }: { organisationId: string; role: string }) {
  const canInvite = role === "owner" || role === "admin";
  const [members, setMembers] = useState<Member[] | null>(null);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [email, setEmail] = useState("");
  const [newRole, setNewRole] = useState("secretary");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ email: string; result: "added" | "invited" } | null>(null);

  const reload = useCallback(async () => {
    try {
      setMembers(await loadMembers(organisationId));
      if (canInvite) setInvitations(await loadInvitations(organisationId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load people.");
    }
  }, [organisationId, canInvite]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function invite(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const result = await inviteMember(organisationId, email, newRole);
      setDone({ email: email.trim(), result });
      setEmail("");
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not invite that person.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setError(null);
    try {
      await revokeInvitation(id);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not revoke the invitation.");
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
      {!canInvite && <p className="muted">Only an owner or admin can see everyone and invite people.</p>}

      {canInvite && invitations.length > 0 && (
        <section className="block">
          <h2>Invited, not yet joined</h2>
          <ul className="entity-list">
            {invitations.map((i) => (
              <li key={i.id} className="member-row">
                <span>
                  <span className="entity-name">{i.email}</span>
                  <span className="muted">
                    {" "}
                    · {roleLabel(i.role)} · invited {formatDay(i.created_at)}
                  </span>
                </span>
                <button type="button" className="link-dark" aria-label={`Revoke invitation for ${i.email}`} onClick={() => void revoke(i.id)}>
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {canInvite && (
        <form className="card form" onSubmit={invite}>
          <h2>Invite a person</h2>
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
            {busy ? "Inviting…" : "Invite"}
          </button>
          {done?.result === "added" && <p role="status">{done.email} already had an account and has been added.</p>}
          {done?.result === "invited" && (
            <div role="status">
              <p>
                <strong>{done.email} is invited.</strong> They will join automatically the first time they sign in with
                that email.
              </p>
              <p>
                No email is sent yet, so send them this link yourself: <code>{window.location.origin}</code>
              </p>
            </div>
          )}
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
