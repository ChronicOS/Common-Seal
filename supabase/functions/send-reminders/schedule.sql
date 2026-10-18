-- Reminder emails: test and schedule. Run in Supabase → SQL editor, one part at a time.
-- Replace YOUR-PROJECT with your project's reference (the part before .supabase.co in the project URL).
-- The CRON_SECRET value goes in at part 1 only, typed straight into the SQL editor. Never into chat.

-- Part 1 (once): keep the cron secret in the Vault so the schedule never shows it.
select vault.create_secret('PASTE THE SAME CRON_SECRET VALUE HERE', 'reminders_cron_secret');

-- Part 2: dry run. Emails nobody and marks nobody as emailed; lists who would get one.
select net.http_post(
  url := 'https://YOUR-PROJECT.supabase.co/functions/v1/send-reminders?dry=1',
  headers := jsonb_build_object('Content-Type', 'application/json',
                                'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'reminders_cron_secret')),
  body := '{}'::jsonb) as request_id;

-- Part 3: a few seconds later, read the answer. Expect status 200 and {"dry_run":true,...}.
-- 401 means the secret in the Vault does not match the function's CRON_SECRET.
select id, status_code, content::text, error_msg from net._http_response order by id desc limit 3;

-- Part 4: one real send (only once SES works; see the README). Then repeat part 3.
-- Expect {"via":"Amazon SES (ap-southeast-2)","sent":N,"failed":[]}.
select net.http_post(
  url := 'https://YOUR-PROJECT.supabase.co/functions/v1/send-reminders',
  headers := jsonb_build_object('Content-Type', 'application/json',
                                'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'reminders_cron_secret')),
  body := '{}'::jsonb) as request_id;

-- Part 5: the schedule. 21:00 UTC Sunday to Thursday = 8am Sydney (7am in winter), Monday to Friday.
select cron.schedule('veraphius-reminders', '0 21 * * 0-4', $$
  select net.http_post(
    url := 'https://YOUR-PROJECT.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'reminders_cron_secret')),
    body := '{}'::jsonb);
$$);

-- Check the schedule exists, and later that it ran:
select jobid, jobname, schedule, active from cron.job where jobname = 'veraphius-reminders';
select status, start_time, return_message from cron.job_run_details
 where jobid = (select jobid from cron.job where jobname = 'veraphius-reminders') order by start_time desc limit 5;

-- To pause the emails at any time:
-- select cron.unschedule('veraphius-reminders');
