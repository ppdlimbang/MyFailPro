-- Link recipient-directory entries to staff accounts when their normalized names match.
-- The link is refreshed whenever either the directory or a staff profile changes.

create or replace function public.link_staff_recipient_entries(
  p_owner_id uuid,
  p_staff jsonb
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      case
        when matched.match_count = 1 then
          directory.entry || jsonb_build_object(
            'user_id', matched.staff_id,
            'email', matched.staff_email,
            'avatar_key', matched.avatar_key
          )
        else directory.entry - 'user_id' - 'email' - 'avatar_key'
      end
      order by directory.position
    ),
    '[]'::jsonb
  )
  from jsonb_array_elements(
    case when jsonb_typeof(p_staff) = 'array' then p_staff else '[]'::jsonb end
  ) with ordinality as directory(entry, position)
  cross join lateral (
    select
      (array_agg(profile.id order by profile.id))[1] as staff_id,
      (array_agg(profile.email order by profile.id))[1] as staff_email,
      (array_agg(profile.avatar_key order by profile.id))[1] as avatar_key,
      count(*) as match_count
    from public.profiles as profile
    where profile.role = 'staff'
      and profile.agency_id = p_owner_id
      and lower(regexp_replace(btrim(profile.name), '\s+', ' ', 'g')) =
          lower(regexp_replace(btrim(directory.entry ->> 'nama'), '\s+', ' ', 'g'))
  ) as matched;
$$;

revoke all on function public.link_staff_recipient_entries(uuid, jsonb) from public;

create or replace function public.set_staff_recipient_links()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.staff := public.link_staff_recipient_entries(new.owner_id, new.staff);
  return new;
end;
$$;

drop trigger if exists agency_settings_link_staff_recipients on public.agency_settings;
create trigger agency_settings_link_staff_recipients
before insert or update of owner_id, staff on public.agency_settings
for each row execute function public.set_staff_recipient_links();

revoke all on function public.set_staff_recipient_links() from public;

create or replace function public.refresh_staff_recipient_links()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_owner uuid;
  current_owner uuid;
begin
  if tg_op <> 'INSERT' and old.role = 'staff' then
    previous_owner := old.agency_id;
  end if;

  if tg_op <> 'DELETE' and new.role = 'staff' then
    current_owner := new.agency_id;
  end if;

  if previous_owner is not null then
    update public.agency_settings
       set staff = staff
     where owner_id = previous_owner;
  end if;

  if current_owner is not null and current_owner is distinct from previous_owner then
    update public.agency_settings
       set staff = staff
     where owner_id = current_owner;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_refresh_staff_recipient_links_insert_delete on public.profiles;
create trigger profiles_refresh_staff_recipient_links_insert_delete
after insert or delete on public.profiles
for each row execute function public.refresh_staff_recipient_links();

drop trigger if exists profiles_refresh_staff_recipient_links_update on public.profiles;
create trigger profiles_refresh_staff_recipient_links_update
after update of name, email, role, agency_id, avatar_key on public.profiles
for each row execute function public.refresh_staff_recipient_links();

revoke all on function public.refresh_staff_recipient_links() from public;

-- Prefer the durable directory-to-account link when delivering notifications.
create or replace function public.create_file_recipient_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  matched_recipient uuid;
  matched_count integer;
  file_code text;
  file_volume integer;
begin
  if lower(btrim(new.from_holder)) = lower('Sistem Pendaftaran') then
    return new;
  end if;

  select (array_agg(linked.id order by linked.id))[1], count(*)
    into matched_recipient, matched_count
    from (
      select distinct profile.id
        from public.agency_settings as settings
        cross join lateral jsonb_array_elements(settings.staff) as directory(entry)
        join public.profiles as profile
          on profile.id::text = directory.entry ->> 'user_id'
         and profile.role = 'staff'
         and profile.agency_id = new.owner_id
         and lower(regexp_replace(btrim(profile.name), '\s+', ' ', 'g')) =
             lower(regexp_replace(btrim(directory.entry ->> 'nama'), '\s+', ' ', 'g'))
       where settings.owner_id = new.owner_id
         and lower(regexp_replace(btrim(directory.entry ->> 'nama'), '\s+', ' ', 'g')) =
             lower(regexp_replace(btrim(new.to_holder), '\s+', ' ', 'g'))
    ) as linked;

  -- Compatibility fallback for a movement created before a directory row is linked.
  if matched_count = 0 then
    select (array_agg(profile.id order by profile.id))[1], count(*)
      into matched_recipient, matched_count
      from public.profiles as profile
     where profile.role = 'staff'
       and profile.agency_id = new.owner_id
       and lower(regexp_replace(btrim(profile.name), '\s+', ' ', 'g')) =
           lower(regexp_replace(btrim(new.to_holder), '\s+', ' ', 'g'));
  end if;

  if matched_count <> 1 or matched_recipient is null or matched_recipient = new.performed_by then
    return new;
  end if;

  select file.transaction_code, file.volume
    into file_code, file_volume
    from public.files as file
   where file.id = new.file_id;

  if not found then
    return new;
  end if;

  insert into public.file_notifications (
    recipient_id,
    movement_id,
    file_id,
    actor_id,
    actor_name,
    actor_email,
    transaction_code,
    volume,
    from_holder,
    to_holder,
    moved_at
  ) values (
    matched_recipient,
    new.id,
    new.file_id,
    new.performed_by,
    coalesce(nullif(btrim(new.performed_by_name), ''), 'Pengguna MyFailPro'),
    nullif(btrim(new.performed_by_email), ''),
    file_code,
    file_volume,
    new.from_holder,
    new.to_holder,
    new.moved_at
  )
  on conflict (recipient_id, movement_id) do nothing;

  return new;
end;
$$;

revoke all on function public.create_file_recipient_notification() from public;

-- Backfill links for directory entries that already exist.
update public.agency_settings
   set staff = staff;

analyze public.agency_settings;
notify pgrst, 'reload schema';
