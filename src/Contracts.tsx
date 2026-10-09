import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  ANY,
  holders,
  loadAuthority,
  money,
  TRANSACTION_TYPES,
  whoCan,
  type AuthorityData,
  type Rule,
} from "./authority";
import { formatDay, formatWhen } from "./board";
import {
  CONTRACT_STATUS,
  decideApproval,
  EXCEPTION_LABELS,
  fileContract,
  INTERCOMPANY_TYPE,
  loadContracts,
  recordSignature,
  resubmitContract,
  type Approval,
  type Contract,
  type ContractsData,
} from "./contracts";
import type { GroupData } from "./types";

type Props = {
  organisationId: string;
  group: GroupData;
  role: string;
  /** Opens straight onto one contract, e.g. when arriving from the intercompany map. */
  initialOpenId?: string | null;
};

const NO_RULE = "__none__";

const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function signerLabel(authority: AuthorityData, rule: Rule): string {
  if (rule.holder_kind === "statutory") return rule.statutory_basis ?? "";
  if (rule.holder_kind === "attorney")
    return `${authority.attorneys.find((a) => a.id === rule.power_of_attorney_id)?.attorney_name ?? "Attorney"} (attorney)`;
  const title = authority.positions.find((p) => p.id === rule.position_id)?.title ?? "Position";
  const people = holders(authority, rule.position_id ?? "");
  return people.length ? `${title}: ${people.join(", ")}` : title;
}

function ApprovalDecision({ approval, busy, onDecide }: { approval: Approval; busy: boolean; onDecide: (approve: boolean, note: string) => void }) {
  const [note, setNote] = useState("");
  const id = `approval-note-${approval.id}`;
  return (
    <>
      <label htmlFor={id}>Note (optional), e.g. how approval was given</label>
      <input id={id} value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="row">
        <button type="button" disabled={busy} onClick={() => onDecide(true, note)}>
          Record approval
        </button>
        <button type="button" className="quiet" disabled={busy} onClick={() => onDecide(false, note)}>
          Record refusal
        </button>
      </div>
    </>
  );
}

function SignForm({
  idPrefix,
  signers,
  authority,
  outOfOrder,
  busy,
  onSign,
}: {
  idPrefix: string;
  signers: Rule[];
  authority: AuthorityData;
  outOfOrder: boolean;
  busy: boolean;
  onSign: (ruleId: string | null, signedBy: string, signedOn: string) => void;
}) {
  const [rule, setRule] = useState("");
  const [signedBy, setSignedBy] = useState("");
  const [signedOn, setSignedOn] = useState(localToday);
  const [problem, setProblem] = useState<string | null>(null);
  const chosen = rule || (signers[0]?.id ?? NO_RULE);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (signedBy.trim().length < 2) return setProblem("Enter who signed.");
    setProblem(null);
    const ruleId = chosen === NO_RULE ? null : chosen;
    if ((outOfOrder || !ruleId) && !window.confirm("This will be logged as an exception and reported to the board. Record it anyway?"))
      return;
    onSign(ruleId, signedBy, signedOn);
  }

  return (
    <form className="form" onSubmit={submit}>
      {outOfOrder && (
        <p className="warning-text">This contract is not approved yet. Recording a signature now will be logged as an exception.</p>
      )}
      <label htmlFor={`${idPrefix}-rule`}>Signed under</label>
      <select id={`${idPrefix}-rule`} value={chosen} onChange={(e) => setRule(e.target.value)}>
        {signers.map((r) => (
          <option key={r.id} value={r.id}>
            {signerLabel(authority, r)}
          </option>
        ))}
        <option value={NO_RULE}>None of these (outside authority)</option>
      </select>
      <label htmlFor={`${idPrefix}-by`}>Who signed</label>
      <input id={`${idPrefix}-by`} value={signedBy} onChange={(e) => setSignedBy(e.target.value)} />
      <label htmlFor={`${idPrefix}-on`}>Date signed</label>
      <input id={`${idPrefix}-on`} type="date" max={localToday()} value={signedOn} onChange={(e) => setSignedOn(e.target.value)} />
      <button type="submit" disabled={busy}>
        Record signature
      </button>
      {problem && (
        <p className="error" role="alert">
          {problem}
        </p>
      )}
    </form>
  );
}

export default function Contracts({ organisationId, group, role, initialOpenId }: Props) {
  const canFile = role !== "auditor";
  const canRecord = ["owner", "admin", "secretary", "legal", "compliance"].includes(role);

  const [data, setData] = useState<ContractsData | null>(null);
  const [authority, setAuthority] = useState<AuthorityData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(initialOpenId ?? null);

  // New contract
  const [entityId, setEntityId] = useState(group.entities[0]?.id ?? "");
  const [counterparty, setCounterparty] = useState("");
  const [title, setTitle] = useState("");
  const [type, setType] = useState("");
  const [value, setValue] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [noticeBy, setNoticeBy] = useState("");
  const [autoRenews, setAutoRenews] = useState(false);
  const [summary, setSummary] = useState("");

  const reload = useCallback(async () => {
    const [contracts, rules] = await Promise.all([loadContracts(organisationId), loadAuthority(organisationId)]);
    setData(contracts);
    setAuthority(rules);
  }, [organisationId]);

  useEffect(() => {
    reload().catch((e) => setError(e instanceof Error ? e.message : "Could not load contracts."));
  }, [reload]);

  async function run(action: () => Promise<void>): Promise<boolean> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      await reload();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (!data || !authority) {
    return error ? (
      <p className="error" role="alert">
        {error}
      </p>
    ) : (
      <p className="lead">Loading…</p>
    );
  }

  const entityName = (id: string | null | undefined) => group.entities.find((e) => e.id === id)?.name ?? "Unknown entity";
  const otherName = (c: Contract) => c.counterparty?.name ?? entityName(c.counterparty_entity_id);
  const who = (uid: string | null) => data.people.find((p) => p.user_id === uid)?.full_name ?? "a member";
  const types = [...new Set([...TRANSACTION_TYPES, ...authority.rules.map((r) => r.transaction_type)])].filter(
    (t) => t !== ANY && t !== INTERCOMPANY_TYPE,
  );

  // ---------- One contract ----------
  const open = openId ? data.contracts.find((c) => c.id === openId) : undefined;
  if (open) {
    const sides = [open.entity_id, ...(open.counterparty_entity_id ? [open.counterparty_entity_id] : [])];
    const twoSided = sides.length > 1;
    const approvals = data.approvals.filter((a) => a.contract_id === open.id);
    const signatures = data.signatures.filter((s) => s.contract_id === open.id);
    const exceptions = data.exceptions.filter((x) => x.contract_id === open.id);
    const reminders = data.reminders.filter((r) => r.subject_id === open.id);
    // The latest approval for each side (the list is newest first)
    const approvalFor = (side: string) => approvals.find((a) => (a.entity_id ?? open.entity_id) === side);
    const signatureFor = (side: string) => signatures.find((s) => (s.entity_id ?? open.entity_id) === side);
    const canSign = canRecord && open.status !== "signed" && open.status !== "terminated";
    const outOfOrder = open.status !== "approved";
    const partyId = open.counterparty?.id;
    const party = partyId ? data.counterparties.find((p) => p.id === partyId) : undefined;
    const blocked = party?.dd_status === "rejected" || (party?.dd_status === "open" && party?.risk_rating === "high");
    const ddLine = twoSided
      ? "Both sides are group entities, so third-party due diligence does not apply."
      : !party?.dd_status
        ? "No due diligence on record for the other party."
        : party.dd_status === "rejected"
          ? "The other party was rejected in due diligence, so this contract cannot be approved."
          : party.dd_status === "open"
            ? party.risk_rating === "high"
              ? "The other party is rated high risk and its due diligence is not finished, so this contract cannot be approved yet."
              : "Due diligence on the other party is in progress."
            : `The other party is cleared${party.dd_status === "cleared_with_conditions" ? " with conditions" : ""} (${party.risk_rating ?? "unrated"} risk).`;

    return (
      <>
        <button type="button" className="back" onClick={() => { setOpenId(null); setError(null); setNotice(null); }}>
          ← Back to contracts
        </button>
        <p className="eyebrow">
          {entityName(open.entity_id)} · {otherName(open)}
        </p>
        <h1>{open.title}</h1>
        <p className="lead">
          <span className="chip">{CONTRACT_STATUS[open.status]}</span>
          {twoSided && (
            <>
              {" "}
              <span className="chip">Intercompany</span>
            </>
          )}
        </p>
        <p className={blocked ? "card warning" : "muted"}>{ddLine}</p>

        <dl className="detail-list two">
          <div>
            <dt>Type</dt>
            <dd>{twoSided ? (open.arrangement_type ?? "Intercompany") : open.transaction_type === ANY ? "Not specified" : open.transaction_type}</dd>
          </div>
          <div>
            <dt>{open.arrangement_type === "Loan" ? "Principal" : "Value"}</dt>
            <dd>{open.value_amount === null ? "Not stated" : money(open.value_amount)}</dd>
          </div>
          {open.pricing_basis && (
            <div>
              <dt>Pricing basis</dt>
              <dd>{open.pricing_basis}</dd>
            </div>
          )}
          {open.interest_rate != null && (
            <div>
              <dt>Interest rate</dt>
              <dd>{Number(open.interest_rate)}% a year</dd>
            </div>
          )}
          <div>
            <dt>Term</dt>
            <dd>
              {open.starts_on ? formatDay(open.starts_on) : "Start not stated"} to{" "}
              {open.ends_on ? formatDay(open.ends_on) : "no end date"}
              {open.auto_renews ? " · renews automatically" : ""}
            </dd>
          </div>
          <div>
            <dt>{twoSided ? "Review by" : "Notice by"}</dt>
            <dd>{open.notice_by ? formatDay(open.notice_by) : "Not stated"}</dd>
          </div>
          {open.summary && (
            <div>
              <dt>Summary</dt>
              <dd className="muted">{open.summary}</dd>
            </div>
          )}
        </dl>

        {notice && (
          <p className="card note block" role="status">
            {notice}
          </p>
        )}
        {error && (
          <p className="error block" role="alert">
            {error}
          </p>
        )}

        {exceptions.length > 0 && (
          <section className="card warning block">
            <h2>Exceptions reported to the board</h2>
            <ul className="plain">
              {exceptions.map((x) => (
                <li key={x.id}>
                  <strong>{EXCEPTION_LABELS[x.kind] ?? x.kind}.</strong> {x.detail}.
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="card block">
          <h2>1. Approval</h2>
          {approvals.length === 0 && <p>Not yet sent for approval.</p>}
          {sides.map((side) => {
            const approval = approvalFor(side);
            if (!approval) return null;
            return (
              <div key={side} className="side-block">
                {twoSided && <h3>{entityName(side)}</h3>}
                <p>
                  Approval required from <strong>{approval.required_holder}</strong>.
                </p>
                <p className="muted">{approval.basis}.</p>
                {approval.status === "pending" && open.status === "pending_approval" && canRecord && (
                  <ApprovalDecision
                    approval={approval}
                    busy={busy}
                    onDecide={(approve, note) => void run(() => decideApproval(approval.id, approve, note))}
                  />
                )}
                {approval.status === "pending" && !canRecord && <p className="muted">Waiting for a decision.</p>}
                {approval.status !== "pending" && (
                  <p>
                    <strong>{approval.status === "approved" ? "Approved" : "Refused"}</strong>
                    {approval.decided_at ? ` on ${formatWhen(approval.decided_at)}` : ""}
                    {approval.decided_by
                      ? approval.on_behalf
                        ? `, recorded by ${who(approval.decided_by)} on behalf of ${approval.required_holder}`
                        : `, by ${who(approval.decided_by)} as ${approval.required_holder}`
                      : ""}
                    .{approval.comment ? ` Note: ${approval.comment}` : ""}
                  </p>
                )}
              </div>
            );
          })}
          {open.status === "rejected" && canFile && (
            <button type="button" className="quiet" disabled={busy} onClick={() => void run(() => resubmitContract(open.id))}>
              Send for approval again
            </button>
          )}
        </section>

        <section className="card block">
          <h2>2. Signing</h2>
          {sides.map((side) => {
            const signature = signatureFor(side);
            const signers = whoCan(authority, side, "execute", open.transaction_type, open.value_amount ?? 0);
            return (
              <div key={side} className="side-block">
                {twoSided && <h3>{entityName(side)}</h3>}
                {signature ? (
                  <p>
                    Signed by <strong>{signature.signed_by}</strong> on {formatDay(signature.signed_on)}, as{" "}
                    {signature.capacity === "No recorded authority" ? "no recorded authority" : signature.capacity}.
                  </p>
                ) : (
                  <>
                    {signers.length === 0 ? (
                      <p className="warning-text">
                        No one is authorised to sign this for {entityName(side)}. Add a signing rule on the Authority page.
                      </p>
                    ) : (
                      <>
                        <p>Authorised to sign:</p>
                        <ul className="plain">
                          {signers.map((r) => (
                            <li key={r.id}>{signerLabel(authority, r)}</li>
                          ))}
                        </ul>
                      </>
                    )}
                    {canSign && (
                      <SignForm
                        idPrefix={`sign-${side}`}
                        signers={signers}
                        authority={authority}
                        outOfOrder={outOfOrder}
                        busy={busy}
                        onSign={(ruleId, signedBy, signedOn) =>
                          void run(async () => {
                            const raised = await recordSignature(open.id, ruleId, signedBy, signedOn, twoSided ? side : undefined);
                            setNotice(
                              raised > 0
                                ? `Signature recorded. ${raised} exception${raised === 1 ? " was" : "s were"} logged for the board.`
                                : twoSided
                                  ? "Signature recorded."
                                  : "Signature recorded and reminders set.",
                            );
                          })
                        }
                      />
                    )}
                  </>
                )}
              </div>
            );
          })}
        </section>

        <section className="card block">
          <h2>3. Reminders</h2>
          {reminders.length === 0 ? (
            <p>
              {open.status === "signed"
                ? "No reminders: this contract has no end date or notice date."
                : "Set automatically from the end date and notice date once the contract is signed."}
            </p>
          ) : (
            <ul className="plain">
              {reminders.map((r) => (
                <li key={r.id}>
                  {r.title}
                  {r.due_at && <span className="muted"> · {formatDay(r.due_at)}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </>
    );
  }

  // ---------- List and filing ----------
  async function submit(event: FormEvent) {
    event.preventDefault();
    const amount = value.trim() === "" ? null : Number(value.replace(/[$,\s]/g, ""));
    if (amount !== null && !(Number.isFinite(amount) && amount >= 0)) return setError("Enter the value as a number, or leave it blank.");
    if (counterparty.trim().length < 2 || title.trim().length < 2) return setError("Enter the other party and a title.");
    let created = "";
    const ok = await run(async () => {
      created = await fileContract(organisationId, data!, {
        entityId,
        counterpartyName: counterparty,
        title,
        transactionType: type,
        value: amount,
        startsOn: startsOn || null,
        endsOn: endsOn || null,
        noticeBy: noticeBy || null,
        autoRenews,
        summary,
      });
    });
    if (ok) {
      setCounterparty("");
      setTitle("");
      setValue("");
      setStartsOn("");
      setEndsOn("");
      setNoticeBy("");
      setAutoRenews(false);
      setSummary("");
      setOpenId(created);
    }
  }

  const nextDate = (c: Contract) =>
    c.status !== "signed" ? null : c.notice_by ? `Notice by ${formatDay(c.notice_by)}` : c.ends_on ? `Ends ${formatDay(c.ends_on)}` : null;

  return (
    <>
      <p className="eyebrow">Contracts</p>
      <h1>Contracts</h1>

      {data.exceptions.length > 0 && (
        <section className="card warning">
          <h2>Exceptions register</h2>
          <ul className="plain">
            {data.exceptions.map((x) => (
              <li key={x.id}>
                <strong>{data.contracts.find((c) => c.id === x.contract_id)?.title ?? "Contract"}:</strong>{" "}
                {EXCEPTION_LABELS[x.kind] ?? x.kind} <span className="muted">· {formatDay(x.created_at)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.contracts.length === 0 ? (
        <p className="lead">No contracts yet.</p>
      ) : (
        <ul className="entity-list">
          {data.contracts.map((c) => (
            <li key={c.id}>
              <button type="button" className="entity-row" onClick={() => setOpenId(c.id)}>
                <span>
                  <span className="entity-name">{c.title}</span>
                  <span className="muted"> · {otherName(c)}</span>
                  <br />
                  <span className="muted">
                    {entityName(c.entity_id)}
                    {c.counterparty_entity_id ? " · intercompany" : ""}
                    {c.value_amount !== null ? ` · ${money(c.value_amount)}` : ""}
                    {nextDate(c) ? ` · ${nextDate(c)}` : ""}
                  </span>
                </span>
                <span className="chip">{CONTRACT_STATUS[c.status]}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {canFile &&
        (group.entities.length === 0 ? (
          <p className="card note">Add an entity on the Overview page first; a contract belongs to a company.</p>
        ) : (
          <form className="card form" onSubmit={submit}>
            <h2>File a contract</h2>
            <p className="muted">
              For now the details are typed in. Reading them from the uploaded document comes with AI extraction.
            </p>
            <label htmlFor="c-entity">Our company</label>
            <select id="c-entity" value={entityId} onChange={(e) => setEntityId(e.target.value)}>
              {group.entities.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
            <label htmlFor="c-party">Other party</label>
            <input id="c-party" list="counterparties" autoComplete="off" value={counterparty} onChange={(e) => setCounterparty(e.target.value)} />
            <datalist id="counterparties">
              {data.counterparties.map((p) => (
                <option key={p.id} value={p.name} />
              ))}
            </datalist>
            <label htmlFor="c-title">Title</label>
            <input id="c-title" placeholder="e.g. Supply agreement" value={title} onChange={(e) => setTitle(e.target.value)} />
            <label htmlFor="c-type">Type of transaction</label>
            <input id="c-type" list="contract-types" autoComplete="off" value={type} onChange={(e) => setType(e.target.value)} />
            <datalist id="contract-types">
              {types.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
            <label htmlFor="c-value">Total value in Australian dollars</label>
            <input id="c-value" className="short-wide" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
            <div className="row">
              <span className="field">
                <label htmlFor="c-start">Starts</label>
                <input id="c-start" type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
              </span>
              <span className="field">
                <label htmlFor="c-end">Ends</label>
                <input id="c-end" type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
              </span>
              <span className="field">
                <label htmlFor="c-notice">Give notice by</label>
                <input id="c-notice" type="date" value={noticeBy} onChange={(e) => setNoticeBy(e.target.value)} />
              </span>
            </div>
            <label className="check">
              <input type="checkbox" checked={autoRenews} onChange={(e) => setAutoRenews(e.target.checked)} /> Renews
              automatically
            </label>
            <label htmlFor="c-summary">Summary or unusual terms (optional)</label>
            <textarea id="c-summary" rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} />
            <button type="submit" disabled={busy}>
              {busy ? "Filing…" : "File and send for approval"}
            </button>
          </form>
        ))}
      {error && (
        <p className="error block" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
