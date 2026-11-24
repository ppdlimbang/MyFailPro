-- Fix office_id ambiguity between the PL/pgSQL variable and recipient table
-- column when office staff synchronize school recipients.
begin;

create or replace function public.sync_ped_outgoing_school_recipients(
  p_correspondence_id uuid,
  p_school_ids uuid[],
  p_recipient_names text[]
)
returns setof public.ped_correspondence_school_recipients
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_office_id uuid := (select public.current_workspace_owner());
  recipient_ids uuid[];
begin
  if not (select public.can_access_ped()) or not (select public.ped_is_office()) then
    raise exception 'Hanya akaun Pejabat boleh menetapkan sekolah penerima.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.ped_correspondence as letter
     where letter.id = p_correspondence_id
       and letter.owner_id = v_office_id
       and letter.category = 'outgoing'
       and letter.recipient_type in ('school', 'external')
  ) then
    raise exception 'Surat keluar Pejabat tidak ditemui atau tiada jenis penerima yang sah.' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.ped_correspondence as letter
     where letter.id = p_correspondence_id
       and letter.recipient_type = 'external'
       and (cardinality(coalesce(p_school_ids, '{}'::uuid[])) > 0
         or cardinality(coalesce(p_recipient_names, '{}'::text[])) > 0)
  ) then
    raise exception 'Surat kepada Agensi/Jabatan Luar tidak boleh dikaitkan dengan sekolah.' using errcode = '23514';
  end if;

  if exists (
    select 1 from unnest(coalesce(p_school_ids, '{}'::uuid[])) as selected(school_id)
     where not (select public.ped_school_belongs_to_office(selected.school_id))
  ) then
    raise exception 'Sekolah yang dipilih bukan dalam senarai sekolah Pejabat ini.' using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct school.id), '{}'::uuid[])
    into recipient_ids
    from public.profiles as school
   where school.role = 'agency'
     and lower(btrim(school.agency_type)) = 'sekolah'
     and (
       school.id = any(coalesce(p_school_ids, '{}'::uuid[]))
       or regexp_replace(lower(btrim(school.name)), '\s+', ' ', 'g') = any(
         array(
           select regexp_replace(lower(btrim(typed.name)), '\s+', ' ', 'g')
             from unnest(coalesce(p_recipient_names, '{}'::text[])) as typed(name)
         )
       )
     );

  delete from public.ped_correspondence_school_recipients as recipient
   where recipient.correspondence_id = p_correspondence_id
     and not (recipient.school_id = any(recipient_ids));

  insert into public.ped_correspondence_school_recipients as target
    (correspondence_id, office_id, office_name, school_id, school_name)
  select p_correspondence_id, sending_office.id, sending_office.name, school.id, school.name
    from public.profiles as sending_office
    cross join public.profiles as school
   where sending_office.id = v_office_id
     and school.id = any(recipient_ids)
  on conflict (correspondence_id, school_id) do update
    set office_id = excluded.office_id,
        office_name = excluded.office_name,
        school_name = excluded.school_name,
        updated_at = now();

  return query
    select recipient.*
      from public.ped_correspondence_school_recipients as recipient
     where recipient.correspondence_id = p_correspondence_id
     order by recipient.school_name;
end;
$$;

revoke all on function public.sync_ped_outgoing_school_recipients(uuid, uuid[], text[]) from public, anon;
grant execute on function public.sync_ped_outgoing_school_recipients(uuid, uuid[], text[]) to authenticated;

notify pgrst, 'reload schema';
commit;
