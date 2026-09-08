-- Capitalize every word in staff-account and recipient-directory names.
-- Existing names are normalized once and future writes are protected by triggers.

create or replace function public.title_case_person_name(p_name text)
returns text
language sql
stable
set search_path = ''
as $$
  select initcap(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'));
$$;

revoke all on function public.title_case_person_name(text) from public;

create or replace function public.normalize_staff_profile_name()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role = 'staff' then
    new.name := public.title_case_person_name(new.name);
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_normalize_staff_name on public.profiles;
create trigger profiles_normalize_staff_name
before insert or update of name, role on public.profiles
for each row execute function public.normalize_staff_profile_name();

revoke all on function public.normalize_staff_profile_name() from public;

create or replace function public.set_staff_recipient_links()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select coalesce(
    jsonb_agg(
      case
        when jsonb_typeof(directory.entry) = 'object'
             and nullif(btrim(directory.entry ->> 'nama'), '') is not null then
          directory.entry || jsonb_build_object(
            'nama', public.title_case_person_name(directory.entry ->> 'nama')
          )
        else directory.entry
      end
      order by directory.position
    ),
    '[]'::jsonb
  )
    into new.staff
    from jsonb_array_elements(
      case when jsonb_typeof(new.staff) = 'array' then new.staff else '[]'::jsonb end
    ) with ordinality as directory(entry, position);

  new.staff := public.link_staff_recipient_entries(new.owner_id, new.staff);
  return new;
end;
$$;

revoke all on function public.set_staff_recipient_links() from public;

-- Normalize every previously registered staff account. The existing profile
-- synchronization trigger also updates any directory entry linked by user_id.
update public.profiles
   set name = public.title_case_person_name(name)
 where role = 'staff'
   and name is distinct from public.title_case_person_name(name);

-- Normalize linked and unlinked names already stored in every directory.
update public.agency_settings
   set staff = staff;

analyze public.profiles;
analyze public.agency_settings;
notify pgrst, 'reload schema';
