import { useEffect, useState } from "react";
import { blankQAnswers, openPublicQuestionnaire, Q_TEXT, submitPublicQuestionnaire, type PublicQuestionnaire, type QAnswers, type YesNoDetails } from "./parties";

const day = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });

/** The third party's answers, read-only (for the case page) */
export function QuestionnaireAnswers({ a, submittedAt }: { a: QAnswers; submittedAt: string | null }) {
  const yn = (k: "litigation" | "insolvency" | "press", label: string) => {
    const v = a[k];
    return (
      <li key={k}>
        {label}: <strong className={v.answer === "yes" ? "warning-text" : undefined}>{v.answer === "yes" ? "Yes" : "No"}</strong>
        {v.details ? ` · ${v.details}` : ""}
      </li>
    );
  };
  return (
    <div className="q-answers">
      <dl className="detail-list compact key-facts">
        <div><dt>Legal name</dt><dd>{a.company.legal_name}</dd></div>
        {a.company.registration_number && <div><dt>Registration</dt><dd>{a.company.registration_number}</dd></div>}
        {a.company.incorporated_on && <div><dt>Incorporated</dt><dd>{day(a.company.incorporated_on)}</dd></div>}
        {a.company.registered_address && <div><dt>Registered address</dt><dd>{a.company.registered_address}</dd></div>}
        {a.company.website && <div><dt>Website</dt><dd>{a.company.website}</dd></div>}
      </dl>
      <h3>Office holders</h3>
      <ul className="plain small">
        {a.officers.map((o, i) => (
          <li key={i}>
            {o.name} · {o.role}
            {o.appointed_on ? ` · since ${day(o.appointed_on)}` : ""}
          </li>
        ))}
      </ul>
      {a.company.is_corporation === "yes" && (
        <>
          <h3>Shareholders</h3>
          <ul className="plain small">
            {a.shareholders.map((s, i) => (
              <li key={i}>
                {s.name}
                {s.percent ? ` · ${s.percent}%` : ""}
              </li>
            ))}
          </ul>
        </>
      )}
      <h3>Disclosures</h3>
      <ul className="plain small">
        {yn("litigation", "Litigation")}
        {yn("insolvency", "Insolvency")}
        {yn("press", "Adverse press")}
        <li>
          Licences and permits held: <strong className={a.licences.confirmed === "no" ? "warning-text" : undefined}>{a.licences.confirmed === "yes" ? "Confirmed" : "Not confirmed"}</strong>
          {a.licences.details ? ` · ${a.licences.details}` : ""}
        </li>
      </ul>
      {a.licences.items.length > 0 && (
        <ul className="plain small">
          {a.licences.items.map((l, i) => (
            <li key={i}>
              {l.name}
              {l.number ? ` · ${l.number}` : ""}
              {l.issuer ? ` · ${l.issuer}` : ""}
              {l.expires_on ? ` · expires ${day(l.expires_on)}` : ""}
            </li>
          ))}
        </ul>
      )}
      <p className="muted small">
        Declared by {a.declaration.signed_name}, {a.declaration.position}
        {submittedAt ? `, ${day(submittedAt)}` : ""}.
      </p>
    </div>
  );
}

function YesNo({ id, text, value, onChange }: { id: string; text: string; value: YesNoDetails; onChange: (v: YesNoDetails) => void }) {
  return (
    <fieldset className="plain-fieldset question">
      <legend>{text}</legend>
      <div className="row">
        {(["no", "yes"] as const).map((v) => (
          <label key={v} className="check">
            <input type="radio" name={id} checked={value.answer === v} onChange={() => onChange({ ...value, answer: v })} /> {v === "yes" ? "Yes" : "No"}
          </label>
        ))}
      </div>
      {value.answer === "yes" && (
        <>
          <label htmlFor={`${id}-d`}>Please give details (who, what, when, and where it stands)</label>
          <textarea id={`${id}-d`} rows={3} value={value.details} onChange={(e) => onChange({ ...value, details: e.target.value })} />
        </>
      )}
    </fieldset>
  );
}

/** The personal-link page for a third party */
export default function DdQuestionnaire({ token }: { token: string }) {
  const [info, setInfo] = useState<PublicQuestionnaire | null>(null);
  const [a, setA] = useState<QAnswers>(blankQAnswers());
  const [error, setError] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    openPublicQuestionnaire(token).then(
      (q) => {
        setInfo(q);
        setA(blankQAnswers({ party_name: q.party_name, registration_number: q.registration_number, website: q.website }));
      },
      (e) => setError(e instanceof Error ? e.message : "This link could not be opened."),
    );
  }, [token]);

  const company = (patch: Partial<QAnswers["company"]>) => setA({ ...a, company: { ...a.company, ...patch } });
  const submit = () => {
    setProblem(null);
    if (a.company.legal_name.trim().length < 2) return setProblem("Give the legal name.");
    if (!a.company.is_corporation) return setProblem("Say whether it is a company (corporation).");
    if (!a.officers.some((o) => o.name.trim())) return setProblem("List at least one current office holder.");
    if (a.company.is_corporation === "yes" && !a.shareholders.some((s) => s.name.trim())) return setProblem("List the shareholders.");
    for (const k of ["litigation", "insolvency", "press"] as const) {
      if (!a[k].answer) return setProblem("Answer every question.");
      if (a[k].answer === "yes" && a[k].details.trim().length < 5) return setProblem('Give details for each "yes" answer.');
    }
    if (!a.licences.confirmed) return setProblem("Confirm whether you hold the licences and permits needed.");
    if (a.declaration.agreed !== "true" || a.declaration.signed_name.trim().length < 3 || a.declaration.position.trim().length < 2) return setProblem("Complete the declaration: tick it, and give your name and position.");
    setBusy(true);
    submitPublicQuestionnaire(token, a).then(
      () => { setDone(true); setBusy(false); window.scrollTo(0, 0); },
      (e) => { setProblem(e instanceof Error ? e.message : "It could not be sent."); setBusy(false); },
    );
  };

  return (
    <div className="page">
      <header className="masthead">
        <span className="wordmark">Common Seal</span>
      </header>
      <main className="content">
        {error && (
          <>
            <h1>This link cannot be opened</h1>
            <p className="lead">{error}</p>
          </>
        )}
        {!error && !info && <p className="lead">Loading…</p>}
        {info && (done || info.submitted_at) && (
          <>
            <p className="eyebrow">{info.organisation} · Third-party questionnaire</p>
            <h1>Thank you</h1>
            <p className="lead">Your answers have been sent to {info.organisation}. They may contact you if they have questions.</p>
          </>
        )}
        {info && !done && !info.submitted_at && (
          <>
            <p className="eyebrow">{info.organisation} · Third-party questionnaire</p>
            <h1>{info.party_name}</h1>
            <p className="lead">
              {info.organisation} asks every new business partner to answer these questions. It takes about ten minutes. Please answer accurately: the answers form part of our due diligence{info.description ? ` for: ${info.description}` : ""}.
            </p>

            <section className="card form">
              <h2>1. Your company</h2>
              <label htmlFor="q-legal">Full legal name</label>
              <input id="q-legal" value={a.company.legal_name} onChange={(e) => company({ legal_name: e.target.value })} />
              <fieldset className="plain-fieldset">
                <legend>Is it a company (a corporation with shareholders)?</legend>
                <div className="row">
                  {(["yes", "no"] as const).map((v) => (
                    <label key={v} className="check">
                      <input type="radio" name="q-corp" checked={a.company.is_corporation === v} onChange={() => company({ is_corporation: v })} /> {v === "yes" ? "Yes" : "No (sole trader, partnership, trust or other)"}
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="row wrap">
                <span className="field">
                  <label htmlFor="q-reg">Company or registration number</label>
                  <input id="q-reg" value={a.company.registration_number} onChange={(e) => company({ registration_number: e.target.value })} />
                </span>
                <span className="field">
                  <label htmlFor="q-inc">Date of incorporation or registration</label>
                  <input id="q-inc" type="date" value={a.company.incorporated_on} onChange={(e) => company({ incorporated_on: e.target.value })} />
                </span>
                <span className="field grow">
                  <label htmlFor="q-web">Website</label>
                  <input id="q-web" value={a.company.website} onChange={(e) => company({ website: e.target.value })} />
                </span>
              </div>
              <label htmlFor="q-addr">Registered address</label>
              <input id="q-addr" value={a.company.registered_address} onChange={(e) => company({ registered_address: e.target.value })} />
            </section>

            <section className="card form">
              <h2>2. Current office holders</h2>
              <p className="muted small">Directors, company secretary and other officers (or the owner or partners if it is not a company).</p>
              {a.officers.map((o, i) => (
                <div key={i} className="row wrap">
                  <input aria-label={`Office holder ${i + 1} name`} placeholder="Full name" value={o.name} onChange={(e) => setA({ ...a, officers: a.officers.map((x, n) => (n === i ? { ...x, name: e.target.value } : x)) })} />
                  <select aria-label={`Office holder ${i + 1} role`} value={o.role} onChange={(e) => setA({ ...a, officers: a.officers.map((x, n) => (n === i ? { ...x, role: e.target.value } : x)) })}>
                    {["Director", "Company secretary", "Chief executive", "Chief financial officer", "Owner", "Partner", "Trustee", "Other officer"].map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                  <input aria-label={`Office holder ${i + 1} appointed`} type="date" title="Appointed on" value={o.appointed_on} onChange={(e) => setA({ ...a, officers: a.officers.map((x, n) => (n === i ? { ...x, appointed_on: e.target.value } : x)) })} />
                  {a.officers.length > 1 && (
                    <button type="button" className="link-dark small" onClick={() => setA({ ...a, officers: a.officers.filter((_, n) => n !== i) })}>
                      Remove
                    </button>
                  )}
                </div>
              ))}
              <button type="button" className="link-dark small" onClick={() => setA({ ...a, officers: [...a.officers, { name: "", role: "Director", appointed_on: "" }] })}>
                Add another
              </button>
            </section>

            {a.company.is_corporation === "yes" && (
              <section className="card form">
                <h2>3. Shareholders</h2>
                <p className="muted small">Everyone who holds shares, with their percentage. For a listed company, list holders of 5% or more.</p>
                {a.shareholders.map((s, i) => (
                  <div key={i} className="row wrap">
                    <input className="grow" aria-label={`Shareholder ${i + 1} name`} placeholder="Name (person or company)" value={s.name} onChange={(e) => setA({ ...a, shareholders: a.shareholders.map((x, n) => (n === i ? { ...x, name: e.target.value } : x)) })} />
                    <input className="short" aria-label={`Shareholder ${i + 1} percentage`} placeholder="%" inputMode="decimal" value={s.percent} onChange={(e) => setA({ ...a, shareholders: a.shareholders.map((x, n) => (n === i ? { ...x, percent: e.target.value } : x)) })} />
                    {a.shareholders.length > 1 && (
                      <button type="button" className="link-dark small" onClick={() => setA({ ...a, shareholders: a.shareholders.filter((_, n) => n !== i) })}>
                        Remove
                      </button>
                    )}
                  </div>
                ))}
                <button type="button" className="link-dark small" onClick={() => setA({ ...a, shareholders: [...a.shareholders, { name: "", percent: "" }] })}>
                  Add another
                </button>
              </section>
            )}

            <section className="card form">
              <h2>{a.company.is_corporation === "yes" ? "4" : "3"}. Questions</h2>
              <YesNo id="q-lit" text={Q_TEXT.litigation} value={a.litigation} onChange={(v) => setA({ ...a, litigation: v })} />
              <YesNo id="q-ins" text={Q_TEXT.insolvency} value={a.insolvency} onChange={(v) => setA({ ...a, insolvency: v })} />
              <YesNo id="q-press" text={Q_TEXT.press} value={a.press} onChange={(v) => setA({ ...a, press: v })} />
              <fieldset className="plain-fieldset question">
                <legend>
                  {Q_TEXT.licences}
                  {info.countries?.length ? <span className="muted small"> We expect you to work in: {info.countries.join(", ")}.</span> : info.country ? <span className="muted small"> We expect you to work in: {info.country}.</span> : null}
                </legend>
                <div className="row">
                  {(["yes", "no"] as const).map((v) => (
                    <label key={v} className="check">
                      <input type="radio" name="q-lic" checked={a.licences.confirmed === v} onChange={() => setA({ ...a, licences: { ...a.licences, confirmed: v } })} /> {v === "yes" ? "Yes, we hold them all" : "No, or not all of them"}
                    </label>
                  ))}
                </div>
                {a.licences.confirmed === "no" && (
                  <>
                    <label htmlFor="q-lic-d">Which are missing, and when you expect to have them</label>
                    <textarea id="q-lic-d" rows={2} value={a.licences.details} onChange={(e) => setA({ ...a, licences: { ...a.licences, details: e.target.value } })} />
                  </>
                )}
                <p className="muted small">List the main ones (licence, permit, registration or professional membership):</p>
                {a.licences.items.map((l, i) => (
                  <div key={i} className="row wrap">
                    <input aria-label={`Licence ${i + 1}`} placeholder="Name" value={l.name} onChange={(e) => setA({ ...a, licences: { ...a.licences, items: a.licences.items.map((x, n) => (n === i ? { ...x, name: e.target.value } : x)) } })} />
                    <input aria-label={`Licence ${i + 1} number`} placeholder="Number" value={l.number} onChange={(e) => setA({ ...a, licences: { ...a.licences, items: a.licences.items.map((x, n) => (n === i ? { ...x, number: e.target.value } : x)) } })} />
                    <input aria-label={`Licence ${i + 1} issuer`} placeholder="Issued by" value={l.issuer} onChange={(e) => setA({ ...a, licences: { ...a.licences, items: a.licences.items.map((x, n) => (n === i ? { ...x, issuer: e.target.value } : x)) } })} />
                    <input aria-label={`Licence ${i + 1} expiry`} type="date" title="Expires on" value={l.expires_on} onChange={(e) => setA({ ...a, licences: { ...a.licences, items: a.licences.items.map((x, n) => (n === i ? { ...x, expires_on: e.target.value } : x)) } })} />
                  </div>
                ))}
                <button type="button" className="link-dark small" onClick={() => setA({ ...a, licences: { ...a.licences, items: [...a.licences.items, { name: "", number: "", issuer: "", expires_on: "" }] } })}>
                  Add another
                </button>
              </fieldset>
            </section>

            <section className="card form declaration">
              <h2>Declaration</h2>
              <label className="check option-help">
                <input type="checkbox" checked={a.declaration.agreed === "true"} onChange={(e) => setA({ ...a, declaration: { ...a.declaration, agreed: e.target.checked ? "true" : "" } })} /> <strong>I am authorised to answer for the company, and these answers are true and complete to the best of my knowledge.</strong>
                <span className="muted"> We will tell {info.organisation} promptly if any of them changes.</span>
              </label>
              <div className="row wrap">
                <span className="field">
                  <label htmlFor="q-sign">Your full name (typed in lieu of a signature)</label>
                  <input id="q-sign" className="signature" autoComplete="off" value={a.declaration.signed_name} onChange={(e) => setA({ ...a, declaration: { ...a.declaration, signed_name: e.target.value } })} />
                </span>
                <span className="field">
                  <label htmlFor="q-pos">Position</label>
                  <input id="q-pos" value={a.declaration.position} onChange={(e) => setA({ ...a, declaration: { ...a.declaration, position: e.target.value } })} />
                </span>
              </div>
              {problem && (
                <p className="error" role="alert">
                  {problem}
                </p>
              )}
              <button type="button" disabled={busy} onClick={submit}>
                {busy ? "Sending…" : "Submit"}
              </button>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
