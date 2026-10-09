import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  addAttorney,
  addRule,
  addStandardSigning,
  ANY,
  attorneyIsCurrent,
  endRule,
  holders,
  loadAuthority,
  money,
  revokeAttorney,
  ruleIsCurrent,
  STATUTORY_BASES,
  TRANSACTION_TYPES,
  whoCan,
  type AuthorityData,
  type AuthorityKind,
  type HolderKind,
  type Rule,
} from "./authority";
import { formatDay } from "./board";
import type { GroupData } from "./types";

type Props = { organisationId: string; group: GroupData; canEdit: boolean };

const KIND_WORD: Record<AuthorityKind, string> = { approve: "approve", execute: "sign" };

function holderLabel(data: AuthorityData, rule: Rule): { name: string; detail: string; warning?: string } {
  if (rule.holder_kind === "statutory") return { name: rule.statutory_basis ?? "", detail: "Company execution" };
  if (rule.holder_kind === "attorney") {
    const attorney = data.attorneys.find((a) => a.id === rule.power_of_attorney_id);
    return {
      name: attorney ? `${attorney.attorney_name} (attorney)` : "Attorney",
      detail: attorney?.scope ?? "",
      warning: attorney && !attorneyIsCurrent(attorney) ? "Power of attorney expired or revoked" : undefined,
    };
  }
  const title = data.positions.find((p) => p.id === rule.position_id)?.title ?? "Position";
  const people = holders(data, rule.position_id ?? "");
  return {
    name: title,
    detail: people.length ? people.join(", ") : "",
    warning: people.length ? undefined : "No one is recorded in this position",
  };
}

const limitLabel = (rule: Rule) => (rule.limit_amount === null ? "No limit" : `Up to ${money(rule.limit_amount)}`);

export default function Authority({ organisationId, group, canEdit }: Props) {
  const [data, setData] = useState<AuthorityData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [entityId, setEntityId] = useState(group.entities[0]?.id ?? "");

  // Lookup
  const [askType, setAskType] = useState(ANY);
  const [askAmount, setAskAmount] = useState("");

  // New rule
  const [authority, setAuthority] = useState<AuthorityKind>("approve");
  const [holderKind, setHolderKind] = useState<HolderKind>("position");
  const [positionTitle, setPositionTitle] = useState("");
  const [holderName, setHolderName] = useState("");
  const [basis, setBasis] = useState(STATUTORY_BASES[0]);
  const [attorneyId, setAttorneyId] = useState("");
  const [type, setType] = useState(ANY);
  const [limit, setLimit] = useState("");
  const [conditions, setConditions] = useState("");
  const [from, setFrom] = useState("");

  // New power of attorney
  const [poaName, setPoaName] = useState("");
  const [poaScope, setPoaScope] = useState("");
  const [poaGranted, setPoaGranted] = useState("");
  const [poaExpires, setPoaExpires] = useState("");

  const reload = useCallback(async () => {
    setData(await loadAuthority(organisationId));
  }, [organisationId]);

  useEffect(() => {
    reload().catch((e) => setError(e instanceof Error ? e.message : "Could not load authorities."));
  }, [reload]);

  async function run(action: () => Promise<void>): Promise<boolean> {
    setBusy(true);
    setError(null);
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

  if (group.entities.length === 0) {
    return (
      <>
        <p className="eyebrow">Delegations and signing</p>
        <h1>Authority</h1>
        <p className="card note">Add an entity on the Overview page first; authority is set per company.</p>
      </>
    );
  }
  if (!data) {
    return error ? (
      <p className="error" role="alert">
        {error}
      </p>
    ) : (
      <p className="lead">Loading…</p>
    );
  }

  const entity = group.entities.find((e) => e.id === entityId) ?? group.entities[0];
  const rules = data.rules.filter((r) => r.entity_id === entity.id && ruleIsCurrent(r));
  const attorneys = data.attorneys.filter((a) => a.entity_id === entity.id);
  const currentAttorneys = attorneys.filter(attorneyIsCurrent);
  const types = [...new Set([...TRANSACTION_TYPES, ...data.rules.map((r) => r.transaction_type)])];

  const amount = Number(askAmount.replace(/[$,\s]/g, ""));
  const asked = askAmount.trim() !== "" && Number.isFinite(amount) && amount >= 0;

  function parseLimit(): number | null | undefined {
    if (limit.trim() === "") return null;
    const value = Number(limit.replace(/[$,\s]/g, ""));
    return Number.isFinite(value) && value >= 0 ? value : undefined;
  }

  async function submitRule(event: FormEvent) {
    event.preventDefault();
    const parsed = parseLimit();
    if (parsed === undefined) return setError("Enter the limit as a number, or leave it blank for no limit.");
    if (holderKind === "position" && positionTitle.trim().length < 2) return setError("Enter the position title.");
    if (holderKind === "attorney" && !attorneyId) return setError("Choose the attorney, or record the power of attorney first.");
    const ok = await run(() =>
      addRule(organisationId, data!, {
        entityId: entity.id,
        authority,
        transactionType: type,
        holderKind,
        positionTitle,
        holderName,
        statutoryBasis: basis,
        attorneyId,
        limit: parsed,
        conditions,
        delegatedFromId: from || null,
      }),
    );
    if (ok) {
      setPositionTitle("");
      setHolderName("");
      setLimit("");
      setConditions("");
      setFrom("");
    }
  }

  async function submitAttorney(event: FormEvent) {
    event.preventDefault();
    if (poaName.trim().length < 2 || poaScope.trim().length < 2) return setError("Enter the attorney's name and what the power covers.");
    const ok = await run(() =>
      addAttorney(organisationId, entity.id, poaName, poaScope, poaGranted || null, poaExpires || null),
    );
    if (ok) {
      setPoaName("");
      setPoaScope("");
      setPoaGranted("");
      setPoaExpires("");
    }
  }

  const section = (kind: AuthorityKind, heading: string) => {
    const list = rules.filter((r) => r.authority === kind);
    return (
      <section className="block">
        <h2>{heading}</h2>
        {list.length === 0 ? (
          <p className="muted">No rules yet.</p>
        ) : (
          <ul className="plain rows">
            {list.map((rule) => {
              const h = holderLabel(data, rule);
              const parent = rule.delegated_from_id ? data.rules.find((r) => r.id === rule.delegated_from_id) : null;
              return (
                <li key={rule.id} className="row spread">
                  <span>
                    <strong>{h.name}</strong>
                    {h.detail && <span className="muted"> · {h.detail}</span>}
                    <br />
                    {rule.transaction_type === ANY ? "Any transaction" : rule.transaction_type} · {limitLabel(rule)}
                    {rule.conditions && <span className="muted"> · {rule.conditions}</span>}
                    {parent && <span className="muted"> · delegated by {holderLabel(data, parent).name}</span>}
                    {h.warning && (
                      <>
                        <br />
                        <span className="warning-text">{h.warning}</span>
                      </>
                    )}
                  </span>
                  {canEdit && (
                    <button
                      type="button"
                      className="link-dark"
                      aria-label={`End the rule for ${h.name}`}
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm(`End this authority for ${h.name} now?`)) void run(() => endRule(rule.id));
                      }}
                    >
                      End
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {kind === "execute" && list.length === 0 && canEdit && (
          <button type="button" className="quiet" disabled={busy} onClick={() => void run(() => addStandardSigning(organisationId, entity.id))}>
            Add the standard company signing rules
          </button>
        )}
      </section>
    );
  };

  const answer = (kind: AuthorityKind) => {
    const matches = whoCan(data, entity.id, kind, askType, amount);
    return (
      <div>
        <h3>Who can {KIND_WORD[kind]}</h3>
        {matches.length === 0 ? (
          <p className="warning-text">No one is authorised. Escalate to the board or add a rule.</p>
        ) : (
          <ul className="plain">
            {matches.map((rule) => {
              const h = holderLabel(data, rule);
              return (
                <li key={rule.id}>
                  <strong>{h.name}</strong>
                  {h.detail && <span className="muted"> · {h.detail}</span>}
                  <span className="muted"> · {limitLabel(rule).toLowerCase()}</span>
                  {rule.conditions && <span className="muted"> · {rule.conditions}</span>}
                  {h.warning && <span className="warning-text"> · {h.warning}</span>}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  };

  const parents = rules.filter((r) => r.authority === authority && r.holder_kind === "position");

  return (
    <>
      <p className="eyebrow">Delegations and signing</p>
      <h1>Authority</h1>
      {group.entities.length > 1 && (
        <div className="row block-tight">
          <label htmlFor="auth-entity">Company</label>
          <select id="auth-entity" value={entity.id} onChange={(e) => setEntityId(e.target.value)}>
            {group.entities.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {group.entities.length === 1 && <p className="lead">{entity.name}</p>}

      <section className="card form">
        <h2>Who can sign this?</h2>
        <div className="row">
          <select aria-label="Type of transaction" value={askType} onChange={(e) => setAskType(e.target.value)}>
            {types.map((t) => (
              <option key={t} value={t}>
                {t === ANY ? "Any type" : t}
              </option>
            ))}
          </select>
          <input
            className="grow"
            aria-label="Value in Australian dollars"
            placeholder="Value, e.g. 80,000"
            inputMode="decimal"
            value={askAmount}
            onChange={(e) => setAskAmount(e.target.value)}
          />
        </div>
        {asked ? (
          <div className="answers" role="status">
            <p className="muted">
              {entity.name} · {askType === ANY ? "Any type" : askType} · {money(amount)}
            </p>
            {answer("approve")}
            {answer("execute")}
          </div>
        ) : (
          <p className="muted">Enter a value to see who may approve the commitment and who may sign the document.</p>
        )}
      </section>

      {section("approve", "Authority to approve")}
      {section("execute", "Authority to sign")}

      <section className="block">
        <h2>Powers of attorney</h2>
        {attorneys.length === 0 ? (
          <p className="muted">None recorded.</p>
        ) : (
          <ul className="plain rows">
            {attorneys.map((a) => (
              <li key={a.id} className="row spread">
                <span>
                  <strong>{a.attorney_name}</strong> <span className="muted">· {a.scope}</span>
                  <br />
                  <span className={attorneyIsCurrent(a) ? "muted" : "warning-text"}>
                    {a.revoked_on
                      ? `Revoked ${formatDay(a.revoked_on)}`
                      : a.expires_on
                        ? `${attorneyIsCurrent(a) ? "Expires" : "Expired"} ${formatDay(a.expires_on)}`
                        : "No expiry recorded"}
                  </span>
                </span>
                {canEdit && attorneyIsCurrent(a) && (
                  <button
                    type="button"
                    className="link-dark"
                    aria-label={`Revoke the power of attorney for ${a.attorney_name}`}
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm(`Record this power of attorney as revoked from today?`)) void run(() => revokeAttorney(a.id));
                    }}
                  >
                    Revoke
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {error && (
        <p className="error block" role="alert">
          {error}
        </p>
      )}

      {canEdit && (
        <>
          <form className="card form block" onSubmit={submitRule}>
            <h2>Add an authority</h2>
            <span className="segmented" role="group" aria-label="Kind of authority">
              {(["approve", "execute"] as AuthorityKind[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  className={authority === k ? "on" : undefined}
                  aria-pressed={authority === k}
                  onClick={() => {
                    setAuthority(k);
                    setFrom("");
                  }}
                >
                  {k === "approve" ? "To approve" : "To sign"}
                </button>
              ))}
            </span>

            <label htmlFor="rule-holder">Held by</label>
            <select id="rule-holder" value={holderKind} onChange={(e) => setHolderKind(e.target.value as HolderKind)}>
              <option value="position">A position, e.g. Sales Director</option>
              <option value="statutory">Company execution, e.g. two directors</option>
              <option value="attorney">An attorney under a power of attorney</option>
            </select>

            {holderKind === "position" && (
              <>
                <label htmlFor="rule-position">Position title</label>
                <input
                  id="rule-position"
                  list="position-titles"
                  autoComplete="off"
                  value={positionTitle}
                  onChange={(e) => setPositionTitle(e.target.value)}
                />
                <datalist id="position-titles">
                  {data.positions.map((p) => (
                    <option key={p.id} value={p.title} />
                  ))}
                </datalist>
                <label htmlFor="rule-person">Who holds it now (optional)</label>
                <input id="rule-person" value={holderName} onChange={(e) => setHolderName(e.target.value)} />
              </>
            )}
            {holderKind === "statutory" && (
              <>
                <label htmlFor="rule-basis">Method</label>
                <select id="rule-basis" value={basis} onChange={(e) => setBasis(e.target.value)}>
                  {STATUTORY_BASES.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </>
            )}
            {holderKind === "attorney" && (
              <>
                <label htmlFor="rule-attorney">Attorney</label>
                <select id="rule-attorney" value={attorneyId} onChange={(e) => setAttorneyId(e.target.value)}>
                  <option value="">{currentAttorneys.length ? "Choose…" : "Record a power of attorney below first"}</option>
                  {currentAttorneys.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.attorney_name}
                    </option>
                  ))}
                </select>
              </>
            )}

            <label htmlFor="rule-type">Type of transaction</label>
            <input id="rule-type" list="transaction-types" autoComplete="off" value={type} onChange={(e) => setType(e.target.value)} />
            <datalist id="transaction-types">
              {types.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>

            <label htmlFor="rule-limit">Limit in Australian dollars (blank for no limit)</label>
            <input id="rule-limit" className="short-wide" inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} />

            <label htmlFor="rule-conditions">Conditions (optional)</label>
            <input
              id="rule-conditions"
              placeholder="e.g. Legal review required"
              value={conditions}
              onChange={(e) => setConditions(e.target.value)}
            />

            {parents.length > 0 && (
              <>
                <label htmlFor="rule-from">Delegated onward by (optional)</label>
                <select id="rule-from" value={from} onChange={(e) => setFrom(e.target.value)}>
                  <option value="">Not an onward delegation</option>
                  {parents.map((r) => (
                    <option key={r.id} value={r.id}>
                      {holderLabel(data, r).name} · {limitLabel(r)}
                    </option>
                  ))}
                </select>
              </>
            )}
            <button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Add authority"}
            </button>
          </form>

          <form className="card form block" onSubmit={submitAttorney}>
            <h2>Record a power of attorney</h2>
            <label htmlFor="poa-name">Attorney's name</label>
            <input id="poa-name" value={poaName} onChange={(e) => setPoaName(e.target.value)} />
            <label htmlFor="poa-scope">What it covers</label>
            <input id="poa-scope" placeholder="e.g. Property transactions in NSW" value={poaScope} onChange={(e) => setPoaScope(e.target.value)} />
            <div className="row">
              <span className="field">
                <label htmlFor="poa-granted">Granted</label>
                <input id="poa-granted" type="date" value={poaGranted} onChange={(e) => setPoaGranted(e.target.value)} />
              </span>
              <span className="field">
                <label htmlFor="poa-expires">Expires</label>
                <input id="poa-expires" type="date" value={poaExpires} onChange={(e) => setPoaExpires(e.target.value)} />
              </span>
            </div>
            <button type="submit" className="quiet" disabled={busy}>
              Record power of attorney
            </button>
          </form>
        </>
      )}
    </>
  );
}
