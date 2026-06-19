-- Territory Manager shared editable coverage areas patch
-- Run this in Supabase SQL Editor.
-- This makes every signed-in user able to see, edit, redraw, and delete coverage drawings.

create table if not exists public.coverage_areas (
  id text primary key,
  zip text,
  user_id uuid references auth.users(id) on delete set null,
  user_email text,
  color text not null default '#22c55e',
  last_worked date,
  geometry jsonb not null,
  updated_at timestamptz default now()
);

alter table public.coverage_areas enable row level security;

drop policy if exists "signed in can read coverage areas" on public.coverage_areas;
drop policy if exists "signed in can write own coverage areas" on public.coverage_areas;
drop policy if exists "signed in can update own coverage areas" on public.coverage_areas;
drop policy if exists "signed in can delete own coverage areas" on public.coverage_areas;
drop policy if exists "admins can delete any coverage areas" on public.coverage_areas;
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

-- If this says the table is already in the publication, that is okay.
alter publication supabase_realtime add table public.coverage_areas;
