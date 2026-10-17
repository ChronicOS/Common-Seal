import { useState } from "react";
import Attachments from "./Attachments";
import { formatDay } from "./board";
import { CLIMATE_ITEMS, CLIMATE_QUESTIONS, climateGroup, CONSUMER_ITEMS, CONSUMER_QUESTIONS, EMPLOYMENT_ITEMS, EMPLOYMENT_QUESTIONS } from "./regLibraries";
import RegulatoryPage, { type PageContext } from "./RegulatoryPage";
import { saveContract, UCT_TERMS, type Finding, type StandardContract, type StandardContractValues } from "./regulatory";
import type { GroupData } from "./types";

type Props = { organisationId: string; role: string; userId: string; group: GroupData | null; onOpen: (tab: string) => void };
const day = (iso: string | null | undefined) => (iso ? formatDay(`${iso.slice(0, 10)}T12:00:00`) : "");

/** Risk and compliance, Employment law */
export function EmploymentLaw(p: Props) {
  return (
    <RegulatoryPage {...p} programme="employment" title="Employment law" perEntity questions={EMPLOYMENT_QUESTIONS} items={EMPLOYMENT_ITEMS}
      lead="The Fair Work and related obligations for each employing company: what applies on its workforce profile, whether it is in place, and the evidence. Recent changes include the right to disconnect, the employee choice path for casuals, limits on fixed-term contracts and the criminal offence of wage theft." />
  );
}

/** Risk and compliance, Consumer law */
export function ConsumerLaw(p: Props) {
  return (
    <RegulatoryPage {...p} programme="consumer" title="Consumer law" perEntity={false} questions={CONSUMER_QUESTIONS} items={CONSUMER_ITEMS}
      lead="Australian Consumer Law obligations for the group, and a register of your standard form contracts reviewed for unfair terms. Since 9 November 2023 an unfair term in a standard form consumer or small business contract can attract a penalty, not just be void."
      extra={(ctx) => <ContractRegister organisationId={p.organisationId} ctx={ctx} group={p.group} userId={p.userId} />} />
  );
}

/** Risk and compliance, Climate reporting */
export function ClimateReporting(p: Props) {
  return (
    <RegulatoryPage {...p} programme="climate" title="Climate reporting" perEntity questions={CLIMATE_QUESTIONS} items={CLIMATE_ITEMS}
      lead="Mandatory climate-related financial disclosures in the annual sustainability report (Corporations Act Chapter 2M, AASB S2). Work out which group each company falls in and when it must first report, then track readiness."
      extra={(ctx) => <ClimateGroupCard ctx={ctx} />} />
  );
}

function ClimateGroupCard({ ctx }: { ctx: PageContext }) {
  const g = climateGroup(ctx.answers);
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const fy = g.firstYear ? new Date(`${g.firstYear}T12:00:00`) : null;
  const fyEnd = fy ? new Date(fy.getFullYear() + 1, fy.getMonth(), fy.getDate() - 1, 12) : null;
  return (
    <section className={g.group ? "card warning block" : "card block"}>
      <h2>{g.group ? `Group ${g.group}` : g.known ? "Not required on these figures" : "Group not yet known"}</h2>
      <p className="small">{g.why}</p>
      {fy && fyEnd && (
        <p><strong>First report: for the financial year {day(iso(fy))} to {day(iso(fyEnd))}</strong>, in the annual report for that year.</p>
      )}
      <p className="small muted">Group 1 from years starting 1 January 2025, Group 2 from 1 July 2026, Group 3 from 1 July 2027. Figures are for the company and the entities it controls, at the end of the financial year.</p>
    </section>
  );
}

const USED_WITH: Record<StandardContract["used_with"], string> = { consumers: "Consumers", small_business: "Small businesses", both: "Consumers and small businesses", neither: "Neither (larger businesses only)" };
const KINDS: Record<StandardContract["kind"], string> = { customer: "Customer terms", supplier: "Supplier terms", distributor: "Distributor or reseller", licence: "Licence", subscription: "Subscription", website: "Website terms", other: "Other" };
const FINDINGS: Record<Finding, string> = { ok: "Fine", risk: "Risk: fix", fixed: "Fixed", na: "Not in it" };

function ContractRegister({ organisationId, ctx, group, userId }: { organisationId: string; ctx: PageContext; group: GroupData | null; userId: string }) {
  const [editing, setEditing] = useState<StandardContract | "new" | null>(null);
  const list = ctx.data.contracts;
  const who = (uid: string | null) => (uid ? ctx.data.people.find((p) => p.user_id === uid)?.full_name ?? "" : "");
  if (editing) {
    return <ContractForm initial={editing === "new" ? null : editing} people={ctx.data.people} group={group} canEdit={ctx.manage || (editing !== "new" && editing.owner_user_id === userId)} busy={ctx.busy} today={ctx.today}
      onCancel={() => setEditing(null)} onSave={async (v) => { if (await ctx.run(() => saveContract(organisationId, editing === "new" ? null : editing.id, v), "Contract saved.")) setEditing(null); }} />;
  }
  return (
    <section className="card block">
      <h2>Standard form contracts</h2>
      {list.length === 0 ? <p className="muted small">None recorded. Start with your customer terms, website terms and any supplier or distributor terms you issue on a take-it-or-leave-it basis.</p> : (
        <div className="table-scroll">
          <table className="report-table wide">
            <thead><tr><th scope="col">Contract</th><th scope="col">Used with</th><th scope="col">Unfair terms review</th><th scope="col">Owner</th></tr></thead>
            <tbody>
              {list.map((c) => {
                const risky = Object.values(c.findings).filter((f) => f === "risk").length;
                const fixed = Object.values(c.findings).filter((f) => f === "fixed").length;
                const overdue = c.next_review_on && c.next_review_on < ctx.today;
                return (
                  <tr key={c.id} className={c.status === "retired" ? "muted" : undefined}>
                    <th scope="row"><button type="button" className="link-dark" onClick={() => setEditing(c)}>{c.name}</button><span className="muted small"><br />{KINDS[c.kind]}{c.version ? ` · ${c.version}` : ""}</span></th>
                    <td>{USED_WITH[c.used_with]}</td>
                    <td className={c.used_with !== "neither" && (risky || !c.last_reviewed_on || overdue) ? "warning-text" : undefined}>
                      {!c.last_reviewed_on ? "Not reviewed" : risky ? `${risky} term${risky === 1 ? "" : "s"} to fix` : "No terms outstanding"}
                      <span className="muted small">{c.last_reviewed_on ? <><br />Reviewed {day(c.last_reviewed_on)}{fixed ? `, ${fixed} fixed` : ""}</> : null}{c.next_review_on ? <><br />Next {day(c.next_review_on)}</> : null}</span>
                    </td>
                    <td>{who(c.owner_user_id) || <span className="warning-text">None</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {ctx.manage && <p className="block"><button type="button" onClick={() => setEditing("new")}>Add a standard form contract</button></p>}
    </section>
  );
}

function ContractForm({ initial, people, group, canEdit, busy, today: t, onSave, onCancel }: { initial: StandardContract | null; people: PageContext["data"]["people"]; group: GroupData | null; canEdit: boolean; busy: boolean; today: string; onSave: (v: StandardContractValues) => void; onCancel: () => void }) {
  const [v, setV] = useState<StandardContractValues>(initial ? (({ id: _id, ...r }) => r)(initial) : {
    entity_id: null, name: "", kind: "customer", used_with: "both", version: null, findings: {}, notes: null, owner_user_id: null, last_reviewed_on: null, next_review_on: null, status: "current",
  });
  const set = (p: Partial<StandardContractValues>) => setV({ ...v, ...p });
  const all = UCT_TERMS.every((u) => v.findings[u.key]);
  return (
    <section className="card form block">
      <h2>{initial ? initial.name : "New standard form contract"}</h2>
      <div className="row wrap">
        <span className="field grow"><label htmlFor="sf-name">Name</label><input id="sf-name" disabled={!canEdit} value={v.name} onChange={(e) => set({ name: e.target.value })} placeholder="Online store terms of sale" /></span>
        <span className="field"><label htmlFor="sf-kind">Kind</label><select id="sf-kind" disabled={!canEdit} value={v.kind} onChange={(e) => set({ kind: e.target.value as StandardContract["kind"] })}>{Object.entries(KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></span>
        <span className="field"><label htmlFor="sf-ver">Version</label><input id="sf-ver" disabled={!canEdit} value={v.version ?? ""} onChange={(e) => set({ version: e.target.value })} /></span>
      </div>
      <div className="row wrap">
        <span className="field"><label htmlFor="sf-with">Used with</label><select id="sf-with" disabled={!canEdit} value={v.used_with} onChange={(e) => set({ used_with: e.target.value as StandardContract["used_with"] })}>{Object.entries(USED_WITH).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></span>
        {(group?.entities.length ?? 0) > 1 && <span className="field"><label htmlFor="sf-ent">Company</label><select id="sf-ent" disabled={!canEdit} value={v.entity_id ?? ""} onChange={(e) => set({ entity_id: e.target.value || null })}><option value="">All</option>{group!.entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></span>}
      </div>
      {v.used_with === "neither" && <p className="small muted">The unfair contract terms law protects consumers and small businesses (fewer than 100 employees or turnover under $10 million). A review is still useful, but these terms will not be flagged.</p>}
      <fieldset className="plain-fieldset">
        <legend>Review each kind of term</legend>
        <div className="table-scroll">
          <table className="report-table">
            <tbody>
              {UCT_TERMS.map((u) => (
                <tr key={u.key}>
                  <th scope="row" className="small">{u.label}{u.hint ? <span className="muted"><br />{u.hint}</span> : null}</th>
                  <td>
                    <span className="row wrap">
                      {(Object.keys(FINDINGS) as Finding[]).map((f) => (
                        <label key={f} className="check small"><input type="radio" name={`f-${u.key}`} disabled={!canEdit} checked={v.findings[u.key] === f} onChange={() => set({ findings: { ...v.findings, [u.key]: f } })} /> {FINDINGS[f]}</label>
                      ))}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </fieldset>
      <span className="field grow"><label htmlFor="sf-notes">Notes and changes made</label><textarea id="sf-notes" rows={2} disabled={!canEdit} value={v.notes ?? ""} onChange={(e) => set({ notes: e.target.value })} /></span>
      <div className="row wrap">
        <span className="field"><label htmlFor="sf-rev">Reviewed on</label><input id="sf-rev" type="date" max={t} disabled={!canEdit} value={v.last_reviewed_on ?? ""} onChange={(e) => set({ last_reviewed_on: e.target.value || null })} /></span>
        <span className="field"><label htmlFor="sf-next">Next review</label><input id="sf-next" type="date" disabled={!canEdit} value={v.next_review_on ?? ""} onChange={(e) => set({ next_review_on: e.target.value || null })} /></span>
        <span className="field"><label htmlFor="sf-owner">Owner</label><select id="sf-owner" disabled={!canEdit} value={v.owner_user_id ?? ""} onChange={(e) => set({ owner_user_id: e.target.value || null })}><option value="">No owner</option>{people.filter((p) => p.user_id).map((p) => <option key={p.user_id!} value={p.user_id!}>{p.full_name}</option>)}</select></span>
        {initial && <label className="check"><input type="checkbox" disabled={!canEdit} checked={v.status === "retired"} onChange={(e) => set({ status: e.target.checked ? "retired" : "current" })} /> No longer used</label>}
      </div>
      {canEdit && v.last_reviewed_on && !all && <p className="small warning-text">Mark every kind of term before recording the review as done.</p>}
      <div className="row">
        {canEdit && <button type="button" disabled={busy || v.name.trim().length < 2 || (!!v.last_reviewed_on && !all)} onClick={() => onSave(v)}>Save</button>}
        <button type="button" className="quiet" onClick={onCancel}>{canEdit ? "Cancel" : "Back"}</button>
      </div>
      {initial && <Attachments subjectTable="standard_form_contracts" subjectId={initial.id} canAttach={canEdit} label="The contract and marked-up review" />}
    </section>
  );
}
