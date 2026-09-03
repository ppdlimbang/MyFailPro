-- MyFailPro database optimization: query indexes, stricter integrity, and
-- atomic file registration/movement operations. This migration is additive
-- and does not delete existing application data.

-- Match the application's most common tenant-scoped filters and sort orders.
create index if not exists profiles_role_name_idx
  on public.profiles (role, name);

create index if not exists files_owner_status_idx
  on public.files (owner_id, status);

create index if not exists files_owner_function_transaction_idx
  on public.files (owner_id, function_name, transaction_code, volume);

create index if not exists movements_owner_moved_at_idx
  on public.movements (owner_id, moved_at desc);

-- New writes must contain meaningful classification and holder values. The
-- constraints are NOT VALID so legacy rows do not block this safe upgrade.
do $migration$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'files_required_text_not_blank'
      and conrelid = 'public.files'::regclass
  ) then
    alter table public.files
      add constraint files_required_text_not_blank check (
        btrim(function_name) <> '' and
        btrim(activity_name) <> '' and
        btrim(sub_activity_name) <> '' and
        btrim(transaction_code) <> '' and
        btrim(current_holder) <> ''
      ) not valid;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'movements_required_text_not_blank'
      and conrelid = 'public.movements'::regclass
  ) then
    alter table public.movements
      add constraint movements_required_text_not_blank check (
        btrim(from_holder) <> '' and btrim(to_holder) <> ''
      ) not valid;
  end if;
end;
$migration$;

-- Derive movement ownership from the selected file. This prevents owner_id
-- drift even for trusted administrative writes.
create or replace function public.set_movement_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolved_owner uuid;
begin
  select f.owner_id
    into resolved_owner
    from public.files as f
   where f.id = new.file_id;

  if resolved_owner is null then
    raise exception using
      errcode = '23503',
      message = 'Fail untuk rekod pergerakan tidak ditemui.';
  end if;

  new.owner_id = resolved_owner;
  return new;
end;
$$;

drop trigger if exists movements_set_owner on public.movements;
create trigger movements_set_owner
before insert or update of file_id, owner_id on public.movements
for each row execute function public.set_movement_owner();

revoke all on function public.set_movement_owner() from public;

-- Register a file and its initial movement as one transaction. owner_id is
-- always sourced from the authenticated session, never from browser input.
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
  authenticated_owner uuid := (select auth.uid());
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

-- Update a file holder and record the movement as one transaction. RLS still
-- controls which file the signed-in user may update.
create or replace function public.move_file(
  p_file_id uuid,
  p_to_holder text,
  p_moved_at timestamptz,
  p_note text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  selected_file public.files;
  updated_file public.files;
  created_movement public.movements;
  clean_holder text := btrim(p_to_holder);
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'Log masuk diperlukan.';
  end if;

  if clean_holder = '' then
    raise exception using errcode = '22023', message = 'Keberadaan fail diperlukan.';
  end if;

  select *
    into selected_file
    from public.files
   where id = p_file_id
   for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Fail tidak ditemui atau akses ditolak.';
  end if;

  if selected_file.current_holder = clean_holder and btrim(coalesce(p_note, '')) = '' then
    raise exception using errcode = '22023', message = 'Tiada perubahan pergerakan untuk disimpan.';
  end if;

  update public.files
     set current_holder = clean_holder,
         status = case when lower(clean_holder) = lower('Bilik Fail')
                       then 'Bilik Fail' else 'Sedang Beredar' end
   where id = selected_file.id
  returning * into updated_file;

  insert into public.movements (
    file_id,
    owner_id,
    moved_at,
    from_holder,
    to_holder,
    note
  ) values (
    selected_file.id,
    selected_file.owner_id,
    coalesce(p_moved_at, now()),
    selected_file.current_holder,
    clean_holder,
    btrim(coalesce(p_note, ''))
  ) returning * into created_movement;

  return jsonb_build_object(
    'file', to_jsonb(updated_file),
    'movement', to_jsonb(created_movement)
  );
end;
$$;

revoke all on function public.register_file(text, text, text, text, integer, date, date) from public;
revoke all on function public.move_file(uuid, text, timestamptz, text) from public;
grant execute on function public.register_file(text, text, text, text, integer, date, date) to authenticated;
grant execute on function public.move_file(uuid, text, timestamptz, text) to authenticated;

-- Wrap stable security checks in SELECT so PostgreSQL can evaluate them once
-- per statement instead of once per returned row.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
using ((select auth.uid()) = id or (select public.is_admin()));

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
using ((select auth.uid()) = id or (select public.is_admin()))
with check ((select auth.uid()) = id or (select public.is_admin()));

drop policy if exists agency_settings_select on public.agency_settings;
create policy agency_settings_select on public.agency_settings for select to authenticated
using ((select auth.uid()) = owner_id or (select public.is_admin()));

drop policy if exists agency_settings_insert on public.agency_settings;
create policy agency_settings_insert on public.agency_settings for insert to authenticated
with check ((select auth.uid()) = owner_id or (select public.is_admin()));

drop policy if exists agency_settings_update on public.agency_settings;
create policy agency_settings_update on public.agency_settings for update to authenticated
using ((select auth.uid()) = owner_id or (select public.is_admin()))
with check ((select auth.uid()) = owner_id or (select public.is_admin()));

drop policy if exists files_select on public.files;
create policy files_select on public.files for select to authenticated
using ((select auth.uid()) = owner_id or (select public.is_admin()));

drop policy if exists files_insert on public.files;
create policy files_insert on public.files for insert to authenticated
with check ((select auth.uid()) = owner_id or (select public.is_admin()));

drop policy if exists files_update on public.files;
create policy files_update on public.files for update to authenticated
using ((select auth.uid()) = owner_id or (select public.is_admin()))
with check ((select auth.uid()) = owner_id or (select public.is_admin()));

drop policy if exists files_delete on public.files;
create policy files_delete on public.files for delete to authenticated
using ((select auth.uid()) = owner_id or (select public.is_admin()));

drop policy if exists movements_select on public.movements;
create policy movements_select on public.movements for select to authenticated
using ((select auth.uid()) = owner_id or (select public.is_admin()));

drop policy if exists movements_insert on public.movements;
create policy movements_insert on public.movements for insert to authenticated
with check (
  (select public.is_admin()) or (
    (select auth.uid()) = owner_id and
    exists (
      select 1
        from public.files as f
       where f.id = file_id
         and f.owner_id = (select auth.uid())
    )
  )
);

-- Keep helper execution limited to signed-in users; policies continue to use it.
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

analyze public.profiles;
analyze public.agency_settings;
analyze public.files;
analyze public.movements;
