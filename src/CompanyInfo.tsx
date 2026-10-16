import type { ReactNode } from "react";
import { applies, FIELD_LABELS, progress, type FieldKey } from "./checks";
import { displayValue } from "./EntityDetail";
import type { GroupData, OfficeRole } from "./types";

const DETAILS: FieldKey[] = ["legal_form", "acn", "abn", "incorporated_on", "registered_office", "is_listed"];
const OFFICES: { roles: OfficeRole[]; label: string }[] = [
  { roles: ["chair"], label: "Chair" },
  { roles: ["director"], label: "Directors" },
  { roles: ["alternate_director"], label: "Alternate directors" },
  { roles: ["secretary"], label: "Company secretary" },
  { roles: ["public_officer"], label: "Public officer" },
];
const share = (pct: number | null) => (pct === null ? "" : ` (${Number(pct)}%)`);

/** Every company in the group on one page: details, officers and ownership. Changes are made on the company's own page. */
export default function CompanyInfo({ data, canEdit, onOpen, addSlot }: { data: GroupData; canEdit: boolean; onOpen: (entityId: string) => void; addSlot?: ReactNode }) {
  const nameOf = (id: string) => data.entities.find((e) => e.id === id)?.name ?? "Unknown entity";
  return (
    <>
      <p className="eyebrow">Company</p>
      <h1>Company Info</h1>
      <p className="lead">
        {data.entities.length === 0 ? "No companies yet. Add the first one below." : `${data.entities.length} ${data.entities.length === 1 ? "company" : "companies"} in the group.`}
      </p>
      {addSlot}
      {data.entities.length > 1 && (
        <p className="muted">
          Jump to:{" "}
          {data.entities.map((e, n) => (
            <span key={e.id}>
              {n > 0 ? " · " : ""}
              <a className="link-dark" href={`#company-${e.id}`}>
                {e.name}
              </a>
            </span>
          ))}
        </p>
      )}
      {data.entities.map((entity) => {
        const p = progress(data, entity);
        const officers = data.officeholdings.filter((o) => o.entity_id === entity.id && !o.ceased_on);
        const parents = data.relationships.filter((r) => r.child_entity_id === entity.id && !r.ends_on);
        const children = data.relationships.filter((r) => r.parent_entity_id === entity.id && !r.ends_on);
        const top = p.states.parent === "not_applicable";
        return (
          <section key={entity.id} id={`company-${entity.id}`} className="card company">
            <div className="row spread">
              <h2>{entity.name}</h2>
              <button type="button" className="quiet" aria-label={`${canEdit ? "Change" : "Open"} ${entity.name}`} onClick={() => onOpen(entity.id)}>
                {canEdit ? "Change" : "Open"}
              </button>
            </div>
            {p.queue.length > 0 && (
              <p className="warning-text">
                {p.answered} of {p.total} details complete. Anything not yet provided is shown as such, not assumed.
              </p>
            )}

            <h3>Details</h3>
            <dl className="detail-list compact">
              {DETAILS.filter((key) => applies(entity, key)).map((key) => (
                <div key={key}>
                  <dt>{FIELD_LABELS[key]}</dt>
                  <dd className={p.states[key] === "complete" ? undefined : "muted"}>{displayValue(data, entity, key, p.states[key])}</dd>
                </div>
              ))}
            </dl>

            <h3>Company officers</h3>
            {officers.length === 0 ? (
              <p className="muted">{p.states.directors === "skipped" ? "Skipped for now" : "Not yet provided"}</p>
            ) : (
              <dl className="detail-list compact">
                {OFFICES.map((office) => {
                  const held = officers.filter((o) => office.roles.includes(o.role));
                  const none = office.label === "Company secretary" && p.states.secretary === "not_applicable";
                  if (held.length === 0 && !none && office.label !== "Directors" && office.label !== "Company secretary") return null;
                  return (
                    <div key={office.label}>
                      <dt>{office.label}</dt>
                      <dd className={held.length ? undefined : "muted"}>{held.length ? held.map((o) => o.person.full_name).join(", ") : none ? "None" : "Not yet provided"}</dd>
                    </div>
                  );
                })}
              </dl>
            )}

            <h3>Ownership</h3>
            <dl className="detail-list compact">
              <div>
                <dt>Owned by</dt>
                <dd className={parents.length ? undefined : "muted"}>
                  {parents.length ? parents.map((r) => `${nameOf(r.parent_entity_id)}${share(r.ownership_pct)}`).join(", ") : top ? "Top of the group" : "Not yet provided"}
                </dd>
              </div>
              <div>
                <dt>Owns</dt>
                <dd className={children.length ? undefined : "muted"}>
                  {children.length ? children.map((r) => `${nameOf(r.child_entity_id)}${share(r.ownership_pct)}`).join(", ") : "No companies recorded"}
                </dd>
              </div>
            </dl>
          </section>
        );
      })}
    </>
  );
}
