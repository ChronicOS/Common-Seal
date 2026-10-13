import { Fragment, useCallback, useEffect, useState } from "react";
import {
  addBand,
  addFunction,
  addPosition,
  addVertical,
  assignHolder,
  bandLabel,
  bandsFor,
  currentHolders,
  describeChanges,
  endHolding,
  gaps,
  KIND_LABEL,
  loadAuthorities,
  lockAuthority,
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
import type { Entity } from "./types";

type Props = { organisationId: string; entities: Entity[]; canEdit: boolean };
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

export default function Authorities({ organisationId, entities, canEdit }: Props) {
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
    const used = (id: string) => data.cells.filter((c) => counted.includes(c.version_id) && (c.operational_position_id === id || c.finance_position_id === id)).length;
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
  const changes = open && inForce && isChange ? describeChanges(data, open, inForce, entityName) : [];
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
                    {kind === "signing" && <th scope="col">Amount</th>}
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
