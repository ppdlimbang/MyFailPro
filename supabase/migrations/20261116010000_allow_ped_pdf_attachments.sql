-- Optional PDF/image attachments for office and school outgoing correspondence.
-- Run after 20261105030000_enable_ped_for_all_workspace_users.sql.
-- Re-running is safe; existing records, files and bucket privacy are preserved.
begin;

-- Keep the existing size limit and MIME types; add PDF to the private bucket.
update storage.buckets
set allowed_mime_types = array(
  select distinct mime from unnest(allowed_mime_types || array['application/pdf']) as types(mime)
)
where id = 'ped-correspondence' and allowed_mime_types is not null;

-- Preserve the current school workflow and office field protections. Schools
-- may change their own attachment only while the letter remains editable.
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

  -- A changed attachment must belong to this workspace. Existing attachments
  -- remain readable by the recipient through the correspondence storage policy.
  if (tg_op = 'INSERT' or new.attachment_path is distinct from old.attachment_path)
     and nullif(new.attachment_path, '') is not null
     and split_part(new.attachment_path, '/', 1) <> workspace.id::text then
    raise exception 'Lampiran mesti dimuat naik dalam ruang kerja anda.' using errcode = '42501';
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
         new.notes)
        is distinct from
        (old.sender, old.recipient, old.department_sectors, old.assigned_officers,
         old.school_sector, old.assigned_to, old.office_reference_file,
         old.registry_file_number, old.origin_sector, old.delivery_methods,
         old.notes) then
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
notify pgrst, 'reload schema';
commit;
