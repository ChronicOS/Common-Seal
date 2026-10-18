import { useState } from "react";
import { ReminderChoice } from "./ForYou";
import { setTier } from "./register";
import { has, roleLabels } from "./roles";
import { supabase } from "./supabase";
import { TIERS, tierName, type Tier } from "./tiers";
import type { Organisation } from "./types";

/** Settings → Account settings: the organisation, your own settings, and the tiers */
export default function AccountSettings({ organisation, role, userId, onPassword }: { organisation: Organisation; role: string; userId: string; onPassword: () => void }) {
  const admin = has(role, "owner", "admin");
  const [name, setName] = useState(organisation.name);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const current = organisation.tier as Tier;
  const order: Tier[] = ["small", "medium", "large"];
  const run = async (work: () => Promise<void>, done: string, reload = false) => {
    setBusy(true);
    setProblem(null);
    setNotice(null);
    try {
      await work();
      if (reload) window.location.reload();
      else setNotice(done);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "That did not save.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <p className="eyebrow">Settings</p>
      <h1>Account settings</h1>
      {problem && <p className="error" role="alert">{problem}</p>}
      {notice && <p className="card note" role="status">{notice}</p>}

      <section className="card form block">
        <h2>Organisation</h2>
        <div className="row wrap">
          <span className="field grow"><label htmlFor="acc-name">Name</label><input id="acc-name" disabled={!admin} value={name} onChange={(e) => setName(e.target.value)} /></span>
          {admin && name.trim() !== organisation.name && (
            <button type="button" disabled={busy || name.trim().length < 2} onClick={() => run(async () => {
              const { error } = await supabase!.from("organisations").update({ name: name.trim() }).eq("id", organisation.id);
              if (error) throw new Error(error.message);
            }, "Saved.", true)}>Save</button>
          )}
        </div>
        <dl className="detail-list compact">
          <div><dt>Tier</dt><dd>{tierName(current)}</dd></div>
          <div><dt>Where your data is kept</dt><dd>Sydney, Australia{organisation.data_region ? ` (${organisation.data_region})` : ""}. This cannot be changed.</dd></div>
          <div><dt>Your role</dt><dd>{roleLabels(role)}</dd></div>
        </dl>
        {!admin && <p className="small muted">Only an owner or administrator can change the organisation's details or tier.</p>}
      </section>

      <section className="card block">
        <h2>Your settings</h2>
        <ReminderChoice organisationId={organisation.id} userId={userId} />
        <p className="small"><button type="button" className="link-dark" onClick={onPassword}>Change your password</button></p>
      </section>

      <section className="block">
        <h2>Tiers</h2>
        <p className="small muted">Each tier includes everything in the tiers before it. Pricing is still to be set; until billing is in place, an owner or administrator of a test organisation can switch tiers here.</p>
        <div className="tier-grid">
          {TIERS.map((t, i) => {
            const on = t.id === current;
            const included = order.indexOf(t.id) <= order.indexOf(current);
            return (
              <section key={t.id} className={on ? "card tier-card on" : "card tier-card"} aria-current={on ? "true" : undefined}>
                <p className="eyebrow">{on ? "Your tier" : included ? "Included" : ""}&nbsp;</p>
                <h3>{t.name}</h3>
                <p className="small">{t.suits}</p>
                <p className="small muted">{t.price}</p>
                {i > 0 && <p className="small"><strong>Everything in {TIERS[i - 1].name}, plus:</strong></p>}
                {t.adds.map((g) => (
                  <div key={g.group}>
                    <p className="small"><strong>{g.group}</strong></p>
                    <ul className="small">{g.items.map((x) => <li key={x}>{x}</li>)}</ul>
                  </div>
                ))}
                {admin && !on && (
                  <button type="button" className="quiet" disabled={busy} onClick={() => run(() => setTier(organisation.id, t.id), "", true)}>
                    Switch to {t.name}
                  </button>
                )}
              </section>
            );
          })}
        </div>
      </section>
    </>
  );
}
