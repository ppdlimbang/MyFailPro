-- Keep the existing education-office link and PeD recipient link identical.
-- The earlier PeD migration may already be installed before this migration.
begin;

alter table public.profiles
  add column if not exists parent_agency_id uuid references public.profiles(id) on delete set null;

grant update (parent_agency_id) on public.profiles to authenticated;

create or replace function public.ped_guard_office_assignment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.agency_type is distinct from old.agency_type
     and auth.uid() is not null and not public.is_admin() then
    raise exception 'Hanya admin sistem boleh mengubah jenis agensi.' using errcode = '42501';
  end if;

  if new.parent_agency_id is distinct from old.parent_agency_id
     and new.ped_office_id is not distinct from old.ped_office_id then
    new.ped_office_id := new.parent_agency_id;
  elsif new.ped_office_id is distinct from old.ped_office_id
     and new.parent_agency_id is not distinct from old.parent_agency_id then
    new.parent_agency_id := new.ped_office_id;
  elsif new.ped_office_id is distinct from new.parent_agency_id then
    raise exception 'Pejabat Pendidikan dan Pejabat PeD mesti sama.' using errcode = '23514';
  end if;

  if new.ped_office_id is distinct from old.ped_office_id
     or new.parent_agency_id is distinct from old.parent_agency_id then
    if auth.uid() is not null and not public.is_admin() then
      raise exception 'Hanya admin sistem boleh menetapkan Pejabat sekolah.' using errcode = '42501';
    end if;
    if new.ped_office_id is not null then
      if new.role <> 'agency' or lower(btrim(new.agency_type)) <> 'sekolah' then
        raise exception 'Pejabat hanya boleh ditetapkan kepada akaun sekolah.' using errcode = '23514';
      end if;
      if not exists (
        select 1 from public.profiles p where p.id = new.ped_office_id
          and p.role = 'agency' and lower(btrim(p.agency_type)) = 'pejabat'
      ) then
        raise exception 'Pilih akaun Pejabat yang sah.' using errcode = '23514';
      end if;
    end if;
  end if;
  return new;
end;
$$;

-- Backfill existing school accounts from either previous mapping.
update public.profiles
   set parent_agency_id = ped_office_id
 where role = 'agency' and lower(btrim(agency_type)) = 'sekolah'
   and parent_agency_id is null and ped_office_id is not null;

update public.profiles
   set ped_office_id = parent_agency_id
 where role = 'agency' and lower(btrim(agency_type)) = 'sekolah'
   and parent_agency_id is not null
   and ped_office_id is distinct from parent_agency_id;

drop trigger if exists ped_sync_school_office on public.profiles;
create trigger ped_sync_school_office
after update on public.profiles
for each row execute function public.ped_sync_school_office();

notify pgrst, 'reload schema';
commit;
