begin;

-- Let authenticated agency staff use PeD within their linked agency workspace.
create or replace function public.can_access_ped()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.profiles as actor
     where actor.id = (select auth.uid())
       and (
         actor.role in ('admin', 'agency')
         or (
           actor.role = 'staff'
           and exists (
             select 1 from public.profiles as workspace
              where workspace.id = actor.agency_id and workspace.role = 'agency'
           )
         )
       )
  );
$$;

create or replace function public.ped_workspace_profile()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', workspace.id,
    'name', workspace.name,
    'agency_type', workspace.agency_type,
    'ped_office_id', workspace.ped_office_id
  )
    from public.profiles as workspace
   where workspace.id = (select public.current_workspace_owner())
     and workspace.role = 'agency';
$$;

create or replace function public.ped_school_office_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select ped_office_id
    from public.profiles
   where id = (select public.current_workspace_owner())
     and role = 'agency'
     and lower(btrim(agency_type)) = 'sekolah';
$$;

create or replace function public.ped_is_office()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.profiles
     where id = (select public.current_workspace_owner())
       and role = 'agency'
       and lower(btrim(agency_type)) = 'pejabat'
  );
$$;

create or replace function public.ped_is_school()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.profiles
     where id = (select public.current_workspace_owner())
       and role = 'agency'
       and lower(btrim(agency_type)) = 'sekolah'
  );
$$;

create or replace function public.ped_school_belongs_to_office(p_school_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.profiles as school
     where school.id = p_school_id
       and school.role = 'agency'
       and lower(btrim(school.agency_type)) = 'sekolah'
       and school.ped_office_id = (select public.current_workspace_owner())
       and (select public.ped_is_office())
  );
$$;

revoke all on function public.can_access_ped() from public;
revoke all on function public.ped_workspace_profile() from public;
revoke all on function public.ped_school_office_id() from public;
revoke all on function public.ped_is_office() from public;
revoke all on function public.ped_is_school() from public;
revoke all on function public.ped_school_belongs_to_office(uuid) from public;
grant execute on function public.can_access_ped() to authenticated;
grant execute on function public.ped_workspace_profile() to authenticated;
grant execute on function public.ped_school_office_id() to authenticated;
grant execute on function public.ped_is_office() to authenticated;
grant execute on function public.ped_is_school() to authenticated;
grant execute on function public.ped_school_belongs_to_office(uuid) to authenticated;

drop policy if exists profiles_ped_assigned_office_select on public.profiles;
create policy profiles_ped_assigned_office_select
on public.profiles for select to authenticated
using (id = (select public.ped_school_office_id()));

drop policy if exists profiles_ped_office_schools_select on public.profiles;
create policy profiles_ped_office_schools_select
on public.profiles for select to authenticated
using (
  ped_office_id = (select public.current_workspace_owner())
  and (select public.ped_is_office())
);

create or replace function public.ped_validate_school_record()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.profiles;
  workspace public.profiles;
  target_school public.profiles;
begin
  select * into actor from public.profiles where id = (select auth.uid());
  if actor.role = 'admin' then
    return new;
  end if;

  if actor.role = 'staff' then
    select * into workspace
      from public.profiles
     where id = actor.agency_id and role = 'agency';
  elsif actor.role = 'agency' then
    workspace := actor;
  end if;

  if workspace.id is null then
    raise exception 'Akses PeD tidak dibenarkan.' using errcode = '42501';
  end if;
  if new.owner_id is distinct from workspace.id
     and not (
       lower(btrim(workspace.agency_type)) = 'pejabat'
       and new.category = 'school_in'
       and new.school_id is not null
     ) then
    raise exception 'Rekod PeD mesti disimpan dalam ruang kerja agensi anda.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and (new.owner_id <> old.owner_id or new.category <> old.category) then
    raise exception 'Pemilik atau kategori surat tidak boleh diubah.' using errcode = '42501';
  end if;

  if lower(btrim(workspace.agency_type)) = 'sekolah' then
    if new.category not in ('school_in', 'school_received') then
      raise exception 'Sekolah hanya boleh mengurus suratnya sendiri.' using errcode = '42501';
    end if;
    if new.category = 'school_in' then
      if workspace.ped_office_id is null then
        raise exception 'Pejabat penerima belum ditetapkan untuk sekolah ini.' using errcode = '23514';
      end if;
      if tg_op = 'UPDATE' and old.status not in ('Dihantar', 'Dihantar Semula', 'Dikembalikan') then
        raise exception 'Surat yang sedang diproses Pejabat tidak boleh diubah oleh sekolah.' using errcode = '42501';
      end if;
      if new.status not in ('Dihantar', 'Dihantar Semula') then
        raise exception 'Status ini hanya boleh ditetapkan oleh Pejabat.' using errcode = '42501';
      end if;
      if tg_op = 'INSERT' and new.status <> 'Dihantar' then
        raise exception 'Surat Keluar baharu mesti berstatus Dihantar.' using errcode = '23514';
      end if;
      if tg_op = 'UPDATE' and old.status = 'Dihantar' and new.status <> 'Dihantar' then
        raise exception 'Surat hanya boleh dihantar semula selepas dikembalikan Pejabat.' using errcode = '23514';
      end if;
      if tg_op = 'UPDATE' and old.status = 'Dikembalikan'
         and new.status <> 'Dihantar Semula' then
        raise exception 'Surat yang dikembalikan mesti dihantar semula.' using errcode = '23514';
      end if;
      if tg_op = 'UPDATE' and
        (new.sender, new.recipient, new.department_sectors, new.assigned_officers,
         new.school_sector, new.assigned_to, new.office_reference_file,
         new.registry_file_number, new.origin_sector, new.delivery_methods,
         new.notes, new.attachment_path)
        is distinct from
        (old.sender, old.recipient, old.department_sectors, old.assigned_officers,
         old.school_sector, old.assigned_to, old.office_reference_file,
         old.registry_file_number, old.origin_sector, old.delivery_methods,
         old.notes, old.attachment_path) then
        raise exception 'Medan tindakan Pejabat tidak boleh diubah oleh sekolah.' using errcode = '42501';
      end if;
      new.school_id := workspace.id;
      new.office_id := workspace.ped_office_id;
      new.school_name := workspace.name;
      new.correspondent := workspace.name;
    else
      new.school_id := workspace.id;
      new.office_id := null;
    end if;
  elsif new.category = 'school_received' then
    raise exception 'Surat Masuk Sekolah hanya untuk akaun sekolah.' using errcode = '42501';
  elsif new.category = 'school_in' and new.school_id is not null then
    select * into target_school from public.profiles where id = new.school_id;
    if lower(btrim(workspace.agency_type)) <> 'pejabat'
       or target_school.ped_office_id is distinct from workspace.id then
      raise exception 'Sekolah ini tidak ditetapkan kepada Pejabat anda.' using errcode = '42501';
    end if;
    if new.status = 'Dihantar Semula'
       and (tg_op = 'INSERT' or old.status is distinct from new.status) then
      raise exception 'Status Dihantar Semula hanya boleh ditetapkan oleh sekolah.' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and old.owner_id <> workspace.id
       and (new.correspondence_date, new.reference_number, new.correspondent,
            new.sender, new.school_name, new.recipient, new.department_sectors,
            new.assigned_officers, new.office_reference_file, new.origin_sector,
            new.delivery_methods, new.subject, new.attachment_path,
            new.school_id, new.office_id)
         is distinct from
           (old.correspondence_date, old.reference_number, old.correspondent,
            old.sender, old.school_name, old.recipient, old.department_sectors,
            old.assigned_officers, old.office_reference_file, old.origin_sector,
            old.delivery_methods, old.subject, old.attachment_path,
            old.school_id, old.office_id) then
      raise exception 'Butiran asal sekolah tidak boleh diubah oleh Pejabat.' using errcode = '42501';
    end if;
    new.office_id := workspace.id;
    new.school_name := target_school.name;
    new.correspondent := target_school.name;
  end if;
  return new;
end;
$$;

revoke all on function public.ped_validate_school_record() from public;
grant execute on function public.ped_validate_school_record() to authenticated;

drop policy if exists ped_correspondence_select on public.ped_correspondence;
create policy ped_correspondence_select on public.ped_correspondence
for select to authenticated using (
  (select public.can_access_ped())
  and (not (select public.ped_is_school()) or category in ('school_in', 'school_received'))
  and (
    ((select public.is_admin()) and category <> 'school_received')
    or owner_id = (select public.current_workspace_owner())
    or (category = 'school_in' and school_id = (select public.current_workspace_owner()))
    or (category = 'school_in' and office_id = (select public.current_workspace_owner())
        and (select public.ped_is_office()))
  )
);

drop policy if exists ped_correspondence_insert on public.ped_correspondence;
create policy ped_correspondence_insert on public.ped_correspondence
for insert to authenticated with check (
  (select public.can_access_ped())
  and owner_id = (select public.current_workspace_owner())
  and (
    ((select public.ped_is_school()) and category = 'school_in'
      and school_id = (select public.current_workspace_owner())
      and office_id = (select public.ped_school_office_id()))
    or (not (select public.ped_is_school()) and category <> 'school_received'
      and (category <> 'school_in' or school_id is null
        or ((select public.ped_is_office()) and (select public.ped_school_belongs_to_office(school_id)))))
    or (category = 'school_received' and (select public.ped_is_school())
      and school_id = (select public.current_workspace_owner()))
  )
);

drop policy if exists ped_correspondence_update on public.ped_correspondence;
create policy ped_correspondence_update on public.ped_correspondence
for update to authenticated
using (
  (select public.can_access_ped())
  and (not (select public.ped_is_school()) or category in ('school_in', 'school_received'))
  and (
    ((select public.is_admin()) and category <> 'school_received')
    or owner_id = (select public.current_workspace_owner())
    or (category = 'school_in' and office_id = (select public.current_workspace_owner())
        and (select public.ped_is_office()))
  )
)
with check (
  (select public.can_access_ped())
  and (not (select public.ped_is_school()) or category in ('school_in', 'school_received'))
  and (
    ((select public.is_admin()) and category <> 'school_received')
    or owner_id = (select public.current_workspace_owner())
    or (category = 'school_in' and office_id = (select public.current_workspace_owner())
        and (select public.ped_is_office()))
  )
);

drop policy if exists ped_correspondence_delete on public.ped_correspondence;
create policy ped_correspondence_delete on public.ped_correspondence
for delete to authenticated using (
  (select public.can_access_ped())
  and (not (select public.ped_is_school()) or category in ('school_in', 'school_received'))
  and (
    ((select public.is_admin()) and category <> 'school_received')
    or (
      owner_id = (select public.current_workspace_owner())
      and (category <> 'school_in' or not (select public.ped_is_school())
        or status in ('Dihantar', 'Dihantar Semula', 'Dikembalikan'))
    )
    or (category = 'school_in' and office_id = (select public.current_workspace_owner())
        and (select public.ped_is_office()))
  )
);

-- Staff share the agency's private attachment folder. PeD recipients can read
-- an attachment only when its correspondence row is visible to their account.
drop policy if exists ped_correspondence_attachment_select on storage.objects;
create policy ped_correspondence_attachment_select
on storage.objects for select to authenticated using (
  bucket_id = 'ped-correspondence'
  and (select public.can_access_ped())
  and (
    (select public.is_admin())
    or (storage.foldername(name))[1] = (select public.current_workspace_owner())::text
    or exists (
      select 1 from public.ped_correspondence as letter
       where letter.attachment_path = storage.objects.name
    )
  )
);

drop policy if exists ped_correspondence_attachment_insert on storage.objects;
create policy ped_correspondence_attachment_insert
on storage.objects for insert to authenticated with check (
  bucket_id = 'ped-correspondence'
  and (select public.can_access_ped())
  and (storage.foldername(name))[1] = (select public.current_workspace_owner())::text
);

drop policy if exists ped_correspondence_attachment_update on storage.objects;
create policy ped_correspondence_attachment_update
on storage.objects for update to authenticated
using (
  bucket_id = 'ped-correspondence'
  and (select public.can_access_ped())
  and (
    (select public.is_admin())
    or (storage.foldername(name))[1] = (select public.current_workspace_owner())::text
  )
)
with check (
  bucket_id = 'ped-correspondence'
  and (select public.can_access_ped())
  and (
    (select public.is_admin())
    or (storage.foldername(name))[1] = (select public.current_workspace_owner())::text
  )
);

drop policy if exists ped_correspondence_attachment_delete on storage.objects;
create policy ped_correspondence_attachment_delete
on storage.objects for delete to authenticated using (
  bucket_id = 'ped-correspondence'
  and (select public.can_access_ped())
  and (
    (select public.is_admin())
    or (storage.foldername(name))[1] = (select public.current_workspace_owner())::text
  )
);

notify pgrst, 'reload schema';
commit;
