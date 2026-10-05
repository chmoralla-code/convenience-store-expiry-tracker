-- Daily auto-check: call the expiry-check Edge Function every morning (00:00 UTC = 08:00 PH).
-- The function itself reads TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID secrets.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- Replace any old schedule with the fresh one.
select cron.unschedule('daily-expiry-check') where exists (
  select 1 from cron.job where jobname = 'daily-expiry-check'
);

select cron.schedule(
  'daily-expiry-check',
  '0 0 * * *',
  $$
  select extensions.http_post(
    url := 'https://ttascdowltevfveipyuq.supabase.co/functions/v1/expiry-check',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
