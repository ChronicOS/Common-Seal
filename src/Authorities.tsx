import { Fragment, useCallback, useEffect, useState } from "react";
import {
  addBand,
  addGroup,
  addMember,
  addScope,
  copyGroups,
  removeGroup,
  removeMember,
  removeScope,
  REQUIREMENTS,
  requirementLabel,
  updateGroup,
  updateScope,
  type SignGroup,
  addFunction,
  addPosition,
  addVertical,
  assignHolder,
  bandLabel,
  bandsFor,
  currentHolders,
  describeChanges,
  describeSigningChanges,
  endHolding,
  gaps,
  KIND_LABEL,
  loadAuthorities,
  lockAuthority,
  money,
  proposeChange,
  removeBand,
  removeFunction,
  removeVariation,
  removeVertical,
  renameFunction,
  renameVertical,
  reopenChange,
  setApprover,
  startChange,
  STATUS_LABEL,
  updateBand,
  varyForCompany,
  withdrawChange,
  type AuthData,
  type Band,
  type Kind,
  type Version,
} from "./authorities";
import type { Entity, GroupData } from "./types";
import { supabase } from "./supabase";

type Props = { organisationId: string; entities: Entity[]; group: GroupData; canEdit: boolean };
type View = Kind | "positions";

const day = (iso: string) => new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });

/** Saves on leaving the field, so typing is not interrupted */
function TextOnBlur({ value, label, onSave, className }: { value: string; label: string; onSave: (v: string) => void; className?: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return <input aria-label={label} className={className} value={v} onChange={(e) => setV(e.target.value)} onBlur={() => v.trim() !== value && v.trim().length >= 2 && onSave(v)} />;
}
function AmountOnBlur({ value, label, onSave }: { value: number | null; label: string; onSave: (v: number) => void }) {
  const [v, setV] = useState(value === null ? "" : String(value));
  useEffect(() => setV(value === null ? "" : String(value)), [value]);
  return (
    <input
      aria-label={label}
      className="amount"
      inputMode="decimal"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        const n = Number(v.replace(/[$,\s]/g, ""));
        if (n > 0 && n !== value) onSave(n);
        else setV(value === null ? "" : String(value));
      }}
    />
  );
}

const GROUP_SUGGESTIONS = ["Managing Director", "Chief Operating Officer", "Country Managers", "Quality", "Medical", "Regulatory", "Finance"];

type GroupsProps = {
  organisationId: string;
  data: AuthData;
  version: Version;
  editable: boolean;
  entities: Entity[];
  group: GroupData;
  busy: boolean;
  run: (work: () => Promise<unknown>, done?: string) => Promise<boolean>;
};

/** Signing Delegation: for each company, signatory groups, what each can sign, and the minimum signatures. */
function SigningGroups({ organisationId, data, version, editable, entities, group, busy, run }: GroupsProps) {
  const live = entities.filter((e) => e.status !== "deregistered");
  const [entityId, setEntityId] = useState(live[0]?.id ?? "");
  const [newGroup, setNewGroup] = useState("");
  const [copyFrom, setCopyFrom] = useState("");
  const [adding, setAdding] = useState<Record<string, string>>({});
  const [scopeText, setScopeText] = useState<Record<string, string>>({});
  const officers = (roles: string[]) => group.officeholdings.filter((o) => o.entity_id === entityId && !o.ceased_on && roles.includes(o.role)).map((o) => o.person.full_name);
  const groups = data.groups.filter((g) => g.version_id === version.id && g.entity_id === entityId).sort((a, b) => a.position - b.position);
  const others = live.filter((e) => e.id !== entityId && data.groups.some((g) => g.version_id === version.id && g.entity_id === e.id));
  const directors = officers(["director", "chair"]);
  const secretaries = officers(["secretary"]);
  const label = (m: { position_id: string | null; person_id: string | null }) => {
    if (m.position_id) {
      const holders = currentHolders(data, m.position_id).map((h) => h.person.full_name);
      return { text: data.positions.find((p) => p.id === m.position_id)?.title ?? "Unknown position", sub: holders.length ? holders.join(", ") : "Vacant", vacant: holders.length === 0 };
    }
    return { text: data.people.find((p) => p.id === m.person_id)?.full_name ?? "Unknown person", sub: "named person", vacant: false };
  };

  if (live.length === 0) return <p className="muted">Add a company first (Overview or Company Info).</p>;

  return (
    <>
      <div className="row block">
        <span className="field">
          <label htmlFor="sg-company">Company</label>
          <select id="sg-company" value={entityId} onChange={(e) => setEntityId(e.target.value)}>
            {live.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </span>
      </div>

      {groups.length === 0 && <p className="warning-text">No signatory groups for this company yet.</p>}
      {groups.map((g: SignGroup) => {
        const members = data.members.filter((m) => m.group_id === g.id);
        const scopes = data.scopes.filter((x) => x.group_id === g.id).sort((a, b) => a.position - b.position);
        return (
          <section key={g.id} className="card authority">
            <div className="row spread">
              {editable ? <TextOnBlur className="heading-input" value={g.name} label={`Rename ${g.name}`} onSave={(v) => void run(() => updateGroup(g.id, { name: v }))} /> : <h2>{g.name}</h2>}
              {editable && (
                <button type="button" className="link-dark small" disabled={busy} onClick={() => { if (window.confirm(`Remove the ${g.name} group?`)) void run(() => removeGroup(g.id)); }}>
                  Remove group
                </button>
              )}
            </div>

            <h3>Signatories</h3>
            <ul className="plain rows">
              {(editable || g.includes_directors) && (
                <li>
                  {editable ? (
                    <label className="check">
                      <input type="checkbox" checked={g.includes_directors} disabled={busy} onChange={(e) => void run(() => updateGroup(g.id, { includes_directors: e.target.checked }))} /> Directors
                      {g.includes_directors && <span className={directors.length ? "muted" : "warning-text"}>&nbsp;({directors.length ? directors.join(", ") : "none recorded for this company"})</span>}
                    </label>
                  ) : (
                    <>
                      <strong>Directors</strong>
                      {g.includes_directors && <span className={directors.length ? "muted" : "warning-text"}> ({directors.length ? directors.join(", ") : "none recorded for this company"})</span>}
                    </>
                  )}
                </li>
              )}
              {(editable || g.includes_secretary) && (
                <li>
                  {editable ? (
                    <label className="check">
                      <input type="checkbox" checked={g.includes_secretary} disabled={busy} onChange={(e) => void run(() => updateGroup(g.id, { includes_secretary: e.target.checked }))} /> Company Secretary
                      {g.includes_secretary && <span className={secretaries.length ? "muted" : "warning-text"}>&nbsp;({secretaries.length ? secretaries.join(", ") : "none recorded for this company"})</span>}
                    </label>
                  ) : (
                    <>
                      <strong>Company Secretary</strong>
                      {g.includes_secretary && <span className={secretaries.length ? "muted" : "warning-text"}> ({secretaries.length ? secretaries.join(", ") : "none recorded for this company"})</span>}
                    </>
                  )}
                </li>
              )}
              {members.map((m) => {
                const l = label(m);
                return (
                  <li key={m.id} className="row">
                    <span>
                      <strong>{l.text}</strong> <span className={l.vacant ? "warning-text" : "muted"}>({l.sub})</span>
                    </span>
                    {editable && (
                      <button type="button" className="link-dark small" disabled={busy} aria-label={`Remove ${l.text} from ${g.name}`} onClick={() => void run(() => removeMember(m.id))}>
                        Remove
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
            {editable && (
              <div className="row">
                <select aria-label={`Add an authorised signatory to ${g.name}`} value={adding[g.id] ?? ""} onChange={(e) => setAdding({ ...adding, [g.id]: e.target.value })}>
                  <option value="">Add an authorised signatory…</option>
                  <optgroup label="By position (preferred)">
                    {data.positions.filter((p) => p.is_active && !members.some((m) => m.position_id === p.id)).map((p) => (
                      <option key={p.id} value={`pos:${p.id}`}>
                        {p.title}
                        {currentHolders(data, p.id).length ? "" : " (vacant)"}
                      </option>
                    ))}
                    <option value="newpos">A new position…</option>
                  </optgroup>
                  <option value="person">A named person…</option>
                </select>
                <button
                  type="button"
                  className="quiet"
                  disabled={busy || !adding[g.id]}
                  onClick={() => {
                    const pick = adding[g.id];
                    if (pick === "newpos") {
                      const title = window.prompt("Name of the position (for example, Country Manager, New Zealand)");
                      if (title && title.trim().length >= 2) void run(async () => { const id = await addPosition(organisationId, title); await addMember(organisationId, version.id, g.id, { positionId: id }); });
                    } else if (pick === "person") {
                      const name = window.prompt("Full name of the authorised signatory");
                      if (name && name.trim().length >= 2) {
                        const known = data.people.find((x) => x.full_name.toLowerCase() === name.trim().toLowerCase());
                        void run(() => addMember(organisationId, version.id, g.id, known ? { personId: known.id } : { personName: name }));
                      }
                    } else void run(() => addMember(organisationId, version.id, g.id, { positionId: pick.slice(4) }));
                    setAdding({ ...adding, [g.id]: "" });
                  }}
                >
                  Add
                </button>
              </div>
            )}

            <h3>Can sign</h3>
            {scopes.length === 0 && <p className="warning-text">Nothing yet.</p>}
            <ul className="plain rows">
              {scopes.map((sc) => (
                <li key={sc.id}>
                  {editable ? (
                    <div className="scope-edit">
                      <TextOnBlur className="grow" value={sc.text} label="What this group can sign" onSave={(v) => void run(() => updateScope(sc.id, { text: v }))} />
                      <label className="check small">
                        <input type="checkbox" checked={sc.within_financial} disabled={busy} onChange={(e) => void run(() => updateScope(sc.id, { within_financial: e.target.checked }))} /> Up to the Financial Approval Matrix limits
                      </label>
                      <span className="row">
                        <span className="small muted">Up to $</span>
                        <AmountOnBlur value={sc.up_to} label="Upper amount (optional)" onSave={(v) => void run(() => updateScope(sc.id, { up_to: v }))} />
                        {sc.up_to !== null && (
                          <button type="button" className="link-dark small" onClick={() => void run(() => updateScope(sc.id, { up_to: null }))}>
                            No amount cap
                          </button>
                        )}
                      </span>
                      <button type="button" className="link-dark small" disabled={busy} onClick={() => void run(() => removeScope(sc.id))}>
                        Remove
                      </button>
                    </div>
                  ) : (
                    <span>
                      {sc.text}
                      {sc.up_to !== null ? `, up to ${money(sc.up_to)}` : ""}
                      {sc.within_financial ? ", within the Financial Approval Matrix limits" : ""}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            {editable && (
              <div className="row">
                <input className="grow" aria-label={`Add what ${g.name} can sign`} placeholder='e.g. Any distribution agreement relating to the New Zealand market' value={scopeText[g.id] ?? ""} onChange={(e) => setScopeText({ ...scopeText, [g.id]: e.target.value })} />
                <button type="button" className="quiet" disabled={busy || (scopeText[g.id] ?? "").trim().length < 3} onClick={() => void run(() => addScope(organisationId, version.id, g.id, scopeText[g.id], scopes.length + 1)).then((ok) => ok && setScopeText({ ...scopeText, [g.id]: "" }))}>
                  Add
                </button>
              </div>
            )}

            <h3>Minimum signatures</h3>
            {editable ? (
              <fieldset className="plain-fieldset">
                <legend className="muted small">Any one of the ticked combinations is enough</legend>
                {REQUIREMENTS.map((r) => (
                  <label key={r.value} className="check">
                    <input
                      type="checkbox"
                      checked={g.requirements.includes(r.value)}
                      disabled={busy}
                      onChange={(e) => void run(() => updateGroup(g.id, { requirements: e.target.checked ? [...g.requirements, r.value] : g.requirements.filter((x) => x !== r.value) }))}
                    />{" "}
                    {r.label}
                  </label>
                ))}
                <label htmlFor={`sg-stip-${g.id}`}>Other stipulations (optional)</label>
                <TextOnBlur value={g.stipulations ?? ""} label="Other stipulations" onSave={(v) => void run(() => updateGroup(g.id, { stipulations: v }))} />
              </fieldset>
            ) : (
              <p>
                {g.requirements.length ? g.requirements.map(requirementLabel).join("; or ") : <span className="warning-text">Not set</span>}
                {g.stipulations ? <><br /><span className="muted">{g.stipulations}</span></> : null}
              </p>
            )}
          </section>
        );
      })}

      {editable && (
        <section className="card form">
          <h2>Add a signatory group</h2>
          <div className="row">
            <input aria-label="New signatory group" list="sg-suggestions" placeholder="e.g. Managing Director, or Quality" value={newGroup} onChange={(e) => setNewGroup(e.target.value)} />
            <datalist id="sg-suggestions">
              {GROUP_SUGGESTIONS.map((x) => <option key={x} value={x} />)}
            </datalist>
            <button type="button" className="quiet" disabled={busy || newGroup.trim().length < 2} onClick={() => void run(() => addGroup(organisationId, version.id, entityId, newGroup, groups.length + 1)).then((ok) => ok && setNewGroup(""))}>
              Add group
            </button>
          </div>
          {others.length > 0 && (
            <div className="row">
              <select aria-label="Copy groups from another company" value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
                <option value="">Copy the groups of another company…</option>
                {others.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="quiet"
                disabled={busy || !copyFrom}
                onClick={() =>
                  void run(
                    () => copyGroups(organisationId, version.id, entityId, data.groups.filter((g) => g.version_id === version.id && g.entity_id === copyFrom), data.members, data.scopes, groups.length + 1),
                    "Copied. Check the directors, company secretary and authorised signatories are right for this company.",
                  ).then((ok) => ok && setCopyFrom(""))
                }
              >
                Copy
              </button>
            </div>
          )}
          <p className="muted">Directors and the company secretary come from the company's officeholders, so appointments and resignations flow through without a change here.</p>
        </section>
      )}
    </>
  );
}

export default function Authorities({ organisationId, entities, group, canEdit }: Props) {
  const [data, setData] = useState<AuthData | null>(null);
  const [view, setView] = useState<View>("financial");
  const [showing, setShowing] = useState<"open" | "in_force">("open");
  const [entityId, setEntityId] = useState<string>("");
  const [fnFilter, setFnFilter] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[] | null>(null);
  const [note, setNote] = useState("");
  const [meetingId, setMeetingId] = useState("");
  const [newName, setNewName] = useState("");
  const [newFunction, setNewFunction] = useState("");
  const [newPosition, setNewPosition] = useState("");
  const [holderFor, setHolderFor] = useState<string | null>(null);
  const [holderName, setHolderName] = useState("");
  const [holderActing, setHolderActing] = useState(false);

  const reload = useCallback(async () => {
    try {
      setData(await loadAuthorities(organisationId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the authorities.");
    }
  }, [organisationId]);
  useEffect(() => {
    void reload();
  }, [reload]);

  const run = async (work: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await work();
      await reload();
      if (done) setNotice(done);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (!data) return error ? <p className="error">{error}</p> : <p className="lead">Loading…</p>;

  const entityName = (id: string) => entities.find((e) => e.id === id)?.name ?? "a company";
  const positionTitle = (id: string | null) => (id ? data.positions.find((p) => p.id === id)?.title ?? "Unknown position" : null);

  const header = (
    <>
      <p className="eyebrow">Board</p>
      <h1>Authorities</h1>
      <p className="lead">Who can approve spending and who can sign for the company. Once locked, changes take effect only when the board ratifies them.</p>
      <InvestorConsents organisationId={organisationId} entities={entities} />
      <span className="segmented block-gap" role="group" aria-label="Authorities">
        {(["financial", "signing", "positions"] as View[]).map((k) => (
          <button key={k} type="button" className={view === k ? "on" : undefined} aria-pressed={view === k} onClick={() => { setView(k); setShowing("open"); setMissing(null); setError(null); setNotice(null); }}>
            {k === "positions" ? "Positions and holders" : KIND_LABEL[k]}
          </button>
        ))}
      </span>
      {notice && <p className="card note" role="status">{notice}</p>}
      {error && <p className="error block" role="alert">{error}</p>}
    </>
  );

  // ---- Positions and holders ----
  if (view === "positions") {
    // Counted in what is in force (or the draft, before anything is locked), not across versions
    const counted = (["financial", "signing"] as Kind[]).map((k) => (data.versions.find((v) => v.kind === k && v.status === "in_force") ?? data.versions.find((v) => v.kind === k && v.status === "draft"))?.id);
    const used = (id: string) =>
      data.cells.filter((c) => counted.includes(c.version_id) && (c.operational_position_id === id || c.finance_position_id === id)).length +
      data.members.filter((m) => counted.includes(m.version_id) && m.position_id === id).length;
    return (
      <>
        {header}
        <p className="muted">Approvals are tied to positions, not to people. Whoever holds a position holds its authority, and the history of holders shows who held it on any day.</p>
        <div className="table-scroll">
          <table className="report-table">
            <thead>
              <tr>
                <th scope="col">Position</th>
                <th scope="col">Held by</th>
                <th scope="col">Used in</th>
              </tr>
            </thead>
            <tbody>
              {data.positions.filter((p) => p.is_active).map((p) => {
                const holders = currentHolders(data, p.id);
                return (
                  <tr key={p.id}>
                    <th scope="row">{p.title}</th>
                    <td>
                      {holders.length === 0 && <span className="warning-text">Vacant </span>}
                      {holders.map((h) => (
                        <span key={h.id} className="person">
                          <span>
                            {h.person.full_name}
                            {h.is_acting ? <span className="muted"> (acting)</span> : null}
                            <span className="muted"> since {day(h.starts_on)}</span>
                          </span>
                          {canEdit && (
                            <button type="button" className="link-dark small" disabled={busy} aria-label={`End ${h.person.full_name} as ${p.title}`} onClick={() => { if (window.confirm(`${h.person.full_name} stops holding ${p.title} from today?`)) void run(() => endHolding(h.id)); }}>
                              End
                            </button>
                          )}
                        </span>
                      ))}
                      {canEdit &&
                        (holderFor === p.id ? (
                          <span className="row review">
                            <input aria-label="Holder's name" list="auth-people" placeholder="Full name" value={holderName} onChange={(e) => setHolderName(e.target.value)} />
                            <datalist id="auth-people">
                              {data.people.map((x) => <option key={x.id} value={x.full_name} />)}
                            </datalist>
                            <label className="check">
                              <input type="checkbox" checked={holderActing} onChange={(e) => setHolderActing(e.target.checked)} /> Acting
                            </label>
                            <button
                              type="button"
                              className="quiet"
                              disabled={busy || holderName.trim().length < 2}
                              onClick={() => {
                                const known = data.people.find((x) => x.full_name.toLowerCase() === holderName.trim().toLowerCase());
                                void run(() => assignHolder(organisationId, p.id, known ? { id: known.id } : { name: holderName }, holderActing)).then((ok) => ok && (setHolderFor(null), setHolderName(""), setHolderActing(false)));
                              }}
                            >
                              Save
                            </button>
                            <button type="button" className="link-dark" onClick={() => setHolderFor(null)}>Cancel</button>
                          </span>
                        ) : (
                          <button type="button" className="link-dark small" onClick={() => { setHolderFor(p.id); setHolderName(""); setHolderActing(false); }}>
                            {holders.length ? "Add another holder" : "Name the holder"}
                          </button>
                        ))}
                    </td>
                    <td>{used(p.id) ? `${used(p.id)} ${used(p.id) === 1 ? "approval" : "approvals"}` : <span className="muted">Not used</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {canEdit && (
          <div className="row block">
            <input aria-label="New position" placeholder="e.g. Chief Executive Officer" value={newPosition} onChange={(e) => setNewPosition(e.target.value)} />
            <button type="button" className="quiet" disabled={busy || newPosition.trim().length < 2} onClick={() => void run(() => addPosition(organisationId, newPosition), "Position added.").then((ok) => ok && setNewPosition(""))}>
              Add position
            </button>
          </div>
        )}
      </>
    );
  }

  // ---- A matrix ----
  const kind = view;
  const versions = data.versions.filter((v) => v.kind === kind);
  const inForce = versions.find((v) => v.status === "in_force");
  const open = versions.find((v) => v.status === "draft" || v.status === "proposed");
  const shown: Version | undefined = showing === "in_force" && inForce ? inForce : open ?? inForce;
  if (!shown) return <>{header}<p className="lead">Loading…</p></>;
  const editable = canEdit && shown.status === "draft";
  const isChange = Boolean(open?.based_on_id);
  const functions = kind === "financial" ? data.functions.filter((f) => f.version_id === shown.id).sort((a, b) => a.position - b.position) : [];
  const shownFunctions = fnFilter ? functions.filter((f) => f.id === fnFilter) : functions;
  const verticals = data.verticals.filter((v) => v.version_id === shown.id).sort((a, b) => a.position - b.position);
  const cellsOf = (bandId: string) => data.cells.filter((c) => c.band_id === bandId);
  const changes = open && inForce && isChange ? (kind === "signing" ? describeSigningChanges : describeChanges)(data, open, inForce, entityName) : [];
  const meeting = (id: string | null) => data.meetings.find((m) => m.id === id);
  const boardMeetings = data.meetings.filter((m) => m.body?.kind === "board" && m.status === "scheduled");
  const columns = kind === "financial" ? ["Operational", "Finance"] : ["First signatory", "Second signatory (optional)"];

  const positionSelect = (bandId: string, functionId: string | null, column: "operational_position_id" | "finance_position_id", label: string) => {
    const cell = cellsOf(bandId).find((c) => (c.function_id ?? null) === functionId);
    const value = cell?.[column] ?? null;
    if (!editable) {
      const title = positionTitle(value);
      if (!title) return <span className={column === "finance_position_id" && kind === "signing" ? "muted" : "warning-text"}>{column === "finance_position_id" && kind === "signing" ? "Not needed" : "Not set"}</span>;
      const holders = currentHolders(data, value!);
      return (
        <span>
          {title}
          <br />
          <span className={holders.length ? "muted small" : "warning-text small"}>{holders.length ? holders.map((h) => h.person.full_name + (h.is_acting ? " (acting)" : "")).join(", ") : "Vacant"}</span>
        </span>
      );
    }
    return (
      <select
        aria-label={label}
        value={value ?? ""}
        disabled={busy}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "__new__") {
            const title = window.prompt("Name of the new position (for example, Chief Financial Officer)");
            if (title && title.trim().length >= 2) void run(async () => { const id = await addPosition(organisationId, title); await setApprover(organisationId, shown.id, bandId, functionId, cell, column, id); });
            return;
          }
          void run(() => setApprover(organisationId, shown.id, bandId, functionId, cell, column, v || null));
        }}
      >
        <option value="">{column === "finance_position_id" && kind === "signing" ? "Not needed" : "Choose…"}</option>
        {data.positions.filter((p) => p.is_active).map((p) => (
          <option key={p.id} value={p.id}>
            {p.title}
            {currentHolders(data, p.id).length ? "" : " (vacant)"}
          </option>
        ))}
        <option value="__new__">A new position…</option>
      </select>
    );
  };

  return (
    <>
      {header}

      {/* Where this framework stands */}
      {!inForce && open && (
        <section className="card warning">
          <h2>Draft: not yet in force</h2>
          <p>Set the limits and approvers, then lock it once the board has approved it. After that, every change needs board ratification.</p>
        </section>
      )}
      {inForce && !open && (
        <section className="card note">
          <h2>In force: version {inForce.number}</h2>
          <p className="muted">
            Since {day(inForce.in_force_from ?? inForce.created_at)}. {inForce.approval_note ? `Approved: ${inForce.approval_note}.` : inForce.resolution_id ? "Ratified by board resolution." : ""}
          </p>
          {canEdit && (
            <button type="button" disabled={busy} onClick={() => void run(() => startChange(organisationId, kind), "A draft change has been started from the version in force. Edit it, then submit it for ratification.")}>
              Propose a change
            </button>
          )}
        </section>
      )}
      {inForce && open && (
        <section className={open.status === "proposed" ? "card warning" : "card note"}>
          <h2>{open.status === "proposed" ? `Change awaiting ratification: version ${open.number}` : `Change in draft: version ${open.number}`}</h2>
          {open.status === "proposed" ? (
            <p>
              Queued for {meeting(open.meeting_id)?.title ?? "a board meeting"}
              {meeting(open.meeting_id) ? ` on ${day(meeting(open.meeting_id)!.scheduled_at)}` : ""}. Version {inForce.number} stays in force until the board passes the resolution on that agenda item. If it is not passed, the change is rejected.
            </p>
          ) : (
            <p>Version {inForce.number} stays in force while you edit this draft.</p>
          )}
          <span className="segmented" role="group" aria-label="Which version">
            <button type="button" className={showing === "open" ? "on" : undefined} aria-pressed={showing === "open"} onClick={() => setShowing("open")}>
              The change (v{open.number})
            </button>
            <button type="button" className={showing === "in_force" ? "on" : undefined} aria-pressed={showing === "in_force"} onClick={() => setShowing("in_force")}>
              In force (v{inForce.number})
            </button>
          </span>
          <h3>What changes</h3>
          {changes.length === 0 ? <p className="muted">Nothing yet.</p> : <ul>{changes.map((c, n) => <li key={n}>{c}</li>)}</ul>}
          {canEdit && (
            <div className="row">
              {open.status === "proposed" && (
                <button type="button" className="quiet" disabled={busy} onClick={() => void run(() => reopenChange(open.id), "Back in draft. The agenda item has been taken off the meeting.")}>
                  Take back to draft
                </button>
              )}
              <button type="button" className="link-dark" disabled={busy} onClick={() => { if (window.confirm("Withdraw this change? The version in force is not affected.")) void run(() => withdrawChange(open.id), "Change withdrawn."); }}>
                Withdraw the change
              </button>
            </div>
          )}
        </section>
      )}

      {kind === "signing" ? (
        <SigningGroups organisationId={organisationId} data={data} version={shown} editable={editable} entities={entities} group={group} busy={busy} run={run} />
      ) : (
        <>
      {/* Scope and filter */}
      <div className="row block">
        <span className="field">
          <label htmlFor="auth-scope">Showing</label>
          <select id="auth-scope" value={entityId} onChange={(e) => setEntityId(e.target.value)}>
            <option value="">The whole group</option>
            {entities.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </span>
        {kind === "financial" && (
          <span className="field">
            <label htmlFor="auth-fn">Function</label>
            <select id="auth-fn" value={fnFilter} onChange={(e) => setFnFilter(e.target.value)}>
              <option value="">All functions</option>
              {functions.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </span>
        )}
      </div>

      {/* Functions */}
      {kind === "financial" && editable && (
        <section className="card form">
          <h2>Functions</h2>
          <p className="muted">Each function names its own operational and finance approver for every band.</p>
          <ul className="plain rows">
            {functions.map((f) => (
              <li key={f.id} className="row">
                <TextOnBlur value={f.name} label={`Rename ${f.name}`} onSave={(v) => void run(() => renameFunction(f.id, v))} />
                <button type="button" className="link-dark small" disabled={busy || functions.length === 1} onClick={() => { if (window.confirm(`Remove the ${f.name} function and its approvers?`)) void run(() => removeFunction(f.id)); }}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <div className="row">
            <input aria-label="New function" placeholder="e.g. Commercial" value={newFunction} onChange={(e) => setNewFunction(e.target.value)} />
            <button type="button" className="quiet" disabled={busy || newFunction.trim().length < 2} onClick={() => void run(() => addFunction(organisationId, shown.id, newFunction, functions.length + 1)).then((ok) => ok && setNewFunction(""))}>
              Add function
            </button>
          </div>
        </section>
      )}

      {/* The matrix */}
      {verticals.map((v) => {
        const { list, varied, group } = bandsFor(data, v.id, entityId || null);
        const editBands = editable && (!entityId || varied);
        return (
          <section key={v.id} className="card authority">
            <div className="row spread">
              {editable ? <TextOnBlur className="heading-input" value={v.name} label={`Rename ${v.name}`} onSave={(x) => void run(() => renameVertical(v.id, x))} /> : <h2>{v.name}</h2>}
              {editable && !entityId && (
                <button type="button" className="link-dark small" disabled={busy} onClick={() => { if (window.confirm(`Remove ${v.name} and all its bands?`)) void run(() => removeVertical(v.id)); }}>
                  Remove vertical
                </button>
              )}
            </div>
            {entityId && (
              <p className="muted">
                {varied ? `${entityName(entityId)} has its own limits for this vertical.` : `${entityName(entityId)} follows the group limits.`}{" "}
                {editable &&
                  (varied ? (
                    <button type="button" className="link-dark small" disabled={busy} onClick={() => void run(() => removeVariation(list.map((b) => b.id)))}>
                      Go back to the group limits
                    </button>
                  ) : (
                    <button type="button" className="link-dark small" disabled={busy} onClick={() => void run(() => varyForCompany(organisationId, shown.id, v.id, entityId, group, data.cells))}>
                      Set different limits for this company
                    </button>
                  ))}
              </p>
            )}
            <div className="table-scroll">
              <table className="report-table auth-table">
                <thead>
                  {kind === "financial" && (
                    <tr>
                      <th scope="col" rowSpan={2}>Amount</th>
                      {shownFunctions.map((f) => (
                        <th key={f.id} scope="colgroup" colSpan={2}>
                          {f.name}
                        </th>
                      ))}
                    </tr>
                  )}
                  <tr>
                    {(kind as Kind) === "signing" && <th scope="col">Amount</th>}
                    {(kind === "financial" ? shownFunctions : [null]).map((f) => (
                      <Fragment key={f?.id ?? "one"}>
                        <th scope="col">{columns[0]}</th>
                        <th scope="col">{columns[1]}</th>
                      </Fragment>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {list.map((b: Band, n) => {
                    const last = n === list.length - 1;
                    return (
                      <tr key={b.id}>
                        <th scope="row">
                          {bandLabel(b, list[n - 1])}
                          {editBands && (
                            <span className="band-edit">
                              {!b.board && b.up_to !== null && <AmountOnBlur value={b.up_to} label={`Upper limit of band ${n + 1}`} onSave={(x) => void run(() => updateBand(b.id, { up_to: x }))} />}
                              {last && (
                                <label className="check small">
                                  <input type="checkbox" checked={b.board} disabled={busy} onChange={(e) => void run(() => updateBand(b.id, { board: e.target.checked, up_to: null }))} /> Goes to the board
                                </label>
                              )}
                              {list.length > 1 && (
                                <button type="button" className="link-dark small" disabled={busy} onClick={() => void run(() => removeBand(b.id))}>
                                  Remove band
                                </button>
                              )}
                            </span>
                          )}
                        </th>
                        {b.board ? (
                          <td colSpan={(kind === "financial" ? shownFunctions.length : 1) * 2} className="board-cell">
                            Board approval
                          </td>
                        ) : (
                          (kind === "financial" ? shownFunctions : [null]).map((f) => (
                            <Fragment key={f?.id ?? "one"}>
                              <td>{editBands ? positionSelect(b.id, f?.id ?? null, "operational_position_id", `${v.name}, band ${n + 1}${f ? `, ${f.name}` : ""}: ${columns[0]}`) : positionSelect(b.id, f?.id ?? null, "operational_position_id", "")}</td>
                              <td>{editBands ? positionSelect(b.id, f?.id ?? null, "finance_position_id", `${v.name}, band ${n + 1}${f ? `, ${f.name}` : ""}: ${columns[1]}`) : positionSelect(b.id, f?.id ?? null, "finance_position_id", "")}</td>
                            </Fragment>
                          ))
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {editBands && (
              <button type="button" className="quiet" disabled={busy} onClick={() => void run(() => addBand(organisationId, shown.id, v.id, entityId || null, list))}>
                Add a band
              </button>
            )}
          </section>
        );
      })}

      {editable && !entityId && (
        <div className="row block">
          <input aria-label="New vertical" placeholder={kind === "financial" ? "e.g. Capital Approval (Property)" : "e.g. Marketing agreements"} value={newName} onChange={(e) => setNewName(e.target.value)} />
          <button type="button" className="quiet" disabled={busy || newName.trim().length < 2} onClick={() => void run(() => addVertical(organisationId, shown.id, newName, verticals.length + 1)).then((ok) => ok && setNewName(""))}>
            Add vertical
          </button>
        </div>
      )}

        </>
      )}

      {/* Lock or propose */}
      {editable && (
        <section className="card form">
          <h2>{isChange ? "Submit for board ratification" : "Lock once the board has approved"}</h2>
          <button type="button" className="quiet" disabled={busy} onClick={() => void run(async () => setMissing(await gaps(shown.id)))}>
            Check it is complete
          </button>
          {missing && (missing.length === 0 ? <p className="muted">Complete: nothing is missing.</p> : <ul className="warning-text">{missing.map((m, n) => <li key={n}>{m}</li>)}</ul>)}
          {isChange ? (
            <>
              <label htmlFor="auth-meeting">Board meeting to ratify it</label>
              <select id="auth-meeting" value={meetingId} onChange={(e) => setMeetingId(e.target.value)}>
                <option value="">Choose a meeting…</option>
                {boardMeetings.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title}, {day(m.scheduled_at)}
                    {m.body ? ` (${m.body.name})` : ""}
                  </option>
                ))}
              </select>
              {boardMeetings.length === 0 && <p className="warning-text">No upcoming board meeting is scheduled. Schedule one under Board, Meetings first.</p>}
              <label htmlFor="auth-note">What is changing and why</label>
              <textarea id="auth-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
              <button type="button" disabled={busy || !meetingId || note.trim().length < 5} onClick={() => void run(() => proposeChange(shown.id, meetingId, note), "Submitted. A decision item has been added to the meeting agenda; the change takes effect when the board passes it.").then((ok) => ok && (setNote(""), setMeetingId("")))}>
                Submit for ratification
              </button>
            </>
          ) : (
            <>
              <label htmlFor="auth-note">How the board approved it</label>
              <input id="auth-note" placeholder="e.g. Board meeting 1 October 2026, resolution 4" value={note} onChange={(e) => setNote(e.target.value)} />
              <button
                type="button"
                disabled={busy || note.trim().length < 5}
                onClick={() => {
                  if (window.confirm("Lock these authorities? After this, any change needs board ratification.")) void run(() => lockAuthority(shown.id, note), "Locked and in force.").then((ok) => ok && setNote(""));
                }}
              >
                Lock
              </button>
            </>
          )}
        </section>
      )}

      {versions.length > 1 && (
        <section className="block">
          <h2>History</h2>
          <ul className="plain rows">
            {[...versions].reverse().map((v) => (
              <li key={v.id} className="row spread">
                <span>
                  Version {v.number}
                  {v.change_note ? `: ${v.change_note}` : ""}
                </span>
                <span className="muted">
                  {STATUS_LABEL[v.status]}
                  {v.in_force_from ? `, from ${day(v.in_force_from)}` : ""}
                  {v.ended_at ? ` to ${day(v.ended_at)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="muted">Amounts are in Australian dollars.</p>
    </>
  );
}

/** Investor reserved matters: consents needed on top of the delegated authorities (startup mode, migration 0044) */
function InvestorConsents({ organisationId, entities }: { organisationId: string; entities: { id: string; name: string; startup_mode?: boolean }[] }) {
  const [rows, setRows] = useState<{ id: string; entity_id: string; matter: string; consent_from: string; clause: string | null }[]>([]);
  const startupIds = entities.filter((e) => e.startup_mode).map((e) => e.id).join(",");
  useEffect(() => {
    if (!supabase || !startupIds) return setRows([]);
    void supabase.from("reserved_matters").select("id, entity_id, matter, consent_from, clause").eq("organisation_id", organisationId).eq("is_active", true).in("entity_id", startupIds.split(","))
      .then(({ data }) => setRows((data ?? []) as typeof rows));
  }, [organisationId, startupIds]);
  if (!rows.length) return null;
  return (
    <section className="card note block">
      <h2>Investor consents also needed</h2>
      <p className="small muted">Even within these authorities, these decisions need investor consent first. Contracts that fall within them cannot be approved until it is recorded. Manage them under Company, Ownership.</p>
      <ul className="plain small">
        {rows.map((r) => (
          <li key={r.id}>
            <strong>{r.matter}</strong> · consent from {r.consent_from}
            {entities.length > 1 ? ` · ${entities.find((e) => e.id === r.entity_id)?.name ?? ""}` : ""}
            {r.clause ? <span className="muted"> · {r.clause}</span> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
