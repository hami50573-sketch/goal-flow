create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault with schema vault;

select cron.unschedule(jobid)
from cron.job
where jobname = 'goalflow-hourly-reminders';

select cron.schedule(
  'goalflow-hourly-reminders',
  '0 * * * *',
  $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'goalflow_supabase_url')
        || '/functions/v1/send-reminders',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-reminder-secret',
        (select decrypted_secret from vault.decrypted_secrets where name = 'goalflow_reminder_secret')
      ),
      body := '{}'::jsonb
    );
  $job$
);
