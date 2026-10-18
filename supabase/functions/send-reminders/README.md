# Reminder emails: Amazon SES (Sydney) set-up and switch-on

One sitting, about 90 minutes plus waiting time for DNS. When you finish, VeraPhius emails people on weekday mornings, only when something needs them. Email is sent from Sydney (ap-southeast-2), so it stays in Australia.

**Before you start**

- Migrations 0044 to 0060 have been run and the health check passes.
- You can sign in to wherever `veraphius.com`'s DNS is managed (Netlify, if the domain points there; otherwise the registrar).
- You have a password manager open. Keys go from AWS into Supabase via the password manager. They never go into chat, email or a document.

**Files in this folder**

| File | What it is |
|---|---|
| `index.ts` | The function. Paste it into Supabase in Part D. |
| `ses-send-policy.json` | The AWS permission: send email from reminders@veraphius.com and nothing else. |
| `schedule.sql` | The SQL for the test runs and the schedule (Parts E and F). |

**Waiting times to plan around**

- DNS records: usually minutes, up to 72 hours.
- AWS "production access" (permission to email anyone): up to 4 days (AWS says initial response within 96 hours). Until then, SES only sends to addresses you have verified, which is enough for testing. **If you can, do Parts A to C earlier in the week and lodge the production access request then.** Sunday then becomes Parts D to F only.

---

## Part A: AWS account (15 min)

1. Go to aws.amazon.com → **Create an AWS account**. Use a shared mailbox you control (for example `aws@veraphius.com` or your own address), not a personal one you might lose. Choose the Basic (free) support plan.
2. Sign in as the root user. Top right → your account name → **Security credentials** → **Assign MFA device** → authenticator app. Never create access keys for the root user.
3. Top-right Region selector: choose **Asia Pacific (Sydney) ap-southeast-2**. Check it says Sydney every time you come back; SES set-up is per Region.
4. Billing alert: search **Billing and Cost Management** → **Budgets** → **Create budget** → *Zero spend budget* (or a monthly budget of AUD 10). Enter your email. SES costs about USD 0.10 per 1,000 emails, so a normal month is cents.

## Part B: Verify the domain in SES (20 min, then wait)

1. Search **Amazon Simple Email Service** (SES). Check the Region is Sydney.
2. **Configuration → Identities → Create identity**.
   - Identity type: **Domain**. Domain: `veraphius.com` (no www).
   - Tick **Use a custom MAIL FROM domain**. MAIL FROM domain: `mail.veraphius.com`. Behaviour on MX failure: **Use default MAIL FROM domain**.
   - **Advanced DKIM settings**: Easy DKIM, RSA 2048-bit, DKIM signatures **Enabled**.
   - **Create identity**.
3. Open the new identity → **Authentication** tab → **Publish DNS records** → **Download .csv record set**. You will get:
   - 3 × **CNAME** records: names like `abc123._domainkey.veraphius.com`, values like `abc123.dkim.amazonses.com`.
   - 1 × **MX** record for `mail.veraphius.com`, priority 10, value `feedback-smtp.ap-southeast-2.amazonses.com`.
   - 1 × **TXT** record for `mail.veraphius.com`: `"v=spf1 include:amazonses.com ~all"`.
4. Add all five at your DNS host. In Netlify: **Domains → veraphius.com → DNS settings → Add new record**. Notes:
   - Copy the names exactly, keeping the underscore in `_domainkey`. Some hosts add the domain automatically, so enter `abc123._domainkey` or `mail` rather than the full name if the form already shows `.veraphius.com`.
   - Leave any existing MX records for `veraphius.com` itself alone. The new MX is only for the `mail` subdomain.
5. Also add DMARC if there is none: TXT, name `_dmarc`, value `v=DMARC1; p=none; rua=mailto:YOUR-ADDRESS`. It improves delivery and lets you see spoofing reports.
6. Back in SES, the identity shows **Verified** and DKIM **Successful** once AWS sees the records. Refresh after 10 minutes. You can carry on with Part C meanwhile.

## Part C: Test address and production access (10 min)

1. **Identities → Create identity → Email address**: your own email. Click the link in the email from no-reply-aws@amazon.com. This lets the sandbox send to you.
2. **Account dashboard** → in the "Your Amazon SES account is in the sandbox" box, choose **View Get set up page** → **Request production access**:
   - Mail type: **Transactional**.
   - Website URL: `https://www.veraphius.com`.
   - Use case (if asked): *"VeraPhius is a board and compliance platform. We send one transactional reminder email per user, at most daily, only to signed-in members of customer organisations, when an item they are responsible for is due. No marketing. Users can turn emails off in their settings. Bounces and complaints go to the SES account-level suppression list, and addresses that bounce are not retried."*
   - Additional contacts: your email.
   - Tick the acknowledgement → **Submit request**.
3. Carry on. Until approval, real sends work only to the address from step 1.

## Part D: The sending key, Supabase secrets and the function (25 min)

**D1. A user that can only send email**

1. Search **IAM** → **Policies → Create policy → JSON**. Paste `ses-send-policy.json`. Replace `YOUR-AWS-ACCOUNT-ID` with your 12-digit account ID (top right → account name). **Next**, name it `VeraPhiusSesSend`, **Create policy**.
2. **IAM → Users → Create user**. Name: `veraphius-reminders`. Do **not** give console access. **Next** → **Attach policies directly** → tick `VeraPhiusSesSend` → **Create user**.
3. Open the user → **Security credentials → Create access key** → *Application running outside AWS* → **Create**. Save the **Access key** and **Secret access key** straight into your password manager. AWS shows the secret only once.

This key can do one thing: send email as reminders@veraphius.com from Sydney. If it ever leaks, nobody can use it to read data or spend money elsewhere. Delete it in IAM and make a new one.

**D2. Secrets in Supabase**

Supabase → your project → **Edge Functions → Secrets** (sometimes under *Manage secrets*). Add these, pasting values from the password manager:

| Name | Value |
|---|---|
| `AWS_ACCESS_KEY_ID` | the access key from D1 |
| `AWS_SECRET_ACCESS_KEY` | the secret access key from D1 |
| `AWS_REGION` | `ap-southeast-2` |
| `REMINDER_FROM` | `VeraPhius <reminders@veraphius.com>` |
| `SITE_URL` | `https://www.veraphius.com` (or the Netlify address people use today) |
| `CRON_SECRET` | a new long random value from the password manager (40+ characters) |

If you set up `RESEND_API_KEY` earlier, delete it.

**D3. The function**

1. **Edge Functions → Deploy a new function → Via editor**. Name it exactly `send-reminders`.
2. Replace the sample code with all of `index.ts` from this folder. **Deploy**.
3. Open the function → **Details** (or Settings) → turn **Verify JWT / Enforce JWT verification** **off** → Save. The function checks `CRON_SECRET` itself; the schedule does not send a sign-in token.

## Part E: Test (15 min)

1. Supabase → **Integrations** (or Database → Extensions): turn on **pg_cron** and **pg_net**. **Vault** is on already.
2. SQL editor: open `schedule.sql`. Replace `YOUR-PROJECT` everywhere with your project reference. Run **Part 1** (puts `CRON_SECRET` in the Vault; type the value into the editor directly).
3. Run **Part 2** (dry run), wait 5 seconds, run **Part 3**. Expect `200` and `{"dry_run":true,"would_email":N,"people":[...]}`. The dry run emails nobody and marks nobody.
   - `401`: the Vault secret and the Supabase secret differ. Fix one to match.
   - `404`: the function name or project reference is wrong.
   - `would_email: 0`: nobody has anything due. In the test organisation, give yourself a training assignment or a risk action due tomorrow, then try again.
4. Run **Part 4** (a real send), wait 5 seconds, then **Part 3** again. Expect `"via":"Amazon SES (ap-southeast-2)"` and `sent` of at least 1, with an email in your inbox within a minute. Check it isn't in junk, and that it shows "signed by veraphius.com" (Gmail: the ▸ details arrow).
   - While still in the sandbox, anyone other than your verified address shows under `failed` with `Email address is not verified`. That's expected and harmless: they aren't marked as emailed, so they'll get their email on the first run after production access arrives.
   - `failed` with `403 ... not authorized`: the policy's account ID, Region or from-address doesn't match. The address in `REMINDER_FROM` must be exactly `reminders@veraphius.com`.
   - Logs: Edge Functions → send-reminders → **Logs**.

## Part F: Schedule (5 min)

1. Once production access is approved (AWS emails you), run **Part 5** of `schedule.sql`. It sends at 8am Sydney time (7am in winter), Monday to Friday.
2. Run the two check queries at the end of `schedule.sql`. The next morning, `cron.job_run_details` should show `succeeded`, and the function logs show how many emails went.
3. To pause at any time: `select cron.unschedule('veraphius-reminders');`.

## Afterwards

- **Bounces and complaints**: SES puts addresses that bounce or complain on the account suppression list automatically. Check **SES → Reputation metrics** monthly for the first few months. AWS reviews accounts whose bounce rate is over 5% or complaint rate is over 0.1%.
- **Key rotation**: once a year, create a second access key for `veraphius-reminders`, update the two Supabase secrets, then delete the old key.
- **Each person controls their emails** in Settings → My profile: when needed, weekly or off, and which areas. Organisations set the footer, reply-to address and the starting setting in Settings → Email and notifications.
