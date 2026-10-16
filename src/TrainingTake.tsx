import { useState } from "react";
import type { MarkResult } from "./training";

const day = (iso: string) => new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });
const paragraphs = (text: string) =>
  text
    .split(/\n\s*\n|\n(?=# )/)
    .map((p) => p.trim())
    .filter(Boolean);

type Props = {
  title: string;
  content: string;
  files: { name: string; download: () => Promise<void> }[];
  questions: { key: string; prompt: string; options: string[] }[];
  passMark: number;
  declaration: string;
  /** The person's name as recorded; they type it to sign */
  name: string;
  dueOn: string;
  completedAt: string | null;
  signedName: string | null;
  score: number | null;
  policyVersion?: number | null;
  onSubmit: (answers: number[], signedName: string, agreed: boolean) => Promise<MarkResult>;
};

/** Read the material, answer the questions if any, then the declaration. Used signed in and by personal link. */
export default function TrainingTake(p: Props) {
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [agreed, setAgreed] = useState(false);
  const [typed, setTyped] = useState("");
  const [result, setResult] = useState<MarkResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const done = Boolean(p.completedAt) || Boolean(result?.completed);
  const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

  async function complete() {
    setError(null);
    if (p.questions.some((q) => answers[q.key] === undefined)) return setError("Answer every question first.");
    if (!agreed) return setError("Tick the box to confirm you agree to comply.");
    if (norm(typed) !== norm(p.name)) return setError(`Type your name as it appears above: ${p.name}`);
    setBusy(true);
    try {
      const r = await p.onSubmit(
        p.questions.map((q) => answers[q.key]),
        typed,
        agreed,
      );
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not record your completion.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1>{p.title}</h1>
      <p className="lead">
        {done
          ? `Completed on ${day(p.completedAt ?? new Date().toISOString())}${p.signedName ? `, signed by ${p.signedName}` : ""}${p.score !== null && p.questions.length ? ` with ${p.score}%` : result && p.questions.length ? ` with ${result.score}%` : ""}.`
          : `Please complete by ${day(p.dueOn)}.${p.questions.length ? ` There ${p.questions.length === 1 ? "is one question" : `are ${p.questions.length} questions`}; the pass mark is ${p.passMark}%.` : ""}`}
        {p.policyVersion ? ` Version ${p.policyVersion} of the policy.` : ""}
      </p>

      {p.files.length > 0 && (
        <section className="card">
          <h2>Material</h2>
          <ul className="plain rows">
            {p.files.map((f) => (
              <li key={f.name}>
                <button type="button" className="quiet" onClick={() => void f.download().catch((e) => setError(e instanceof Error ? e.message : "Could not download."))}>
                  ⤓ {f.name}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {p.content.trim() && (
        <section className="card reading">
          {paragraphs(p.content).map((x, i) => (x.startsWith("# ") ? <h3 key={i}>{x.slice(2)}</h3> : <p key={i}>{x}</p>))}
        </section>
      )}

      {done ? (
        <p className="card note" role="status">
          Thank you. Your completion is recorded.
        </p>
      ) : (
        <>
          {p.questions.length > 0 && (
            <section className="block">
              <h2>Questions</h2>
              {p.questions.map((q, qi) => (
                <fieldset key={q.key} className="plain-fieldset question">
                  <legend>
                    {qi + 1}. {q.prompt}
                    {result && !result.passed && <span className={result.marks[qi] ? "muted" : "warning-text"}> {result.marks[qi] ? "Correct" : "Not correct"}</span>}
                  </legend>
                  {q.options.map((option, oi) => (
                    <label key={oi} className="check">
                      <input type="radio" name={q.key} checked={answers[q.key] === oi} onChange={() => setAnswers({ ...answers, [q.key]: oi })} /> {option}
                    </label>
                  ))}
                </fieldset>
              ))}
              {result && !result.passed && (
                <p className="card warning" role="status">
                  You scored {result.score}%. The pass mark is {result.pass_mark}%. Read the material again, change your answers and complete again. Each attempt is recorded.
                </p>
              )}
            </section>
          )}

          <section className="card form declaration">
            <h2>Declaration</h2>
            <dl className="detail-list compact">
              <div>
                <dt>Name</dt>
                <dd>{p.name}</dd>
              </div>
              <div>
                <dt>Date</dt>
                <dd>{day(new Date().toISOString())}</dd>
              </div>
            </dl>
            <label className="check option-help">
              <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} /> <strong>I agree to comply with the terms of this policy.</strong>
              <span className="muted"> {p.declaration}</span>
            </label>
            <label htmlFor="tk-sign">Type your full name in lieu of a signature</label>
            <input id="tk-sign" className="signature" autoComplete="off" placeholder={p.name} value={typed} onChange={(e) => setTyped(e.target.value)} />
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button type="button" disabled={busy} onClick={() => void complete()}>
              {busy ? "Recording…" : "Complete"}
            </button>
          </section>
        </>
      )}
    </>
  );
}
