-- Territory Manager admin-only controls patch
-- Run this in Supabase SQL Editor.

create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  created_at timestamptz default now()
);

alter table public.admins enable row level security;

drop policy if exists "admins can read own admin row" on public.admins;
create policy "admins can read own admin row"
on public.admins
for select
to authenticated
using (auth.uid() = user_id);

-- Add Brandon/William as admin.
insert into public.admins (user_id, email)
values ('d46fb0e8-14f7-45f2-be53-e3c1916ce05d', 'bambingames@gmail.com')
on conflict (user_id) do update set email = excluded.email;

-- Lock team editing to admin only.
drop policy if exists "signed in can write teams" on public.teams;
drop policy if exists "admins can write teams" on public.teams;

create policy "admins can write teams"
on public.teams
for all
to authenticated
using (
  exists (
    select 1 from public.admins
    where admins.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.admins
    where admins.user_id = auth.uid()
  )
);

-- Keep all signed-in users able to read teams.
drop policy if exists "signed in can read teams" on public.teams;
create policy "signed in can read teams"
on public.teams
for select
to authenticated
using (true);

-- Keep signed-in users able to read/write territories.
drop policy if exists "signed in can read territories" on public.territories;
drop policy if exists "signed in can write territories" on public.territories;

create policy "signed in can read territories"
on public.territories
for select
to authenticated
using (true);

create policy "signed in can write territories"
on public.territories
for all
to authenticated
using (true)
with check (true);
