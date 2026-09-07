-- Agency staff accounts share their parent agency's workspace while keeping
-- account creation and settings management restricted to the agency owner.

alter table public.profiles
  add column if not exists agency_id uuid;

do $migration$
begin
  if not exists (
    select 1
      from pg_catalog.pg_constraint
     where conname = 'profiles_agency_id_fkey'
       and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_agency_id_fkey
      foreign key (agency_id) references public.profiles(id) on delete restrict;
  end if;
end;
$migration$;

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('admin', 'agency', 'staff'));

alter table public.profiles drop constraint if exists profiles_agency_membership_check;
alter table public.profiles
  add constraint profiles_agency_membership_check
  check (
    (role = 'staff' and agency_id is not null and agency_id <> id) or
    (role in ('admin', 'agency') and agency_id is null)
  );

create index if not exists profiles_agency_role_name_idx
  on public.profiles (agency_id, role, name);

create or replace function public.current_workspace_owner()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p.agency_id, p.id)
    from public.profiles as p
   where p.id = (select auth.uid());
$$;

revoke all on function public.current_workspace_owner() from public;
grant execute on function public.current_workspace_owner() to authenticated;

-- Staff registrations are written under the agency owner so unique file
-- checks, settings and movement history remain shared by the whole agency.
create or replace function public.register_file(
  p_function_name text,
  p_activity_name text,
  p_sub_activity_name text,
  p_transaction_code text,
  p_volume integer,
  p_opened_on date,
  p_closed_on date
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  authenticated_owner uuid := (select public.current_workspace_owner());
  created_file public.files;
  created_movement public.movements;
begin
  if authenticated_owner is null then
    raise exception using errcode = '42501', message = 'Log masuk diperlukan.';
  end if;

  insert into public.files (
    owner_id,
    function_name,
    activity_name,
    sub_activity_name,
    transaction_code,
    volume,
    opened_on,
    closed_on,
    status,
    current_holder
  ) values (
    authenticated_owner,
    btrim(p_function_name),
    btrim(p_activity_name),
    btrim(p_sub_activity_name),
    btrim(p_transaction_code),
    p_volume,
    p_opened_on,
    p_closed_on,
    'Bilik Fail',
    'Bilik Fail'
  ) returning * into created_file;

  insert into public.movements (
    file_id,
    owner_id,
    moved_at,
    from_holder,
    to_holder,
    note
  ) values (
    created_file.id,
    authenticated_owner,
    now(),
    'Sistem Pendaftaran',
    'Bilik Fail',
    'Rekod asal dicipta'
  ) returning * into created_movement;

  return jsonb_build_object(
    'file', to_jsonb(created_file),
    'movement', to_jsonb(created_movement)
  );
end;
$$;

revoke all on function public.register_file(text, text, text, text, integer, date, date) from public;
grant execute on function public.register_file(text, text, text, text, integer, date, date) to authenticated;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
using (
  (select auth.uid()) = id or
  agency_id = (select auth.uid()) or
  (select public.is_admin())
);

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
using ((select auth.uid()) = id or (select public.is_admin()))
with check ((select auth.uid()) = id or (select public.is_admin()));

drop policy if exists agency_settings_select on public.agency_settings;
create policy agency_settings_select on public.agency_settings for select to authenticated
using (owner_id = (select public.current_workspace_owner()) or (select public.is_admin()));

drop policy if exists agency_settings_insert on public.agency_settings;
create policy agency_settings_insert on public.agency_settings for insert to authenticated
with check ((select auth.uid()) = owner_id or (select public.is_admin()));

drop policy if exists agency_settings_update on public.agency_settings;
create policy agency_settings_update on public.agency_settings for update to authenticated
using ((select auth.uid()) = owner_id or (select public.is_admin()))
with check ((select auth.uid()) = owner_id or (select public.is_admin()));

drop policy if exists files_select on public.files;
create policy files_select on public.files for select to authenticated
using (owner_id = (select public.current_workspace_owner()) or (select public.is_admin()));

drop policy if exists files_insert on public.files;
create policy files_insert on public.files for insert to authenticated
with check (owner_id = (select public.current_workspace_owner()) or (select public.is_admin()));

drop policy if exists files_update on public.files;
create policy files_update on public.files for update to authenticated
using (owner_id = (select public.current_workspace_owner()) or (select public.is_admin()))
with check (owner_id = (select public.current_workspace_owner()) or (select public.is_admin()));

drop policy if exists files_delete on public.files;
create policy files_delete on public.files for delete to authenticated
using (owner_id = (select public.current_workspace_owner()) or (select public.is_admin()));

drop policy if exists movements_select on public.movements;
create policy movements_select on public.movements for select to authenticated
using (owner_id = (select public.current_workspace_owner()) or (select public.is_admin()));

drop policy if exists movements_insert on public.movements;
create policy movements_insert on public.movements for insert to authenticated
with check (
  (select public.is_admin()) or (
    owner_id = (select public.current_workspace_owner()) and
    exists (
      select 1
        from public.files as f
       where f.id = file_id
         and f.owner_id = (select public.current_workspace_owner())
    )
  )
);

analyze public.profiles;
notify pgrst, 'reload schema';
