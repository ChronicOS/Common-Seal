import { useEffect, useState, type FormEvent } from "react";
import { openQuestionnaire, submitQuestionnaire, type Answer, type PublicQuestionnaire } from "./mssurvey";

const day = (iso: string) => new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });

/** The page a supplier sees from their personal link. It needs no account. */
export default function Questionnaire({ token }: { token: string }) {
  const [q, setQ] = useState<PublicQuestionnaire | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [countries, setCountries] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    openQuestionnaire(token).then(
      (data) => {
        setQ(data);
        setName(data.contact_name);
        setEmail(data.contact_email);
        setCompany(data.supplier);
      },
      (e) => setError(e instanceof Error ? e.message : "This link could not be opened."),
    );
  }, [token]);

  const shell = (children: React.ReactNode) => (
    <div className="page">
      <header className="masthead">
        <span className="wordmark">Common Seal</span>
      </header>
      <main className="content">{children}</main>
    </div>
  );

  if (!q) {
    return shell(
      error ? (
        <>
          <h1>This link cannot be opened</h1>
          <p className="lead">{error}. Please check you have the whole link, or ask the person who sent it to send it again.</p>
        </>
      ) : (
        <p className="lead">Opening your questionnaire…</p>
      ),
    );
  }
  if (done || q.submitted_at) {
    return shell(
      <>
        <p className="eyebrow">{q.organisation}</p>
        <h1>Thank you</h1>
        <p className="lead">
          The questionnaire for {q.supplier} has been received{q.submitted_at && !done ? ` (submitted ${day(q.submitted_at)})` : ""}. You can close this page.
        </p>
      </>,
    );
  }
  if (q.closed) {
    return shell(
      <>
        <p className="eyebrow">{q.organisation}</p>
        <h1>This questionnaire has closed</h1>
        <p className="lead">Please contact the person at {q.organisation} who sent it to you.</p>
      </>,
    );
  }

  const yesno = q.questions.filter((x) => x.kind === "yesno");
  const written = q.questions.filter((x) => x.kind === "text" || x.kind === "number");
  const numberOf = (code: string) => q.questions.findIndex((x) => x.code === code) + 1;
  const set = (code: string, patch: Partial<Answer>) => setAnswers({ ...answers, [code]: { ...(answers[code] ?? { a: "" }), ...patch } });

  async function submit(event: FormEvent) {
    event.preventDefault();
    const missing =
      yesno.find((x) => answers[x.code]?.a !== "yes" && answers[x.code]?.a !== "no") ??
      written.find((x) => (x.kind === "number" ? !/^[0-9]{1,9}$/.test((answers[x.code]?.a ?? "").trim()) : (answers[x.code]?.a ?? "").trim().length < 2));
    if (missing) {
      setError(`Please answer every question. Question ${numberOf(missing.code)} ${missing.kind === "number" ? "needs a whole number" : "has no answer"}.`);
      document.getElementById(`qbox-${missing.code}`)?.scrollIntoView({ block: "center" });
      return;
    }
    const noDetail = yesno.find((x) => x.detail_on && answers[x.code].a === x.detail_on && !(answers[x.code].d ?? "").trim());
    if (noDetail) {
      setError("Please provide the details asked for.");
      document.getElementById(`qbox-${noDetail.code}`)?.scrollIntoView({ block: "center" });
      return;
    }
    const list = countries
      .split(/,|\n/)
      .map((c) => c.trim())
      .filter(Boolean);
    if (list.length === 0) return setError("Please tell us the country or countries where your manufacturing facilities are located.");
    setBusy(true);
    setError(null);
    try {
      await submitQuestionnaire(token, { name, email, company }, answers, list);
      setDone(true);
      window.scrollTo(0, 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Your answers could not be sent. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  let lastSection = "";
  return shell(
    <>
      <p className="eyebrow">{q.organisation}</p>
      <h1>Modern slavery questionnaire</h1>
      <p className="lead">
        For {q.supplier}. Please answer by {day(q.deadline)}. Answer for your own organisation; it takes about 30 minutes and must be
        completed in one sitting. There are no wrong answers: please answer openly.
      </p>
      <form className="form" onSubmit={submit} noValidate>
        <section className="card form">
          <h2>About you</h2>
          <label htmlFor="q-name">Your full name</label>
          <input id="q-name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
          <label htmlFor="q-email">Your email</label>
          <input id="q-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <label htmlFor="q-company">Your company name</label>
          <input id="q-company" autoComplete="organization" value={company} onChange={(e) => setCompany(e.target.value)} />
        </section>

        {q.questions.map((x) => {
          const heading = x.section !== lastSection ? <h2 className="q-section">{x.section}</h2> : null;
          lastSection = x.section;
          if (x.kind === "countries") {
            return (
              <div key={x.code}>
                {heading}
                <div className="card form" id={`qbox-${x.code}`}>
                  <label htmlFor="q-countries">
                    {numberOf(x.code)}. {x.prompt}
                  </label>
                  <textarea id="q-countries" rows={2} placeholder="For example: Australia, India" value={countries} onChange={(e) => setCountries(e.target.value)} />
                  <span className="muted">Separate countries with commas.</span>
                </div>
              </div>
            );
          }
          const number = numberOf(x.code);
          const a = answers[x.code];
          if (x.kind === "text" || x.kind === "number") {
            return (
              <div key={x.code}>
                {heading}
                <div className="card form" id={`qbox-${x.code}`}>
                  <label htmlFor={`qt-${x.code}`}>
                    {number}. {x.prompt}
                  </label>
                  {x.kind === "number" ? (
                    <input id={`qt-${x.code}`} className="short-wide" inputMode="numeric" value={a?.a ?? ""} onChange={(e) => set(x.code, { a: e.target.value.trim() })} />
                  ) : (
                    <textarea id={`qt-${x.code}`} rows={2} value={a?.a ?? ""} onChange={(e) => set(x.code, { a: e.target.value })} />
                  )}
                </div>
              </div>
            );
          }
          return (
            <div key={x.code}>
              {heading}
              <fieldset className="card plain-fieldset question" id={`qbox-${x.code}`}>
                <legend>
                  {number}. {x.prompt}
                </legend>
                <div className="row">
                  <label className="check">
                    <input type="radio" name={x.code} checked={a?.a === "yes"} onChange={() => set(x.code, { a: "yes" })} /> Yes
                  </label>
                  <label className="check">
                    <input type="radio" name={x.code} checked={a?.a === "no"} onChange={() => set(x.code, { a: "no" })} /> No
                  </label>
                </div>
                {x.detail_on && a?.a === x.detail_on && (
                  <>
                    <label htmlFor={`qd-${x.code}`}>{x.detail_prompt}</label>
                    <textarea id={`qd-${x.code}`} rows={3} value={a.d ?? ""} onChange={(e) => set(x.code, { d: e.target.value })} />
                  </>
                )}
              </fieldset>
            </div>
          );
        })}

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <p className="muted">
          By submitting you confirm the answers are accurate to the best of your knowledge. They go to {q.organisation} and cannot be changed
          afterwards.
        </p>
        <button type="submit" disabled={busy}>
          {busy ? "Sending…" : "Submit answers"}
        </button>
      </form>
    </>,
  );
}
