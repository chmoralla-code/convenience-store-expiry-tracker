-- Shared Telegram settings: every Shelby phone that enters the same store code
-- gets the same bot token and chat ID.
--
-- The table itself is closed to the app (RLS on, no policies). Phones can only
-- go through the two functions below, and both need the store code. Only a
-- SHA-256 hash of the code is stored.

create table if not exists public.store_telegram_settings (
  code_hash text primary key,
  bot_token text not null,
  chat_id text not null,
  updated_at timestamptz not null default now()
);

alter table public.store_telegram_settings enable row level security;
revoke all on public.store_telegram_settings from anon, authenticated;

create or replace function public.shelby_code_hash(store_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(upper(trim(store_code)), 'UTF8')), 'hex');
$$;

-- Saves (or replaces) the settings for a store code.
create or replace function public.save_telegram_settings(store_code text, bot_token text, chat_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if length(trim(coalesce(store_code, ''))) < 8 then
    raise exception 'Store code must be at least 8 characters.';
  end if;
  if coalesce(trim(bot_token), '') = '' or coalesce(trim(chat_id), '') = '' then
    raise exception 'Bot token and chat ID are required.';
  end if;
  insert into public.store_telegram_settings (code_hash, bot_token, chat_id, updated_at)
  values (public.shelby_code_hash(store_code), trim(bot_token), trim(chat_id), now())
  on conflict (code_hash) do update
    set bot_token = excluded.bot_token, chat_id = excluded.chat_id, updated_at = now();
end;
$$;

-- Returns the settings for a store code (no rows if the code is unknown).
create or replace function public.get_telegram_settings(store_code text)
returns table (bot_token text, chat_id text, updated_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select s.bot_token, s.chat_id, s.updated_at
  from public.store_telegram_settings s
  where s.code_hash = public.shelby_code_hash(store_code);
$$;

revoke all on function public.save_telegram_settings(text, text, text) from public;
revoke all on function public.get_telegram_settings(text) from public;
grant execute on function public.save_telegram_settings(text, text, text) to anon, authenticated;
grant execute on function public.get_telegram_settings(text) to anon, authenticated;
