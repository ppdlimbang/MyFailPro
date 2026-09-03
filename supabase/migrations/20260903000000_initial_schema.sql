-- MyFailPro: Supabase Auth, tenant-isolated data, and Row Level Security.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  name text not null default '',
  agency_type text not null default 'Agensi',
  role text not null default 'agency' check (role in ('admin', 'agency')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.agency_settings (
  owner_id uuid primary key references public.profiles(id) on delete cascade,
  functions text[] not null default array['400 Pengurusan Kewangan dan Perakaunan'],
  activities text[] not null default array['400-1 Tadbir Urus Kewangan/Akaun'],
  sub_activities text[] not null default array['400-1/1 Perwakilan Kewangan'],
  transactions text[] not null default array['400-1/1/1'],
  staff jsonb not null default '[{"nama":"Ahmad Albab","sektor":"Unit Kewangan"}]'::jsonb,
  updated_at timestamptz not null default now(),
  constraint staff_is_array check (jsonb_typeof(staff) = 'array')
);

create table if not exists public.files (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete restrict,
  function_name text not null,
  activity_name text not null,
  sub_activity_name text not null,
  transaction_code text not null,
  volume integer not null default 1 check (volume > 0),
  opened_on date not null,
  closed_on date,
  status text not null default 'Bilik Fail' check (status in ('Bilik Fail', 'Sedang Beredar')),
  current_holder text not null default 'Bilik Fail',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint valid_file_dates check (closed_on is null or closed_on >= opened_on),
  constraint unique_agency_file_volume unique (owner_id, transaction_code, volume)
);

create table if not exists public.movements (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null references public.files(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete restrict,
  moved_at timestamptz not null default now(),
  from_holder text not null,
  to_holder text not null,
  note text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists files_owner_id_idx on public.files(owner_id);
create index if not exists files_transaction_code_idx on public.files(transaction_code);
create index if not exists movements_file_id_moved_at_idx on public.movements(file_id, moved_at desc);
create index if not exists movements_owner_id_idx on public.movements(owner_id);

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles for each row execute function public.set_updated_at();
drop trigger if exists agency_settings_set_updated_at on public.agency_settings;
create trigger agency_settings_set_updated_at before update on public.agency_settings for each row execute function public.set_updated_at();
drop trigger if exists files_set_updated_at on public.files;
create trigger files_set_updated_at before update on public.files for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, name, agency_type, role)
  values (new.id, coalesce(new.email, ''), coalesce(new.raw_user_meta_data ->> 'name', ''), coalesce(new.raw_user_meta_data ->> 'agency_type', 'Agensi'), 'agency');
  insert into public.agency_settings (owner_id) values (new.id);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'admin');
$$;

alter table public.profiles enable row level security;
alter table public.agency_settings enable row level security;
alter table public.files enable row level security;
alter table public.movements enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using ((select auth.uid()) = id or public.is_admin());
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated using ((select auth.uid()) = id or public.is_admin()) with check ((select auth.uid()) = id or public.is_admin());

drop policy if exists agency_settings_select on public.agency_settings;
create policy agency_settings_select on public.agency_settings for select to authenticated using ((select auth.uid()) = owner_id or public.is_admin());
drop policy if exists agency_settings_insert on public.agency_settings;
create policy agency_settings_insert on public.agency_settings for insert to authenticated with check ((select auth.uid()) = owner_id or public.is_admin());
drop policy if exists agency_settings_update on public.agency_settings;
create policy agency_settings_update on public.agency_settings for update to authenticated using ((select auth.uid()) = owner_id or public.is_admin()) with check ((select auth.uid()) = owner_id or public.is_admin());

drop policy if exists files_select on public.files;
create policy files_select on public.files for select to authenticated using ((select auth.uid()) = owner_id or public.is_admin());
drop policy if exists files_insert on public.files;
create policy files_insert on public.files for insert to authenticated with check ((select auth.uid()) = owner_id or public.is_admin());
drop policy if exists files_update on public.files;
create policy files_update on public.files for update to authenticated using ((select auth.uid()) = owner_id or public.is_admin()) with check ((select auth.uid()) = owner_id or public.is_admin());
drop policy if exists files_delete on public.files;
create policy files_delete on public.files for delete to authenticated using ((select auth.uid()) = owner_id or public.is_admin());

drop policy if exists movements_select on public.movements;
create policy movements_select on public.movements for select to authenticated using ((select auth.uid()) = owner_id or public.is_admin());
drop policy if exists movements_insert on public.movements;
create policy movements_insert on public.movements for insert to authenticated with check (
  public.is_admin() or ((select auth.uid()) = owner_id and exists (select 1 from public.files f where f.id = file_id and f.owner_id = (select auth.uid())))
);

revoke all on public.profiles, public.agency_settings, public.files, public.movements from anon;
grant select on public.profiles, public.agency_settings, public.files, public.movements to authenticated;
grant update (name, agency_type) on public.profiles to authenticated;
grant insert, update on public.agency_settings to authenticated;
grant insert, update, delete on public.files to authenticated;
grant insert on public.movements to authenticated;

-- Promote the first Auth account once through SQL Editor:
-- update public.profiles set role = 'admin' where email = 'YOUR_ADMIN_EMAIL';
