import { useCallback, useEffect, useState } from "react";
import { formatDay, loadMembers, setMemberRoles, type Member } from "./board";
import { setTier } from "./register";
import { has, roleList, roleLabels } from "./roles";
import { NotYet } from "./Settings";
import {
  acceptTerms, bytes, DPA_VERSION, loadOrgSettings, loadUsage, requestClose, saveOrgSettings, SUPPORT_EMAIL, TERMS_VERSION,
  type EditableSettings, type OrgSettings, type Usage,
} from "./settings";
import { TIERS, tierName, type Tier } from "./tiers";
import type { Organisation } from "./types";

/** Reads a picked image into a small data URL for printed documents */
function readLogo(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpeg|svg\+xml|webp)$/.test(file.type)) return reject(new Error("Use a PNG, JPEG, SVG or WebP image."));
    if (file.size > 200_000) return reject(new Error("Use an image under 200 KB."));
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Could not read that file."));
    r.readAsDataURL(file);
  });
}

/** Settings → Account: the organisation, its plan and its agreements */
export default function AccountSettings({ organisation, role, userId }: { organisation: Organisation; role: string; userId: string }) {
  const admin = has(role, "owner", "admin");
  const owner = has(role, "owner");
  const [s, setS] = useState<OrgSettings | null | undefined>(undefined);
  const [form, setForm] = useState({ name: organisation.name, legal_name: "", abn: "", address: "", billing_contact_name: "", billing_contact_email: "" });
  const [usage, setUsage] = useState<Usage | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [transferTo, setTransferTo] = useState("");
  const [keepOwner, setKeepOwner] = useState(true);
  const [closing, setClosing] = useState(false);
  const [closeReason, setCloseReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const current = organisation.tier as Tier;
  const order: Tier[] = ["small", "medium", "large"];

  const reload = useCallback(async () => {
    const next = await loadOrgSettings(organisation.id);
    setS(next);
    if (next)
      setForm({ name: next.name, legal_name: next.legal_name ?? "", abn: next.abn ?? "", address: next.address ?? "", billing_contact_name: next.billing_contact_name ?? "", billing_contact_email: next.billing_contact_email ?? "" });
    setUsage(await loadUsage(organisation.id));
    setMembers(await loadMembers(organisation.id).catch(() => []));
  }, [organisation.id]);
  useEffect(() => {
    void reload();
  }, [reload]);

  const run = async (work: () => Promise<void>, done: string, reloadPage = false) => {
    setBusy(true);
    setProblem(null);
    setNotice(null);
    try {
      await work();
      if (reloadPage) window.location.reload();
      else {
        await reload();
        setNotice(done);
      }
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "That did not save.");
    } finally {
      setBusy(false);
    }
  };
  const save = (patch: EditableSettings, done = "Saved.", reloadPage = false) =>
    run(() => saveOrgSettings(organisation.id, patch), done, reloadPage);

  const field = (key: keyof typeof form, label: string, opts: { type?: string; placeholder?: string; area?: boolean } = {}) => (
    <span className="field grow">
      <label htmlFor={`acc-${key}`}>{label}</label>
      {opts.area ? (
        <textarea id={`acc-${key}`} rows={2} disabled={!admin} value={form[key]} placeholder={opts.placeholder} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
      ) : (
        <input id={`acc-${key}`} type={opts.type ?? "text"} disabled={!admin} value={form[key]} placeholder={opts.placeholder} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
      )}
    </span>
  );
  const detailsDirty = s && (form.legal_name !== (s.legal_name ?? "") || form.abn !== (s.abn ?? "") || form.address !== (s.address ?? ""));
  const billingDirty = s && (form.billing_contact_name !== (s.billing_contact_name ?? "") || form.billing_contact_email !== (s.billing_contact_email ?? ""));
  const owners = members.filter((m) => m.is_active && roleList(m.role).includes("owner"));
  const candidates = members.filter((m) => m.is_active && !roleList(m.role).includes("owner"));
  const target = candidates.find((m) => m.user_id === transferTo);
  const me = members.find((m) => m.user_id === userId);

  return (
    <>
      <p className="eyebrow">Settings</p>
      <h1>Account</h1>
      {problem && <p className="error" role="alert">{problem}</p>}
      {notice && <p className="card note" role="status">{notice}</p>}

      <section className="card form block">
        <h2>Organisation</h2>
        <div className="row wrap">
          {field("name", "Name shown in VeraPhius")}
          {admin && form.name.trim() !== organisation.name && (
            <button type="button" disabled={busy || form.name.trim().length < 2} onClick={() => void save({ name: form.name.trim() }, "Saved.", true)}>Save</button>
          )}
        </div>
        <dl className="detail-list compact">
          <div><dt>Tier</dt><dd>{tierName(current)}</dd></div>
          <div><dt>Where your data is kept</dt><dd>Sydney, Australia{organisation.data_region ? ` (${organisation.data_region})` : ""}. This cannot be changed.</dd></div>
          <div><dt>Your role</dt><dd>{roleLabels(role)}</dd></div>
        </dl>
        {!admin && <p className="small muted">Only an owner or administrator can change the organisation's details or tier.</p>}
      </section>

      {s === undefined ? null : s === null ? <NotYet /> : (
        <>
          <section className="card form block">
            <h2>Details for printed documents</h2>
            <p className="small muted">Shown at the top of registers, minutes and reports you print or save as PDF.</p>
            <div className="row wrap">
              {field("legal_name", "Legal name", { placeholder: "Example Holdings Pty Ltd" })}
              {field("abn", "ABN", { placeholder: "11 digits" })}
            </div>
            {field("address", "Address", { area: true })}
            {admin && detailsDirty && (
              <p><button type="button" disabled={busy} onClick={() => void save({ legal_name: form.legal_name.trim() || null, abn: form.abn.replace(/\s/g, "") || null, address: form.address.trim() || null })}>Save details</button></p>
            )}
            <p className="small"><strong>Logo</strong></p>
            <div className="row wrap">
              {s.logo_data_url ? <img src={s.logo_data_url} alt="Your logo" style={{ maxHeight: 48, maxWidth: 200 }} /> : <span className="muted small">No logo</span>}
              {admin && (
                <label className="attach-button">
                  <span className="quiet-button">{s.logo_data_url ? "Replace" : "Add a logo"}</span>
                  <input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" className="visually-hidden" onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) void run(async () => saveOrgSettings(organisation.id, { logo_data_url: await readLogo(f) }), "Logo saved.");
                  }} />
                </label>
              )}
              {admin && s.logo_data_url && <button type="button" className="link-dark" disabled={busy} onClick={() => void save({ logo_data_url: null }, "Logo removed.")}>Remove</button>}
            </div>
          </section>

          <section className="card block">
            <h2>Usage</h2>
            {usage ? (
              <dl className="detail-list compact">
                <div><dt>Companies</dt><dd>{usage.companies}</dd></div>
                <div><dt>People with access</dt><dd>{usage.people}</dd></div>
                <div><dt>Files stored</dt><dd>{usage.files} ({bytes(usage.storage_bytes)})</dd></div>
              </dl>
            ) : <p className="muted">Not available.</p>}
            <p className="small muted">Limits for each tier will be set with pricing.</p>
          </section>

          <section className="card form block">
            <h2>Billing</h2>
            <div className="row wrap">
              {field("billing_contact_name", "Billing contact")}
              {field("billing_contact_email", "Billing email", { type: "email" })}
            </div>
            {admin && billingDirty && (
              <p><button type="button" disabled={busy} onClick={() => void save({ billing_contact_name: form.billing_contact_name.trim() || null, billing_contact_email: form.billing_contact_email.trim() || null })}>Save</button></p>
            )}
            <p className="small muted">Invoices will appear here once billing is set up. There is nothing to pay during testing.</p>
          </section>

          <section className="card form block">
            <h2>Owners</h2>
            <p className="small">{owners.length ? owners.map((o) => o.name).join(", ") : usage?.owners.join(", ") || "Not available"}</p>
            <p className="small muted">Owners can do everything, including closing the organisation. There must always be at least one.</p>
            {owner && candidates.length > 0 && (
              <>
                <label htmlFor="acc-transfer">Make someone else an owner</label>
                <select id="acc-transfer" value={transferTo} onChange={(e) => setTransferTo(e.target.value)}>
                  <option value="">Choose a person…</option>
                  {candidates.map((m) => <option key={m.user_id} value={m.user_id}>{m.name} ({roleLabels(m.role)})</option>)}
                </select>
                {target && (
                  <>
                    <label className="check"><input type="checkbox" checked={keepOwner} onChange={(e) => setKeepOwner(e.target.checked)} /> I stay an owner too</label>
                    <button type="button" disabled={busy} onClick={() => {
                      if (!keepOwner && !window.confirm(`Hand ownership to ${target.name}? You will keep your other roles${me && roleList(me.role).length === 1 ? " and become an Admin" : ""}.`)) return;
                      void run(async () => {
                        await setMemberRoles(organisation.id, target.user_id, [...roleList(target.role), "owner"]);
                        if (!keepOwner && me) {
                          const mine = roleList(me.role).filter((r) => r !== "owner");
                          await setMemberRoles(organisation.id, userId, mine.length ? mine : ["admin"]);
                        }
                        setTransferTo("");
                      }, `${target.name} is now an owner.`, !keepOwner);
                    }}>{keepOwner ? `Make ${target.name} an owner` : `Hand ownership to ${target.name}`}</button>
                  </>
                )}
              </>
            )}
          </section>

          <section className="card block">
            <h2>Agreements</h2>
            {[
              { what: "terms" as const, label: "Terms of use", version: TERMS_VERSION, accepted: s.terms_accepted_at, acceptedVersion: s.terms_version },
              { what: "dpa" as const, label: "Data processing agreement", version: DPA_VERSION, accepted: s.dpa_accepted_at, acceptedVersion: s.dpa_version },
            ].map((a) => (
              <p key={a.what} className="row wrap">
                <strong>{a.label}</strong>
                {a.accepted && a.acceptedVersion === a.version ? (
                  <span className="ok-text">Accepted {formatDay(a.accepted)} ({a.acceptedVersion})</span>
                ) : (
                  <>
                    <span className="warning-text">{a.accepted ? `Accepted ${a.acceptedVersion}; a newer version (${a.version}) needs accepting` : "Not yet accepted"}</span>
                    {owner && <button type="button" className="quiet" disabled={busy} onClick={() => void run(() => acceptTerms(organisation.id, a.what), `${a.label} accepted.`)}>Accept {a.version}</button>}
                  </>
                )}
              </p>
            ))}
            <p className="small muted">The documents themselves are being finalised. Only an owner can accept on the organisation's behalf; the date and who accepted are recorded.</p>
          </section>

          <section className="card block">
            <h2>Help, security and privacy</h2>
            <p className="small">Support: <a className="link-dark" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a></p>
            <ul className="small">
              <li>Your data is stored in Sydney, Australia, and is encrypted when stored and when sent.</li>
              <li>Each organisation's records are walled off from every other organisation by the database itself, not only by the screens.</li>
              <li>Every change to a record is logged (Settings, Security).</li>
            </ul>
          </section>
        </>
      )}

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
                  <button type="button" className="quiet" disabled={busy} onClick={() => void run(() => setTier(organisation.id, t.id), "", true)}>
                    Switch to {t.name}
                  </button>
                )}
              </section>
            );
          })}
        </div>
      </section>

      {owner && s && (
        <section className="card block">
          <h2>Close this organisation</h2>
          {s.close_requested_at ? (
            <>
              <p className="warning-text">Closure requested {formatDay(s.close_requested_at)}{s.close_reason ? `: ${s.close_reason}` : ""}. VeraPhius support will contact the owners to confirm before anything is deleted.</p>
              <button type="button" className="quiet" disabled={busy} onClick={() => void run(() => requestClose(organisation.id, null), "Closure request withdrawn.")}>Withdraw the request</button>
            </>
          ) : closing ? (
            <div className="form">
              <p className="small">Nothing is deleted straight away. Support will confirm with the owners, give you time to export your data, and check for legal holds first.</p>
              <label htmlFor="acc-close">Why are you closing it?</label>
              <textarea id="acc-close" rows={2} value={closeReason} onChange={(e) => setCloseReason(e.target.value)} />
              <div className="row">
                <button type="button" disabled={busy || !closeReason.trim()} onClick={() => void run(() => requestClose(organisation.id, closeReason), "Closure requested.")}>Request closure</button>
                <button type="button" className="link-dark" onClick={() => setClosing(false)}>Cancel</button>
              </div>
            </div>
          ) : (
            <button type="button" className="link-dark" onClick={() => setClosing(true)}>Ask to close this organisation…</button>
          )}
        </section>
      )}
    </>
  );
}
