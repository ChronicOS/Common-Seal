# Reminder emails: switching them on

VeraPhius emails a person only when something needs them: something new since their last email, or something due within two days or overdue. At most one email a day (or a week, if they choose). Nothing needed, no email.

Do these once, after migration 0058 has been run. Keys and secrets go into Supabase or Resend only. Never paste them into chat.

1. **Email service.** Create a Resend account (resend.com). Add and verify the domain `veraphius.com`. Resend gives you DNS records to add in Netlify DNS. Create an API key with "sending" access.
   *If you would rather keep email in Australia, Amazon SES in Sydney (ap-southeast-2) works too. Tell Claude and the function will be switched over.*
2. **Secrets.** In Supabase → Edge Functions → Secrets, add:
   - `RESEND_API_KEY`: the key from step 1.
   - `REMINDER_FROM`: `VeraPhius <reminders@veraphius.com>`.
   - `SITE_URL`: `https://www.veraphius.com`.
   - `CRON_SECRET`: a long random value (for example from a password manager).
3. **The function.** In Supabase → Edge Functions → Deploy a new function → name it `send-reminders`. Paste in `index.ts` from this folder, and turn off "Verify JWT" (the function checks `CRON_SECRET` itself). Deploy.
4. **Dry run.** Remove `RESEND_API_KEY` for a moment, or deploy before adding it. Then call the function once from the SQL editor (step 5 with the schedule run by hand). The function's logs show who would have been emailed, without sending anything.
5. **Schedule.** In Supabase → Integrations, turn on **Cron** and **pg_net**. Then in the SQL editor, replacing `YOUR-PROJECT` and the secret:

   ```sql
   select vault.create_secret('the same CRON_SECRET value', 'reminders_cron_secret');
   select cron.schedule('veraphius-reminders', '0 21 * * 0-4', $$
     select net.http_post(
       url := 'https://YOUR-PROJECT.supabase.co/functions/v1/send-reminders',
       headers := jsonb_build_object('Content-Type', 'application/json',
                                     'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'reminders_cron_secret')),
       body := '{}'::jsonb);
   $$);
   ```

   `0 21 * * 0-4` is 21:00 UTC, Sunday to Thursday. In Sydney that is 8am in summer and 7am in winter, Monday to Friday.
6. **Check.** The next morning, Supabase → Edge Functions → send-reminders → Logs shows how many were sent.

Each person can choose "only when needed", "at most weekly" or "off" at the bottom of For you.
