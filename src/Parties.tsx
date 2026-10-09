import { useCallback, useEffect, useState, type FormEvent } from "react";
import { formatDay, formatWhen } from "./board";
import {
  addParty,
  BLANK_ANSWERS,
  DD_LABELS,
  decideCase,
  DEFAULT_TOPICS,
  KIND_LABELS,
  loadParties,
  openCase,
  provisionalRating,
  RISK_LABELS,
  saveCheck,
  TOPIC_LABELS,
  type Answers,
  type DdCheck,
  type PartiesData,
  type Party,
  type PartyKind,
  type RiskLevel,
  type Topic,
} from "./parties";

type Props = { organisationId: string; role: string };

const ALL_TOPICS: Topic[] = ["abc", "sanctions", "modern_slavery", "aml_kyc"];

function partyChip(p: Party): string {
  if (!p.dd_status) return "No due diligence";
  return `${DD_LABELS[p.dd_status]}${p.risk_rating ? ` · ${RISK_LABELS[p.risk_rating]}` : ""}`;
}

function CheckRow({ check, canEdit, busy, onSave }: { check: DdCheck; canEdit: boolean; busy: boolean; onSave: (result: DdCheck["result"], notes: string) => void }) {
  const [result, setResult] = useState(check.result);
  const [notes, setNotes] = useState(check.notes ?? "");
  const changed = result !== check.result || notes !== (check.notes ?? "");
  const id = `check-${check.id}`;
  return (
    <div className="check-row">
      <label htmlFor={id}>{TOPIC_LABELS[check.topic]}</label>
      <div className="row">
        <select id={id} disabled={!canEdit} value={result} onChange={(e) => setResult(e.target.value as DdCheck["result"])}>
          <option value="pending">Not done</option>
          <option value="clear">Clear</option>
          <option value="concern">Concern found</option>
        </select>
        <input
          className="grow"
          disabled={!canEdit}
          aria-label={`Notes for ${TOPIC_LABELS[check.topic]}`}
          placeholder={check.topic === "sanctions" ? "Result and reference, entered by hand for now" : "What was checked and found"}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
        {canEdit && (
          <button type="button" className="quiet" disabled={busy || !changed} onClick={() => onSave(result, notes)}>
            Save
          </button>
        )}
      </div>
    </div>
  );
}

export default function Parties({ organisationId, role }: Props) {
  const canEdit = ["owner", "admin", "secretary", "legal", "compliance"].includes(role);
  const canAdd = role !== "auditor";

  const [data, setData] = useState<PartiesData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [kind, setKind] = useState<PartyKind>("third_party");
  const [country, setCountry] = useState("");
  const [answers, setAnswers] = useState<Answers>(BLANK_ANSWERS);
  const [topics, setTopics] = useState<Topic[] | null>(null);
  const [conditions, setConditions] = useState("");

  const reload = useCallback(async () => {
    setData(await loadParties(organisationId));
  }, [organisationId]);

  useEffect(() => {
    reload().catch((e) => setError(e instanceof Error ? e.message : "Could not load third parties."));
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

  if (!data) {
    return error ? (
      <p className="error" role="alert">
        {error}
      </p>
    ) : (
      <p className="lead">Loading…</p>
    );
  }

  const who = (uid: string | null) => data.people.find((p) => p.user_id === uid)?.full_name ?? "a member";

  // ---------- One party ----------
  const party = openId ? data.parties.find((p) => p.id === openId) : undefined;
  if (party) {
    const cases = data.cases.filter((c) => c.counterparty_id === party.id);
    const current = cases.find((c) => c.status === "open");
    const past = cases.filter((c) => c.status !== "open");
    const checks = current ? data.checks.filter((k) => k.case_id === current.id) : [];
    const chosen = topics ?? DEFAULT_TOPICS[party.kind];
    const pending = checks.some((k) => k.result === "pending");
    const concern = checks.some((k) => k.result === "concern");
    const preview: RiskLevel = provisionalRating(answers);

    const start = (event: FormEvent) => {
      event.preventDefault();
      if (chosen.length === 0) return setError("Choose at least one check.");
      void run(() => openCase(party.id, answers, chosen)).then((ok) => {
        if (ok) {
          setAnswers(BLANK_ANSWERS);
          setTopics(null);
        }
      });
    };

    return (
      <>
        <button type="button" className="back" onClick={() => { setOpenId(null); setError(null); }}>
          ← Back to third parties
        </button>
        <p className="eyebrow">
          {KIND_LABELS[party.kind]}
          {party.country ? ` · ${party.country}` : ""}
        </p>
        <h1>{party.name}</h1>
        <p className="lead">
          <span className="chip">{partyChip(party)}</span>
          {party.next_review_on ? ` Next review ${formatDay(party.next_review_on)}` : ""}
        </p>
        {party.dd_status === "rejected" && (
          <p className="card warning" role="alert">
            <strong>Rejected.</strong> Contracts with this party cannot be approved.
          </p>
        )}
        {party.dd_status === "open" && party.risk_rating === "high" && (
          <p className="card warning" role="alert">
            <strong>High risk, not yet cleared.</strong> Contracts with this party cannot be approved until this is
            decided.
          </p>
        )}
        {error && (
          <p className="error block" role="alert">
            {error}
          </p>
        )}

        {current && (
          <section className="card form block">
            <h2>Checks</h2>
            <p>
              Rated <strong>{RISK_LABELS[current.risk_rating].toLowerCase()}</strong> from the answers given when this
              was opened.
            </p>
            {checks.map((k) => (
              <CheckRow key={`${k.id}-${k.result}-${k.notes ?? ""}`} check={k} canEdit={canEdit} busy={busy} onSave={(result, notes) => void run(() => saveCheck(k.id, result, notes))} />
            ))}
            {canEdit && (
              <>
                <h3>Decision</h3>
                {pending && <p className="muted">Complete every check before clearing. You can reject at any time.</p>}
                {concern && <p className="warning-text">A check raised a concern, so this can only be cleared with conditions or rejected.</p>}
                <label htmlFor="dd-conditions">Conditions (needed to clear with conditions)</label>
                <input id="dd-conditions" value={conditions} onChange={(e) => setConditions(e.target.value)} />
                <div className="row">
                  <button type="button" disabled={busy || pending || concern} onClick={() => void run(() => decideCase(current.id, "cleared", "")).then((ok) => ok && setConditions(""))}>
                    Clear
                  </button>
                  <button
                    type="button"
                    className="quiet"
                    disabled={busy || pending}
                    onClick={() => void run(() => decideCase(current.id, "cleared_with_conditions", conditions)).then((ok) => ok && setConditions(""))}
                  >
                    Clear with conditions
                  </button>
                  <button
                    type="button"
                    className="quiet"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm(`Reject ${party.name}? Its contracts will be blocked from approval.`))
                        void run(() => decideCase(current.id, "rejected", conditions)).then((ok) => ok && setConditions(""));
                    }}
                  >
                    Reject
                  </button>
                </div>
              </>
            )}
          </section>
        )}

        {!current && canEdit && (
          <form className="card form block" onSubmit={start}>
            <h2>{past.length ? "Start a new review" : "Start due diligence"}</h2>
            <label htmlFor="q-country">How risky is the country they operate in?</label>
            <select id="q-country" value={answers.country_risk} onChange={(e) => setAnswers({ ...answers, country_risk: e.target.value as RiskLevel })}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
            <label className="check">
              <input type="checkbox" checked={answers.government_links} onChange={(e) => setAnswers({ ...answers, government_links: e.target.checked })} />
              Owned by, or closely linked to, a government or public official
            </label>
            <label className="check">
              <input type="checkbox" checked={answers.acts_on_our_behalf} onChange={(e) => setAnswers({ ...answers, acts_on_our_behalf: e.target.checked })} />
              Acts on our behalf (agent, distributor or intermediary)
            </label>
            <label className="check">
              <input type="checkbox" checked={answers.high_risk_sector} onChange={(e) => setAnswers({ ...answers, high_risk_sector: e.target.checked })} />
              Works in a higher-risk sector
            </label>
            <label htmlFor="q-value">Expected annual value</label>
            <select id="q-value" value={answers.annual_value} onChange={(e) => setAnswers({ ...answers, annual_value: e.target.value as Answers["annual_value"] })}>
              <option value="under_100k">Under $100,000</option>
              <option value="100k_to_1m">$100,000 to $1 million</option>
              <option value="over_1m">Over $1 million</option>
            </select>
            <p role="status">
              Provisional rating: <strong>{RISK_LABELS[preview].toLowerCase()}</strong>
              {preview === "high" ? ". Contracts will be blocked until this is decided." : "."}
            </p>
            <fieldset className="plain-fieldset">
              <legend>Checks to run</legend>
              {ALL_TOPICS.map((t) => (
                <label key={t} className="check">
                  <input
                    type="checkbox"
                    checked={chosen.includes(t)}
                    onChange={(e) => setTopics(e.target.checked ? [...chosen, t] : chosen.filter((x) => x !== t))}
                  />
                  {TOPIC_LABELS[t]}
                </label>
              ))}
            </fieldset>
            <button type="submit" disabled={busy}>
              Open due diligence
            </button>
          </form>
        )}

        {past.length > 0 && (
          <section className="block">
            <h2>History</h2>
            <ul className="plain rows">
              {past.map((c) => (
                <li key={c.id}>
                  <strong>{DD_LABELS[c.status]}</strong> · {RISK_LABELS[c.risk_rating]}
                  <span className="muted">
                    {c.decided_at ? ` · ${formatWhen(c.decided_at)} by ${who(c.decided_by)}` : ""}
                  </span>
                  {c.conditions && (
                    <>
                      <br />
                      Conditions: {c.conditions}
                    </>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </>
    );
  }

  // ---------- List ----------
  async function add(event: FormEvent) {
    event.preventDefault();
    if (name.trim().length < 2) return setError("Enter the name.");
    let id = "";
    const ok = await run(async () => {
      id = await addParty(organisationId, name, kind, country);
    });
    if (ok) {
      setName("");
      setCountry("");
      setOpenId(id);
    }
  }

  return (
    <>
      <p className="eyebrow">Due diligence</p>
      <h1>Third parties</h1>
      {data.parties.length === 0 ? (
        <p className="lead">No third parties or customers yet. Counterparties from contracts appear here too.</p>
      ) : (
        <ul className="entity-list">
          {data.parties.map((p) => (
            <li key={p.id}>
              <button type="button" className="entity-row" onClick={() => { setOpenId(p.id); setError(null); setTopics(null); }}>
                <span>
                  <span className="entity-name">{p.name}</span>
                  <span className="muted">
                    {" "}
                    · {KIND_LABELS[p.kind]}
                    {p.country ? ` · ${p.country}` : ""}
                    {p.next_review_on ? ` · review ${formatDay(p.next_review_on)}` : ""}
                  </span>
                </span>
                <span className={p.dd_status === "rejected" || (p.dd_status === "open" && p.risk_rating === "high") ? "chip chip-alert" : "chip"}>
                  {partyChip(p)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {canAdd && (
        <form className="card form" onSubmit={add}>
          <h2>Add a third party or customer</h2>
          <label htmlFor="p-name">Name</label>
          <input id="p-name" value={name} onChange={(e) => setName(e.target.value)} />
          <div className="row">
            <span className="field">
              <label htmlFor="p-kind">Relationship</label>
              <select id="p-kind" value={kind} onChange={(e) => setKind(e.target.value as PartyKind)}>
                <option value="third_party">Third party (supplier, agent, partner)</option>
                <option value="customer">Customer</option>
              </select>
            </span>
            <span className="field">
              <label htmlFor="p-country">Country (optional)</label>
              <input id="p-country" value={country} onChange={(e) => setCountry(e.target.value)} />
            </span>
          </div>
          <button type="submit" disabled={busy}>
            Add
          </button>
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
