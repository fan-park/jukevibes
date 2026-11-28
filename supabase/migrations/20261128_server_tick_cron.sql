-- Server-side queue engine: every 5 seconds, while any session has had a guest in the
-- last 3 hours, call the app's tick endpoint so songs get queued even with the page closed.
-- The bearer secret lives in Supabase Vault (name: jukevibe_cron_secret) and must match
-- the CRON_SECRET env var in Vercel. It is NOT stored in this file. To set it:
--   select vault.create_secret('<secret>', 'jukevibe_cron_secret');

create extension if not exists pg_net;
create extension if not exists pg_cron;

create or replace function public.jukevibe_server_tick()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.guests g join public.rooms r on r.id = g.room_id
             where r.ended_at is null and g.last_seen_at > now() - interval '3 hours') then
    perform net.http_post(
      url := 'https://jukevibes.vercel.app/api/cron/tick',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'jukevibe_cron_secret')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 10000
    );
  end if;
end;
$$;
revoke execute on function public.jukevibe_server_tick() from public, anon, authenticated;

select cron.schedule('jukevibe-tick', '5 seconds', 'select public.jukevibe_server_tick()');
