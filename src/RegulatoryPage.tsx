import { useCallback, useEffect, useState, type ReactNode } from "react";
import Attachments from "./Attachments";
import { today as todayIso } from "./authorities";
import { formatDay } from "./board";
import { has } from "./roles";
import {
  EFFECTIVE_CLASS, EFFECTIVE_LABELS, effective, loadRegulatory, saveCheck, saveProfile, STATUS_LABELS,
  type Answers, type Check, type Item, type Programme, type Question, type RegData, type Status,
} from "./regulatory";
import type { GroupData } from "./types";

const day = (iso: string | null | undefined) => (iso ? formatDay(`${iso.slice(0, 10)}T12:00:00`) : "");
export type PageContext = { data: RegData; answers: Answers; entityId: string | null; manage: boolean; busy: boolean; today: string; run: (work: () => Promise<unknown>, done: string) => Promise<boolean> };
type Props = {
  organisationId: string; role: string; userId: string; group: GroupData | null; onOpen: (tab: string) => void;
  programme: Programme; title: string; lead: ReactNode; questions: Question[]; items: Item[]; perEntity: boolean;
  /** Shown after the profile, for example the climate group or the contract register */
  extra?: (ctx: PageContext) => ReactNode;
};

// Remembered across visits, per programme
const chosen: Partial<Record<Programme, string>> = {};

/** A checklist of legal obligations, driven by a short profile, with evidence from the rest of the platform */
export default function RegulatoryPage({ organisationId, role, userId, group, onOpen, programme, title, lead, questions, items, perEntity, extra }: Props) {
  const manage = has(role, "owner", "admin", "secretary", "legal", "compliance");
  const [data, setData] = useState<RegData | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const entities = group?.entities ?? [];
  const [entityId, setEntityId] = useState<string | null>(perEntity ? chosen[programme] ?? entities[0]?.id ?? null : null);
  const t = todayIso();
  useEffect(() => {
    if (perEntity && !entityId && entities[0]) setEntityId(entities[0].id);
  }, [perEntity, entityId, entities]);

  const reload = useCallback(async () => {
    try {
      setData(await loadRegulatory(organisationId, programme));
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Could not load.");
    }
  }, [organisationId, programme]);
  useEffect(() => {
    void reload();
  }, [reload]);
  const run = async (work: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setProblem(null);
    setNotice(null);
    try {
      await work();
      await reload();
      setNotice(done);
      return true;
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "That did not save.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const header = (
    <>
      <p className="eyebrow">Risk and compliance</p>
      <h1>{title}</h1>
      <p className="lead">{lead}</p>
      {problem && <p className="error" role="alert">{problem}</p>}
      {notice && <p className="card note" role="status">{notice}</p>}
    </>
  );
  if (!data) return <>{header}<p className="muted">Loading…</p></>;
  if (!data.ready) return <>{header}<p className="card warning">Not set up yet: run migration 0052 in Supabase.</p></>;
  if (!data.allowed) return <>{header}<p className="muted">This is open to directors, the people who manage compliance, and auditors.</p></>;
  if (perEntity && entities.length === 0) return <>{header}<p className="muted">Add a company under Company Info first.</p></>;

  const profile = data.profiles.find((p) => p.entity_id === entityId);
  const answers = profile?.answers ?? {};
  const checks = new Map(data.checks.filter((c) => c.entity_id === entityId).map((c) => [c.item_key, c]));
  const rows = items.map((it) => {
    const applies = it.applies ? it.applies(answers) : true;
    const auto = applies !== false && it.auto ? it.auto(data.signals, answers) : null;
    return { it, applies, auto, eff: effective(checks.get(it.key), auto, applies, it.coming) };
  });
  const count = (s: keyof typeof EFFECTIVE_LABELS) => rows.filter((r) => r.eff.status === s).length;
  const ctx: PageContext = { data, answers, entityId, manage, busy, today: t, run };

  return (
    <>
      {header}
      {perEntity && entities.length > 1 && (
        <p className="row wrap">
          <label htmlFor={`${programme}-entity`} className="small">Company</label>
          <select id={`${programme}-entity`} value={entityId ?? ""} onChange={(e) => { chosen[programme] = e.target.value; setEntityId(e.target.value); }}>
            {entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </p>
      )}
      <ProfileForm key={`${programme}-${entityId}`} questions={questions} answers={answers} canEdit={manage} busy={busy} updated={profile ? true : false}
        onSave={(a) => run(() => saveProfile(organisationId, programme, entityId, profile, a), "Profile saved. The checklist below now reflects it.")} />
      {extra?.(ctx)}
      <dl className="facts">
        <div><dt>In place</dt><dd>{count("in_place")}</dd></div>
        <div><dt>Partly</dt><dd className={count("partly") ? "warning-text" : undefined}>{count("partly")}</dd></div>
        <div><dt>Gaps</dt><dd className={count("gap") ? "warning-text" : undefined}>{count("gap")}</dd></div>
        <div><dt>To assess</dt><dd className={count("not_assessed") + count("unknown_scope") ? "warning-text" : undefined}>{count("not_assessed") + count("unknown_scope")}</dd></div>
      </dl>
      <section className="card block">
        <h2>Checklist</h2>
        <p className="small muted">An item only shows as in place when someone has confirmed it and the records agree. Items marked Coming are not yet law.</p>
        <ul className="plain rows">
          {rows.map(({ it, applies, auto, eff }) => (
            <ItemRow key={it.key} item={it} applies={applies} auto={auto} eff={eff} check={checks.get(it.key)} people={data.people} canEdit={manage || checks.get(it.key)?.owner_user_id === userId} manage={manage} busy={busy} today={t} onOpen={onOpen}
              onSave={(v) => run(() => saveCheck(organisationId, programme, entityId, checks.get(it.key), it.key, v), "Saved.")} />
          ))}
        </ul>
      </section>
    </>
  );
}

function ProfileForm({ questions, answers, canEdit, busy, updated, onSave }: { questions: Question[]; answers: Answers; canEdit: boolean; busy: boolean; updated: boolean; onSave: (a: Answers) => Promise<boolean> }) {
  const [open, setOpen] = useState(!updated);
  const [v, setV] = useState<Answers>(answers);
  const answered = questions.filter((q) => v[q.key] !== undefined && v[q.key] !== null && v[q.key] !== "").length;
  return (
    <section className="card form block">
      <div className="row wrap">
        <h2 className="grow">Profile</h2>
        <span className={answered < questions.length ? "warning-text small" : "muted small"}>{answered} of {questions.length} answered</span>
        <button type="button" className="quiet" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Hide" : "Show"}</button>
      </div>
      {open && (
        <>
          <p className="small muted">These answers decide which items apply. Unanswered questions leave items to assess, never in place.</p>
          {questions.map((q) => (
            <div key={q.key} className="question">
              {q.kind === "number" || q.kind === "money" ? (
                <span className="field"><label htmlFor={`pq-${q.key}`}>{q.label}</label>
                  <input id={`pq-${q.key}`} type="number" min={0} step={q.kind === "money" ? "0.1" : "1"} disabled={!canEdit} value={(v[q.key] as number | null) ?? ""} onChange={(e) => setV({ ...v, [q.key]: e.target.value === "" ? null : Number(e.target.value) })} />
                </span>
              ) : (
                <fieldset className="plain-fieldset">
                  <legend>{q.label}</legend>
                  <span className="row wrap">
                    {(q.options ?? [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }]).map((o) => (
                      <label key={o.value} className="check"><input type="radio" name={`pq-${q.key}`} disabled={!canEdit} checked={v[q.key] === o.value} onChange={() => setV({ ...v, [q.key]: o.value })} /> {o.label}</label>
                    ))}
                  </span>
                </fieldset>
              )}
              {q.hint && <p className="small muted">{q.hint}</p>}
            </div>
          ))}
          {canEdit && <button type="button" disabled={busy} onClick={async () => { if (await onSave(v)) setOpen(false); }}>Save the profile</button>}
        </>
      )}
    </section>
  );
}

function ItemRow({ item: it, applies, auto, eff, check, people, canEdit, manage, busy, today: t, onOpen, onSave }: {
  item: Item; applies: boolean | null; auto: ReturnType<NonNullable<Item["auto"]>> | null; eff: ReturnType<typeof effective>; check: Check | undefined; people: RegData["people"];
  canEdit: boolean; manage: boolean; busy: boolean; today: string; onOpen: (tab: string) => void; onSave: (v: Pick<Check, "status" | "notes" | "evidence" | "owner_user_id" | "review_on">) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [d, setD] = useState({ status: check?.status ?? null, notes: check?.notes ?? null, evidence: check?.evidence ?? null, owner_user_id: check?.owner_user_id ?? null, review_on: check?.review_on ?? null });
  const who = (uid: string | null) => (uid ? people.find((p) => p.user_id === uid)?.full_name ?? "" : "");
  return (
    <li className={applies === false ? "muted" : undefined}>
      <div className="row wrap">
        <span className="grow">
          <strong>{it.label}</strong>
          <span className="small"><br />{it.hint}</span>
          <span className="muted small"><br />{it.law}</span>
        </span>
        <span className={EFFECTIVE_CLASS[eff.status]}><strong>{EFFECTIVE_LABELS[eff.status]}</strong></span>
        {canEdit && applies !== false && <button type="button" className="quiet" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Close" : check ? "Update" : "Assess"}</button>}
      </div>
      {auto && (
        <p className={`small ${auto.level === "ok" ? "muted" : "warning-text"}`}>
          From the records: {auto.text} {auto.tab && <button type="button" className="link-dark" onClick={() => onOpen(auto.tab!)}>Open</button>}
        </p>
      )}
      {eff.reason && applies !== false && <p className="small warning-text">{eff.reason}</p>}
      {check && (check.notes || check.evidence) && !open && (
        <p className="small">{check.notes}{check.evidence ? <><br /><span className="muted">Evidence: {check.evidence}</span></> : null}{check.owner_user_id ? <span className="muted"> · owner {who(check.owner_user_id)}</span> : null}{check.review_on ? <span className={check.review_on < t ? "warning-text" : "muted"}> · review {day(check.review_on)}</span> : null}</p>
      )}
      {open && (
        <div className="form block">
          <fieldset className="plain-fieldset">
            <legend>Status</legend>
            <span className="row wrap">
              {(Object.keys(STATUS_LABELS) as Status[]).map((s) => (
                <label key={s} className="check"><input type="radio" name={`st-${it.key}`} checked={d.status === s} onChange={() => setD({ ...d, status: s })} /> {STATUS_LABELS[s]}</label>
              ))}
            </span>
          </fieldset>
          <span className="field grow"><label htmlFor={`n-${it.key}`}>{d.status === "not_applicable" ? "Why it does not apply" : "How it is met, or what is missing"}</label><textarea id={`n-${it.key}`} rows={2} value={d.notes ?? ""} onChange={(e) => setD({ ...d, notes: e.target.value })} /></span>
          <span className="field grow"><label htmlFor={`e-${it.key}`}>Evidence</label><input id={`e-${it.key}`} value={d.evidence ?? ""} onChange={(e) => setD({ ...d, evidence: e.target.value })} /></span>
          <div className="row wrap">
            <span className="field"><label htmlFor={`o-${it.key}`}>Owner</label><select id={`o-${it.key}`} value={d.owner_user_id ?? ""} onChange={(e) => setD({ ...d, owner_user_id: e.target.value || null })}><option value="">No owner</option>{people.filter((p) => p.user_id).map((p) => <option key={p.user_id!} value={p.user_id!}>{p.full_name}</option>)}</select></span>
            <span className="field"><label htmlFor={`r-${it.key}`}>Review by</label><input id={`r-${it.key}`} type="date" value={d.review_on ?? ""} onChange={(e) => setD({ ...d, review_on: e.target.value || null })} /></span>
          </div>
          <button type="button" disabled={busy || !d.status || (d.status === "not_applicable" && (d.notes ?? "").trim().length < 5)} onClick={async () => { if (await onSave(d)) setOpen(false); }}>Save</button>
          {check && <Attachments subjectTable="compliance_checks" subjectId={check.id} canAttach={manage} label="Evidence files" />}
        </div>
      )}
    </li>
  );
}
