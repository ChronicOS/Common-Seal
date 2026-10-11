import { useCallback, useEffect, useState, type FormEvent } from "react";
import { formatDay, inviteMember, loadInvitations, loadMembers, revokeInvitation, setMemberRoles, type Invitation, type Member } from "./board";
import { has, roleLabel, roleLabels, roleList, ROLES } from "./roles";

/** Tick boxes for one or more roles. Only an owner can hand out the owner role. */
function RolePicker({ idPrefix, value, onChange, canGrantOwner }: { idPrefix: string; value: string[]; onChange: (roles: string[]) => void; canGrantOwner: boolean }) {
  return (
    <fieldset className="plain-fieldset">
      <legend>Roles (choose one or more)</legend>
      {ROLES.filter((r) => r.value !== "owner" || canGrantOwner || value.includes("owner")).map((r) => (
        <label key={r.value} className="check" htmlFor={`${idPrefix}-${r.value}`}>
          <input
            id={`${idPrefix}-${r.value}`}
            type="checkbox"
            checked={value.includes(r.value)}
            disabled={r.value === "owner" && !canGrantOwner}
            onChange={(e) => onChange(e.target.checked ? [...value, r.value] : value.filter((x) => x !== r.value))}
          />{" "}
          {r.label}
        </label>
      ))}
    </fieldset>
  );
}

export default function Members({ organisationId, role }: { organisationId: string; role: string }) {
  const canInvite = has(role, "owner", "admin");
  const isOwner = has(role, "owner");
  const [members, setMembers] = useState<Member[] | null>(null);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [mode, setMode] = useState<"invite" | "assign">("invite");
  const [email, setEmail] = useState("");
  const [inviteRoles, setInviteRoles] = useState<string[]>([]);
  const [assignee, setAssignee] = useState("");
  const [assignRoles, setAssignRoles] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [invited, setInvited] = useState<string | null>(null);

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

  async function act(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setDone(null);
    setInvited(null);
    try {
      await work();
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  function invite(event: FormEvent) {
    event.preventDefault();
    void act(async () => {
      const who = email.trim();
      const result = await inviteMember(organisationId, who, inviteRoles);
      if (result === "added") setDone(`${who} already had an account and has been added.`);
      else setInvited(who);
      setEmail("");
      setInviteRoles([]);
    });
  }

  function choose(userId: string) {
    setAssignee(userId);
    setAssignRoles(roleList(members?.find((m) => m.user_id === userId)?.role ?? ""));
    setMode("assign");
    setError(null);
    setDone(null);
    setInvited(null);
  }

  const active = (members ?? []).filter((m) => m.is_active);
  const former = (members ?? []).filter((m) => !m.is_active);
  const chosen = members?.find((m) => m.user_id === assignee);

  return (
    <>
      <p className="eyebrow">Access</p>
      <h1>People</h1>
      {members === null && !error && <p className="lead">Loading…</p>}
      {members && (
        <ul className="entity-list">
          {active.map((m) => (
            <li key={m.user_id} className="member-row">
              <span className="entity-name">{m.name}</span>
              <span className="row">
                {roleList(m.role).map((r) => (
                  <span key={r} className="chip">
                    {roleLabel(r)}
                  </span>
                ))}
                {canInvite && (
                  <button type="button" className="link-dark" aria-label={`Change roles for ${m.name}`} onClick={() => choose(m.user_id)}>
                    Change roles
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {!canInvite && <p className="muted">Only an owner or admin can see everyone, invite people and assign roles.</p>}

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
                    · {roleLabels(i.role)} · invited {formatDay(i.created_at)}
                  </span>
                </span>
                <button type="button" className="link-dark" aria-label={`Revoke invitation for ${i.email}`} onClick={() => void act(() => revokeInvitation(i.id))}>
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {canInvite && former.length > 0 && (
        <section className="block">
          <h2>Access removed</h2>
          <ul className="entity-list">
            {former.map((m) => (
              <li key={m.user_id} className="member-row">
                <span className="entity-name">{m.name}</span>
                <button type="button" className="link-dark" aria-label={`Restore access for ${m.name}`} onClick={() => choose(m.user_id)}>
                  Restore access
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {canInvite && (
        <section className="card form">
          <div className="row" role="group" aria-label="Invite or assign">
            <button type="button" className={mode === "invite" ? "" : "quiet"} aria-pressed={mode === "invite"} onClick={() => setMode("invite")}>
              Invite
            </button>
            <button type="button" className={mode === "assign" ? "" : "quiet"} aria-pressed={mode === "assign"} onClick={() => setMode("assign")}>
              Assign
            </button>
          </div>

          {mode === "invite" ? (
            <form className="form" onSubmit={invite}>
              <h2>Invite a new person</h2>
              <p className="muted">For someone who is not yet in this organisation.</p>
              <label htmlFor="member-email">Email</label>
              <input id="member-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              <RolePicker idPrefix="inv" value={inviteRoles} onChange={setInviteRoles} canGrantOwner={isOwner} />
              <button type="submit" disabled={busy || inviteRoles.length === 0}>
                {busy ? "Inviting…" : "Invite"}
              </button>
            </form>
          ) : (
            <div className="form">
              <h2>Assign roles to an existing person</h2>
              <p className="muted">Add, change or take away the roles of someone already in this organisation.</p>
              <label htmlFor="member-assignee">Person</label>
              <select id="member-assignee" value={assignee} onChange={(e) => choose(e.target.value)}>
                <option value="">Choose a person…</option>
                {(members ?? []).map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.name}
                    {m.is_active ? "" : " (access removed)"}
                  </option>
                ))}
              </select>
              {chosen && (
                <>
                  <RolePicker idPrefix="asg" value={assignRoles} onChange={setAssignRoles} canGrantOwner={isOwner} />
                  <div className="row">
                    <button type="button" disabled={busy || assignRoles.length === 0} onClick={() => void act(() => setMemberRoles(organisationId, chosen.user_id, assignRoles).then(() => setDone(`Roles saved for ${chosen.name}.`)))}>
                      {busy ? "Saving…" : chosen.is_active ? "Save roles" : "Restore access with these roles"}
                    </button>
                    {chosen.is_active && (
                      <button
                        type="button"
                        className="link-dark"
                        disabled={busy}
                        onClick={() => {
                          if (window.confirm(`Remove ${chosen.name}'s access to this organisation? Their past records stay. You can restore access later.`)) {
                            void act(() => setMemberRoles(organisationId, chosen.user_id, [], false).then(() => setDone(`Access removed for ${chosen.name}.`)));
                          }
                        }}
                      >
                        Remove access
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {done && <p role="status">{done}</p>}
          {invited && (
            <div role="status">
              <p>
                <strong>{invited} is invited.</strong> They will join automatically the first time they sign in with that email.
              </p>
              <p>
                No email is sent yet, so send them this link yourself: <code>{window.location.origin}</code>
              </p>
            </div>
          )}
        </section>
      )}
      {error && (
        <p className="error block" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
