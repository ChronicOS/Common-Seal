import { useState, type FormEvent, type ReactNode } from "react";
import {
  applies,
  FIELD_LABELS,
  FIELD_ORDER,
  formatAbn,
  formatAcn,
  parseAbn,
  parseAcn,
  progress,
  type FieldKey,
  type FieldState,
} from "./checks";
import { addOfficeholder, addOwner, createEntity, setPrompt, updateEntity } from "./data";
import { FORM_LABELS, type Entity, type EntityForm, type GroupData } from "./types";

type Props = {
  organisationId: string;
  entity: Entity;
  data: GroupData;
  canEdit: boolean;
  reload: () => Promise<void>;
  onBack: () => void;
};

const NEW_OWNER = "__new__";

function formatDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });
}

function officerNames(data: GroupData, entityId: string, roles: string[]) {
  return data.officeholdings
    .filter((o) => o.entity_id === entityId && !o.ceased_on && roles.includes(o.role))
    .map((o) => o.person.full_name);
}

function displayValue(data: GroupData, entity: Entity, key: FieldKey, state: FieldState): string {
  if (state === "open") return "Not yet provided";
  if (state === "skipped") return "Skipped for now";
  if (state === "not_applicable") {
    if (key === "secretary") return "None";
    if (key === "parent") return "Top of the group";
    return "Not applicable";
  }
  switch (key) {
    case "legal_form":
      return FORM_LABELS[entity.legal_form!];
    case "acn":
      return formatAcn(entity.acn!);
    case "abn":
      return formatAbn(entity.abn!);
    case "incorporated_on":
      return formatDate(entity.incorporated_on!);
    case "registered_office":
      return entity.registered_office!;
    case "is_listed":
      return entity.is_listed ? "Yes" : "No";
    case "directors":
      return officerNames(data, entity.id, ["director", "chair"]).join(", ");
    case "secretary":
      return officerNames(data, entity.id, ["secretary"]).join(", ");
    case "parent":
      return data.relationships
        .filter((r) => r.child_entity_id === entity.id && !r.ends_on)
        .map((r) => {
          const owner = data.entities.find((e) => e.id === r.parent_entity_id)?.name ?? "Unknown entity";
          return r.ownership_pct === null ? owner : `${owner} (${Number(r.ownership_pct)}%)`;
        })
        .join(", ");
  }
}

function question(entity: Entity, key: FieldKey): string {
  const n = entity.name;
  switch (key) {
    case "legal_form":
      return `What kind of entity is ${n}?`;
    case "acn":
      return `What is the ACN for ${n}?`;
    case "abn":
      return `What is the ABN for ${n}?`;
    case "incorporated_on":
      return `When was ${n} registered?`;
    case "registered_office":
      return `Where is the registered office of ${n}?`;
    case "is_listed":
      return `Is ${n} listed on a securities exchange?`;
    case "directors":
      return `Who is a director of ${n}?`;
    case "secretary":
      return `Who is the company secretary of ${n}?`;
    case "parent":
      return `Is ${n} owned by another entity in your group?`;
  }
}

export default function EntityDetail({ organisationId, entity, data, canEdit, reload, onBack }: Props) {
  const { states, queue, answered, total } = progress(data, entity);
  const [chosen, setChosen] = useState<FieldKey | null>(null);
  const [passed, setPassed] = useState<FieldKey[]>([]);
  const [text, setText] = useState("");
  const [owner, setOwner] = useState("");
  const [pct, setPct] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const active: FieldKey | null = chosen ?? queue.find((k) => !passed.includes(k)) ?? null;
  const others = data.entities.filter((e) => e.id !== entity.id);

  function resetInputs() {
    setText("");
    setOwner("");
    setPct("");
    setError(null);
    setChosen(null);
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await reload();
      resetInputs();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!active) return;
    const value = text.trim();
    switch (active) {
      case "legal_form":
        if (!value) return setError("Choose a type.");
        return run(() => updateEntity(entity.id, { legal_form: value as EntityForm }));
      case "acn": {
        const acn = parseAcn(value);
        if (!acn) return setError("That is not a valid ACN. It should be nine digits; check for a typing error.");
        return run(() => updateEntity(entity.id, { acn }));
      }
      case "abn": {
        const abn = parseAbn(value);
        if (!abn) return setError("That is not a valid ABN. It should be eleven digits; check for a typing error.");
        return run(() => updateEntity(entity.id, { abn }));
      }
      case "incorporated_on":
        if (!value) return setError("Choose a date.");
        if (value > new Date().toISOString().slice(0, 10)) return setError("The date cannot be in the future.");
        return run(() => updateEntity(entity.id, { incorporated_on: value }));
      case "registered_office":
        if (value.length < 5) return setError("Enter the full address.");
        return run(() => updateEntity(entity.id, { registered_office: value }));
      case "directors":
        if (value.length < 2) return setError("Enter the director's full name.");
        return run(() => addOfficeholder(organisationId, entity.id, value, "director"));
      case "secretary":
        if (value.length < 2) return setError("Enter the secretary's full name.");
        return run(() => addOfficeholder(organisationId, entity.id, value, "secretary"));
      case "parent": {
        const share = pct.trim() === "" ? null : Number(pct);
        if (share !== null && !(share > 0 && share <= 100))
          return setError("Ownership must be more than 0 and at most 100 per cent.");
        if (owner === NEW_OWNER) {
          if (value.length < 2) return setError("Enter the owner's name.");
          return run(async () => {
            const created = await createEntity(organisationId, value);
            await addOwner(organisationId, entity.id, created.id, share);
          });
        }
        if (!owner) return setError("Choose the owner.");
        return run(() => addOwner(organisationId, entity.id, owner, share));
      }
    }
  }

  const answerListed = (isListed: boolean) =>
    run(async () => {
      await updateEntity(entity.id, { is_listed: isListed });
      await setPrompt(organisationId, entity.id, "is_listed", "done");
    });

  const markNotApplicable = (key: FieldKey) => run(() => setPrompt(organisationId, entity.id, key, "not_applicable"));

  const skip = (key: FieldKey) =>
    run(async () => {
      await setPrompt(organisationId, entity.id, key, "skipped");
      setPassed((p) => [...p, key]);
    });

  let fields: ReactNode = null;
  if (active === "legal_form") {
    fields = (
      <select id="answer" value={text} onChange={(e) => setText(e.target.value)}>
        <option value="">Choose…</option>
        {(Object.keys(FORM_LABELS) as EntityForm[]).map((form) => (
          <option key={form} value={form}>
            {FORM_LABELS[form]}
          </option>
        ))}
      </select>
    );
  } else if (active === "incorporated_on") {
    fields = <input id="answer" type="date" value={text} onChange={(e) => setText(e.target.value)} />;
  } else if (active === "parent") {
    fields = (
      <>
        <select id="answer" value={owner} onChange={(e) => setOwner(e.target.value)}>
          <option value="">Choose the owner…</option>
          {others.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
          <option value={NEW_OWNER}>An entity not added yet…</option>
        </select>
        {owner === NEW_OWNER && (
          <>
            <label htmlFor="owner-name">Owner's name</label>
            <input id="owner-name" value={text} onChange={(e) => setText(e.target.value)} />
          </>
        )}
        <label htmlFor="pct">Percentage owned (optional)</label>
        <input
          id="pct"
          className="short"
          inputMode="decimal"
          value={pct}
          onChange={(e) => setPct(e.target.value)}
        />
      </>
    );
  } else if (active && active !== "is_listed") {
    fields = (
      <input
        id="answer"
        value={text}
        inputMode={active === "acn" || active === "abn" ? "numeric" : undefined}
        autoComplete="off"
        onChange={(e) => setText(e.target.value)}
      />
    );
  }

  return (
    <>
      <button type="button" className="back" onClick={onBack}>
        ← Back to group
      </button>
      <p className="eyebrow">Entity</p>
      <h1>{entity.name}</h1>
      <p className="lead">
        {answered} of {total} details complete
      </p>

      {canEdit && active && (
        <form className="card form prompt" onSubmit={save}>
          <label htmlFor="answer" className="prompt-question">
            {question(entity, active)}
          </label>
          {active === "is_listed" ? (
            <div className="row">
              <button type="button" disabled={busy} onClick={() => void answerListed(true)}>
                Yes
              </button>
              <button type="button" disabled={busy} onClick={() => void answerListed(false)}>
                No
              </button>
            </div>
          ) : (
            <>
              {fields}
              <div className="row">
                <button type="submit" disabled={busy}>
                  {busy ? "Saving…" : "Save"}
                </button>
                {active === "secretary" && (
                  <button type="button" className="quiet" disabled={busy} onClick={() => void markNotApplicable(active)}>
                    It doesn't have one
                  </button>
                )}
                {active === "parent" && (
                  <button type="button" className="quiet" disabled={busy} onClick={() => void markNotApplicable(active)}>
                    No, it sits at the top
                  </button>
                )}
              </div>
            </>
          )}
          <button type="button" className="link-dark" disabled={busy} onClick={() => void skip(active)}>
            Skip for now
          </button>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </form>
      )}
      {canEdit && !active && queue.length > 0 && (
        <p className="card note" role="status">
          That's everything for now. {queue.length === 1 ? "One detail is" : `${queue.length} details are`} still
          to complete, and we'll remind you next time.
        </p>
      )}
      {queue.length === 0 && (
        <p className="card note" role="status">
          All details for this entity are complete.
        </p>
      )}

      <dl className="detail-list">
        {FIELD_ORDER.filter((key) => applies(entity, key)).map((key) => (
            <div key={key}>
              <dt>{FIELD_LABELS[key]}</dt>
              <dd className={states[key] === "complete" ? undefined : "muted"}>
                {displayValue(data, entity, key, states[key])}
              </dd>
              {canEdit && (
                <button
                  type="button"
                  className="link-dark"
                  aria-label={`${states[key] === "complete" ? "Change" : "Answer"} ${FIELD_LABELS[key]}`}
                  onClick={() => {
                    resetInputs();
                    setChosen(key);
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                >
                  {states[key] !== "complete"
                    ? "Answer"
                    : key === "directors" || key === "secretary" || key === "parent"
                      ? "Add another"
                      : "Change"}
                </button>
              )}
            </div>
        ))}
      </dl>
    </>
  );
}
