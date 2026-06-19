-- Territory Manager Community Edition Supabase setup
-- Run this in Supabase SQL Editor.

create table if not exists public.teams (
  id text primary key,
  name text not null,
  color text not null default '#2563eb',
  sort_order integer not null default 0
);

create table if not exists public.territories (
  zip text primary key,
  last_worked date,
  owner_team_id text references public.teams(id),
  handoff_team_id text references public.teams(id),
  notes text,
  updated_by uuid references auth.users(id),
  updated_at timestamptz default now()
);

alter table public.teams enable row level security;
alter table public.territories enable row level security;

drop policy if exists "signed in can read teams" on public.teams;
drop policy if exists "signed in can write teams" on public.teams;
drop policy if exists "signed in can read territories" on public.territories;
drop policy if exists "signed in can write territories" on public.territories;

create policy "signed in can read teams"
on public.teams for select
to authenticated
using (true);

create policy "signed in can write teams"
on public.teams for all
to authenticated
using (true)
with check (true);

create policy "signed in can read territories"
on public.territories for select
to authenticated
using (true);

create policy "signed in can write territories"
on public.territories for all
to authenticated
using (true)
with check (true);

insert into public.teams (id, name, color, sort_order) values
('team1','Team 1','#2563eb',1),
('team2','Team 2','#9333ea',2),
('team3','Team 3','#ec4899',3),
('team4','Team 4','#0f766e',4),
('team5','Team 5','#f59e0b',5),
('team6','Team 6','#22c55e',6)
on conflict (id) do nothing;

-- For Realtime:
-- In Supabase Dashboard > Database > Replication, enable Realtime for territories and teams.
-- Or run:
-- alter publication supabase_realtime add table public.territories;
-- alter publication supabase_realtime add table public.teams;
