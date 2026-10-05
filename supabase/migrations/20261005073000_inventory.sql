-- Convenience store inventory: food items with expiry dates.
-- Run this once in the Supabase dashboard: SQL Editor > New query > paste > Run.

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  name text not null,
  quantity int not null default 1 check (quantity >= 0),
  expiry_date date not null,
  category text not null default 'general',
  barcode text
);

create index if not exists products_expiry_idx on public.products (expiry_date);

alter table public.products enable row level security;

drop policy if exists "Anyone can view items" on public.products;
drop policy if exists "Anyone can add items" on public.products;
drop policy if exists "Anyone can update items" on public.products;
drop policy if exists "Anyone can delete items" on public.products;

-- Shared store inventory: every staff phone uses the same anon key,
-- so all devices can read and manage the same items.
create policy "Anyone can view items"
  on public.products for select using (true);

create policy "Anyone can add items"
  on public.products for insert with check (true);

create policy "Anyone can update items"
  on public.products for update using (true);

create policy "Anyone can delete items"
  on public.products for delete using (true);
