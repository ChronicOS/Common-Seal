import { useEffect, useRef, useState } from "react";
import {
  discardFile,
  EMPTY_VALUES,
  readerStatus,
  readFile,
  readUrl,
  saveRead,
  stageFile,
  TFC_BY,
  valuesFrom,
  YES_NO,
  type ContractValues,
  type ReadFields,
  type Saved,
} from "./contractReading";
import { AGREEMENT_TYPES, FAMILY_ROLES, FUNCTIONS, previewName, shortParty, TYPE_GROUPS, VERDICT_LABEL } from "./contractFiling";

type Existing = { id: string; name: string; party: string; isMaster: boolean };

type Item = {
  key: string;
  kind: "file" | "url";
  label: string;
  entityId: string;
  signed: boolean;
  status: "reading" | "ready" | "failed" | "saving" | "saved";
  error?: string;
  documentId?: string;
  versionId?: string;
  extractionId?: string | null;
  duplicateOf?: string | null;
  fields?: ReadFields;
  values: ContractValues;
  saved?: Saved;
};

type Props = {
  organisationId: string;
  entities: { id: string; name: string }[];
  counterparties: { id: string; name: string }[];
  /** Contracts already on file, to link amendments and statements of work to their master */
  existing: Existing[];
  onSaved: () => Promise<void> | void;
  onOpen: (contractId: string) => void;
  onStartDueDiligence?: (partyId: string) => void;
};

/** The master agreement a document most likely belongs to: same other party, and the title it names */
function suggestParent(existing: Existing[], v: ContractValues) {
  if (!v.family_role) return "";
  const party = shortParty(v.counterparty).toLowerCase();
  const mine = existing.filter((c) => c.isMaster && shortParty(c.party).toLowerCase() === party);
  const words = (v.parent_title || "").toLowerCase().split(/\W+/).filter((w) => w.length > 3);
  const scored = mine.map((c) => ({ c, n: words.filter((w) => c.name.toLowerCase().includes(w)).length })).sort((a, b) => b.n - a.n);
  return scored[0]?.c.id ?? "";
}

const ACCEPT = ".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain";

/** Add contracts by dropping them in: Claude (in Australia) reads the details, a person checks them, then they are saved */
export default function ContractReader({ organisationId, entities, counterparties, existing, onSaved, onOpen, onStartDueDiligence }: Props) {
  const [entityId, setEntityId] = useState(entities[0]?.id ?? "");
  const [signed, setSigned] = useState(true);
  const [items, setItems] = useState<Item[]>([]);
  const [over, setOver] = useState(false);
  const [links, setLinks] = useState("");
  const [showLinks, setShowLinks] = useState(false);
  const [ready, setReady] = useState<boolean | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    void readerStatus().then(setReady);
  }, []);

  const patch = (key: string, p: Partial<Item>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...p } : i)));
  const entityName = (id: string) => entities.find((e) => e.id === id)?.name ?? "";

  async function addFiles(files: File[]) {
    setProblem(null);
    if (!entityId) return setProblem("Choose which of your companies is the party first.");
    const fresh: [Item, File][] = files.map((f) => [
      { key: `f${seq.current++}`, kind: "file", label: f.name, entityId, signed, status: "reading", values: { ...EMPTY_VALUES } },
      f,
    ]);
    setItems((list) => [...fresh.map(([i]) => i), ...list]);
    // Two at a time, so a batch moves quickly without overloading the reader
    const queue = [...fresh];
    const worker = async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        const [item, file] = next;
        let staged: Awaited<ReturnType<typeof stageFile>> | null = null;
        try {
          staged = await stageFile(organisationId, item.entityId, file);
          patch(item.key, { documentId: staged.document_id, versionId: staged.version_id, duplicateOf: staged.duplicate_of });
          if (ready === false) throw new Error("Reading is not switched on yet, so type the details in.");
          const r = await readFile(staged.version_id, item.entityId);
          const values = valuesFrom(r.fields);
          values.parent_contract_id = suggestParent(existing, values);
          patch(item.key, { status: "ready", fields: r.fields, extractionId: r.extraction_id, values });
        } catch (e) {
          patch(item.key, { status: "failed", error: e instanceof Error ? e.message : "The file could not be read." });
        }
      }
    };
    await Promise.all([worker(), worker()]);
  }

  async function addLinks() {
    setProblem(null);
    if (!entityId) return setProblem("Choose which of your companies is the party first.");
    const urls = [...new Set(links.split(/[\s,]+/).map((u) => u.trim()).filter(Boolean))];
    const bad = urls.filter((u) => !/^https?:\/\/[^\s/]+\.[^\s]+/i.test(u));
    if (!urls.length) return setProblem("Paste at least one link.");
    if (bad.length) return setProblem(`These are not web addresses (they should start with https://): ${bad.join(", ")}`);
    const fresh: Item[] = urls.map((u) => ({ key: `u${seq.current++}`, kind: "url", label: u, entityId, signed, status: "reading", values: { ...EMPTY_VALUES } }));
    setItems((list) => [...fresh, ...list]);
    setLinks("");
    setShowLinks(false);
    await Promise.all(
      fresh.map(async (item) => {
        try {
          if (ready === false) throw new Error("Reading is not switched on yet, so type the details in.");
          const r = await readUrl(organisationId, item.entityId, item.label);
          patch(item.key, { status: "ready", fields: r.fields, values: { ...valuesFrom(r.fields), agreement_type: "TERMS" } });
        } catch (e) {
          patch(item.key, { status: "failed", error: e instanceof Error ? e.message : "The page could not be read." });
        }
      }),
    );
  }

  async function save(item: Item) {
    if (item.values.start_date && item.values.end_date && item.values.end_date < item.values.start_date)
      return patch(item.key, { error: "The end date is before the start date." });
    patch(item.key, { status: "saving", error: undefined });
    try {
      const saved = await saveRead(organisationId, item.entityId, item.signed, item.values, item.kind === "url" ? { url: item.label } : { versionId: item.versionId, extractionId: item.extractionId });
      patch(item.key, { status: "saved", saved });
      await onSaved();
    } catch (e) {
      patch(item.key, { status: "ready", error: e instanceof Error ? e.message : "Could not save." });
    }
  }

  async function remove(item: Item) {
    setItems((list) => list.filter((i) => i.key !== item.key));
    if (item.documentId && item.status !== "saved") await discardFile(item.documentId).catch(() => undefined);
  }

  const pending = items.filter((i) => i.status !== "saved").length;

  return (
    <section className="card form reader">
      <h2>Add contracts</h2>
      <p className="muted small">
        Drop in one or more contracts and Claude reads the details for you, in Australia. Check each one, then save. Nothing is saved until you do.
      </p>
      <div className="row wrap">
        <span className="field">
          <label htmlFor="r-entity">Our company</label>
          <select id="r-entity" value={entityId} onChange={(e) => setEntityId(e.target.value)}>
            {entities.map((e) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
        </span>
        <label className="check reader-signed">
          <input type="checkbox" checked={signed} onChange={(e) => setSigned(e.target.checked)} /> Fully signed
        </label>
      </div>
      <p className="muted small">{signed ? "Saved as signed contracts, with reminders for notice and end dates." : "Not signed yet: each one is saved and sent for approval."}</p>

      <label
        className={over ? "drop-zone over" : "drop-zone"}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const files = [...(e.dataTransfer.files ?? [])];
          if (files.length) void addFiles(files);
        }}
      >
        <strong>Drop contracts here</strong>
        <span className="muted small"> or click to choose. PDF, Word (.docx) or text, up to 10 MB each.</span>
        <input
          type="file"
          hidden
          multiple
          accept={ACCEPT}
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = "";
            if (files.length) void addFiles(files);
          }}
        />
      </label>

      {showLinks ? (
        <>
          <label htmlFor="r-links">Links to online terms (one per line)</label>
          <textarea id="r-links" rows={3} placeholder="https://example.com/terms" value={links} onChange={(e) => setLinks(e.target.value)} />
          <div className="row">
            <button type="button" onClick={() => void addLinks()}>Read the links</button>
            <button type="button" className="quiet" onClick={() => setShowLinks(false)}>Cancel</button>
          </div>
        </>
      ) : (
        <button type="button" className="link-dark small" onClick={() => setShowLinks(true)}>
          Online terms instead? Paste links
        </button>
      )}
      {ready === false && (
        <p className="muted small">Reading is not switched on yet (set-up guide, Part 7). You can still drop files in and type the details.</p>
      )}
      {problem && <p className="error" role="alert">{problem}</p>}

      {items.length > 0 && (
        <div className="reader-items">
          {pending > 1 && <p className="muted small">{pending} to check.</p>}
          {items.map((item) => (
            <ReadCard
              key={item.key}
              item={item}
              entityName={entityName(item.entityId)}
              counterparties={counterparties}
              existing={existing}
              onStartDueDiligence={onStartDueDiligence}
              onChange={(values) => patch(item.key, { values })}
              onSigned={(s) => patch(item.key, { signed: s })}
              onTypeIn={() => patch(item.key, { status: "ready", error: undefined, extractionId: null, fields: undefined })}
              onSave={() => void save(item)}
              onRemove={() => void remove(item)}
              onOpen={() => item.saved && onOpen(item.saved.contract_id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function Quote({ f }: { f?: { quote: string | null } }) {
  if (!f?.quote) return null;
  return <span className="reader-quote">“{f.quote}”</span>;
}

function ReadCard({
  item,
  entityName,
  counterparties,
  existing,
  onStartDueDiligence,
  onChange,
  onSigned,
  onTypeIn,
  onSave,
  onRemove,
  onOpen,
}: {
  item: Item;
  entityName: string;
  counterparties: { id: string; name: string }[];
  existing: Existing[];
  onStartDueDiligence?: (partyId: string) => void;
  onChange: (v: ContractValues) => void;
  onSigned: (s: boolean) => void;
  onTypeIn: () => void;
  onSave: () => void;
  onRemove: () => void;
  onOpen: () => void;
}) {
  const v = item.values;
  const f = item.fields ?? {};
  const set = (k: keyof ContractValues) => (e: { target: { value: string } }) => onChange({ ...v, [k]: e.target.value });
  const id = (k: string) => `${item.key}-${k}`;
  const online = item.kind === "url";
  const known = counterparties.some((p) => p.name.toLowerCase() === v.counterparty.trim().toLowerCase());

  if (item.status === "reading")
    return (
      <div className="reader-item">
        <p><strong>{item.label}</strong></p>
        <p className="muted small" aria-live="polite">Reading… this usually takes 10 to 30 seconds.</p>
      </div>
    );

  if (item.status === "failed")
    return (
      <div className="reader-item">
        <p><strong>{item.label}</strong></p>
        <p className="error small" role="alert">{item.error}</p>
        <div className="row">
          <button type="button" onClick={onTypeIn}>Type the details in</button>
          <button type="button" className="quiet" onClick={onRemove}>Remove</button>
        </div>
      </div>
    );

  if (item.status === "saved" && item.saved) {
    const sc = item.saved.signatory_check;
    return (
      <div className="reader-item saved">
        <p>
          <strong>Saved as {item.saved.display_name ?? v.title}</strong> <span className="muted">· {item.signed ? "signed" : "sent for approval"}</span>{" "}
          <button type="button" className="link-dark small" onClick={onOpen}>Open</button>
        </p>
        {sc && (
          <p className="small">
            <span className={`chip verdict-${sc.verdict}`}>{VERDICT_LABEL[sc.verdict]}</span> {sc.summary}
          </p>
        )}
        {item.saved.needs_due_diligence && (
          <p className="small warning-text">
            {item.saved.new_counterparty ? `${v.counterparty} is new to your records` : `${v.counterparty} has had no due diligence`}.{" "}
            {item.signed ? "The contract is already signed, so start due diligence now." : "It cannot be approved until due diligence is done."}{" "}
            {onStartDueDiligence && (
              <button type="button" className="link-dark small" onClick={() => onStartDueDiligence(item.saved!.counterparty_id)}>Start due diligence</button>
            )}
          </p>
        )}
      </div>
    );
  }

  const canSave = v.counterparty.trim().length >= 2 && v.title.trim().length >= 2 && item.status !== "saving";
  return (
    <form
      className="reader-item"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSave) onSave();
      }}
    >
      <p>
        <strong>{item.label}</strong>
        {online && <span className="muted small"> · online terms, link kept with today’s date</span>}
        {!item.fields && <span className="muted small"> · typed in</span>}
      </p>
      {item.duplicateOf && <p className="small warning-text">This file is already on file as “{item.duplicateOf}”. Save it again only if that is right.</p>}
      {item.fields && <p className="muted small">Check each answer against the words it came from (in quotes), and fix anything that is wrong.</p>}

      <label htmlFor={id("party")}>{online ? "Business offering the terms" : "Other party"}</label>
      <input id={id("party")} list={id("parties")} autoComplete="off" value={v.counterparty} onChange={set("counterparty")} />
      <datalist id={id("parties")}>
        {counterparties.map((p) => <option key={p.id} value={p.name} />)}
      </datalist>
      <Quote f={f.counterparty} />
      {v.counterparty.trim().length >= 2 && !known && <span className="muted small">New to your records: it will be added.</span>}

      <label htmlFor={id("title")}>Title</label>
      <input id={id("title")} value={v.title} onChange={set("title")} />

      <fieldset className="reader-group">
        <legend>Filing</legend>
        <div className="row wrap">
          <span className="field">
            <label htmlFor={id("type")}>Type of agreement</label>
            <select id={id("type")} value={v.agreement_type} onChange={set("agreement_type")}>
              <option value="">Choose</option>
              {TYPE_GROUPS.map((g) => (
                <optgroup key={g} label={g}>
                  {AGREEMENT_TYPES.filter((t) => t.group === g).map((t) => <option key={t.code} value={t.code}>{t.code} · {t.label}</option>)}
                </optgroup>
              ))}
            </select>
          </span>
          <span className="field">
            <label htmlFor={id("fn")}>Business function</label>
            <select id={id("fn")} value={v.business_function} onChange={set("business_function")}>
              <option value="">Not set</option>
              {Object.entries(FUNCTIONS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </span>
        </div>
        {v.agreement_type === "OTH" && (
          <>
            <label htmlFor={id("oth")}>What kind (two or three words)</label>
            <input id={id("oth")} value={v.agreement_type_other} onChange={set("agreement_type_other")} />
          </>
        )}
        <Quote f={f.agreement_type} />
        {!online && (
          <>
            <div className="row wrap">
              <span className="field">
                <label htmlFor={id("fam")}>Part of another agreement?</label>
                <select id={id("fam")} value={v.family_role} onChange={(e) => onChange({ ...v, family_role: e.target.value, parent_contract_id: e.target.value ? v.parent_contract_id || suggestParent(existing, { ...v, family_role: e.target.value }) : "" })}>
                  <option value="">No, it stands alone</option>
                  {Object.entries(FAMILY_ROLES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </span>
              {v.family_role && (
                <span className="field">
                  <label htmlFor={id("parent")}>Master agreement</label>
                  <select id={id("parent")} value={v.parent_contract_id} onChange={set("parent_contract_id")}>
                    <option value="">Choose</option>
                    {existing.filter((c) => c.isMaster).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </span>
              )}
            </div>
            <Quote f={f.parent_title} />
            {v.family_role && !v.parent_contract_id && <span className="muted small">The master agreement is not on file yet: add it too, or save this on its own.</span>}
          </>
        )}
      </fieldset>

      {!online && (
        <fieldset className="reader-group">
          <legend>Value</legend>
          <div className="row wrap">
            <span className="field">
              <label htmlFor={id("val")}>Amount</label>
              <input id={id("val")} inputMode="decimal" placeholder="Leave blank if none" value={v.value} onChange={set("value")} />
            </span>
            <span className="field narrow">
              <label htmlFor={id("cur")}>Currency</label>
              <input id={id("cur")} maxLength={3} placeholder="AUD" value={v.currency} onChange={(e) => onChange({ ...v, currency: e.target.value.toUpperCase() })} />
            </span>
            <span className="field">
              <label htmlFor={id("basis")}>Covers</label>
              <input id={id("basis")} placeholder="e.g. total over the term, per year" value={v.value_basis} onChange={set("value_basis")} />
            </span>
          </div>
          <Quote f={f.value} />
        </fieldset>
      )}

      <label htmlFor={id("desc")}>What it is</label>
      <textarea id={id("desc")} rows={2} value={v.description} onChange={set("description")} />
      <Quote f={f.description} />
      <label htmlFor={id("purpose")}>What it is for</label>
      <textarea id={id("purpose")} rows={2} value={v.purpose} onChange={set("purpose")} />
      <Quote f={f.purpose} />

      {!online && (
        <>
          <div className="row wrap">
            <span className="field">
              <label htmlFor={id("start")}>Starts</label>
              <input id={id("start")} type="date" value={v.start_date} onChange={set("start_date")} />
            </span>
            <span className="field">
              <label htmlFor={id("end")}>Ends</label>
              <input id={id("end")} type="date" value={v.end_date} onChange={set("end_date")} />
            </span>
          </div>
          <Quote f={f.start_date} />
          <Quote f={f.end_date} />

          <fieldset className="reader-group">
            <legend>Ending it early by giving notice (termination for convenience)</legend>
            <div className="row wrap">
              <span className="field">
                <label htmlFor={id("tfc")}>Can a party end it by notice?</label>
                <select id={id("tfc")} value={v.tfc_available} onChange={set("tfc_available")}>
                  <option value="">Not checked</option>
                  {Object.entries(YES_NO).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </span>
              {v.tfc_available === "yes" && (
                <span className="field">
                  <label htmlFor={id("tfcby")}>Who can</label>
                  <select id={id("tfcby")} value={v.tfc_by} onChange={set("tfc_by")}>
                    <option value="">Choose</option>
                    {Object.entries(TFC_BY).map(([k, l]) => <option key={k} value={k}>{k === "us" ? `Us only (${entityName})` : l}</option>)}
                  </select>
                </span>
              )}
            </div>
            <Quote f={f.tfc_available} />
            {v.tfc_available === "yes" && (
              <>
                <div className="row wrap">
                  <span className="field">
                    <label htmlFor={id("tfcn")}>Notice needed</label>
                    <input id={id("tfcn")} placeholder="e.g. 30 days’ written notice" value={v.tfc_notice} onChange={set("tfc_notice")} />
                  </span>
                  <span className="field">
                    <label htmlFor={id("tfcf")}>Allowed from</label>
                    <input id={id("tfcf")} placeholder="e.g. any time" value={v.tfc_from} onChange={set("tfc_from")} />
                  </span>
                </div>
                <Quote f={f.tfc_notice} />
              </>
            )}
          </fieldset>

          <fieldset className="reader-group">
            <legend>Renewal</legend>
            <div className="row wrap">
              <span className="field">
                <label htmlFor={id("ar")}>Renews automatically?</label>
                <select id={id("ar")} value={v.auto_renews} onChange={set("auto_renews")}>
                  <option value="">Not checked</option>
                  {Object.entries(YES_NO).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </span>
              {v.auto_renews !== "no" && (
                <span className="field">
                  <label htmlFor={id("nb")}>Last day to give notice</label>
                  <input id={id("nb")} type="date" value={v.notice_by} onChange={set("notice_by")} />
                </span>
              )}
            </div>
            <Quote f={f.auto_renews} />
            {v.auto_renews === "yes" && (
              <>
                <label htmlFor={id("rt")}>Renewal rule</label>
                <input id={id("rt")} value={v.renewal_terms} onChange={set("renewal_terms")} />
                <Quote f={f.renewal_terms} />
              </>
            )}
          </fieldset>
        </>
      )}

      <label className="check">
        <input type="checkbox" checked={item.signed} onChange={(e) => onSigned(e.target.checked)} /> {online ? "Accepted (in force)" : "Fully signed"}
      </label>
      {item.signed && !online && (
        <fieldset className="reader-group">
          <legend>Who signed for us</legend>
          <label htmlFor={id("sig")}>Names and titles, separated by ;</label>
          <input id={id("sig")} placeholder="e.g. Jane Smith (Director); John Lee (Company Secretary)" value={v.our_signatories} onChange={set("our_signatories")} />
          <Quote f={f.our_signatories} />
          <label htmlFor={id("son")}>Date signed</label>
          <input id={id("son")} type="date" value={v.signed_on} onChange={set("signed_on")} />
          <span className="muted small">Checked against the Signing Delegation (and Financial Approval Matrix limits) in force on that date when you save.</span>
        </fieldset>
      )}
      <p className="small">
        Will be filed as{" "}
        <strong>
          {previewName({ type: v.agreement_type || (online ? "TERMS" : "OTH"), other: v.agreement_type_other, party: v.counterparty, start: online ? new Date().toLocaleDateString("en-CA") : v.start_date, signedOn: v.signed_on, role: v.family_role, parentName: v.parent_contract_id ? existing.find((c) => c.id === v.parent_contract_id)?.name : null, signed: item.signed })}
        </strong>
      </p>
      {item.error && <p className="error small" role="alert">{item.error}</p>}
      <div className="row">
        <button type="submit" disabled={!canSave}>{item.status === "saving" ? "Saving…" : "Save"}</button>
        <button type="button" className="quiet" onClick={onRemove}>Remove</button>
      </div>
    </form>
  );
}
