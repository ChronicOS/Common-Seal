// Sends reminder emails, only to people who have something that needs them (migrations 0058 and 0060).
//
// Runs on a schedule (Supabase cron, weekday mornings). For each person who needs an email it sends one
// short message listing what is waiting, then records it so the same things do not trigger another email
// tomorrow unless they are due within two days, overdue, or new.
//
// Email goes through Amazon SES in Sydney (ap-southeast-2), so it stays in Australia.
//
// Secrets to set in Supabase (Edge Functions → Secrets). None of them ever go in chat:
//   CRON_SECRET            a long random value; the scheduled job sends it in the x-cron-secret header
//   AWS_ACCESS_KEY_ID      the access key of the send-only AWS user (see README)
//   AWS_SECRET_ACCESS_KEY  its secret
//   AWS_REGION             ap-southeast-2
//   REMINDER_FROM          for example "VeraPhius <reminders@veraphius.com>" (the domain must be verified in SES)
//   SITE_URL               for example https://www.veraphius.com
// Without the AWS keys, the function does a dry run that only logs. Adding ?dry=1 to the call forces a dry
// run even with the keys set. A dry run never marks anyone as emailed.
// (RESEND_API_KEY still works instead of the AWS keys, if you ever switch back.)
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase automatically.

import { createClient } from "npm:@supabase/supabase-js@2";
import { AwsClient } from "npm:aws4fetch@1.0.20";

type Item = { area: string; what: string; due: string | null };
type Row = { organisation_id: string; organisation_name: string; user_id: string; email: string; full_name: string; items: Item[]; item_keys: string[]; email_footer?: string | null; reply_to?: string | null };

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
    `You get this email only when something needs you. To change how often or which areas, open Settings, My profile in VeraPhius.`,
    ...(r.email_footer ? [r.email_footer] : []),
  ].join("\n\n");
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#10231f;max-width:560px">
<p>Hello ${esc(r.full_name)},</p>
<p>${n === 1 ? "This is" : "These are"} waiting for you in VeraPhius for <strong>${esc(r.organisation_name)}</strong>:</p>
<ul>${r.items.map((i) => `<li><strong>${esc(i.area)}:</strong> ${esc(line(i))}</li>`).join("")}</ul>
<p><a href="${esc(site)}" style="color:#b4472e">Open VeraPhius</a></p>
<p style="color:#44524e;font-size:13px">You get this email only when something needs you. To change how often or which areas, open Settings, My profile in VeraPhius.</p>
${r.email_footer ? `<p style="color:#44524e;font-size:12px;white-space:pre-line">${esc(r.email_footer)}</p>` : ""}
</div>`;
  return { subject, text, html };
}

type Message = { subject: string; text: string; html: string };
type Sender = { name: string; send: (to: string, m: Message, replyTo: string | null) => Promise<string | null> };

/** Amazon SES (API v2), signed with the send-only user's keys. Returns null when sent, else the problem. */
function sesSender(from: string): Sender | null {
  const accessKeyId = Deno.env.get("AWS_ACCESS_KEY_ID");
  const secretAccessKey = Deno.env.get("AWS_SECRET_ACCESS_KEY");
  if (!accessKeyId || !secretAccessKey) return null;
  const region = Deno.env.get("AWS_REGION") ?? "ap-southeast-2";
  const aws = new AwsClient({ accessKeyId, secretAccessKey, service: "ses", region });
  return {
    name: `Amazon SES (${region})`,
    send: async (to, m, replyTo) => {
      const res = await aws.fetch(`https://email.${region}.amazonaws.com/v2/email/outbound-emails`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          FromEmailAddress: from,
          Destination: { ToAddresses: [to] },
          ...(replyTo ? { ReplyToAddresses: [replyTo] } : {}),
          Content: { Simple: { Subject: { Data: m.subject, Charset: "UTF-8" }, Body: { Text: { Data: m.text, Charset: "UTF-8" }, Html: { Data: m.html, Charset: "UTF-8" } } } },
        }),
      });
      return res.ok ? null : `${res.status} ${(await res.text()).slice(0, 200)}`;
    },
  };
}

function resendSender(from: string): Sender | null {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) return null;
  return {
    name: "Resend",
    send: async (to, m, replyTo) => {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [to], subject: m.subject, text: m.text, html: m.html, ...(replyTo ? { reply_to: replyTo } : {}) }),
      });
      return res.ok ? null : `${res.status} ${(await res.text()).slice(0, 200)}`;
    },
  };
}

Deno.serve(async (req) => {
  const secret = Deno.env.get("CRON_SECRET");
  if (!secret || req.headers.get("x-cron-secret") !== secret) return new Response("Not allowed", { status: 401 });
  const site = Deno.env.get("SITE_URL") ?? "https://www.veraphius.com";
  const from = Deno.env.get("REMINDER_FROM") ?? "VeraPhius <reminders@veraphius.com>";
  const forcedDry = new URL(req.url).searchParams.get("dry") === "1";
  const sender = forcedDry ? null : (sesSender(from) ?? resendSender(from));
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  const { data, error } = await db.rpc("reminder_batch");
  if (error) return new Response(`Could not work out who needs an email: ${error.message}`, { status: 500 });
  let sent = 0;
  const wouldSend: string[] = [];
  const failed: string[] = [];
  for (const r of (data ?? []) as Row[]) {
    if (!r.items?.length) continue;
    const m = message(r, site);
    if (!sender) {
      // Dry run: log only, and do not mark them as emailed, so the real run still reaches them
      console.log(`Dry run: would email ${r.email}: ${m.subject}`);
      wouldSend.push(r.email);
      continue;
    }
    const problem = await sender.send(r.email, m, r.reply_to ?? null);
    if (problem) {
      console.error(`Could not email ${r.email}: ${problem}`);
      failed.push(`${r.email}: ${problem}`);
      continue;
    }
    const done = await db.rpc("reminder_sent", { p_org: r.organisation_id, p_user: r.user_id, p_keys: r.item_keys });
    if (done.error) failed.push(`${r.email}: sent, but not recorded: ${done.error.message}`);
    else sent++;
  }
  const result = sender ? { via: sender.name, sent, failed } : { dry_run: true, would_email: wouldSend.length, people: wouldSend };
  console.log(JSON.stringify(result));
  return new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json" } });
});
