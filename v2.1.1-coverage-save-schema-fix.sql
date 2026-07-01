alter table public.coverage_areas
add column if not exists user_email text,
add column if not exists user_tag text,
add column if not exists user_color text,
add column if not exists display_name text,
add column if not exists tag text,
add column if not exists team_id text,
add column if not exists team_color text,
add column if not exists shape_type text,
add column if not exists last_worked date,
add column if not exists updated_at timestamptz default now();

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

do $$
begin
  begin
    alter publication supabase_realtime add table public.coverage_areas;
  exception
    when duplicate_object then null;
  end;
end $$;
