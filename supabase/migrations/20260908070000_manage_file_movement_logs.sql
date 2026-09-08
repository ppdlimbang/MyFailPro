-- Allow authenticated workspace members to correct or delete an erroneous
-- movement while keeping the file's current holder and notifications consistent.

create or replace function public.refresh_file_from_movement_history(p_file_id uuid)
returns public.files
language plpgsql
security definer
set search_path = ''
as $$
declare
  latest_holder text;
  updated_file public.files;
begin
  select movement.to_holder
    into latest_holder
    from public.movements as movement
   where movement.file_id = p_file_id
   order by movement.moved_at desc, movement.created_at desc, movement.id desc
   limit 1;

  latest_holder := coalesce(nullif(btrim(latest_holder), ''), 'Bilik Fail');

  update public.files
     set current_holder = latest_holder,
         status = case
           when lower(latest_holder) = lower('Bilik Fail') then 'Bilik Fail'
           else 'Sedang Beredar'
         end
   where id = p_file_id
  returning * into updated_file;

  return updated_file;
end;
$$;

revoke all on function public.refresh_file_from_movement_history(uuid) from public;

create or replace function public.correct_file_movement(
  p_movement_id uuid,
  p_from_holder text,
  p_to_holder text,
  p_moved_at timestamptz,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  authenticated_user uuid := (select auth.uid());
  workspace_owner uuid := (select public.current_workspace_owner());
  selected_movement public.movements;
  updated_movement public.movements;
  updated_file public.files;
  actor_name text;
  actor_email text;
  clean_from text := regexp_replace(btrim(coalesce(p_from_holder, '')), '\s+', ' ', 'g');
  clean_to text := regexp_replace(btrim(coalesce(p_to_holder, '')), '\s+', ' ', 'g');
begin
  if authenticated_user is null or workspace_owner is null then
    raise exception using errcode = '42501', message = 'Log masuk diperlukan.';
  end if;

  if clean_from = '' or clean_to = '' or p_moved_at is null then
    raise exception using errcode = '22023', message = 'Daripada, Kepada serta tarikh dan masa diperlukan.';
  end if;

  select *
    into selected_movement
    from public.movements
   where id = p_movement_id
   for update;

  if not found or (
    selected_movement.owner_id <> workspace_owner and
    not (select public.is_admin())
  ) then
    raise exception using errcode = 'P0002', message = 'Log pergerakan tidak ditemui atau akses ditolak.';
  end if;

  perform 1
    from public.files
   where id = selected_movement.file_id
   for update;

  select nullif(btrim(profile.name), ''), nullif(btrim(profile.email), '')
    into actor_name, actor_email
    from public.profiles as profile
   where profile.id = authenticated_user;

  delete from public.file_notifications
   where movement_id = selected_movement.id;

  update public.movements
     set moved_at = p_moved_at,
         from_holder = clean_from,
         to_holder = clean_to,
         note = btrim(coalesce(p_note, '')),
         performed_by = authenticated_user,
         performed_by_name = coalesce(actor_name, actor_email, 'Pengguna MyFailPro'),
         performed_by_email = actor_email
   where id = selected_movement.id
  returning * into updated_movement;

  updated_file := public.refresh_file_from_movement_history(selected_movement.file_id);

  return jsonb_build_object(
    'movement', to_jsonb(updated_movement),
    'file', to_jsonb(updated_file)
  );
end;
$$;

revoke all on function public.correct_file_movement(uuid, text, text, timestamptz, text) from public;
grant execute on function public.correct_file_movement(uuid, text, text, timestamptz, text) to authenticated;

create or replace function public.delete_file_movement(p_movement_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  authenticated_user uuid := (select auth.uid());
  workspace_owner uuid := (select public.current_workspace_owner());
  selected_movement public.movements;
  updated_file public.files;
begin
  if authenticated_user is null or workspace_owner is null then
    raise exception using errcode = '42501', message = 'Log masuk diperlukan.';
  end if;

  select *
    into selected_movement
    from public.movements
   where id = p_movement_id
   for update;

  if not found or (
    selected_movement.owner_id <> workspace_owner and
    not (select public.is_admin())
  ) then
    raise exception using errcode = 'P0002', message = 'Log pergerakan tidak ditemui atau akses ditolak.';
  end if;

  perform 1
    from public.files
   where id = selected_movement.file_id
   for update;

  delete from public.movements
   where id = selected_movement.id;

  updated_file := public.refresh_file_from_movement_history(selected_movement.file_id);

  return jsonb_build_object('file', to_jsonb(updated_file));
end;
$$;

revoke all on function public.delete_file_movement(uuid) from public;
grant execute on function public.delete_file_movement(uuid) to authenticated;

-- A corrected destination must replace any stale notification and notify the
-- corrected recipient where applicable.
drop trigger if exists movements_notify_recipient on public.movements;
create trigger movements_notify_recipient
after insert or update of from_holder, to_holder, moved_at, performed_by,
  performed_by_name, performed_by_email on public.movements
for each row execute function public.create_file_recipient_notification();

analyze public.movements;
analyze public.files;
notify pgrst, 'reload schema';
