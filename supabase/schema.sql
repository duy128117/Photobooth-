create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default 'Photobooth',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  share_id text not null unique default encode(gen_random_bytes(9), 'hex'),
  title text not null default 'Photobooth',
  layout text not null default 'classic-strip',
  image_count integer not null default 3,
  background text not null default '#ffffff',
  filter_name text not null default 'none',
  overlays jsonb not null default '{}'::jsonb,
  show_date boolean not null default true,
  is_public boolean not null default true,
  images jsonb not null default '[]'::jsonb,
  stickers jsonb not null default '[]'::jsonb,
  preview_image text not null default '',
  download_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', 'Photobooth')
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at
before update on public.projects
for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.projects enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles
for select
to authenticated
using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
on public.profiles
for insert
to authenticated
with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists "projects_select_public_or_owner" on public.projects;
create policy "projects_select_public_or_owner"
on public.projects
for select
to anon, authenticated
using (is_public = true or auth.uid() = user_id);

drop policy if exists "projects_insert_owner" on public.projects;
create policy "projects_insert_owner"
on public.projects
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "projects_update_owner" on public.projects;
create policy "projects_update_owner"
on public.projects
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "projects_delete_owner" on public.projects;
create policy "projects_delete_owner"
on public.projects
for delete
to authenticated
using (auth.uid() = user_id);
