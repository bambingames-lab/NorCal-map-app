-- Mobile drawing + user tag patch
-- Run this in Supabase SQL Editor.

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
