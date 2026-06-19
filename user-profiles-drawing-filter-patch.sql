-- User display name/color + drawing filter support
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

alter table public.coverage_areas
add column if not exists user_tag text;

-- Keep drawings shared/editable by all signed-in users.
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
