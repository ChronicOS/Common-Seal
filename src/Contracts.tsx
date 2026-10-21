import { has, only } from "./roles";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import Attachments from "./Attachments";
import { recordConsent } from "./ownership";
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
import DropZone from "./DropZone";
import ContractReader from "./ContractReader";
import { tfcLine } from "./contractReading";
import { FilingPanel, SigningPanel } from "./ContractPanels";
import { AGREEMENT_TYPES, FUNCTIONS, TYPE_GROUPS, typeLabel, VERDICT_LABEL, type SignatoryCheck } from "./contractFiling";
import { attachFile, downloadFile, listFiles, type LinkedFile } from "./files";
import {
  CONTRACT_STATUS,
  decideApproval,
  EXCEPTION_LABELS,
  fileContract,
  INTERCOMPANY_TYPE,
  loadContracts,
  partyGate,
  consentGate,
  consentsGiven,
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
  /** Opens Due Diligence, ready to start on this third party */
  onStartDueDiligence?: (partyId: string) => void;
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

export default function Contracts({ organisationId, group, role, initialOpenId, onStartDueDiligence }: Props) {
  const canFile = !only(role, "auditor");
  const canRecord = has(role, ...["owner", "admin", "secretary", "legal", "compliance"]);

  const [data, setData] = useState<ContractsData | null>(null);
  const [authority, setAuthority] = useState<AuthorityData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(initialOpenId ?? null);
  const [filter, setFilter] = useState({ entity: "", type: "", fn: "", status: "", quick: "", text: "" });
  const [newType, setNewType] = useState("");
  const [newFn, setNewFn] = useState("");

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

  const [files, setFiles] = useState<LinkedFile[]>([]);
  const reload = useCallback(async () => {
    const [contracts, rules] = await Promise.all([loadContracts(organisationId), loadAuthority(organisationId)]);
    setData(contracts);
    setAuthority(rules);
    setFiles(await listFiles("contracts", contracts.contracts.map((c) => c.id)));
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
    const gate = twoSided ? { blocks: [], flags: [], cleared: [] } : partyGate(data, partyId, new Date().toLocaleDateString("en-CA"));
    const blocked = gate.blocks.length > 0;
    const needConsent = open.status === "draft" || open.status === "pending_approval" ? consentGate(data, open) : [];
    const hadConsent = consentsGiven(data, open.id);

    return (
      <>
        <button type="button" className="back" onClick={() => { setOpenId(null); setError(null); setNotice(null); }}>
          ← Back to contracts
        </button>
        <p className="eyebrow">
          {entityName(open.entity_id)} · {otherName(open)}
        </p>
        <h1>{open.display_name ?? open.title}</h1>
        <p className="lead">
          {open.display_name && open.display_name !== open.title && <span className="muted">{open.title} · </span>}
          <span className="chip">{CONTRACT_STATUS[open.status]}</span>
          {twoSided && (
            <>
              {" "}
              <span className="chip">Intercompany</span>
            </>
          )}
        </p>
        {twoSided ? (
          <p className="muted">Both sides are group entities, so third-party due diligence and sanctions checks do not apply.</p>
        ) : (
          <div className={blocked ? "card warning" : gate.flags.length ? "card note" : "muted"} role={blocked ? "alert" : undefined}>
            {blocked && <p><strong>{open.status === "signed" ? "Already signed, but checks on the other party are outstanding." : "This contract cannot be approved yet."}</strong></p>}
            <ul className="plain small">
              {gate.blocks.map((x) => <li key={x} className="warning-text">{x}</li>)}
              {gate.flags.map((x) => <li key={x}><strong>Flag:</strong> {x}</li>)}
              {gate.cleared.map((x) => <li key={x}>{x}</li>)}
            </ul>
            {partyId && onStartDueDiligence && gate.blocks.some((b) => b.startsWith("No due diligence")) && (
              <button type="button" onClick={() => onStartDueDiligence(partyId)}>Start due diligence on {otherName(open)}</button>
            )}
          </div>
        )}

        {(needConsent.length > 0 || hadConsent.length > 0) && (
          <div className={needConsent.length ? "card warning block" : "muted block"} role={needConsent.length ? "alert" : undefined}>
            {needConsent.length > 0 && <p><strong>Investor consent is needed before this can be approved.</strong></p>}
            <ul className="plain small">
              {needConsent.map((m) => (
                <li key={m.id}>
                  <span className="warning-text">Consent from {m.consent_from}: {m.matter}</span> <span className="muted">(applies to {m.reason})</span>
                  {canRecord && <ConsentForm busy={busy} onSave={(by, on) => void run(async () => { await recordConsent(organisationId, open.entity_id, { matterId: m.id, subjectTable: "contracts", subjectId: open.id, givenBy: by, givenOn: on, notes: "" }); setNotice("Investor consent recorded."); })} />}
                </li>
              ))}
              {hadConsent.map((x) => (
                <li key={x.matter_id}>Investor consent: {x.matter} · given by {x.given_by}, {formatDay(x.given_on)}</li>
              ))}
            </ul>
          </div>
        )}

        <dl className="detail-list two">
          {(twoSided || open.transaction_type !== ANY) && (
            <div>
              <dt>{twoSided ? "Type" : "Approval category"}</dt>
              <dd>{twoSided ? (open.arrangement_type ?? "Intercompany") : open.transaction_type}</dd>
            </div>
          )}
          {twoSided && (
            <div>
              <dt>{open.arrangement_type === "Loan" ? "Principal" : "Value"}</dt>
              <dd>{open.value_amount === null ? "Not stated" : money(open.value_amount)}</dd>
            </div>
          )}
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
          {open.description && (
            <div>
              <dt>What it is</dt>
              <dd>{open.description}</dd>
            </div>
          )}
          {open.purpose && (
            <div>
              <dt>What it is for</dt>
              <dd>{open.purpose}</dd>
            </div>
          )}
          {tfcLine(open) && (
            <div>
              <dt>Ending it early by notice</dt>
              <dd>{tfcLine(open)}</dd>
            </div>
          )}
          {open.renewal_terms && (
            <div>
              <dt>Renewal</dt>
              <dd>{open.renewal_terms}</dd>
            </div>
          )}
          {open.terms_url && (
            <div>
              <dt>Online terms</dt>
              <dd>
                <a href={open.terms_url} target="_blank" rel="noopener noreferrer">{open.terms_url}</a>
                {open.terms_added_on && <span className="muted"> · added {formatDay(open.terms_added_on)}. The page may have changed since.</span>}
              </dd>
            </div>
          )}
          {open.summary && open.summary !== open.description && (
            <div>
              <dt>Summary</dt>
              <dd className="muted">{open.summary}</dd>
            </div>
          )}
        </dl>
        {open.source && open.source !== "typed" && (
          <p className="muted small">Details read by Claude (in Australia) and checked by a person before saving.</p>
        )}

        {!twoSided && (
          <FilingPanel
            key={`f-${open.id}-${open.display_name}`}
            contract={open}
            masters={data.contracts.filter((c) => !c.parent_contract_id && !c.counterparty_entity_id).map((c) => ({ id: c.id, name: c.display_name ?? c.title }))}
            canEdit={canRecord || open.status === "draft"}
            onSaved={reload}
            onOpen={(id) => setOpenId(id)}
          />
        )}
        {!twoSided && data.contracts.some((c) => c.parent_contract_id === open.id) && (
          <section className="block">
            <h2>In this family</h2>
            <ul className="plain rows">
              {data.contracts.filter((c) => c.parent_contract_id === open.id).map((c) => (
                <li key={c.id}>
                  <button type="button" className="link-dark" onClick={() => setOpenId(c.id)}>{c.display_name ?? c.title}</button>{" "}
                  <span className="chip">{CONTRACT_STATUS[c.status]}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {!twoSided && <SigningPanel key={`s-${open.id}-${open.signatory_check ? JSON.stringify(open.signatory_check).length : 0}`} contract={open} canEdit={canRecord} onSaved={reload} />}

        <section className="block">
          <h2>Contract documents</h2>
          {files.filter((f) => f.subject_id === open.id).length === 0 ? (
            <p className="muted">No signed copy or draft attached yet.</p>
          ) : (
            <ul className="plain rows">
              {files.filter((f) => f.subject_id === open.id).map((f) => (
                <li key={f.storage_path}>
                  <button type="button" className="quiet doc-icon" onClick={() => void downloadFile(f.storage_path, f.file_name).catch((e) => setError(e.message))}>
                    ⤓ {f.file_name}
                  </button>{" "}
                  <span className="muted small">added {formatDay(f.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
          {canFile && (
            <DropZone label="Upload the contract" busy={busy} onFile={(f) => void run(() => attachFile("contracts", open.id, f).then(() => undefined)).then((ok) => ok && setNotice(`${f.name} attached.`))} />
          )}
        </section>

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

        {open.status === "signed" && approvals.length === 0 && signatures.length === 0 ? (
          <p className="muted block">Added as a contract that was already signed, so approval and signing were not run in VeraPhius. Who signed is checked above.</p>
        ) : (<>
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
        </>)}

        <section className="card block">
          <Attachments subjectTable="contracts" subjectId={open.id} canAttach={canRecord} label="Contract documents" />
        </section>

        <section className="card block">
          <h2>3. Reminders</h2>
          {reminders.length === 0 ? (
            <p>
              {open.status === "signed"
                ? "No reminders: this contract has no end date or notice date still to come."
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
    if (!newType) return setError("Choose the type of agreement.");
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
        agreementType: newType,
        businessFunction: newFn,
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
                <strong>{(() => { const c = data.contracts.find((k) => k.id === x.contract_id); return c?.display_name ?? c?.title ?? "Contract"; })()}:</strong>{" "}
                {EXCEPTION_LABELS[x.kind] ?? x.kind} <span className="muted">· {formatDay(x.created_at)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.contracts.length === 0 ? (
        <p className="lead">No contracts yet.</p>
      ) : (
        (() => {
          const today = localToday();
          const in90 = new Date(Date.now() + 90 * 864e5).toLocaleDateString("en-CA");
          const live = (c: Contract) => c.status !== "terminated" && (!c.ends_on || c.ends_on >= today);
          const quick: Record<string, { label: string; test: (c: Contract) => boolean }> = {
            renewing: { label: "Notice or end in the next 90 days", test: (c) => c.status === "signed" && [c.notice_by, c.ends_on].some((d) => d && d >= today && d <= in90) },
            tfc: { label: "Can be ended by notice", test: (c) => c.tfc_available === "yes" && live(c) },
            key: { label: "Key contracts", test: (c) => !!c.is_key },
            drafts: { label: "Not signed yet", test: (c) => c.status !== "signed" && c.status !== "terminated" },
            check: { label: "Signing needs a look", test: (c) => !!c.signatory_check && (c.signatory_check as SignatoryCheck).verdict !== "authorised" },
          };
          const text = filter.text.trim().toLowerCase();
          const matches = (c: Contract) =>
            (!filter.entity || c.entity_id === filter.entity) &&
            (!filter.type || (c.agreement_type ?? "OTH") === filter.type) &&
            (!filter.fn || (c.business_function ?? "") === filter.fn) &&
            (!filter.status || (filter.status === "live" ? c.status === "signed" && live(c) : filter.status === "ended" ? !live(c) : c.status !== "signed")) &&
            (!filter.quick || quick[filter.quick].test(c)) &&
            (!text || [c.display_name, c.title, otherName(c), c.description].some((x) => x?.toLowerCase().includes(text)));
          // Families: a linked document shows under its master (and the master shows if any of its family matches)
          const children = (id: string) => data.contracts.filter((c) => c.parent_contract_id === id);
          const masters = data.contracts.filter((c) => !c.parent_contract_id || !data.contracts.some((m) => m.id === c.parent_contract_id));
          const shown = masters.filter((m) => matches(m) || children(m.id).some(matches));
          const groups = new Map<string, Contract[]>();
          for (const c of shown) {
            const key = `${entityName(c.entity_id)}|${c.counterparty_entity_id ? "Intercompany" : typeLabel(c.agreement_type ?? "OTH", null)}`;
            groups.set(key, [...(groups.get(key) ?? []), c]);
          }
          const row = (c: Contract, child = false) => (
            <li key={c.id} className={child ? "family-child" : undefined}>
              <button type="button" className="entity-row" onClick={() => setOpenId(c.id)}>
                <span>
                  <span className="entity-name">{child ? "↳ " : ""}{c.display_name ?? c.title}</span>
                  <br />
                  <span className="muted">
                    {c.display_name && c.display_name !== c.title ? c.title : otherName(c)}
                    {c.business_function ? ` · ${FUNCTIONS[c.business_function]}` : ""}
                    {c.value_amount !== null ? ` · ${money(c.value_amount)}` : ""}
                    {nextDate(c) ? ` · ${nextDate(c)}` : ""}
                  </span>
                </span>
                <span className="row-chips">
                  {c.signatory_check && (c.signatory_check as SignatoryCheck).verdict !== "authorised" && (
                    <span className={`chip verdict-${(c.signatory_check as SignatoryCheck).verdict}`}>{VERDICT_LABEL[(c.signatory_check as SignatoryCheck).verdict]}</span>
                  )}
                  <span className="chip">{CONTRACT_STATUS[c.status]}</span>
                </span>
              </button>
            </li>
          );
          const usedTypes = new Set(data.contracts.map((c) => c.agreement_type ?? "OTH"));
          return (
            <>
              <div className="filters register-filters">
                <input aria-label="Search contracts" placeholder="Search name, party or description" value={filter.text} onChange={(e) => setFilter({ ...filter, text: e.target.value })} />
                {group.entities.length > 1 && (
                  <select aria-label="Company" value={filter.entity} onChange={(e) => setFilter({ ...filter, entity: e.target.value })}>
                    <option value="">All companies</option>
                    {group.entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </select>
                )}
                <select aria-label="Type of agreement" value={filter.type} onChange={(e) => setFilter({ ...filter, type: e.target.value })}>
                  <option value="">All types</option>
                  {AGREEMENT_TYPES.filter((t) => usedTypes.has(t.code)).map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}
                </select>
                <select aria-label="Business function" value={filter.fn} onChange={(e) => setFilter({ ...filter, fn: e.target.value })}>
                  <option value="">All functions</option>
                  {Object.entries(FUNCTIONS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
                <select aria-label="Status" value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })}>
                  <option value="">Any status</option>
                  <option value="live">Signed and in force</option>
                  <option value="draft">Not signed yet</option>
                  <option value="ended">Ended</option>
                </select>
              </div>
              <div className="chip-row" role="group" aria-label="Quick filters">
                {Object.entries(quick).map(([k, q]) => (
                  <button key={k} type="button" className={filter.quick === k ? "chip-button on" : "chip-button"} aria-pressed={filter.quick === k}
                    onClick={() => setFilter({ ...filter, quick: filter.quick === k ? "" : k })}>
                    {q.label} ({data.contracts.filter(q.test).length})
                  </button>
                ))}
              </div>
              {shown.length === 0 ? (
                <p className="muted">No contracts match. <button type="button" className="link-dark" onClick={() => setFilter({ entity: "", type: "", fn: "", status: "", quick: "", text: "" })}>Clear the filters</button></p>
              ) : (
                [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, list]) => {
                  const [ent, type] = key.split("|");
                  return (
                    <section key={key} className="register-group">
                      <h3>{group.entities.length > 1 ? `${ent} · ` : ""}{type} <span className="muted small">({list.length})</span></h3>
                      <ul className="entity-list">
                        {list.sort((a, b) => (a.display_name ?? a.title).localeCompare(b.display_name ?? b.title)).flatMap((m) => [row(m), ...children(m.id).sort((a, b) => (a.family_no ?? 0) - (b.family_no ?? 0)).map((k) => row(k, true))])}
                      </ul>
                    </section>
                  );
                })
              )}
            </>
          );
        })()
      )}

      {canFile &&
        (group.entities.length === 0 ? (
          <p className="card note">Add an entity on the Overview page first; a contract belongs to a company.</p>
        ) : (
          <>
          <ContractReader
            organisationId={organisationId}
            entities={group.entities}
            counterparties={data.counterparties}
            existing={data.contracts.filter((c) => !c.counterparty_entity_id).map((c) => ({ id: c.id, name: c.display_name ?? c.title, party: c.counterparty?.name ?? "", isMaster: !c.parent_contract_id }))}
            onStartDueDiligence={onStartDueDiligence}
            onSaved={reload}
            onOpen={(id) => { setOpenId(id); setError(null); setNotice(null); }}
          />
          <details className="block">
          <summary>Or type a contract in</summary>
          <form className="card form" onSubmit={submit}>
            <h2>File a contract</h2>
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
            <div className="row wrap">
              <span className="field">
                <label htmlFor="c-atype">Type of agreement</label>
                <select id="c-atype" value={newType} onChange={(e) => setNewType(e.target.value)}>
                  <option value="">Choose</option>
                  {TYPE_GROUPS.map((g) => (
                    <optgroup key={g} label={g}>
                      {AGREEMENT_TYPES.filter((t) => t.group === g).map((t) => <option key={t.code} value={t.code}>{t.code} · {t.label}</option>)}
                    </optgroup>
                  ))}
                </select>
              </span>
              <span className="field">
                <label htmlFor="c-fn">Business function</label>
                <select id="c-fn" value={newFn} onChange={(e) => setNewFn(e.target.value)}>
                  <option value="">Not set</option>
                  {Object.entries(FUNCTIONS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </span>
            </div>
            <label htmlFor="c-title">Title</label>
            <input id="c-title" placeholder="e.g. Supply agreement" value={title} onChange={(e) => setTitle(e.target.value)} />
            <label htmlFor="c-type">Approval category (from your delegations; leave blank if none)</label>
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
          </details>
          </>
        ))}
      {error && (
        <p className="error block" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

function ConsentForm({ busy, onSave }: { busy: boolean; onSave: (givenBy: string, givenOn: string) => void }) {
  const [open, setOpen] = useState(false);
  const [by, setBy] = useState("");
  const [on, setOn] = useState(new Date().toLocaleDateString("en-CA"));
  if (!open) return <button type="button" className="link-dark small" onClick={() => setOpen(true)}> Record consent</button>;
  return (
    <span className="row wrap">
      <input aria-label="Consent given by" placeholder="Given by (investor or class)" value={by} onChange={(e) => setBy(e.target.value)} />
      <input aria-label="Consent date" type="date" value={on} onChange={(e) => setOn(e.target.value)} />
      <button type="button" disabled={busy || by.trim().length < 2} onClick={() => onSave(by, on)}>Save consent</button>
    </span>
  );
}
