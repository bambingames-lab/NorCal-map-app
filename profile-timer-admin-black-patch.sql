-- Profile tags, shared drawings, black timer fade, and admin-only timer settings
-- Run this in Supabase SQL Editor.

create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  color text not null default '#22c55e',
  updated_at timestamptz default now()
);

alter table public.user_profiles enable row level security;

drop policy if exists "signed in can read profiles" on public.user_profiles;
drop policy if exists "signed in can write own profile" on public.user_profiles;

create policy "signed in can read profiles"
on public.user_profiles
for select
to authenticated
using (true);

create policy "signed in can write own profile"
on public.user_profiles
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create table if not exists public.app_settings (
  id text primary key default 'global',
  time_mode text not null default 'months',
  threshold numeric not null default 3,
  updated_by uuid references auth.users(id),
  updated_at timestamptz default now()
);

alter table public.app_settings enable row level security;

drop policy if exists "signed in can read app settings" on public.app_settings;
drop policy if exists "admins can write app settings" on public.app_settings;

create policy "signed in can read app settings"
on public.app_settings
for select
to authenticated
using (true);

create policy "admins can write app settings"
on public.app_settings
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

insert into public.app_settings (id, time_mode, threshold)
values ('global', 'months', 3)
on conflict (id) do nothing;

alter table public.coverage_areas
add column if not exists user_tag text;

alter table public.coverage_areas enable row level security;

drop policy if exists "signed in can read coverage areas" on public.coverage_areas;
drop policy if exists "signed in can insert coverage areas" on public.coverage_areas;
drop policy if exists "signed in can update all coverage areas" on public.coverage_areas;
drop policy if exists "signed in can delete all coverage areas" on public.coverage_areas;

create policy "signed in can read coverage areas"
on public.coverage_areas
for select
to authenticated
using (true);

create policy "signed in can insert coverage areas"
on public.coverage_areas
for insert
to authenticated
with check (true);

create policy "signed in can update all coverage areas"
on public.coverage_areas
for update
to authenticated
using (true)
with check (true);

create policy "signed in can delete all coverage areas"
on public.coverage_areas
for delete
to authenticated
using (true);

alter table public.coverage_areas replica identity full;
alter table public.app_settings replica identity full;

-- These may say already exists; that is okay.
alter publication supabase_realtime add table public.coverage_areas;
alter publication supabase_realtime add table public.app_settings;
