import { useCallback, useEffect, useMemo, useState } from "react";
import LawNote from "./LawNote";
import Attachments from "./Attachments";
import { today as todayIso } from "./authorities";
import { formatDay } from "./board";
import {
  addFromTemplate, CATEGORY_LABELS, completeObligation, FREQUENCY_LABELS, LIBRARY, loadCalendar, nextDate, saveObligation, toIcs,
  type CalendarData, type Category, type Frequency, type Item, type Obligation, type ObligationValues,
} from "./calendar";
import type { GroupData } from "./types";

type Props = { organisationId: string; organisationName: string; group: GroupData | null; canEdit: boolean; userId: string; onOpen: (tab: string) => void };
const day = (iso: string | null | undefined) => (iso ? formatDay(`${iso.slice(0, 10)}T12:00:00`) : "");
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Risk and compliance, Compliance calendar: every date in one place */
export default function ComplianceCalendar({ organisationId, organisationName, group, canEdit, userId, onOpen }: Props) {
  const t = todayIso();
  const [data, setData] = useState<CalendarData | null>(null);
  const [entity, setEntity] = useState<string>("all");
  const [area, setArea] = useState<string>("all");
  const [mine, setMine] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [mode, setMode] = useState<"calendar" | "library" | "manage">("calendar");
  const [act, setAct] = useState<{ key: string; kind: "done" | "na"; on: string; notes: string } | null>(null);
  const [evidenceFor, setEvidenceFor] = useState<string | null>(null);
  const [editing, setEditing] = useState<Obligation | "new" | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setData(await loadCalendar(organisationId, t));
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Could not load the calendar.");
    }
  }, [organisationId, t]);
  useEffect(() => {
    void reload();
  }, [reload]);

  const run = async (work: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setProblem(null);
    setNotice(null);
    try {
      await work();
      setAct(null);
      setEditing(null);
      await reload();
      setNotice(done);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "That did not save.");
    } finally {
      setBusy(false);
    }
  };

  const entities = group?.entities ?? [];
  const entityName = (id: string | null) => (id ? entities.find((e) => e.id === id)?.name ?? "" : "");
  const who = (uid: string | null) => (uid ? data?.people.find((p) => p.user_id === uid)?.full_name ?? "a member" : "");
  const filtered = useMemo(() => (data?.items ?? []).filter((i) =>
    (entity === "all" || i.entityId === entity || (entity !== "all" && i.entityId === null && i.obligation)) &&
    (area === "all" || i.area === area) && (!mine || i.ownerId === userId)), [data, entity, area, mine, userId]);
  const open = filtered.filter((i) => !i.done);
  const overdue = open.filter((i) => i.date < t);
  const soon = open.filter((i) => i.date >= t && i.date <= addDays(t, 30));
  const quarter = open.filter((i) => i.date > addDays(t, 30) && i.date <= addDays(t, 90));
  const later = open.filter((i) => i.date > addDays(t, 90));
  const done = filtered.filter((i) => i.done && i.date >= addDays(t, -365)).reverse();
  const areas = [...new Set((data?.items ?? []).map((i) => i.area))].sort();

  const header = (
    <>
      <p className="eyebrow">Risk and compliance</p>
      <h1>Compliance calendar</h1>
      <p className="lead">Every compliance date across the group in one place: ASIC filings, the annual review, tax and payroll, insurance, IP, facilities, contracts, sanctions, policies and more. Anything overdue goes into the next risk review.</p>
      <LawNote library="calendar" />
      {problem && <p className="error" role="alert">{problem}</p>}
      {notice && <p className="card note" role="status">{notice}</p>}
    </>
  );
  if (!data) return <>{header}<p className="muted">Loading…</p></>;

  const download = () => {
    const blob = new Blob([toIcs(open.filter((i) => i.date >= t), organisationName)], { type: "text/calendar" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${organisationName.replace(/[^A-Za-z0-9]+/g, "-")}-compliance.ics`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  const row = (i: Item) => {
    const o = i.obligation;
    const mayComplete = o && (canEdit || o.owner_user_id === userId);
    return (
      <li key={i.key}>
        <div className="row spread">
          <span>
            <span className={!i.done && i.date < t ? "warning-text" : undefined}><strong>{day(i.date)}</strong></span>{" "}
            {i.title}
            <span className="muted small"> · {i.area}{entityName(i.entityId) ? ` · ${entityName(i.entityId)}` : ""}{i.ownerId ? ` · ${who(i.ownerId)}` : o ? " · no owner" : ""}</span>
          </span>
          <span className="row">
            {o && !i.done && mayComplete && act?.key !== i.key && (
              <>
                <button type="button" className="link-dark small" onClick={() => setAct({ key: i.key, kind: "done", on: t, notes: "" })}>Done</button>
                <button type="button" className="link-dark small" onClick={() => setAct({ key: i.key, kind: "na", on: "", notes: "" })}>Not applicable</button>
              </>
            )}
            {o && i.completion && <button type="button" className="link-dark small" onClick={() => setEvidenceFor(evidenceFor === i.completion!.id ? null : i.completion!.id)}>Evidence</button>}
            {!o && <button type="button" className="link-dark small" onClick={() => onOpen(i.tab)}>Open</button>}
          </span>
        </div>
        {o && (o.due_rule || o.regulator) && <div className="small muted">{[o.due_rule, o.regulator, o.law].filter(Boolean).join(" · ")}</div>}
        {i.completion && <div className="small muted">{i.completion.not_applicable ? `Not applicable: ${i.completion.notes}` : `Done ${day(i.completion.done_on)}${i.completion.notes ? `: ${i.completion.notes}` : ""}`}</div>}
        {act?.key === i.key && o && (
          <span className="row wrap">
            {act.kind === "done" && <input aria-label="Date done" type="date" max={t} value={act.on} onChange={(e) => setAct({ ...act, on: e.target.value })} />}
            <input aria-label={act.kind === "na" ? "Why it does not apply" : "Notes (optional)"} placeholder={act.kind === "na" ? "Why it does not apply this time" : "Reference or notes (optional)"} value={act.notes} onChange={(e) => setAct({ ...act, notes: e.target.value })} />
            <button type="button" disabled={busy || (act.kind === "done" && !act.on) || (act.kind === "na" && act.notes.trim().length < 5)} onClick={() => run(async () => {
              const id = await completeObligation(organisationId, o.id, i.date, { done_on: act.kind === "done" ? act.on : null, not_applicable: act.kind === "na", notes: act.notes.trim() || null });
              setEvidenceFor(id);
            }, act.kind === "done" ? "Recorded as done. Attach evidence below if you have it." : "Recorded as not applicable.")}>Save</button>
            <button type="button" className="link-dark small" onClick={() => setAct(null)}>Cancel</button>
          </span>
        )}
        {i.completion && evidenceFor === i.completion.id && <Attachments subjectTable="obligation_completions" subjectId={i.completion.id} canAttach={Boolean(mayComplete)} label="Evidence" />}
      </li>
    );
  };
  const group_ = (title: string, list: Item[], warn = false) => list.length > 0 && (
    <section className={warn ? "card warning block" : "block"}>
      <h2>{title} <span className="muted small">({list.length})</span></h2>
      <ul className="plain rows">{list.map(row)}</ul>
    </section>
  );

  return (
    <>
      {header}
      <dl className="facts">
        <div><dt>Overdue</dt><dd className={overdue.length ? "warning-text" : undefined}>{overdue.length}</dd></div>
        <div><dt>Next 30 days</dt><dd>{soon.length}</dd></div>
        <div><dt>Next 90 days</dt><dd>{soon.length + quarter.length}</dd></div>
        <div><dt>Recurring obligations</dt><dd>{data.obligations.filter((o) => o.is_active).length}</dd></div>
      </dl>
      <span className="segmented block-gap" role="group" aria-label="Calendar views">
        {([["calendar", "Calendar"], ["library", "Add from the library"], ["manage", "Recurring obligations"]] as const).map(([id, label]) => (
          <button key={id} type="button" className={mode === id ? "on" : undefined} aria-pressed={mode === id} onClick={() => { setMode(id); setEditing(null); }}>{label}</button>
        ))}
      </span>
      {!data.ready && <p className="card warning">Recurring obligations are not set up yet: run migration 0048 in Supabase. Dates from the other modules are still shown.</p>}

      {mode === "calendar" && (
        <>
          <div className="row wrap block-gap">
            <span className="field">
              <label htmlFor="cal-entity">Company</label>
              <select id="cal-entity" value={entity} onChange={(e) => setEntity(e.target.value)}>
                <option value="all">All companies</option>
                {entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </span>
            <span className="field">
              <label htmlFor="cal-area">Area</label>
              <select id="cal-area" value={area} onChange={(e) => setArea(e.target.value)}>
                <option value="all">Everything</option>
                {areas.map((a) => <option key={a}>{a}</option>)}
              </select>
            </span>
            <label className="check"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Only mine</label>
            <button type="button" className="quiet" onClick={download}>Add to Outlook or Google Calendar (.ics)</button>
          </div>
          {open.length === 0 && <p className="muted">Nothing due{area !== "all" || entity !== "all" || mine ? " for this filter" : ""}.</p>}
          {group_("Overdue", overdue, true)}
          {group_("Next 30 days", soon)}
          {group_("31 to 90 days", quarter)}
          {group_("Later this year", later)}
          {done.length > 0 && (
            <p><button type="button" className="link-dark small" onClick={() => setShowDone(!showDone)}>{showDone ? "Hide" : "Show"} done in the last year ({done.length})</button></p>
          )}
          {showDone && group_("Done", done)}
          {data.missing.length > 0 && <p className="muted small">Not shown (not set up yet, or not visible to you): {data.missing.join(", ")}.</p>}
        </>
      )}

      {mode === "library" && (
        <Library entities={entities} people={data.people} canEdit={canEdit} busy={busy} today={t} existing={data.obligations}
          onAdd={(tpl, ent, owner) => run(() => addFromTemplate(organisationId, tpl, ent, owner, t), `${tpl.label} added. Check the dates match how you lodge.`)} />
      )}

      {mode === "manage" && (
        editing ? (
          <ObligationForm initial={editing === "new" ? null : editing} entities={entities} people={data.people} busy={busy} today={t}
            onSave={(v) => run(() => saveObligation(organisationId, editing === "new" ? null : editing.id, v), "Saved.")} onCancel={() => setEditing(null)} />
        ) : (
          <>
            {data.obligations.length === 0 ? <p className="muted">No recurring obligations yet. Add some from the library, or your own.</p> : (
              <ul className="plain rows">
                {data.obligations.map((o) => (
                  <li key={o.id} className={o.is_active ? undefined : "voided"}>
                    <div className="row spread">
                      <span><strong>{o.title}</strong> <span className="muted small">· {CATEGORY_LABELS[o.category]} · {FREQUENCY_LABELS[o.frequency]} from {day(o.first_due_on)}{entityName(o.entity_id) ? ` · ${entityName(o.entity_id)}` : " · whole group"} · {o.owner_user_id ? who(o.owner_user_id) : <span className="warning-text">no owner</span>}</span></span>
                      {canEdit && <button type="button" className="link-dark small" onClick={() => setEditing(o)}>Edit</button>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {canEdit && <p><button type="button" onClick={() => setEditing("new")}>Add your own obligation</button></p>}
          </>
        )
      )}
    </>
  );
}

function Library({ entities, people, canEdit, busy, today, existing, onAdd }: {
  entities: GroupData["entities"]; people: CalendarData["people"]; canEdit: boolean; busy: boolean; today: string; existing: Obligation[];
  onAdd: (tpl: (typeof LIBRARY)[number], entityId: string | null, ownerId: string | null) => void;
}) {
  const [ent, setEnt] = useState<string>("");
  const [owner, setOwner] = useState<string>("");
  return (
    <>
      <p className="muted small">Common Australian obligations, with the usual dates for a 30 June year. Each one is added as a recurring obligation you can edit. Check the dates against how you lodge (a tax agent often has later dates).</p>
      <div className="row wrap block-gap">
        <span className="field">
          <label htmlFor="lib-entity">For</label>
          <select id="lib-entity" value={ent} onChange={(e) => setEnt(e.target.value)}>
            <option value="">The whole group</option>
            {entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </span>
        <span className="field">
          <label htmlFor="lib-owner">Owner</label>
          <select id="lib-owner" value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="">Choose later</option>
            {people.filter((p) => p.user_id).map((p) => <option key={p.user_id!} value={p.user_id!}>{p.full_name}</option>)}
          </select>
        </span>
      </div>
      <ul className="plain rows">
        {LIBRARY.map((tpl) => {
          const added = existing.some((o) => o.template_key === tpl.key && (o.entity_id ?? "") === ent);
          return (
            <li key={tpl.key} className="row spread">
              <span>
                <strong>{tpl.label}</strong> <span className="muted small">· {tpl.rows.map((r) => r.due_rule).join("; ")}</span>
                <br /><span className="small muted">{tpl.help} Next: {day(nextDate(today, tpl.rows[0]))}.</span>
              </span>
              {canEdit && (added ? <span className="muted small">Added</span> : <button type="button" className="quiet" disabled={busy} onClick={() => onAdd(tpl, ent || null, owner || null)}>Add</button>)}
            </li>
          );
        })}
      </ul>
    </>
  );
}

function ObligationForm({ initial, entities, people, busy, today, onSave, onCancel }: {
  initial: Obligation | null; entities: GroupData["entities"]; people: CalendarData["people"]; busy: boolean; today: string; onSave: (v: ObligationValues) => void; onCancel: () => void;
}) {
  const [v, setV] = useState<ObligationValues>(initial ? (({ id: _id, ...r }) => r)(initial) : {
    entity_id: null, title: "", category: "other", regulator: null, law: null, frequency: "annually", first_due_on: today, ends_on: null, due_rule: null, owner_user_id: null, template_key: null, notes: null, is_active: true,
  });
  const set = (p: Partial<ObligationValues>) => setV({ ...v, ...p });
  const [missing, setMissing] = useState<string | null>(null);
  const field = (id: string, label: string, value: string | null, on: (x: string) => void, type = "text", wide = false, placeholder?: string) => (
    <span className={wide ? "field grow" : "field"}>
      <label htmlFor={id}>{label}</label>
      <input id={id} type={type} placeholder={placeholder} value={value ?? ""} onChange={(e) => on(e.target.value)} />
    </span>
  );
  return (
    <div className="card form">
      <h2>{initial ? initial.title : "New recurring obligation"}</h2>
      <div className="row wrap">
        {field("ob-title", "What has to be done", v.title, (x) => set({ title: x }), "text", true)}
        <span className="field">
          <label htmlFor="ob-cat">Area</label>
          <select id="ob-cat" value={v.category} onChange={(e) => set({ category: e.target.value as Category })}>
            {Object.entries(CATEGORY_LABELS).map(([id, l]) => <option key={id} value={id}>{l}</option>)}
          </select>
        </span>
      </div>
      <div className="row wrap">
        <span className="field">
          <label htmlFor="ob-freq">How often</label>
          <select id="ob-freq" value={v.frequency} onChange={(e) => set({ frequency: e.target.value as Frequency })}>
            {Object.entries(FREQUENCY_LABELS).map(([id, l]) => <option key={id} value={id}>{l}</option>)}
          </select>
        </span>
        {field("ob-first", v.frequency === "once" ? "Due on" : "First due on", v.first_due_on, (x) => set({ first_due_on: x }), "date")}
        {v.frequency !== "once" && field("ob-ends", "Ends (optional)", v.ends_on, (x) => set({ ends_on: x || null }), "date")}
        {field("ob-rule", "Due date in words", v.due_rule, (x) => set({ due_rule: x }), "text", true, "28 days after each quarter")}
      </div>
      <div className="row wrap">
        {field("ob-reg", "Regulator", v.regulator, (x) => set({ regulator: x }))}
        {field("ob-law", "Law or rule", v.law, (x) => set({ law: x }), "text", true)}
      </div>
      <div className="row wrap">
        <span className="field">
          <label htmlFor="ob-ent">For</label>
          <select id="ob-ent" value={v.entity_id ?? ""} onChange={(e) => set({ entity_id: e.target.value || null })}>
            <option value="">The whole group</option>
            {entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </span>
        <span className="field">
          <label htmlFor="ob-owner">Owner</label>
          <select id="ob-owner" value={v.owner_user_id ?? ""} onChange={(e) => set({ owner_user_id: e.target.value || null })}>
            <option value="">No owner yet</option>
            {people.filter((p) => p.user_id).map((p) => <option key={p.user_id!} value={p.user_id!}>{p.full_name}</option>)}
          </select>
        </span>
        {initial && <label className="check"><input type="checkbox" checked={v.is_active} onChange={(e) => set({ is_active: e.target.checked })} /> Still applies</label>}
      </div>
      {missing && <p className="error">{missing}</p>}
      <div className="row">
        <button type="button" disabled={busy} onClick={() => (v.title.trim().length < 3 ? setMissing("Say what has to be done.") : !v.first_due_on ? setMissing("Give the first due date.") : onSave(v))}>Save</button>
        <button type="button" className="quiet" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
