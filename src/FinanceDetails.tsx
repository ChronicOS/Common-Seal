import { useCallback, useEffect, useState, type ReactNode } from "react";
import Attachments from "./Attachments";
import { today } from "./authorities";
import { formatDay } from "./board";
import {
  accountLine, amount, blankAccount, blankFacility, currentUserId, daysUntil, FACILITY_LABELS, loadFinance, masked, PURPOSE_LABELS, saveAccount, saveFacility,
  unverified, verifyAccount, type AccountValues, type BankAccount, type Facility, type FacilityValues, type FinanceData,
} from "./finance";

const day = (iso: string | null | undefined) => (iso ? formatDay(`${iso.slice(0, 10)}T12:00:00`) : "");
const toNum = (s: string) => (s.trim() === "" ? null : Number(s.replace(/[$,\s]/g, "")));

function Text({ id, label, value, onChange, type = "text", wide, placeholder }: { id: string; label: string; value: string | number | null; onChange: (v: string) => void; type?: string; wide?: boolean; placeholder?: string }) {
  return (
    <span className={wide ? "field grow" : "field"}>
      <label htmlFor={id}>{label}</label>
      <input id={id} type={type} placeholder={placeholder} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
    </span>
  );
}
function Select({ id, label, value, onChange, children }: { id: string; label: string; value: string; onChange: (v: string) => void; children: ReactNode }) {
  return (
    <span className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {children}
      </select>
    </span>
  );
}

/** Company page: bank accounts and credit facilities for one company */
export default function FinanceDetails({ organisationId, entityId, canEdit }: { organisationId: string; entityId: string; canEdit: boolean }) {
  const [data, setData] = useState<FinanceData | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [form, setForm] = useState<string | null>(null);
  const [shown, setShown] = useState<string[]>([]);
  const [verifying, setVerifying] = useState<{ id: string; how: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const t = today();

  const reload = useCallback(async () => {
    try {
      setData(await loadFinance(organisationId, entityId));
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Could not load the finance details.");
    }
  }, [organisationId, entityId]);
  useEffect(() => {
    void reload();
    void currentUserId().then(setMe);
  }, [reload]);

  const run = async (work: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setProblem(null);
    setNotice(null);
    try {
      await work();
      setForm(null);
      setVerifying(null);
      setNotice(done);
      await reload();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "That did not save.");
    } finally {
      setBusy(false);
    }
  };

  const heading = (
    <>
      <h2 id="finance">Finance details</h2>
      {problem && <p className="error" role="alert">{problem}</p>}
      {notice && <p className="card note" role="status">{notice}</p>}
    </>
  );
  if (!data) return <section className="block">{heading}<p className="muted">Loading…</p></section>;
  if (!data.ready) return <section className="block">{heading}<p className="muted">Not set up yet: run migration 0046 in Supabase.</p></section>;

  const who = (uid: string | null) => data.people.find((p) => p.user_id === uid)?.full_name ?? "a member";
  const editingAccount = form?.startsWith("acct:") ? data.accounts.find((a) => a.id === form.slice(5)) : undefined;
  const editingFacility = form?.startsWith("fac:") ? data.facilities.find((f) => f.id === form.slice(4)) : undefined;
  if (form === "acct" || editingAccount) {
    const { id: _i, entity_id: _e, details_changed_at: _a, details_changed_by: _b, verified_at: _c, verified_by: _d, verified_how: _f, ...values } = editingAccount ?? ({ ...blankAccount() } as BankAccount);
    return (
      <section className="block">
        {heading}
        <AccountForm initial={values} editing={Boolean(editingAccount)} busy={busy} onCancel={() => setForm(null)}
          onSave={(v) => run(() => saveAccount(organisationId, entityId, editingAccount?.id ?? null, v), editingAccount ? "Account saved. If the bank details changed, they now need confirming by someone else." : "Account added. Someone other than you now needs to confirm the details.")} />
        {editingAccount && <Attachments subjectTable="bank_accounts" subjectId={editingAccount.id} canAttach={canEdit} label="Bank letters and account confirmations" />}
      </section>
    );
  }
  if (form === "fac" || editingFacility) {
    const { id: _i, entity_id: _e, ...values } = editingFacility ?? ({ id: "", entity_id: "", ...blankFacility() } as Facility);
    return (
      <section className="block">
        {heading}
        <FacilityForm initial={values} accounts={data.accounts.filter((a) => a.status === "open")} busy={busy} onCancel={() => setForm(null)}
          onSave={(v) => run(() => saveFacility(organisationId, entityId, editingFacility?.id ?? null, v), "Facility saved.")} />
        {editingFacility && <Attachments subjectTable="credit_facilities" subjectId={editingFacility.id} canAttach={canEdit} label="Facility agreement and letters" />}
      </section>
    );
  }

  const open = data.accounts.filter((a) => a.status === "open");
  const closed = data.accounts.filter((a) => a.status === "closed");
  const live = data.facilities.filter((f) => f.status === "active");
  const byCurrency = (pick: (f: Facility) => number | null) =>
    Object.entries(live.reduce<Record<string, number>>((s, f) => ({ ...s, [f.currency]: (s[f.currency] ?? 0) + (pick(f) ?? 0) }), {})).map(([c, n]) => amount(n, c)).join(" + ");

  return (
    <section className="block">
      {heading}
      <dl className="facts">
        <div><dt>Open accounts</dt><dd>{open.length}</dd></div>
        <div><dt>To confirm</dt><dd className={open.some(unverified) ? "warning-text" : undefined}>{open.filter(unverified).length}</dd></div>
        <div><dt>Facility limits</dt><dd>{live.length ? byCurrency((f) => f.limit_amount) : "None"}</dd></div>
        <div><dt>Drawn</dt><dd>{live.length ? byCurrency((f) => f.drawn_amount) : "None"}</dd></div>
      </dl>

      <h3>Bank accounts</h3>
      {open.length === 0 && <p className="muted">No bank accounts recorded.</p>}
      <ul className="plain rows">
        {[...open, ...closed].map((a: BankAccount) => {
          const show = shown.includes(a.id);
          return (
            <li key={a.id} className={a.status === "closed" ? "voided" : undefined}>
              <div className="row spread">
                <span>
                  <strong>{a.account_name}</strong> <span className="muted small">· {a.bank} · {PURPOSE_LABELS[a.purpose]}{a.currency !== "AUD" ? ` · ${a.currency}` : ""}</span>
                  {a.is_main && <> <span className="chip">Main</span></>}
                  {a.status === "closed" && <span className="muted small"> · closed {day(a.closed_on)}</span>}
                </span>
                {canEdit && (
                  <button type="button" className="link-dark small" onClick={() => setForm(`acct:${a.id}`)}>
                    Edit
                  </button>
                )}
              </div>
              <div className="small">
                {show ? accountLine(a) : <>{a.bsb ? `BSB ${a.bsb} · ` : ""}Account {masked(a.account_number ?? a.iban)}</>}{" "}
                <button type="button" className="link-dark small" onClick={() => setShown(show ? shown.filter((x) => x !== a.id) : [...shown, a.id])}>
                  {show ? "Hide" : "Show in full"}
                </button>
              </div>
              {(a.signatories || a.authorisation_rule) && (
                <div className="small muted">
                  Authorise payments: {a.signatories ?? <span className="warning-text">signatories not recorded</span>}{a.authorisation_rule ? ` (${a.authorisation_rule})` : ""}
                </div>
              )}
              {!a.signatories && a.status === "open" && <div className="small warning-text">Who can authorise payments is not recorded</div>}
              {a.online_banking && <div className="small muted">Online banking: {a.online_banking}</div>}
              {a.status === "open" && (
                <div className="small">
                  {a.verified_at ? (
                    <span className="muted">
                      Details confirmed by {who(a.verified_by)} on {day(a.verified_at)}{a.verified_how ? ` (${a.verified_how})` : ""}
                    </span>
                  ) : (
                    <span className="warning-text">
                      {a.details_changed_at ? `Details entered or changed by ${who(a.details_changed_by)} on ${day(a.details_changed_at)}: not yet confirmed independently` : "Not yet confirmed independently"}
                    </span>
                  )}
                  {canEdit && !a.verified_at && (a.details_changed_by !== me ? (
                    verifying?.id === a.id ? (
                      <span className="row wrap">
                        <input aria-label="How the details were confirmed" placeholder="Called the bank on its published number" value={verifying.how} onChange={(e) => setVerifying({ id: a.id, how: e.target.value })} />
                        <button type="button" disabled={busy || verifying.how.trim().length < 5} onClick={() => run(() => verifyAccount(a.id, verifying.how), "Confirmed.")}>
                          Record confirmation
                        </button>
                      </span>
                    ) : (
                      <button type="button" className="link-dark small" onClick={() => setVerifying({ id: a.id, how: "" })}>
                        {" "}Confirm the details
                      </button>
                    )
                  ) : (
                    <span className="muted"> · someone other than you must confirm them</span>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {canEdit && (
        <p>
          <button type="button" className="quiet" onClick={() => setForm("acct")}>
            Add a bank account
          </button>
        </p>
      )}

      <h3>Credit facilities</h3>
      {data.facilities.length === 0 ? (
        <p className="muted">No credit lines or facilities recorded.</p>
      ) : (
        <div className="table-scroll">
          <table className="report-table wide">
            <thead>
              <tr>
                <th scope="col">Lender and type</th>
                <th scope="col" className="num">Limit</th>
                <th scope="col" className="num">Drawn</th>
                <th scope="col">Rate</th>
                <th scope="col">Dates</th>
                <th scope="col">Security and covenants</th>
              </tr>
            </thead>
            <tbody>
              {data.facilities.map((f) => {
                const soon = (iso: string | null, days: number) => iso && f.status === "active" && daysUntil(iso, t) <= days;
                return (
                  <tr key={f.id}>
                    <th scope="row">
                      {canEdit ? <button type="button" className="link-dark" onClick={() => setForm(`fac:${f.id}`)}>{f.lender}</button> : f.lender}
                      <span className="muted small"><br />{FACILITY_LABELS[f.kind]}{f.reference ? ` · ${f.reference}` : ""}{f.status !== "active" ? ` · ${f.status}` : ""}</span>
                    </th>
                    <td className="num">{amount(f.limit_amount, f.currency) || <span className="warning-text">Not recorded</span>}</td>
                    <td className="num">
                      {f.drawn_amount != null ? amount(f.drawn_amount, f.currency) : <span className="muted">Not recorded</span>}
                      {f.drawn_as_at && <span className="muted small"><br />at {day(f.drawn_as_at)}</span>}
                    </td>
                    <td className="small">{f.interest_rate}{f.fees ? <><br /><span className="muted">{f.fees}</span></> : null}</td>
                    <td className="small">
                      {f.maturity_on && <span className={soon(f.maturity_on, 180) ? "warning-text" : undefined}>Matures {day(f.maturity_on)}<br /></span>}
                      {f.review_on && <span className={soon(f.review_on, 30) ? "warning-text" : undefined}>Review {day(f.review_on)}<br /></span>}
                      {f.next_covenant_test_on && <span className={soon(f.next_covenant_test_on, 30) ? "warning-text" : undefined}>Covenant test {day(f.next_covenant_test_on)}</span>}
                    </td>
                    <td className="small">
                      {f.security && <>Security: {f.security}<br /></>}
                      {f.guarantors && <>Guarantors: {f.guarantors}<br /></>}
                      {f.covenants && <span className="muted">Covenants: {f.covenants}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {canEdit && (
        <p>
          <button type="button" className="quiet" onClick={() => setForm("fac")}>
            Add a credit line or facility
          </button>
        </p>
      )}
      {data.facilities.length > 0 && <p className="muted small">A facility maturing within six months, or with a review or covenant test due within a month, goes into the next risk review.</p>}
    </section>
  );
}

function AccountForm({ initial, editing, busy, onSave, onCancel }: { initial: AccountValues; editing: boolean; busy: boolean; onSave: (v: AccountValues) => void; onCancel: () => void }) {
  const [v, setV] = useState(initial);
  const set = (p: Partial<AccountValues>) => setV({ ...v, ...p });
  const [missing, setMissing] = useState<string | null>(null);
  const au = ["australia", "au"].includes(v.country.trim().toLowerCase());
  const changing = editing && (v.bsb !== initial.bsb || v.account_number !== initial.account_number || v.iban !== initial.iban || v.swift_bic !== initial.swift_bic);
  return (
    <div className="card form">
      <h3>{editing ? initial.account_name : "New bank account"}</h3>
      <div className="row wrap">
        <Text id="b-bank" label="Bank" value={v.bank} onChange={(x) => set({ bank: x })} />
        <Text id="b-name" label="Account name" value={v.account_name} onChange={(x) => set({ account_name: x })} wide />
        <Select id="b-purpose" label="Used for" value={v.purpose} onChange={(x) => set({ purpose: x as AccountValues["purpose"] })}>
          {Object.entries(PURPOSE_LABELS).map(([id, l]) => <option key={id} value={id}>{l}</option>)}
        </Select>
      </div>
      <div className="row wrap">
        <Text id="b-country" label="Country" value={v.country} onChange={(x) => set({ country: x })} />
        <Text id="b-cur" label="Currency" value={v.currency} onChange={(x) => set({ currency: x.toUpperCase() })} />
        {au && <Text id="b-bsb" label="BSB" placeholder="062-000" value={v.bsb} onChange={(x) => set({ bsb: x })} />}
        <Text id="b-num" label="Account number" value={v.account_number} onChange={(x) => set({ account_number: x })} />
      </div>
      {!au && (
        <div className="row wrap">
          <Text id="b-swift" label="SWIFT / BIC" value={v.swift_bic} onChange={(x) => set({ swift_bic: x })} />
          <Text id="b-iban" label="IBAN" value={v.iban} onChange={(x) => set({ iban: x })} wide />
        </div>
      )}
      {changing && <p className="card warning small">Changing bank details is how most payment fraud happens. Once saved, the account shows as unconfirmed until someone else confirms the new details with the bank on a number you already hold.</p>}
      <div className="row wrap">
        <Text id="b-sig" label="Who can authorise payments" placeholder="CEO, CFO, Financial Controller" value={v.signatories} onChange={(x) => set({ signatories: x })} wide />
        <Text id="b-rule" label="How" placeholder="Any two" value={v.authorisation_rule} onChange={(x) => set({ authorisation_rule: x })} />
      </div>
      <div className="row wrap">
        <Text id="b-online" label="Online banking (platform and administrator)" value={v.online_banking} onChange={(x) => set({ online_banking: x })} wide />
        <Text id="b-opened" label="Opened" type="date" value={v.opened_on} onChange={(x) => set({ opened_on: x || null })} />
      </div>
      <div className="row wrap">
        <label className="check"><input type="checkbox" checked={v.is_main} onChange={(e) => set({ is_main: e.target.checked })} /> A main account</label>
        {editing && (
          <label className="check"><input type="checkbox" checked={v.status === "closed"} onChange={(e) => set({ status: e.target.checked ? "closed" : "open", closed_on: e.target.checked ? v.closed_on ?? today() : null })} /> Closed</label>
        )}
        {v.status === "closed" && <Text id="b-closed" label="Closed on" type="date" value={v.closed_on} onChange={(x) => set({ closed_on: x || null })} />}
      </div>
      <Text id="b-notes" label="Notes" value={v.notes} onChange={(x) => set({ notes: x })} wide />
      {missing && <p className="error">{missing}</p>}
      <div className="row">
        <button type="button" disabled={busy} onClick={() => {
          if (v.bank.trim().length < 2) return setMissing("Give the bank.");
          if (v.account_name.trim().length < 2) return setMissing("Give the account name.");
          if (au && v.purpose !== "card" && !/^\d{3}-?\d{3}$/.test((v.bsb ?? "").replace(/\s/g, ""))) return setMissing("Give the six-digit BSB.");
          if (!v.account_number?.trim() && !v.iban?.trim()) return setMissing(au ? "Give the account number." : "Give the account number or the IBAN.");
          onSave(au ? { ...v, swift_bic: null, iban: null } : v);
        }}>
          Save
        </button>
        <button type="button" className="quiet" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function FacilityForm({ initial, accounts, busy, onSave, onCancel }: { initial: FacilityValues; accounts: BankAccount[]; busy: boolean; onSave: (v: FacilityValues) => void; onCancel: () => void }) {
  const [v, setV] = useState(initial);
  const set = (p: Partial<FacilityValues>) => setV({ ...v, ...p });
  const [missing, setMissing] = useState<string | null>(null);
  return (
    <div className="card form">
      <h3>{initial.lender ? `${initial.lender}: ${FACILITY_LABELS[initial.kind]}` : "New credit line or facility"}</h3>
      <div className="row wrap">
        <Text id="f-lender" label="Lender" value={v.lender} onChange={(x) => set({ lender: x })} />
        <Select id="f-kind" label="Type" value={v.kind} onChange={(x) => set({ kind: x as FacilityValues["kind"] })}>
          {Object.entries(FACILITY_LABELS).map(([id, l]) => <option key={id} value={id}>{l}</option>)}
        </Select>
        <Text id="f-ref" label="Reference" value={v.reference} onChange={(x) => set({ reference: x })} />
        <Select id="f-status" label="Status" value={v.status} onChange={(x) => set({ status: x as FacilityValues["status"] })}>
          <option value="active">Active</option>
          <option value="repaid">Repaid</option>
          <option value="cancelled">Cancelled</option>
          <option value="expired">Expired</option>
        </Select>
      </div>
      <div className="row wrap">
        <Text id="f-limit" label="Limit" value={v.limit_amount} onChange={(x) => set({ limit_amount: toNum(x) })} />
        <Text id="f-cur" label="Currency" value={v.currency} onChange={(x) => set({ currency: x.toUpperCase() })} />
        <Text id="f-drawn" label="Drawn" value={v.drawn_amount} onChange={(x) => set({ drawn_amount: toNum(x) })} />
        <Text id="f-drawn-at" label="Drawn as at" type="date" value={v.drawn_as_at} onChange={(x) => set({ drawn_as_at: x || null })} />
      </div>
      <div className="row wrap">
        <Text id="f-rate" label="Interest rate" placeholder="BBSY + 2.10%" value={v.interest_rate} onChange={(x) => set({ interest_rate: x })} />
        <Text id="f-fees" label="Fees" placeholder="Line fee 0.80% on the limit" value={v.fees} onChange={(x) => set({ fees: x })} wide />
      </div>
      <div className="row wrap">
        <Text id="f-start" label="Started" type="date" value={v.starts_on} onChange={(x) => set({ starts_on: x || null })} />
        <Text id="f-mat" label="Matures" type="date" value={v.maturity_on} onChange={(x) => set({ maturity_on: x || null })} />
        <Text id="f-review" label="Annual review" type="date" value={v.review_on} onChange={(x) => set({ review_on: x || null })} />
        <Text id="f-cov-on" label="Next covenant test" type="date" value={v.next_covenant_test_on} onChange={(x) => set({ next_covenant_test_on: x || null })} />
      </div>
      <Text id="f-sec" label="Security" placeholder="General security over all assets; mortgage over 1 Test St" value={v.security} onChange={(x) => set({ security: x })} wide />
      <Text id="f-guar" label="Guarantors" placeholder="ParentCo and each wholly owned subsidiary" value={v.guarantors} onChange={(x) => set({ guarantors: x })} wide />
      <Text id="f-cov" label="Covenants" placeholder="Leverage under 2.5x; interest cover over 3x, tested half-yearly" value={v.covenants} onChange={(x) => set({ covenants: x })} wide />
      {accounts.length > 0 && (
        <Select id="f-acct" label="Linked bank account" value={v.bank_account_id ?? ""} onChange={(x) => set({ bank_account_id: x || null })}>
          <option value="">None</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.account_name} ({a.bank} {masked(a.account_number ?? a.iban)})</option>)}
        </Select>
      )}
      {missing && <p className="error">{missing}</p>}
      <div className="row">
        <button type="button" disabled={busy} onClick={() => {
          if (v.lender.trim().length < 2) return setMissing("Give the lender.");
          if (v.maturity_on && v.starts_on && v.maturity_on < v.starts_on) return setMissing("Maturity cannot be before the start.");
          onSave(v);
        }}>
          Save
        </button>
        <button type="button" className="quiet" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

/** Company Info card: a short summary for one company */
export function FinanceSummary({ data, entityId }: { data: FinanceData | null; entityId: string }) {
  if (!data?.ready) return null;
  const accounts = data.accounts.filter((a) => a.entity_id === entityId && a.status === "open");
  const facilities = data.facilities.filter((f) => f.entity_id === entityId && f.status === "active");
  const main = accounts.filter((a) => a.is_main);
  const toConfirm = accounts.filter(unverified).length;
  return (
    <>
      <h3>Finance</h3>
      <dl className="detail-list compact">
        <div>
          <dt>Main account</dt>
          <dd className={main.length ? undefined : "muted"}>
            {main.length ? main.map((a) => `${a.bank} ${a.bsb ? `${a.bsb} ` : ""}${masked(a.account_number ?? a.iban)}`).join(", ") : accounts.length ? "None marked as main" : "Not yet provided"}
          </dd>
        </div>
        <div>
          <dt>Bank accounts</dt>
          <dd className={accounts.length ? undefined : "muted"}>
            {accounts.length ? `${accounts.length} open` : "Not yet provided"}
            {toConfirm > 0 && <span className="warning-text"> · {toConfirm} not yet confirmed</span>}
          </dd>
        </div>
        <div>
          <dt>Credit facilities</dt>
          <dd className={facilities.length ? undefined : "muted"}>
            {facilities.length
              ? facilities.map((f) => `${f.lender} ${FACILITY_LABELS[f.kind].toLowerCase()} ${amount(f.limit_amount, f.currency)}${f.drawn_amount != null ? ` (${amount(f.drawn_amount, f.currency)} drawn)` : ""}`).join("; ")
              : "None recorded"}
          </dd>
        </div>
      </dl>
    </>
  );
}
