import { useCallback, useEffect, useRef, useState } from "react";
import { formatDay } from "./board";
import { cardSeen, decideCard, loadMinutesText, loadMyCards, type ActionCard, type Decision } from "./actionCards";

type Props = { organisationId: string; userId: string; role: string; onOpen: (tab: string) => void; onChanged?: () => void };

const today = () => new Date().toLocaleDateString("en-CA");

/** The cards waiting on this person: one decision each, done here */
export default function ActionCards({ organisationId, userId, role, onOpen, onChanged }: Props) {
  const [cards, setCards] = useState<ActionCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const reload = useCallback(async () => setCards(await loadMyCards(organisationId, userId, role)), [organisationId, userId, role]);
  useEffect(() => {
    reload().catch((e) => setError(e instanceof Error ? e.message : "Could not load your cards."));
  }, [reload]);

  if (cards === null) return error ? <p className="error" role="alert">{error}</p> : null;
  if (cards.length === 0) return done ? <p className="card note" role="status">{done}</p> : null;
  return (
    <section className="block action-cards" aria-label="Decisions waiting on you">
      {done && <p className="card note" role="status">{done}</p>}
      <h2>Decisions for you <span className="muted small">({cards.length})</span></h2>
      {cards.map((c) => (
        <Card key={c.id} card={c} onOpen={onOpen} onDecided={async (msg) => { setDone(msg); await reload(); onChanged?.(); }} />
      ))}
    </section>
  );
}

const LABELS: Record<string, { primary?: [Decision, string]; secondary?: [Decision, string][] }> = {
  minutes_approve: { primary: ["approve", "Approve"], secondary: [["change", "Change"], ["send_back", "Send it back"]] },
  minutes_sign: { primary: ["approve", "Sign"], secondary: [["send_back", "Send it back"]] },
  minutes_revise: { primary: ["done", "Done"] },
  action_assigned: { primary: ["done", "Got it"], secondary: [["ask_date", "Ask for another date"]] },
  action_date: { primary: ["approve", "Agree the new date"], secondary: [["send_back", "Keep the original"]] },
  interest_update: { primary: ["done", "Done: register checked"] },
  follow_up: { primary: ["done", "Done"] },
};
const OPEN_TAB: Partial<Record<string, [string, string]>> = {
  minutes_revise: ["meetings", "Open the meeting"],
  interest_update: ["conflicts", "Open Conflicts of interest"],
  follow_up: ["companyregister", "Open Company register"],
};

function Card({ card, onOpen, onDecided }: { card: ActionCard; onOpen: (tab: string) => void; onDecided: (msg: string) => Promise<void> }) {
  const ref = useRef<HTMLElement>(null);
  const [mode, setMode] = useState<Decision | null>(null);
  const [note, setNote] = useState("");
  const [date, setDate] = useState("");
  const [text, setText] = useState<string | null>(null);
  const [showText, setShowText] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const minutes = card.kind === "minutes_approve" || card.kind === "minutes_sign";
  const onBehalf = card.kind === "minutes_sign" && card.payload.on_behalf === true;
  const labels = LABELS[card.kind] ?? { primary: ["done", "Done"] };
  const primary: [Decision, string] = onBehalf ? ["approve", "Record that the chair signed"] : labels.primary!;
  const overdue = card.due_on && card.due_on < today();

  // Counts as seen once it is on screen (for the time-to-decide measure)
  useEffect(() => {
    if (card.first_seen_at || !ref.current || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((e) => {
      if (e.some((x) => x.isIntersecting)) {
        void cardSeen(card.id);
        io.disconnect();
      }
    });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [card.id, card.first_seen_at]);

  async function loadText() {
    if (text === null) setText(await loadMinutesText(card.subject_id));
  }

  async function decide(d: Decision) {
    setProblem(null);
    if (d === "send_back" && minutes && note.trim().length < 3) return setProblem("Say what needs changing.");
    if (d === "ask_date" && !date) return setProblem("Choose the date you need.");
    setBusy(true);
    try {
      await decideCard(card.id, d, note.trim() || undefined, d === "change" ? { content: text } : d === "ask_date" ? { due_on: date } : undefined);
      const what = d === "send_back" ? "Sent back" : d === "ask_date" ? "New date asked for" : d === "change" ? "Changed and approved" : "Done";
      await onDecided(`${what}: ${card.title}.`);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article ref={ref} className="action-card card">
      <header>
        <h3>{card.title}</h3>
        <p className="muted small">
          Prepared by {card.prepared_by}
          {card.due_on && <> · <span className={overdue ? "warning-text" : undefined}>{overdue ? "overdue, was due" : "due"} {formatDay(card.due_on)}</span></>}
        </p>
      </header>
      {card.summary && (
        <>
          <p className="ac-label">What was done</p>
          <p>{card.summary}</p>
        </>
      )}
      {card.flags.length > 0 && (
        <ul className="plain ac-flags">
          {card.flags.map((f) => <li key={f}>⚑ {f}</li>)}
        </ul>
      )}
      <div className="ac-decision">
        <p className="ac-label">Your decision</p>
        <p><strong>{card.decision}</strong></p>
      </div>
      {card.evidence.length > 0 && (
        <details className="ac-evidence">
          <summary>Evidence ({card.evidence.length})</summary>
          <ul className="plain">
            {card.evidence.map((e, i) => (
              <li key={i}><strong>{e.label}</strong>{e.quote && <span className="reader-quote">“{e.quote}”</span>}</li>
            ))}
          </ul>
        </details>
      )}
      {minutes && (
        <p>
          <button type="button" className="link-dark small" onClick={() => void loadText().then(() => setShowText(!showText))} aria-expanded={showText}>
            {showText ? "Hide the minutes" : "Read the minutes"}
          </button>
        </p>
      )}
      {minutes && showText && text !== null && mode !== "change" && <pre className="minutes ac-minutes">{text}</pre>}
      {card.on_approval && <p className="ac-next small"><strong>On approval:</strong> {card.on_approval}</p>}

      {mode === "change" && text !== null && (
        <div className="form">
          <label htmlFor={`ac-text-${card.id}`}>Change the minutes, then approve</label>
          <textarea id={`ac-text-${card.id}`} className="minutes-edit" rows={14} value={text} onChange={(e) => setText(e.target.value)} />
        </div>
      )}
      {(mode === "send_back" || mode === "ask_date") && (
        <div className="form">
          {mode === "ask_date" && (
            <>
              <label htmlFor={`ac-date-${card.id}`}>Date you need</label>
              <input id={`ac-date-${card.id}`} type="date" min={today()} value={date} onChange={(e) => setDate(e.target.value)} />
            </>
          )}
          <label htmlFor={`ac-note-${card.id}`}>{mode === "send_back" ? (minutes ? "What needs changing" : "Reason (optional)") : "Reason (optional)"}</label>
          <input id={`ac-note-${card.id}`} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      )}
      {problem && <p className="error small" role="alert">{problem}</p>}

      <div className="row wrap ac-buttons">
        {mode === null ? (
          <>
            <button type="button" disabled={busy} onClick={() => void decide(primary[0])}>{primary[1]}</button>
            {(labels.secondary ?? []).map(([d, l]) => (
              <button key={d} type="button" className="quiet" disabled={busy} onClick={() => { setProblem(null); if (d === "change") void loadText().then(() => setMode("change")); else setMode(d); }}>{l}</button>
            ))}
            {OPEN_TAB[card.kind] && <button type="button" className="link-dark small" onClick={() => onOpen(OPEN_TAB[card.kind]![0])}>{OPEN_TAB[card.kind]![1]}</button>}
          </>
        ) : (
          <>
            <button type="button" disabled={busy} onClick={() => void decide(mode)}>
              {mode === "change" ? "Save changes and approve" : mode === "send_back" ? "Send it back" : "Ask for this date"}
            </button>
            <button type="button" className="quiet" disabled={busy} onClick={() => { setMode(null); setProblem(null); }}>Cancel</button>
          </>
        )}
      </div>
    </article>
  );
}
