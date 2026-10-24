import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { formatDay } from "./board";
import type { InboxItem } from "./inbox";
import ActionCards from "./ActionCards";

/** Everything waiting on the signed-in person, across the platform. Common items can be done right here. */
export function ReminderChoice({ organisationId, userId }: { organisationId: string; userId: string }) {
  const [choice, setChoice] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!supabase) return;
    void supabase.from("memberships").select("reminder_emails").eq("organisation_id", organisationId).eq("user_id", userId).maybeSingle()
      .then(({ data, error }) => setChoice(error ? null : (data as { reminder_emails?: string } | null)?.reminder_emails ?? null));
  }, [organisationId, userId]);
  if (choice === null) return null;
  return (
    <p className="small row wrap">
      <label htmlFor="fy-emails">Reminder emails</label>
      <select id="fy-emails" value={choice} onChange={async (e) => {
        const v = e.target.value;
        setChoice(v);
        setSaved(false);
        const { error } = await supabase!.rpc("set_reminder_emails", { p_org: organisationId, p_choice: v });
        setSaved(!error);
      }}>
        <option value="when_needed">Only when something needs me (at most daily)</option>
        <option value="weekly">At most once a week</option>
        <option value="off">Off</option>
      </select>
      {saved && <span className="muted">Saved.</span>}
    </p>
  );
}

export default function ForYou({ items: all, onOpen, onChanged, organisationId, userId, role }: { items: InboxItem[] | null; onOpen: (tab: string) => void; onChanged?: () => void; organisationId?: string; userId?: string; role?: string }) {
  // Decisions are shown as cards above the list
  const decisions = all?.filter((i) => i.kind === "Decision").length ?? 0;
  const items = all ? all.filter((i) => i.kind !== "Decision") : null;
  const [doing, setDoing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const act = async (i: InboxItem) => {
    if (!i.action) return;
    setBusy(true);
    setProblem(null);
    try {
      await i.action.run(name.trim());
      setDone(`Done: ${i.title}.`);
      setDoing(null);
      setName("");
      onChanged?.();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <p className="eyebrow">Waiting on you</p>
      <h1>For you</h1>
      {done && <p className="card note" role="status">{done}</p>}
      {problem && <p className="error" role="alert">{problem}</p>}
      {organisationId && userId && role !== undefined && <ActionCards organisationId={organisationId} userId={userId} role={role} onOpen={onOpen} onChanged={onChanged} />}
      {items === null ? (
        <p className="lead">Loading…</p>
      ) : items.length === 0 ? (
        <p className="lead">{decisions ? "Nothing else is waiting on you." : "Nothing is waiting on you."}</p>
      ) : (
        <ul className="entity-list">
          {items.map((i) => (
            <li key={i.key} className="for-you-item">
              <div className="row wrap for-you-row">
                <button type="button" className="entity-row grow" onClick={() => onOpen(i.tab)}>
                  <span>
                    <span className="entity-name">{i.title}</span>
                    <br />
                    <span className="muted">
                      {i.kind}
                      {i.due ? ` · due ${formatDay(i.due)}` : ""}
                    </span>
                  </span>
                  {i.overdue && <span className="chip chip-alert">Overdue</span>}
                </button>
                {i.action && doing !== i.key && (
                  <button type="button" className="quiet" disabled={busy} onClick={() => (i.action!.needsName ? (setDoing(i.key), setName("")) : void act(i))}>{i.action.label}</button>
                )}
              </div>
              {i.action?.needsName && doing === i.key && (
                <div className="row wrap block">
                  <span className="field"><label htmlFor={`fy-${i.key}`}>Type your name to confirm</label><input id={`fy-${i.key}`} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></span>
                  <button type="button" disabled={busy || name.trim().length < 2} onClick={() => void act(i)}>{i.action.label}</button>
                  <button type="button" className="quiet" onClick={() => setDoing(null)}>Cancel</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="muted small">Common items can be done here. Anything else opens the right page.</p>
      {organisationId && userId && <ReminderChoice organisationId={organisationId} userId={userId} />}
    </>
  );
}
