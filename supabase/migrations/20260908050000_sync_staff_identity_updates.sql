-- Keep a linked recipient-directory entry synchronized when an agency owner
-- changes a staff account's name, email address, or avatar.

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

  -- A directory entry already linked by user_id follows identity edits. The
  -- agency_settings trigger then validates and refreshes the stored link.
  if tg_op = 'UPDATE'
     and old.role = 'staff'
     and new.role = 'staff'
     and old.agency_id is not distinct from new.agency_id
     and current_owner is not null then
    update public.agency_settings as settings
       set staff = (
         select coalesce(
           jsonb_agg(
             case
               when directory.entry ->> 'user_id' = new.id::text then
                 directory.entry || jsonb_build_object(
                   'nama', btrim(new.name),
                   'email', new.email,
                   'avatar_key', new.avatar_key
                 )
               else directory.entry
             end
             order by directory.position
           ),
           '[]'::jsonb
         )
         from jsonb_array_elements(settings.staff) with ordinality
           as directory(entry, position)
       )
     where settings.owner_id = current_owner;

    previous_owner := null;
    current_owner := null;
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

revoke all on function public.refresh_staff_recipient_links() from public;

notify pgrst, 'reload schema';
