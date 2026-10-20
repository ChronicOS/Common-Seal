import { useState } from "react";
import {
  attestation, blankOwner, Q2_TEXT, removeQuestionnaireUpload, submitQuestionnaire2, UPLOAD_KINDS, uploadForQuestionnaire,
  type Owner2, type PublicQuestionnaire, type QAnswers2, type Upload, type YesNoDetails, type YN,
} from "./parties";

const day = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
const OWNER_TYPES: { id: Owner2["type"]; label: string }[] = [
  { id: "individual", label: "A person" },
  { id: "company", label: "A company, trust or fund" },
  { id: "government", label: "A government or government agency" },
];

/** A form 2 questionnaire's answers, read-only (for the case page) */
export function QuestionnaireAnswers2({ a, submittedAt }: { a: QAnswers2; submittedAt: string | null }) {
  const flagged = new Set(a.government?.people ?? []);
  const yn = (label: string, v: YesNoDetails) => (
    <li>
      {label}: <strong className={v.answer === "yes" ? "warning-text" : undefined}>{v.answer === "yes" ? "Yes" : "No"}</strong>
      {v.details ? ` · ${v.details}` : ""}
    </li>
  );
  const gov = (key: string, extra = false) => (flagged.has(key) || extra ? <span className="chip chip-alert">Government link declared</span> : null);
  return (
    <div className="q-answers">
      <dl className="detail-list compact key-facts">
        <div><dt>Legal name</dt><dd>{a.business.legal_name}</dd></div>
        {a.business.website && <div><dt>Website</dt><dd>{a.business.website}</dd></div>}
        <div><dt>Countries of operation</dt><dd>{a.business.countries}</dd></div>
        <div><dt>Employees</dt><dd>{a.business.employees}</dd></div>
        <div><dt>In business</dt><dd>{a.business.years}</dd></div>
        <div><dt>Contact</dt><dd>{a.contact.name} · {a.contact.phone} · {a.contact.email}{a.contact.alt_email ? ` · ${a.contact.alt_email}` : ""}<br />{a.contact.address}</dd></div>
      </dl>
      <h3>Owners and shareholders</h3>
      <ul className="plain small">
        {a.owners.map((o, i) => (
          <li key={i}>
            {o.name} · {o.percent}% · {OWNER_TYPES.find((t) => t.id === o.type)?.label ?? o.type}
            {o.country ? ` · ${o.country}` : ""} {gov(`owner:${i}`, o.government === "yes" || o.type === "government")}
          </li>
        ))}
      </ul>
      <h3>Office holders</h3>
      <ul className="plain small">
        {a.officers.map((o, i) => <li key={i}>{o.name} · {o.position}{o.country ? ` · ${o.country}` : ""} {gov(`officer:${i}`)}</li>)}
      </ul>
      <h3>Key management</h3>
      <ul className="plain small">
        {a.management.map((o, i) => <li key={i}>{o.name} · {o.title}{o.country ? ` · ${o.country}` : ""} {gov(`manager:${i}`)}</li>)}
      </ul>
      <h3>Services</h3>
      <p className="small">{a.services.description}</p>
      <h3>Disclosures</h3>
      <ul className="plain small">
        {yn("Dealings with officials or regulated individuals", a.gov_interaction)}
        {yn("Sub-contractors", a.sub_contractors)}
        {yn("Investigations, proceedings or sanctions", a.record)}
        {yn("Government officials among key personnel or family", a.government)}
        <li>Code of conduct or anti-corruption policy: <strong className={a.framework.code === "no" ? "warning-text" : undefined}>{a.framework.code === "yes" ? "Yes (copy uploaded)" : "No"}</strong></li>
        <li>
          Staff trained on it: <strong className={a.framework.training === "no" ? "warning-text" : undefined}>{a.framework.training === "yes" ? "Yes" : "No"}</strong>
          {a.framework.training === "yes" ? (a.framework.cannot_upload === "true" ? " · could not upload materials: contact them to arrange another way" : " · materials uploaded") : ""}
        </li>
      </ul>
      <p className="muted small">
        Attested by {a.declaration.signed_name}, {a.declaration.title}
        {a.declaration.signed_on ? `, ${day(a.declaration.signed_on)}` : submittedAt ? `, ${day(submittedAt)}` : ""}.
      </p>
    </div>
  );
}

function YesNo({ id, text, value, onChange, prompt }: { id: string; text: string; value: YesNoDetails; onChange: (v: YesNoDetails) => void; prompt?: string }) {
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
          <label htmlFor={`${id}-d`}>{prompt ?? "Please describe the circumstances and details"}</label>
          <textarea id={`${id}-d`} rows={3} value={value.details} onChange={(e) => onChange({ ...value, details: e.target.value })} />
        </>
      )}
    </fieldset>
  );
}

function Radio({ name, value, onChange }: { name: string; value: YN; onChange: (v: YN) => void }) {
  return (
    <div className="row">
      {(["yes", "no"] as const).map((v) => (
        <label key={v} className="check">
          <input type="radio" name={name} checked={value === v} onChange={() => onChange(v)} /> {v === "yes" ? "Yes" : "No"}
        </label>
      ))}
    </div>
  );
}

/** The third party's form (version 2): light touch, everything the screening needs */
export function FormTwo({ token, info, onDone }: { token: string; info: PublicQuestionnaire; onDone: () => void }) {
  const [a, setA] = useState<QAnswers2>(() => ({
    business: { legal_name: info.party_name, website: info.website ?? "", countries: (info.countries ?? (info.country ? [info.country] : [])).join(", "), employees: "", years: "" },
    contact: { name: info.contact_name ?? "", phone: "", email: "", alt_email: "", address: "" },
    owners: [blankOwner()],
    officers: [{ name: "", position: "Director", country: "", dob: "" }],
    management: [{ name: "", title: "", country: "", dob: "" }],
    services: { description: "" },
    gov_interaction: { answer: "", details: "" },
    sub_contractors: { answer: "", details: "" },
    record: { answer: "", details: "" },
    government: { answer: "", details: "", people: [] },
    framework: { code: "", training: "", cannot_upload: "" },
    declaration: { agreed: "", signed_name: "", title: "" },
  }));
  const [uploads, setUploads] = useState<Upload[]>(info.uploads ?? []);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const set = <K extends keyof QAnswers2>(k: K, v: QAnswers2[K]) => setA({ ...a, [k]: v });
  const today = new Date().toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });

  const people = [
    ...a.owners.map((o, i) => ({ key: `owner:${i}`, name: o.name, role: "Owner" })),
    ...a.officers.map((o, i) => ({ key: `officer:${i}`, name: o.name, role: o.position || "Office holder" })),
    ...a.management.map((o, i) => ({ key: `manager:${i}`, name: o.name, role: o.title || "Management" })),
  ].filter((p) => p.name.trim());

  const upload = (kind: Upload["kind"], f: File) => {
    setBusy(true);
    setProblem(null);
    uploadForQuestionnaire(token, kind, f).then(
      (path) => { setUploads([...uploads, { path, kind, file_name: f.name.replace(/[^A-Za-z0-9._ -]/g, "_") }]); setBusy(false); },
      (err) => { setProblem(err instanceof Error ? err.message : "The file could not be uploaded."); setBusy(false); },
    );
  };
  const filesOf = (kind: Upload["kind"]) => uploads.filter((u) => u.kind === kind);
  const UploadBox = ({ kind, label }: { kind: Upload["kind"]; label: string }) => (
    <div className="block-gap">
      {filesOf(kind).map((u) => (
        <p key={u.path} className="small row spread">
          <span>{u.file_name}</span>
          <button type="button" className="link-dark small" disabled={busy} onClick={() => { setBusy(true); removeQuestionnaireUpload(token, u.path).then(() => { setUploads(uploads.filter((x) => x.path !== u.path)); setBusy(false); }, (e) => { setProblem(e.message); setBusy(false); }); }}>Remove</button>
        </p>
      ))}
      <label className="quiet file-button">
        {busy ? "Uploading…" : label}
        <input type="file" hidden accept=".pdf,.doc,.docx,.ppt,.pptx,image/*" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) upload(kind, f); }} />
      </label>
    </div>
  );

  const submit = () => {
    setProblem(null);
    const need = (ok: boolean, msg: string) => (ok ? null : msg);
    const yn = (v: YesNoDetails) => v.answer && (v.answer === "no" || v.details.trim().length >= 5);
    const message =
      need(a.business.legal_name.trim().length >= 2, "1. Give the full legal name of the business.") ??
      need(a.business.countries.trim().length >= 2, "3. List the countries you operate in.") ??
      need(Boolean(a.business.employees.trim()), "4. Give the number of employees.") ??
      need(Boolean(a.business.years.trim()), "5. Say how long the business has operated.") ??
      need(a.contact.name.trim().length >= 2 && a.contact.phone.replace(/\D/g, "").length >= 6 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a.contact.email.trim()) && a.contact.address.trim().length >= 5, "6. Complete the contact details: name, phone, email and address.") ??
      need(a.owners.length > 0 && a.owners.every((o) => o.name.trim().length >= 2 && /^\d{1,3}(\.\d{1,4})?$/.test(o.percent.trim()) && o.type && o.government), "7. For each owner give the name, the percentage held, what kind of owner it is, and whether it is a government official or agency.") ??
      need(a.officers.every((o) => o.name.trim().length >= 2) && a.officers.length > 0, "8. List the office holders by name.") ??
      need(a.management.every((o) => o.name.trim().length >= 2) && a.management.length > 0, "9. List your key management by name.") ??
      need(a.services.description.trim().length >= 10, "10(a). Describe the services you would provide.") ??
      need(Boolean(yn(a.gov_interaction) && yn(a.sub_contractors)), "10. Answer each question, with details for each yes.") ??
      need(Boolean(yn(a.record) && yn(a.government)), "11. Answer each question, with details for each yes.") ??
      need(Boolean(a.framework.code && a.framework.training), "12. Answer the questions about your policies and training.") ??
      need(a.framework.code !== "yes" || filesOf("policy").length > 0, "12(a). Upload a copy of your code of conduct or anti-corruption policy.") ??
      need(a.framework.training !== "yes" || filesOf("training").length > 0 || a.framework.cannot_upload === "true", "12(b). Upload your training materials, or tick that you cannot.") ??
      need(a.declaration.agreed === "true" && a.declaration.signed_name.trim().length >= 3 && a.declaration.title.trim().length >= 2, "Sign the attestation: tick it, and give your name and title.");
    if (message) return setProblem(message);
    setBusy(true);
    submitQuestionnaire2(token, a).then(
      () => { setBusy(false); onDone(); },
      (e) => { setProblem(e instanceof Error ? e.message : "It could not be sent."); setBusy(false); },
    );
  };

  const text = (id: string, label: string, value: string, onChange: (v: string) => void, opts: { type?: string; grow?: boolean; placeholder?: string } = {}) => (
    <span className={opts.grow ? "field grow" : "field"}>
      <label htmlFor={id}>{label}</label>
      <input id={id} type={opts.type ?? "text"} value={value} placeholder={opts.placeholder} onChange={(e) => onChange(e.target.value)} />
    </span>
  );

  return (
    <>
      <p className="eyebrow">{info.organisation} · Third-party questionnaire</p>
      <h1>{info.party_name}</h1>
      <p className="lead">
        {info.organisation} asks every business partner to answer these questions before working together. It takes about fifteen minutes.
        {info.description ? ` It relates to: ${info.description}.` : ""}
      </p>

      <section className="card form">
        <h2>Your business</h2>
        {text("q2-legal", "1. Full legal name of the business", a.business.legal_name, (v) => set("business", { ...a.business, legal_name: v }))}
        {text("q2-web", "2. Business website", a.business.website, (v) => set("business", { ...a.business, website: v }), { placeholder: "www.example.com" })}
        {text("q2-countries", "3. Countries of operation", a.business.countries, (v) => set("business", { ...a.business, countries: v }), { placeholder: "Australia, Singapore" })}
        <div className="row wrap">
          {text("q2-emp", "4. Number of employees", a.business.employees, (v) => set("business", { ...a.business, employees: v }))}
          {text("q2-years", "5. How long in business", a.business.years, (v) => set("business", { ...a.business, years: v }), { placeholder: "e.g. 12 years" })}
        </div>
        <h3>6. Contact details</h3>
        <div className="row wrap">
          {text("q2-cname", "Name", a.contact.name, (v) => set("contact", { ...a.contact, name: v }), { grow: true })}
          {text("q2-phone", "Phone", a.contact.phone, (v) => set("contact", { ...a.contact, phone: v }), { type: "tel" })}
        </div>
        <div className="row wrap">
          {text("q2-email", "Email", a.contact.email, (v) => set("contact", { ...a.contact, email: v }), { type: "email", grow: true })}
          {text("q2-alt", "Alternate email (optional)", a.contact.alt_email, (v) => set("contact", { ...a.contact, alt_email: v }), { type: "email", grow: true })}
        </div>
        <label htmlFor="q2-addr">Address</label>
        <textarea id="q2-addr" rows={2} value={a.contact.address} onChange={(e) => set("contact", { ...a.contact, address: e.target.value })} />
      </section>

      <section className="card form">
        <h2>7. Owners and shareholders</h2>
        <p className="small muted">List every owner or shareholder and the percentage each holds. Say whether any is a government official or a government agency.</p>
        {a.owners.map((o, i) => (
          <fieldset key={i} className="plain-fieldset person-row">
            <legend>Owner {i + 1}</legend>
            <div className="row wrap">
              {text(`q2-o${i}-name`, "Name", o.name, (v) => set("owners", a.owners.map((x, j) => (j === i ? { ...x, name: v } : x))), { grow: true })}
              <span className="field">
                <label htmlFor={`q2-o${i}-type`}>Who is it?</label>
                <select id={`q2-o${i}-type`} value={o.type} onChange={(e) => set("owners", a.owners.map((x, j) => (j === i ? { ...x, type: e.target.value as Owner2["type"], government: e.target.value === "government" ? "yes" : x.government } : x)))}>
                  <option value="">Choose</option>
                  {OWNER_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
              </span>
              {text(`q2-o${i}-pct`, "Equity held (%)", o.percent, (v) => set("owners", a.owners.map((x, j) => (j === i ? { ...x, percent: v } : x))))}
              {text(`q2-o${i}-country`, "Country", o.country, (v) => set("owners", a.owners.map((x, j) => (j === i ? { ...x, country: v } : x))))}
              {o.type === "individual" && text(`q2-o${i}-dob`, "Date of birth (optional)", o.dob, (v) => set("owners", a.owners.map((x, j) => (j === i ? { ...x, dob: v } : x))), { type: "date" })}
            </div>
            <span className="small">Is this owner a government official or a government agency?</span>
            <Radio name={`q2-o${i}-gov`} value={o.government} onChange={(v) => set("owners", a.owners.map((x, j) => (j === i ? { ...x, government: v } : x)))} />
            {a.owners.length > 1 && <button type="button" className="link-dark small" onClick={() => set("owners", a.owners.filter((_, j) => j !== i))}>Remove</button>}
          </fieldset>
        ))}
        <button type="button" className="quiet" onClick={() => set("owners", [...a.owners, blankOwner()])}>Add another owner</button>
      </section>

      <section className="card form">
        <h2>8. Office holders</h2>
        <p className="small muted">Directors, company secretary and any other office holders.</p>
        {a.officers.map((o, i) => (
          <div key={i} className="row wrap person-row">
            {text(`q2-of${i}-name`, "Name", o.name, (v) => set("officers", a.officers.map((x, j) => (j === i ? { ...x, name: v } : x))), { grow: true })}
            {text(`q2-of${i}-pos`, "Position", o.position, (v) => set("officers", a.officers.map((x, j) => (j === i ? { ...x, position: v } : x))))}
            {text(`q2-of${i}-country`, "Country", o.country, (v) => set("officers", a.officers.map((x, j) => (j === i ? { ...x, country: v } : x))))}
            {text(`q2-of${i}-dob`, "Date of birth (optional)", o.dob, (v) => set("officers", a.officers.map((x, j) => (j === i ? { ...x, dob: v } : x))), { type: "date" })}
            {a.officers.length > 1 && <button type="button" className="link-dark small" onClick={() => set("officers", a.officers.filter((_, j) => j !== i))}>Remove</button>}
          </div>
        ))}
        <button type="button" className="quiet" onClick={() => set("officers", [...a.officers, { name: "", position: "", country: "", dob: "" }])}>Add another office holder</button>

        <h2>9. Key management</h2>
        <p className="small muted">The people who run the business day to day, for example the CEO, CFO and head of the team who would work with us.</p>
        {a.management.map((o, i) => (
          <div key={i} className="row wrap person-row">
            {text(`q2-m${i}-name`, "Name", o.name, (v) => set("management", a.management.map((x, j) => (j === i ? { ...x, name: v } : x))), { grow: true })}
            {text(`q2-m${i}-title`, "Title", o.title, (v) => set("management", a.management.map((x, j) => (j === i ? { ...x, title: v } : x))))}
            {text(`q2-m${i}-country`, "Country", o.country, (v) => set("management", a.management.map((x, j) => (j === i ? { ...x, country: v } : x))))}
            {text(`q2-m${i}-dob`, "Date of birth (optional)", o.dob, (v) => set("management", a.management.map((x, j) => (j === i ? { ...x, dob: v } : x))), { type: "date" })}
            {a.management.length > 1 && <button type="button" className="link-dark small" onClick={() => set("management", a.management.filter((_, j) => j !== i))}>Remove</button>}
          </div>
        ))}
        <button type="button" className="quiet" onClick={() => set("management", [...a.management, { name: "", title: "", country: "", dob: "" }])}>Add another person</button>
        <p className="small muted">Dates of birth are optional. They help {info.organisation} tell people apart from others with the same name when checking public lists.</p>
      </section>

      <section className="card form">
        <h2>10. Nature of services</h2>
        <label htmlFor="q2-svc">(a) Describe the services you would provide</label>
        <textarea id="q2-svc" rows={3} value={a.services.description} onChange={(e) => set("services", { description: e.target.value })} />
        <YesNo id="q2-govint" text={`(b) ${Q2_TEXT.gov_interaction}`} value={a.gov_interaction} onChange={(v) => set("gov_interaction", v)} prompt="Describe those interactions: who, how often, and why" />
        <YesNo id="q2-sub" text={`(c) ${Q2_TEXT.sub_contractors}`} value={a.sub_contractors} onChange={(v) => set("sub_contractors", v)} prompt="Describe the sub-contractors and what they would do" />
      </section>

      <section className="card form">
        <h2>11. Compliance record</h2>
        <YesNo id="q2-record" text={`(a) ${Q2_TEXT.record}`} value={a.record} onChange={(v) => set("record", v)} />
        <YesNo id="q2-gov" text={`(b) ${Q2_TEXT.government}`} value={a.government} onChange={(v) => set("government", { ...a.government, ...v })} prompt="Please give details: who, which position, and when" />
        {a.government.answer === "yes" && people.length > 0 && (
          <fieldset className="plain-fieldset">
            <legend className="small">Tick each person this applies to (if a family member, tick the person they are related to)</legend>
            {people.map((p) => (
              <label key={p.key} className="check">
                <input type="checkbox" checked={a.government.people.includes(p.key)} onChange={(e) => set("government", { ...a.government, people: e.target.checked ? [...a.government.people, p.key] : a.government.people.filter((k) => k !== p.key) })} /> {p.name} <span className="muted">({p.role})</span>
              </label>
            ))}
          </fieldset>
        )}
      </section>

      <section className="card form">
        <h2>12. Compliance framework</h2>
        <fieldset className="plain-fieldset question">
          <legend>(a) {Q2_TEXT.code}</legend>
          <Radio name="q2-code" value={a.framework.code} onChange={(v) => set("framework", { ...a.framework, code: v })} />
          {a.framework.code === "yes" && <UploadBox kind="policy" label="Upload a copy" />}
        </fieldset>
        <fieldset className="plain-fieldset question">
          <legend>(b) {Q2_TEXT.training}</legend>
          <Radio name="q2-training" value={a.framework.training} onChange={(v) => set("framework", { ...a.framework, training: v })} />
          {a.framework.training === "yes" && (
            <>
              <UploadBox kind="training" label="Upload your training materials" />
              <label className="check small">
                <input type="checkbox" checked={a.framework.cannot_upload === "true"} onChange={(e) => set("framework", { ...a.framework, cannot_upload: e.target.checked ? "true" : "" })} /> I can't upload our training materials. Please contact me to arrange another way.
              </label>
            </>
          )}
        </fieldset>
        <p className="small muted">Files: PDF, Word, PowerPoint or images, up to 10 MB each. Accepted: {UPLOAD_KINDS.filter((k) => k.id === "policy" || k.id === "training").map((k) => k.label.toLowerCase()).join(", ")}.</p>
      </section>

      <section className="card form declaration">
        <h2>Attestation</h2>
        <label className="check option-help">
          <input type="checkbox" checked={a.declaration.agreed === "true"} onChange={(e) => set("declaration", { ...a.declaration, agreed: e.target.checked ? "true" : "" })} />{" "}
          <span>{attestation(info.organisation)}</span>
        </label>
        <div className="row wrap">
          <span className="field grow">
            <label htmlFor="q2-sign">Signed: your full name</label>
            <input id="q2-sign" className="signature" autoComplete="off" value={a.declaration.signed_name} onChange={(e) => set("declaration", { ...a.declaration, signed_name: e.target.value })} />
          </span>
          {text("q2-title", "Title", a.declaration.title, (v) => set("declaration", { ...a.declaration, title: v }))}
          <span className="field">
            <span className="label-like">Date</span>
            <span>{today}</span>
          </span>
        </div>
        {problem && <p className="error" role="alert">{problem}</p>}
        <button type="button" disabled={busy} onClick={submit}>{busy ? "Sending…" : "Sign and submit"}</button>
      </section>
    </>
  );
}
