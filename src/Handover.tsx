import { useEffect, useState } from "react";
import { supabase } from "./supabase";

type Row = { area: string; moves: boolean; item_count: number; items: string[] };
type Person = { user_id: string; name: string; is_active: boolean };

/** Before someone's access is removed: show what they are responsible for, and move it to someone else in one step */
export default function Handover({ organisationId, person, people, busy, onDone, onCancel }: {
  organisationId: string; person: Person; people: Person[]; busy: boolean;
  onDone: (removeAccess: boolean, moved: number, to: string | null) => Promise<void>; onCancel: () => void;
}) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [to, setTo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  useEffect(() => {
    if (!supabase) return;
    void supabase.rpc("handover_summary", { p_org: organisationId, p_user: person.user_id }).then(({ data, error: e }) => {
      if (e) setError(/function|schema cache/i.test(e.message) ? "Run migration 0056 in Supabase to see what they are responsible for." : e.message);
      setRows((data ?? []) as Row[]);
    });
  }, [organisationId, person.user_id]);
  const moving = (rows ?? []).filter((r) => r.moves);
  const notMoving = (rows ?? []).filter((r) => !r.moves);
  const total = moving.reduce((n, r) => n + r.item_count, 0);
  const handOver = async (removeAccess: boolean) => {
    setWorking(true);
    setError(null);
    try {
      let moved = 0;
      if (total > 0) {
        if (!supabase) throw new Error("Not connected");
        const { data, error: e } = await supabase.rpc("hand_over", { p_org: organisationId, p_from: person.user_id, p_to: to });
        if (e) throw new Error(e.message);
        moved = Number(data ?? 0);
      }
      await onDone(removeAccess, moved, people.find((p) => p.user_id === to)?.name ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setWorking(false);
    }
  };
  return (
    <section className="card form block" aria-label="Hand over">
      <h2>Hand over {person.name}'s responsibilities</h2>
      {rows === null && !error ? <p className="muted">Checking what they are responsible for…</p> : null}
      {error && <p className="error" role="alert">{error}</p>}
      {rows && total === 0 && <p className="small">{person.name} is not responsible for anything that needs handing over.</p>}
      {moving.length > 0 && (
        <>
          <p className="small">These move to the person you choose. Their past records (what they decided, signed or reported) stay as they are.</p>
          <ul className="plain rows small">
            {moving.map((r) => <li key={r.area}><strong>{r.area}</strong> ({r.item_count})<br /><span className="muted">{r.items.join("; ")}{r.item_count > r.items.length ? "; …" : ""}</span></li>)}
          </ul>
          <span className="field"><label htmlFor="ho-to">Hand over to</label>
            <select id="ho-to" value={to} onChange={(e) => setTo(e.target.value)}>
              <option value="">Choose a person…</option>
              {people.filter((p) => p.is_active && p.user_id !== person.user_id).map((p) => <option key={p.user_id} value={p.user_id}>{p.name}</option>)}
            </select>
          </span>
        </>
      )}
      {notMoving.length > 0 && (
        <>
          <p className="small"><strong>Needs its own step</strong></p>
          <ul className="plain small">{notMoving.map((r) => <li key={r.area} className="warning-text">{r.area} ({r.item_count})</li>)}</ul>
        </>
      )}
      <div className="row wrap">
        {person.is_active && <button type="button" disabled={busy || working || rows === null || (total > 0 && !to)} onClick={() => void handOver(true)}>{total > 0 ? "Hand over and remove access" : "Remove access"}</button>}
        {total > 0 && <button type="button" className="quiet" disabled={busy || working || !to} onClick={() => void handOver(false)}>Hand over only (keep their access)</button>}
        {person.is_active && total > 0 && <button type="button" className="link-dark" disabled={busy || working} onClick={() => { if (window.confirm(`Remove ${person.name}'s access without handing over? Their responsibilities will be left without an owner.`)) void onDone(true, 0, null); }}>Remove access without handing over</button>}
        <button type="button" className="quiet" onClick={onCancel}>Cancel</button>
      </div>
    </section>
  );
}
