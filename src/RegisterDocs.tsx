import { useState, type ReactNode } from "react";
import { today } from "./authorities";
import { formatDay } from "./board";
import { ROLE_LABELS, type AnnualReview, type Filing, type Officer, type OfficerDetails } from "./companyRegister";
import { fmt, money, MOVEMENT_LABELS, type Movement, type OwnershipData } from "./ownership";
import type { Entity } from "./types";

const day = (iso: string | null | undefined) => (iso ? formatDay(`${iso.slice(0, 10)}T12:00:00`) : "");
const acn = (e: Entity) => (e.acn ? `${e.acn.slice(0, 3)} ${e.acn.slice(3, 6)} ${e.acn.slice(6)}` : null);

/** The organisation's logo and details for the top of printed documents (Settings, Account) */
let printHeader: { logo: string | null; legalName: string | null; abn: string | null } | null = null;
export function setPrintHeader(h: typeof printHeader) {
  printHeader = h;
}

/** A full-screen sheet with Print and Close. Printing shows only the sheet. */
export function PrintView({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const h = printHeader;
  return (
    <div className="print-view" role="dialog" aria-label={title}>
      <div className="print-toolbar no-print">
        <strong>{title}</strong>
        <span className="row">
          <button type="button" onClick={() => window.print()}>Print or save as PDF</button>
          <button type="button" className="quiet" onClick={onClose}>Close</button>
        </span>
      </div>
      <div className="print-sheet">
        {h && (h.logo || h.legalName) && (
          <div className="print-letterhead">
            {h.logo && <img src={h.logo} alt="" />}
            {h.legalName && <span>{h.legalName}{h.abn ? ` · ABN ${h.abn.replace(/^(\d{2})(\d{3})(\d{3})(\d{3})$/, "$1 $2 $3 $4")}` : ""}</span>}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

/** One field ready to copy into ASIC Connect. A missing value is shown as missing, never guessed. */
function Field({ label, value }: { label: string; value: string | null | undefined }) {
  const [copied, setCopied] = useState(false);
  return (
    <tr>
      <th scope="row">{label}</th>
      <td className={value ? undefined : "warning-text"}>{value || "Not recorded: add it before lodging"}</td>
      <td className="no-print">
        {value && (
          <button type="button" className="link-dark small" onClick={() => {
            try {
              void navigator.clipboard.writeText(value);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              // Copying is not allowed here; the value can still be selected
            }
          }}>
            {copied ? "Copied" : "Copy"}
          </button>
        )}
      </td>
    </tr>
  );
}

type Ctx = { entity: Entity; officers: Officer[]; details: OfficerDetails[]; own: OwnershipData };

/** The Form 484 or 205 details for a flagged change, in the order ASIC Connect asks for them */
export function FilingSheet({ filing, ctx }: { filing: Filing; ctx: Ctx }) {
  const { entity } = ctx;
  const d = filing.detail as Record<string, string | null>;
  const person = d.person_id ? ctx.officers.find((o) => o.person.id === d.person_id)?.person : undefined;
  const pd = d.person_id ? ctx.details.find((x) => x.person_id === d.person_id) : undefined;
  const role = d.role ? ROLE_LABELS[d.role as Officer["role"]] : null;
  const rows: [string, string | null | undefined][] = [];
  let action = "";
  switch (filing.kind) {
    case "appoint_officer":
      action = "Change company details → Appoint an officeholder";
      rows.push(["Role", role], ["Full name", person?.full_name], ["Former names", pd?.former_names || "None"], ["Date of birth", day(pd?.date_of_birth)],
        ["Place of birth (town, state or country)", pd?.place_of_birth], ["Residential address", pd?.residential_address], ["Date of appointment", day(d.appointed_on ?? filing.event_on)],
        ["Director ID confirmed", pd?.director_id_confirmed_on ? `Yes, ${day(pd.director_id_confirmed_on)}` : role === "Company secretary" ? "Not needed for a secretary" : null]);
      break;
    case "cease_officer":
      action = "Change company details → Cease an officeholder";
      rows.push(["Role", role], ["Full name", person?.full_name], ["Date of birth", day(pd?.date_of_birth)], ["Date ceased", day(d.ceased_on ?? filing.event_on)]);
      break;
    case "officer_details":
      action = "Change company details → Change officeholder name or address";
      rows.push(["Officeholder", person?.full_name ?? (d.old as string)], ["Old", d.old], ["New", d.new], ["Date of change", day(filing.event_on)]);
      break;
    case "registered_office":
      action = "Change company details → Change of registered office address";
      rows.push(["New registered office", d.new], ["Previous address", d.old], ["Date of change", day(filing.event_on)],
        ["Does the company occupy the premises?", "Confirm. If not, you need the occupier's written consent first"]);
      break;
    case "principal_place":
      action = "Change company details → Change of principal place of business";
      rows.push(["New principal place of business", d.new], ["Previous address", d.old], ["Date of change", day(filing.event_on)]);
      break;
    case "ultimate_holding":
      action = "Change company details → Change of ultimate holding company";
      rows.push(["Ultimate holding company", d.new], ["ACN or ABN", d.acn], ["Country (if overseas)", d.country], ["Date of change", day(filing.event_on)]);
      break;
    case "company_name":
      action = "Form 205 Notification of resolution: change of company name";
      rows.push(["Current name", d.old], ["Proposed new name", d.new], ["Date the special resolution was passed", day(filing.event_on)],
        ["Attach", "A copy of the members' special resolution"], ["Before lodging", "Check the name is available on ASIC Connect"]);
      break;
    case "solvency":
      action = "Form 485 Statement in relation to company solvency";
      rows.push(["Annual review date", day(d.review_date as string)], ["Date of the directors' resolution", day(filing.event_on)]);
      break;
    default:
      action = filing.title;
      rows.push(["What", filing.title], ["Date", day(filing.event_on)]);
  }
  return (
    <div className="asic-sheet">
      <p className="eyebrow">{filing.form === "other" ? "ASIC" : `ASIC Form ${filing.form}`}</p>
      <h2>{filing.title}</h2>
      <p className="small">
        Lodge online through ASIC Connect. In ASIC Connect choose: <strong>{action}</strong>. You will need the company's corporate key.
        {filing.due_on ? <> Due by <strong>{day(filing.due_on)}</strong>; late fees apply after that.</> : null}
      </p>
      <table className="report-table wide copy-table">
        <tbody>
          <Field label="Company name" value={entity.name} />
          <Field label="ACN" value={acn(entity)} />
          {rows.map(([l, v]) => <Field key={l} label={l} value={v} />)}
        </tbody>
      </table>
      <p className="muted small">Prepared from the company register on {day(today())}. Check each detail against your records before lodging.</p>
    </div>
  );
}

/** Form 484 details for a share movement */
export function ShareFilingSheet({ m, ctx }: { m: Movement; ctx: Ctx }) {
  const { entity, own } = ctx;
  const h = (id: string | null) => own.holders.find((x) => x.id === id);
  const cls = (id: string | null) => own.classes.find((c) => c.id === id);
  const to = h(m.to_holder_id), from = h(m.from_holder_id);
  const rows: [string, string | null | undefined][] = [
    ["Change", MOVEMENT_LABELS[m.kind]],
    ["Date", day(m.effective_on)],
    ["Share class", cls(m.class_id)?.name],
    ["Number of shares", m.shares != null ? fmt(m.shares) : m.ratio_from ? `${m.ratio_from} become ${m.ratio_to}` : null],
  ];
  if (m.kind === "issue") rows.push(["Amount paid per share", money(m.paid_per_share ?? m.price_per_share)], ["Amount unpaid per share", money(m.unpaid_per_share)], ["Total paid", money((m.shares ?? 0) * (m.paid_per_share ?? m.price_per_share ?? 0))]);
  if (from) rows.push(["From", from.name], ["Their address", from.address]);
  if (to) rows.push(["To", to.name], ["Their address", to.address], ["Beneficially owned?", to.is_beneficial ? "Yes" : `No: held for ${to.held_for}`]);
  if (m.kind === "conversion") rows.push(["Converted into", `${fmt(m.to_shares ?? 0)} ${cls(m.to_class_id)?.name ?? ""}`]);
  return (
    <div className="asic-sheet">
      <p className="eyebrow">ASIC Form 484</p>
      <h2>{MOVEMENT_LABELS[m.kind]} of shares</h2>
      <p className="small">
        Lodge online through ASIC Connect: <strong>Change company details → {m.kind === "issue" ? "Issue of shares" : m.kind === "transfer" ? "Change to members' register" : "Change to share structure"}</strong>.
        {m.asic_due_on ? <> Due by <strong>{day(m.asic_due_on)}</strong>.</> : null}
      </p>
      <table className="report-table wide copy-table">
        <tbody>
          <Field label="Company name" value={entity.name} />
          <Field label="ACN" value={acn(entity)} />
          {rows.map(([l, v]) => <Field key={l} label={l} value={v} />)}
        </tbody>
      </table>
    </div>
  );
}

function Execution({ ctx }: { ctx: Ctx }) {
  const directors = ctx.officers.filter((o) => !o.ceased_on && o.role === "director");
  const secretaries = ctx.officers.filter((o) => !o.ceased_on && o.role === "secretary");
  const sole = directors.length === 1 && (secretaries.length === 0 || secretaries[0].person.id === directors[0].person.id);
  return (
    <div className="execution">
      <p>Executed by {ctx.entity.name}{ctx.entity.acn ? ` ACN ${acn(ctx.entity)}` : ""} in accordance with section 127 of the <em>Corporations Act 2001</em> (Cth):</p>
      <div className="sign-row">
        {sole ? (
          <div className="sign"><span className="line" />Sole director{secretaries.length ? " and sole company secretary" : ""}: {directors[0].person.full_name}</div>
        ) : (
          <>
            <div className="sign"><span className="line" />Director{directors[0] ? `: ${directors[0].person.full_name}` : ""}</div>
            <div className="sign"><span className="line" />Director or company secretary{(directors[1] ?? secretaries[0]) ? `: ${(directors[1] ?? secretaries[0]).person.full_name}` : ""}</div>
          </>
        )}
      </div>
    </div>
  );
}

export function ShareCertificate({ m, ctx }: { m: Movement; ctx: Ctx }) {
  const { entity, own } = ctx;
  const h = own.holders.find((x) => x.id === m.to_holder_id);
  const c = own.classes.find((x) => x.id === m.class_id);
  const paid = m.paid_per_share ?? m.price_per_share ?? 0;
  return (
    <div className="certificate">
      <p className="eyebrow">Share certificate</p>
      <h2>{entity.name}</h2>
      <p className="small">{entity.acn ? `ACN ${acn(entity)}` : <span className="warning-text">ACN not recorded</span>} · Registered office: {entity.registered_office ?? <span className="warning-text">not recorded</span>}</p>
      <dl className="detail-list compact">
        <div><dt>Certificate number</dt><dd className={m.certificate_number ? undefined : "warning-text"}>{m.certificate_number ?? "Not recorded"}</dd></div>
        <div><dt>Date</dt><dd>{day(m.effective_on)}</dd></div>
      </dl>
      <p className="certify">
        This is to certify that <strong>{h?.name ?? "the holder"}</strong>{h?.address ? ` of ${h.address}` : ""} is the registered holder of{" "}
        <strong>{fmt(m.shares ?? 0)} {c?.name ?? ""} shares</strong> in the company, {m.unpaid_per_share ? `paid to ${money(paid)} and unpaid ${money(m.unpaid_per_share)} per share` : `fully paid (${money(paid)} per share)`},
        subject to the constitution of the company{entity.constitution_kind === "replaceable_rules" ? " (the replaceable rules)" : ""}.
      </p>
      {h && !h.is_beneficial && <p className="small">The shares are held by the registered holder for {h.held_for}.</p>}
      <Execution ctx={ctx} />
    </div>
  );
}

export function ConsentToAct({ o, ctx }: { o: Officer; ctx: Ctx }) {
  const pd = ctx.details.find((x) => x.person_id === o.person.id);
  const role = o.role === "secretary" ? "company secretary" : o.role === "alternate_director" ? "alternate director" : "director";
  return (
    <div className="certificate">
      <p className="eyebrow">Consent to act as {role}</p>
      <h2>{ctx.entity.name}{ctx.entity.acn ? ` ACN ${acn(ctx.entity)}` : ""}</h2>
      <p className="certify">
        I, <strong>{o.person.full_name}</strong>, consent to act as a {role} of the company with effect from{" "}
        <strong>{o.appointed_on ? day(o.appointed_on) : "____________"}</strong>.
      </p>
      <table className="report-table wide">
        <tbody>
          <tr><th scope="row">Full name</th><td>{o.person.full_name}</td></tr>
          <tr><th scope="row">Former names</th><td>{pd?.former_names || "None"}</td></tr>
          <tr><th scope="row">Date of birth</th><td className={pd?.date_of_birth ? undefined : "warning-text"}>{pd?.date_of_birth ? day(pd.date_of_birth) : "To be completed"}</td></tr>
          <tr><th scope="row">Place of birth</th><td className={pd?.place_of_birth ? undefined : "warning-text"}>{pd?.place_of_birth ?? "To be completed"}</td></tr>
          <tr><th scope="row">Residential address</th><td className={pd?.residential_address ? undefined : "warning-text"}>{pd?.residential_address ?? "To be completed"}</td></tr>
          {o.role !== "secretary" && <tr><th scope="row">Director ID</th><td>{pd?.director_id ?? "I confirm I hold a Director ID: ________________"}</td></tr>}
        </tbody>
      </table>
      <p className="small">{o.role === "secretary" ? "Given under section 204C" : "Given under section 201D"} of the <em>Corporations Act 2001</em> (Cth).</p>
      <div className="sign-row"><div className="sign"><span className="line" />Signature</div><div className="sign"><span className="line" />Date</div></div>
    </div>
  );
}

export function SolvencyResolution({ reviewDate, ctx }: { review: AnnualReview | undefined; reviewDate: string; ctx: Ctx }) {
  const directors = ctx.officers.filter((o) => !o.ceased_on && (o.role === "director" || o.role === "alternate_director"));
  return (
    <div className="certificate">
      <p className="eyebrow">Resolution of the directors</p>
      <h2>{ctx.entity.name}{ctx.entity.acn ? ` ACN ${acn(ctx.entity)}` : ""}</h2>
      <h3>Solvency resolution</h3>
      <p>Annual review date: <strong>{day(reviewDate)}</strong></p>
      <p className="certify">
        The directors resolve that, in their opinion, there are reasonable grounds to believe that the company will be able to pay its debts as and when they become due and payable.
      </p>
      <p className="small">Passed within two months after the annual review date, as required by section 347A of the <em>Corporations Act 2001</em> (Cth). If the directors cannot pass this resolution, the company must lodge Form 485 with ASIC within 7 days.</p>
      <div className="sign-row">
        {(directors.length ? directors : [null, null]).map((o, i) => (
          <div key={o?.id ?? i} className="sign"><span className="line" />{o ? o.person.full_name : "Director"}</div>
        ))}
      </div>
      <p>Date: ____________________</p>
    </div>
  );
}

export function RegisterOfMembers({ ctx }: { ctx: Ctx }) {
  const { own } = ctx;
  const certs = (holderId: string, classId: string) =>
    own.movements.filter((m) => !m.voided_at && m.certificate_number && (m.to_holder_id === holderId || (m.kind === "conversion" && m.from_holder_id === holderId)) && (m.class_id === classId || m.to_class_id === classId)).map((m) => m.certificate_number).join(", ");
  const entered = (holderId: string) => own.movements.filter((m) => !m.voided_at && m.to_holder_id === holderId).map((m) => m.effective_on).sort()[0];
  const former = own.holders.filter((h) => !own.positions.some((p) => p.shareholder_id === h.id) && own.movements.some((m) => !m.voided_at && (m.to_holder_id === h.id || m.from_holder_id === h.id)));
  const left = (holderId: string) => own.movements.filter((m) => !m.voided_at && m.from_holder_id === holderId).map((m) => m.effective_on).sort().pop();
  return (
    <div>
      <p className="eyebrow">Register of members (section 169)</p>
      <h2>{ctx.entity.name}{ctx.entity.acn ? ` ACN ${acn(ctx.entity)}` : ""}</h2>
      <p className="small">As at {day(today())}</p>
      <table className="report-table wide">
        <thead><tr><th scope="col">Member</th><th scope="col">Address</th><th scope="col">Date entered</th><th scope="col">Class</th><th scope="col" className="num">Shares</th><th scope="col" className="num">Paid</th><th scope="col" className="num">Unpaid</th><th scope="col">Beneficial</th><th scope="col">Certificates</th></tr></thead>
        <tbody>
          {own.positions.map((p) => {
            const h = own.holders.find((x) => x.id === p.shareholder_id);
            return (
              <tr key={`${p.shareholder_id}-${p.class_id}`}>
                <th scope="row">{h?.name}</th><td>{h?.address ?? "Not recorded"}</td><td>{day(entered(p.shareholder_id))}</td>
                <td>{own.classes.find((c) => c.id === p.class_id)?.name}</td><td className="num">{fmt(p.shares)}</td><td className="num">{money(p.paid)}</td><td className="num">{money(p.unpaid)}</td>
                <td>{h?.is_beneficial ? "Yes" : `No: for ${h?.held_for}`}</td><td>{certs(p.shareholder_id, p.class_id)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {former.length > 0 && (
        <>
          <h3>Former members (last seven years)</h3>
          <table className="report-table wide">
            <thead><tr><th scope="col">Former member</th><th scope="col">Address</th><th scope="col">Ceased to be a member</th></tr></thead>
            <tbody>{former.map((h) => <tr key={h.id}><th scope="row">{h.name}</th><td>{h.address}</td><td>{day(left(h.id))}</td></tr>)}</tbody>
          </table>
        </>
      )}
    </div>
  );
}

export function RegisterOfOptions({ ctx }: { ctx: Ctx }) {
  const { own } = ctx;
  const rows = [
    ...own.grants.filter((g) => g.instrument !== "unit" && g.number - g.exercised - g.lapsed - (g.settled ?? 0) > 0).map((g) => ({
      key: g.id, name: g.holder_name, what: `${g.instrument}s (${own.plans.find((p) => p.id === g.plan_id)?.name ?? "plan"})`, granted: g.granted_on,
      number: g.number - g.exercised - g.lapsed - (g.settled ?? 0), price: g.exercise_price, expires: g.expires_on,
    })),
    ...own.convertibles.filter((c) => c.status === "outstanding" && (c.kind === "warrant" || c.kind === "investor_option")).map((c) => ({
      key: c.id, name: c.holder_name, what: c.kind === "warrant" ? "Warrants" : "Options", granted: c.issued_on, number: c.shares ?? 0, price: c.exercise_price, expires: c.expires_on,
    })),
  ];
  return (
    <div>
      <p className="eyebrow">Register of option holders (section 170)</p>
      <h2>{ctx.entity.name}{ctx.entity.acn ? ` ACN ${acn(ctx.entity)}` : ""}</h2>
      {rows.length === 0 ? <p>No options on issue.</p> : (
        <table className="report-table wide">
          <thead><tr><th scope="col">Holder</th><th scope="col">Options</th><th scope="col">Granted</th><th scope="col" className="num">Number</th><th scope="col" className="num">Exercise price</th><th scope="col">Expires</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.key}><th scope="row">{r.name}</th><td>{r.what}</td><td>{day(r.granted)}</td><td className="num">{fmt(r.number)}</td><td className="num">{money(r.price)}</td><td>{day(r.expires)}</td></tr>)}</tbody>
        </table>
      )}
      <p className="small muted">Phantom units settled in cash are not options and are not listed.</p>
    </div>
  );
}

export function RegisterOfOfficers({ ctx }: { ctx: Ctx }) {
  return (
    <div>
      <p className="eyebrow">Register of officeholders</p>
      <h2>{ctx.entity.name}{ctx.entity.acn ? ` ACN ${acn(ctx.entity)}` : ""}</h2>
      <table className="report-table wide">
        <thead><tr><th scope="col">Name</th><th scope="col">Role</th><th scope="col">Appointed</th><th scope="col">Ceased</th><th scope="col">Date and place of birth</th><th scope="col">Residential address</th></tr></thead>
        <tbody>
          {ctx.officers.map((o) => {
            const pd = ctx.details.find((x) => x.person_id === o.person.id);
            return (
              <tr key={o.id}>
                <th scope="row">{o.person.full_name}</th><td>{ROLE_LABELS[o.role]}</td><td>{o.appointed_on ? day(o.appointed_on) : "Not recorded"}</td><td>{day(o.ceased_on)}</td>
                <td>{pd?.date_of_birth ? `${day(pd.date_of_birth)}, ${pd.place_of_birth ?? "place not recorded"}` : "Not recorded"}</td><td>{pd?.residential_address ?? "Not recorded"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
