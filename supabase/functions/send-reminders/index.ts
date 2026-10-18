// Sends reminder emails, only to people who have something that needs them (see migration 0058).
//
// Runs on a schedule (Supabase cron, weekday mornings). For each person who needs an email it sends one
// short message listing what is waiting, then records it so the same things do not trigger another email
// tomorrow unless they are due within two days, overdue, or new.
//
// Secrets to set in Supabase (Edge Functions → Secrets). None of them ever go in chat:
//   CRON_SECRET     a long random value; the scheduled job sends it in the x-cron-secret header
//   RESEND_API_KEY  the email service's key (Resend). Leave unset to do a dry run that only logs.
//   REMINDER_FROM   for example "VeraPhius <reminders@veraphius.com>" (the domain must be verified with Resend)
//   SITE_URL        for example https://www.veraphius.com
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase automatically.

import { createClient } from "npm:@supabase/supabase-js@2";

type Item = { area: string; what: string; due: string | null };
type Row = { organisation_id: string; organisation_name: string; user_id: string; email: string; full_name: string; items: Item[]; item_keys: string[] };

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const day = (iso: string | null) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" }) : "");

function message(r: Row, site: string) {
  const today = new Date().toISOString().slice(0, 10);
  const n = r.items.length;
  const subject = `VeraPhius: ${n} thing${n === 1 ? "" : "s"} need${n === 1 ? "s" : ""} you (${r.organisation_name})`;
  const line = (i: Item) => `${i.what}${i.due ? ` (${i.due < today ? "overdue, " : ""}due ${day(i.due)})` : ""}`;
  const text = [
    `Hello ${r.full_name},`,
    `${n === 1 ? "This is" : "These are"} waiting for you in VeraPhius for ${r.organisation_name}:`,
    ...r.items.map((i) => `- ${i.area}: ${line(i)}`),
    `Open VeraPhius: ${site}`,
    `You get this email only when something needs you. To change how often, open For you in VeraPhius.`,
  ].join("\n\n");
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#10231f;max-width:560px">
<p>Hello ${esc(r.full_name)},</p>
<p>${n === 1 ? "This is" : "These are"} waiting for you in VeraPhius for <strong>${esc(r.organisation_name)}</strong>:</p>
<ul>${r.items.map((i) => `<li><strong>${esc(i.area)}:</strong> ${esc(line(i))}</li>`).join("")}</ul>
<p><a href="${esc(site)}" style="color:#b4472e">Open VeraPhius</a></p>
<p style="color:#44524e;font-size:13px">You get this email only when something needs you. To change how often, open For you in VeraPhius.</p>
</div>`;
  return { subject, text, html };
}

Deno.serve(async (req) => {
  const secret = Deno.env.get("CRON_SECRET");
  if (!secret || req.headers.get("x-cron-secret") !== secret) return new Response("Not allowed", { status: 401 });
  const site = Deno.env.get("SITE_URL") ?? "https://www.veraphius.com";
  const from = Deno.env.get("REMINDER_FROM") ?? "VeraPhius <reminders@veraphius.com>";
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  const { data, error } = await db.rpc("reminder_batch");
  if (error) return new Response(`Could not work out who needs an email: ${error.message}`, { status: 500 });
  let sent = 0;
  const failed: string[] = [];
  for (const r of (data ?? []) as Row[]) {
    if (!r.items?.length) continue;
    const m = message(r, site);
    if (apiKey) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [r.email], subject: m.subject, text: m.text, html: m.html }),
      });
      if (!res.ok) {
        failed.push(`${r.email}: ${res.status}`);
        continue;
      }
    } else {
      console.log(`Dry run (no RESEND_API_KEY): would email ${r.email}: ${m.subject}`);
    }
    const done = await db.rpc("reminder_sent", { p_org: r.organisation_id, p_user: r.user_id, p_keys: r.item_keys });
    if (done.error) failed.push(`${r.email}: ${done.error.message}`);
    else sent++;
  }
  return new Response(JSON.stringify({ sent, failed, dry_run: !apiKey }), { headers: { "Content-Type": "application/json" } });
});
