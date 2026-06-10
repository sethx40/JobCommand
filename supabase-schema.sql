-- JobCommand Supabase schema
-- Paste this into Supabase SQL Editor for a new project.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.company_members (
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member',
  created_at timestamptz not null default now(),
  primary key (company_id, user_id)
);

create table if not exists public.settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.jobs (
  id text primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  phone text,
  email text,
  address text,
  job_type text,
  payment_type text,
  sales_rep text,
  production_manager text,
  status text,
  start_date date,
  target_completion_date date,
  inspection_date date,
  materials_status text,
  homeowner_update_needed boolean not null default false,
  notes text,
  timeline jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id text primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  job_id text not null references public.jobs(id) on delete cascade,
  title text not null,
  assigned_to text,
  due_date date,
  due_time time,
  priority text,
  complete boolean not null default false,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.schedule_items (
  id text primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  job_id text not null references public.jobs(id) on delete cascade,
  trade text,
  subcontractor text,
  scheduled_date date,
  scheduled_time time,
  status text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.work_orders (
  id text primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  job_id text not null references public.jobs(id) on delete cascade,
  trade text,
  scope text,
  scheduled_date date,
  scheduled_time time,
  subcontractor text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.punch_list_items (
  id text primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  job_id text not null references public.jobs(id) on delete cascade,
  title text not null,
  assigned_to text,
  due_date date,
  due_time time,
  complete boolean not null default false,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.notes (
  id text primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  job_id text not null references public.jobs(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null,
  author_name text,
  body text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.mentions (
  id text primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  job_id text not null references public.jobs(id) on delete cascade,
  note_id text not null references public.notes(id) on delete cascade,
  tagged_user_id uuid references public.profiles(id) on delete cascade,
  tagged_name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id text primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  tagged_name text,
  job_id text references public.jobs(id) on delete cascade,
  note_id text references public.notes(id) on delete cascade,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.calendar_events (
  id text primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  job_id text references public.jobs(id) on delete cascade,
  title text not null,
  event_type text not null default 'Custom',
  event_date date,
  event_time time,
  assigned_to text,
  status text,
  notes text,
  created_at timestamptz not null default now()
);

create or replace function public.is_company_member(target_company uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.company_members
    where company_id = target_company
      and user_id = auth.uid()
  );
$$;

alter table public.profiles enable row level security;
alter table public.companies enable row level security;
alter table public.company_members enable row level security;
alter table public.settings enable row level security;
alter table public.jobs enable row level security;
alter table public.tasks enable row level security;
alter table public.schedule_items enable row level security;
alter table public.work_orders enable row level security;
alter table public.punch_list_items enable row level security;
alter table public.notes enable row level security;
alter table public.mentions enable row level security;
alter table public.notifications enable row level security;
alter table public.calendar_events enable row level security;

drop policy if exists "profiles own read" on public.profiles;
create policy "profiles own read" on public.profiles for select using (id = auth.uid());
drop policy if exists "profiles shared company read" on public.profiles;
create policy "profiles shared company read" on public.profiles for select using (
  exists (
    select 1
    from public.company_members mine
    join public.company_members theirs on theirs.company_id = mine.company_id
    where mine.user_id = auth.uid()
      and theirs.user_id = profiles.id
  )
);
drop policy if exists "profiles own upsert" on public.profiles;
create policy "profiles own upsert" on public.profiles for all using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "companies member access" on public.companies;
create policy "companies member access" on public.companies for all
using (public.is_company_member(id) or owner_id = auth.uid())
with check (owner_id = auth.uid() or public.is_company_member(id));

drop policy if exists "company members access" on public.company_members;
create policy "company members access" on public.company_members for all
using (public.is_company_member(company_id) or user_id = auth.uid())
with check (public.is_company_member(company_id) or user_id = auth.uid());

drop policy if exists "settings company access" on public.settings;
create policy "settings company access" on public.settings for all using (public.is_company_member(company_id)) with check (public.is_company_member(company_id));

drop policy if exists "jobs company access" on public.jobs;
create policy "jobs company access" on public.jobs for all using (public.is_company_member(company_id)) with check (public.is_company_member(company_id));

drop policy if exists "tasks company access" on public.tasks;
create policy "tasks company access" on public.tasks for all using (public.is_company_member(company_id)) with check (public.is_company_member(company_id));

drop policy if exists "schedule company access" on public.schedule_items;
create policy "schedule company access" on public.schedule_items for all using (public.is_company_member(company_id)) with check (public.is_company_member(company_id));

drop policy if exists "work orders company access" on public.work_orders;
create policy "work orders company access" on public.work_orders for all using (public.is_company_member(company_id)) with check (public.is_company_member(company_id));

drop policy if exists "punch company access" on public.punch_list_items;
create policy "punch company access" on public.punch_list_items for all using (public.is_company_member(company_id)) with check (public.is_company_member(company_id));

drop policy if exists "notes company access" on public.notes;
create policy "notes company access" on public.notes for all using (public.is_company_member(company_id)) with check (public.is_company_member(company_id));

drop policy if exists "mentions company access" on public.mentions;
create policy "mentions company access" on public.mentions for all using (public.is_company_member(company_id)) with check (public.is_company_member(company_id));

drop policy if exists "notifications company access" on public.notifications;
create policy "notifications company access" on public.notifications for all using (public.is_company_member(company_id)) with check (public.is_company_member(company_id));

drop policy if exists "calendar company access" on public.calendar_events;
create policy "calendar company access" on public.calendar_events for all using (public.is_company_member(company_id)) with check (public.is_company_member(company_id));
