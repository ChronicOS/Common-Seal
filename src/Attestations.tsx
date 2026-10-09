import { useCallback, useEffect, useState, type FormEvent } from "react";
import { closeRound, loadAttestations, openRound, respond, tally, type AttestationData, type AttestationItem, type Round } from "./attestations";
import { formatDay } from "./board";
import { today } from "./training";

type Props = { organisationId: string; role: string; userId: string };

const MANAGE_ROLES = ["owner", "admin", "secretary", "legal", "compliance"];
const SEE_ALL_ROLES = [...MANAGE_ROLES, "director", "auditor"];
const inDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const KIND: Record<AttestationItem["subject_table"], string> = { register_entries: "Register", policies: "Policy" };

function Answer({ item, busy, onAnswer }: { item: AttestationItem; busy: boolean; onAnswer: (confirm: boolean, comment: string) => void }) {
  const [comment, setComment] = useState(item.comment ?? "");
  return (
    <div className="form review">
      <label htmlFor={`at-${item.id}`}>Comment (needed for an exception)</label>
      <input id={`at-${item.id}`} value={comment} onChange={(e) => setComment(e.target.value)} />
      <div className="row">
        <button type="button" disabled={busy} onClick={() => onAnswer(true, comment)}>
          I confirm
        </button>
        <button type="button" className="quiet" disabled={busy} onClick={() => onAnswer(false, comment)}>
          Raise an exception
        </button>
      </div>
    </div>
  );
}

export default function Attestations({ organisationId, role, userId }: Props) {
  const canManage = MANAGE_ROLES.includes(role);
  const seesAll = SEE_ALL_ROLES.includes(role);

  const [data, setData] = useState<AttestationData | null>(null);
  const [roundId, setRoundId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [dueOn, setDueOn] = useState(() => inDays(14));
  const [note, setNote] = useState("");

  const reload = useCallback(async () => {
    setData(await loadAttestations(organisationId));
  }, [organisationId]);

  useEffect(() => {
    reload().catch((e) => setError(e instanceof Error ? e.message : "Could not load attestations."));
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

  const current: Round | undefined = data.rounds.find((r) => r.id === roundId) ?? data.rounds.find((r) => r.status === "open") ?? data.rounds[0];
  const items = current ? data.items.filter((i) => i.round_id === current.id) : [];
  const mine = items.filter((i) => i.attester_user_id === userId);
  const t = tally(items);
  const late = current?.status === "open" && current.due_on < today();

  return (
    <>
      <p className="eyebrow">Confirmation from the people accountable</p>
      <h1>Attestations</h1>
      {error && (
        <p className="error block" role="alert">
          {error}
        </p>
      )}

      {!current ? (
        <p className="muted">No attestation round has been opened.</p>
      ) : (
        <>
          <p className="lead">
            <strong>{current.name}</strong> <span className={late ? "chip chip-alert" : "chip"}>{current.status === "closed" ? "Closed" : late ? "Overdue" : "Open"}</span>{" "}
            {current.status === "open" ? `due ${formatDay(current.due_on)}` : `closed ${formatDay(current.closed_at!)}`}
          </p>
          {current.closing_note && <p className="card">{current.closing_note}</p>}

          {mine.length > 0 && (
            <section className="block">
              <h2>Yours to give</h2>
              <ul className="plain rows">
                {mine.map((i) => (
                  <li key={i.id}>
                    <span className="row spread">
                      <span>
                        <strong>{i.title}</strong> <span className="muted">· {KIND[i.subject_table]}</span>
                        <br />
                        {i.statement}
                      </span>
                      <span className={i.response === "exception" ? "chip chip-alert" : "chip"}>
                        {i.response === "confirmed" ? "Confirmed" : i.response === "exception" ? "Exception" : "Waiting for you"}
                      </span>
                    </span>
                    {i.comment && i.response && <p className="muted">Your comment: {i.comment}</p>}
                    {current.status === "open" && <Answer key={`${i.id}-${i.response}`} item={i} busy={busy} onAnswer={(c, comment) => void run(() => respond(i.id, c, comment))} />}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {seesAll && (
            <>
              <section className="block">
                <h2>Result</h2>
                <div className="tiles">
                  <div className="card">
                    <h3>Confirmed</h3>
                    <p className="big-number">
                      {t.confirmed} of {t.total}
                    </p>
                  </div>
                  <div className="card">
                    <h3>Exceptions</h3>
                    <p className="big-number">{t.exceptions}</p>
                  </div>
                  <div className="card">
                    <h3>Not answered</h3>
                    <p className="big-number">{t.waiting}</p>
                  </div>
                  <div className="card">
                    <h3>Nobody to ask</h3>
                    <p className="big-number">{t.nobody}</p>
                    <p className="muted">No accountable person with a login. These are not confirmed.</p>
                  </div>
                </div>
              </section>
              <section className="block">
                <h2>Everything in this round</h2>
                <ul className="plain rows">
                  {[...items]
                    .sort((a, b) => Number(a.response === "confirmed") - Number(b.response === "confirmed"))
                    .map((i) => (
                      <li key={i.id} className="row spread">
                        <span>
                          <strong>{i.title}</strong> <span className="muted">· {KIND[i.subject_table]} · {i.attester_user_id ? (i.attester_name ?? "Named person") : "nobody to ask"}</span>
                          {i.comment && (
                            <>
                              <br />
                              {i.comment}
                            </>
                          )}
                        </span>
                        <span className={i.response === "confirmed" ? "chip" : "chip chip-alert"}>
                          {i.response === "confirmed" ? "Confirmed" : i.response === "exception" ? "Exception" : i.attester_user_id ? "Not answered" : "Unknown"}
                        </span>
                      </li>
                    ))}
                </ul>
              </section>
            </>
          )}

          {canManage && current.status === "open" && (
            <form
              className="card form"
              onSubmit={(e) => {
                e.preventDefault();
                const open = t.waiting + t.nobody;
                if (open > 0 && !window.confirm(`${open} ${open === 1 ? "item has" : "items have"} no answer and will stay unconfirmed. Close the round anyway?`)) return;
                void run(() => closeRound(current.id, note)).then((ok) => ok && setNote(""));
              }}
            >
              <h2>Close the round</h2>
              <label htmlFor="at-note">Note for the board (optional)</label>
              <input id="at-note" value={note} onChange={(e) => setNote(e.target.value)} />
              <button type="submit" className="quiet" disabled={busy}>
                Close the round
              </button>
            </form>
          )}
        </>
      )}

      {data.rounds.length > 1 && (
        <section className="block">
          <h2>Rounds</h2>
          <ul className="entity-list">
            {data.rounds.map((r) => (
              <li key={r.id}>
                <button type="button" className="entity-row" onClick={() => setRoundId(r.id)}>
                  <span className="entity-name">{r.name}</span>
                  <span className="chip">{r.status === "open" ? "Open" : "Closed"}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {canManage && !data.rounds.some((r) => r.status === "open") && (
        <form
          className="card form"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            if (name.trim().length < 3) return setError("Name the round, for example Q4 2026.");
            void run(() => openRound(organisationId, name, dueOn)).then((ok) => {
              if (ok) {
                setName("");
                setRoundId(null);
              }
            });
          }}
        >
          <h2>Open a round</h2>
          <p className="muted">
            Asks the accountable person for each confirmed register entry, and the owner of each policy in force, to confirm it
            or raise an exception.
          </p>
          <div className="row">
            <span className="field">
              <label htmlFor="at-name">Name</label>
              <input id="at-name" placeholder="e.g. Q4 2026" value={name} onChange={(e) => setName(e.target.value)} />
            </span>
            <span className="field">
              <label htmlFor="at-due">Answers due</label>
              <input id="at-due" type="date" min={today()} value={dueOn} onChange={(e) => setDueOn(e.target.value)} />
            </span>
          </div>
          <button type="submit" disabled={busy}>
            Open the round
          </button>
        </form>
      )}
    </>
  );
}
