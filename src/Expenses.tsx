import { useCallback, useEffect, useState, type FormEvent } from "react";
import { money } from "./authority";
import { formatDay } from "./board";
import {
  addLine,
  createClaim,
  decideClaim,
  DECLARED_CATEGORIES,
  EXPENSE_CATEGORIES,
  EXPENSE_STATUS,
  lineFlags,
  loadExpenses,
  markPaid,
  removeLine,
  submitClaim,
  type Claim,
  type ExpenseData,
} from "./expenses";
import { today } from "./training";
import type { Entity } from "./types";

type Props = { organisationId: string; role: string; userId: string; entities: Entity[] };

const MANAGE_ROLES = ["owner", "admin", "secretary", "legal", "compliance"];
const savedName = () => {
  try {
    return localStorage.getItem("cs-claimant-name") ?? "";
  } catch {
    return "";
  }
};

export default function Expenses({ organisationId, role, userId, entities }: Props) {
  const canDecide = MANAGE_ROLES.includes(role);
  const canClaim = role !== "auditor";

  const [data, setData] = useState<ExpenseData | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState(savedName);
  const [purpose, setPurpose] = useState("");
  const [entityId, setEntityId] = useState("");

  const [on, setOn] = useState(today);
  const [category, setCategory] = useState(EXPENSE_CATEGORIES[0]);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [receipt, setReceipt] = useState(true);
  const [otherParty, setOtherParty] = useState("");
  const [official, setOfficial] = useState(false);
  const [note, setNote] = useState("");

  const reload = useCallback(async () => {
    setData(await loadExpenses(organisationId));
  }, [organisationId]);

  useEffect(() => {
    reload().catch((e) => setError(e instanceof Error ? e.message : "Could not load expenses."));
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

  if (!data) {
    return error ? (
      <p className="error" role="alert">
        {error}
      </p>
    ) : (
      <p className="lead">Loading…</p>
    );
  }

  const linesOf = (id: string) => data.lines.filter((l) => l.claim_id === id);
  const totalOf = (id: string) => linesOf(id).reduce((sum, l) => sum + l.amount, 0);
  const flagCount = (id: string) => linesOf(id).filter((l) => lineFlags(l, data).length > 0).length;
  const messages = (
    <>
      {notice && (
        <p className="card note" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="error block" role="alert">
          {error}
        </p>
      )}
    </>
  );

  const claim = data.claims.find((c) => c.id === openId);
  if (claim) {
    const lines = linesOf(claim.id);
    const mine = claim.claimant_user_id === userId;
    const editable = mine && (claim.status === "draft" || claim.status === "rejected");
    const needsParty = DECLARED_CATEGORIES.includes(category) || official;

    async function submitLine(event: FormEvent) {
      event.preventDefault();
      const value = Number(amount.replace(/[$,\s]/g, ""));
      if (!Number.isFinite(value) || value <= 0) return setError("Enter the amount as a number.");
      if (description.trim().length < 2) return setError("Say what the expense was.");
      if (needsParty && otherParty.trim().length < 2) return setError("Say who the hospitality or gift was for.");
      const ok = await run(() =>
        addLine(organisationId, claim!.id, {
          incurred_on: on,
          category,
          description: description.trim(),
          amount: value,
          has_receipt: receipt,
          other_party: needsParty ? otherParty.trim() : null,
          public_official: official,
        }),
      );
      if (ok) {
        setDescription("");
        setAmount("");
        setOtherParty("");
        setOfficial(false);
      }
    }

    return (
      <>
        <p>
          <button
            type="button"
            className="link-dark"
            onClick={() => {
              setOpenId(null);
              setError(null);
              setNotice(null);
            }}
          >
            ← Back to expenses
          </button>
        </p>
        <p className="eyebrow">Expense claim · {claim.claimant_name}</p>
        <h1>{claim.purpose}</h1>
        <p className="lead">
          <span className={claim.status === "rejected" ? "chip chip-alert" : "chip"}>{EXPENSE_STATUS[claim.status]}</span> {money(totalOf(claim.id))}
          {claim.submitted_at ? ` · submitted ${formatDay(claim.submitted_at)}` : ""}
        </p>
        {claim.decision_note && <p className="card warning">Decision note: {claim.decision_note}</p>}
        {messages}

        <section className="block">
          <h2>Expenses</h2>
          {lines.length === 0 ? (
            <p className="muted">No expenses added yet.</p>
          ) : (
            <ul className="plain rows">
              {lines.map((l) => {
                const flags = lineFlags(l, data);
                return (
                  <li key={l.id} className="row spread">
                    <span>
                      <strong>{l.description}</strong> · {money(l.amount)}
                      <br />
                      <span className="muted">
                        {l.category} · {formatDay(l.incurred_on)} · {l.has_receipt ? "receipt held" : "no receipt"}
                        {l.other_party ? ` · for ${l.other_party}` : ""}
                        {l.gift_entry_id ? " · declared" : ""}
                      </span>
                      {flags.length > 0 && (
                        <>
                          <br />
                          <strong className="warning-text">{flags.join(" · ")}</strong>
                        </>
                      )}
                    </span>
                    {editable && (
                      <button type="button" className="link-dark" disabled={busy} onClick={() => void run(() => removeLine(l.id))}>
                        Remove
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {editable && (
          <>
            <form className="card form" onSubmit={submitLine}>
              <h2>Add an expense</h2>
              <div className="row">
                <span className="field">
                  <label htmlFor="x-on">Date</label>
                  <input id="x-on" type="date" max={today()} value={on} onChange={(e) => setOn(e.target.value)} />
                </span>
                <span className="field">
                  <label htmlFor="x-category">Category</label>
                  <select id="x-category" value={category} onChange={(e) => setCategory(e.target.value)}>
                    {EXPENSE_CATEGORIES.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </span>
                <span className="field">
                  <label htmlFor="x-amount">Amount in Australian dollars</label>
                  <input id="x-amount" className="short-wide" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
                </span>
              </div>
              <label htmlFor="x-what">What it was</label>
              <input id="x-what" value={description} onChange={(e) => setDescription(e.target.value)} />
              <label className="check">
                <input type="checkbox" checked={receipt} onChange={(e) => setReceipt(e.target.checked)} /> I have the receipt
              </label>
              <label className="check">
                <input type="checkbox" checked={official} onChange={(e) => setOfficial(e.target.checked)} /> A public official was involved
              </label>
              {needsParty && (
                <>
                  <label htmlFor="x-party">Who was it for?</label>
                  <input id="x-party" placeholder="e.g. Two buyers from Acme" value={otherParty} onChange={(e) => setOtherParty(e.target.value)} />
                  <p className="muted">This will be declared as a gift or hospitality when you submit, so you do not need to declare it separately.</p>
                </>
              )}
              <button type="submit" className="quiet" disabled={busy}>
                Add
              </button>
            </form>
            <button
              type="button"
              disabled={busy || lines.length === 0}
              onClick={() =>
                void run(async () => {
                  const n = await submitClaim(claim.id);
                  setNotice(n > 0 ? `Submitted. ${n} gift or hospitality ${n === 1 ? "declaration was" : "declarations were"} made for you.` : "Submitted.");
                })
              }
            >
              {claim.status === "rejected" ? "Submit again" : "Submit for approval"}
            </button>
          </>
        )}

        {canDecide && claim.status === "submitted" && (
          <section className="card form block">
            <h2>Decide</h2>
            {mine ? (
              <p className="muted">You cannot decide your own claim. Someone else in legal, compliance or the company secretary's team decides it.</p>
            ) : (
              <>
                <label htmlFor="x-note">Note (needed if you reject)</label>
                <input id="x-note" value={note} onChange={(e) => setNote(e.target.value)} />
                <div className="row">
                  <button type="button" disabled={busy} onClick={() => void run(() => decideClaim(claim.id, true, note)).then((ok) => ok && setNote(""))}>
                    Approve
                  </button>
                  <button type="button" className="quiet" disabled={busy} onClick={() => void run(() => decideClaim(claim.id, false, note)).then((ok) => ok && setNote(""))}>
                    Reject
                  </button>
                </div>
              </>
            )}
          </section>
        )}
        {canDecide && claim.status === "approved" && !mine && (
          <button type="button" className="quiet" disabled={busy} onClick={() => void run(() => markPaid(claim.id))}>
            Mark as paid
          </button>
        )}
      </>
    );
  }

  async function submitClaimForm(event: FormEvent) {
    event.preventDefault();
    if (name.trim().length < 2) return setError("Enter your name.");
    if (purpose.trim().length < 3) return setError("Say what the claim is for.");
    try {
      localStorage.setItem("cs-claimant-name", name.trim());
    } catch {
      // Remembering the name is a convenience only
    }
    let id = "";
    const ok = await run(async () => {
      id = await createClaim(organisationId, userId, name, purpose, entityId || null);
    });
    if (ok) {
      setPurpose("");
      setOpenId(id);
    }
  }

  const row = (c: Claim) => (
    <li key={c.id}>
      <button type="button" className="entity-row" onClick={() => setOpenId(c.id)}>
        <span>
          <span className="entity-name">{c.purpose}</span>
          <br />
          <span className="muted">
            {c.claimant_name} · {money(totalOf(c.id))} · {linesOf(c.id).length} {linesOf(c.id).length === 1 ? "expense" : "expenses"}
          </span>
          {flagCount(c.id) > 0 && <strong className="warning-text"> · {flagCount(c.id)} flagged</strong>}
        </span>
        <span className={c.status === "rejected" ? "chip chip-alert" : "chip"}>{EXPENSE_STATUS[c.status]}</span>
      </button>
    </li>
  );
  const mine = data.claims.filter((c) => c.claimant_user_id === userId);
  const toDecide = data.claims.filter((c) => c.claimant_user_id !== userId && c.status === "submitted");
  const others = data.claims.filter((c) => c.claimant_user_id !== userId && c.status !== "submitted" && c.status !== "draft");

  return (
    <>
      <p className="eyebrow">Claims and approvals</p>
      <h1>Expenses</h1>
      {messages}
      {canDecide && (
        <section className="block">
          <h2>Waiting for a decision</h2>
          {toDecide.length === 0 ? <p className="muted">Nothing is waiting.</p> : <ul className="entity-list">{toDecide.map(row)}</ul>}
        </section>
      )}
      <section className="block">
        <h2>Your claims</h2>
        {mine.length === 0 ? <p className="muted">You have not made a claim.</p> : <ul className="entity-list">{mine.map(row)}</ul>}
      </section>
      {canDecide && others.length > 0 && (
        <section className="block">
          <h2>Decided</h2>
          <ul className="entity-list">{others.map(row)}</ul>
        </section>
      )}
      {canClaim && (
        <form className="card form" onSubmit={submitClaimForm}>
          <h2>Start a claim</h2>
          <label htmlFor="xc-name">Your name</label>
          <input id="xc-name" value={name} onChange={(e) => setName(e.target.value)} />
          <label htmlFor="xc-purpose">What is it for?</label>
          <input id="xc-purpose" placeholder="e.g. Melbourne client visit, 6 to 8 October" value={purpose} onChange={(e) => setPurpose(e.target.value)} />
          <label htmlFor="xc-entity">Charge to (optional)</label>
          <select id="xc-entity" value={entityId} onChange={(e) => setEntityId(e.target.value)}>
            <option value="">Not specified</option>
            {entities.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
          <p className="muted">
            Expenses of {money(data.receiptThreshold)} or more without a receipt are flagged to the approver. Nobody approves their own claim.
          </p>
          <button type="submit" disabled={busy}>
            Start
          </button>
        </form>
      )}
    </>
  );
}
