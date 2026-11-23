-- Share an office's outgoing letters with each school recipient and let the
-- recipient school acknowledge and update its own delivery status.
begin;

create table if not exists public.ped_correspondence_school_recipients (
  correspondence_id uuid not null references public.ped_correspondence(id) on delete cascade,
  office_id uuid not null references public.profiles(id) on delete cascade,
  office_name text not null,
  school_id uuid not null references public.profiles(id) on delete cascade,
  school_name text not null,
  status text not null default 'Dihantar'
    check (status in ('Dihantar', 'Diterima', 'Dalam proses', 'Selesai')),
  received_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (correspondence_id, school_id),
  constraint ped_correspondence_school_recipient_office_name check (btrim(office_name) <> ''),
  constraint ped_correspondence_school_recipient_name check (btrim(school_name) <> '')
);

create index if not exists ped_correspondence_school_recipients_school_idx
  on public.ped_correspondence_school_recipients (school_id, updated_at desc);

alter table public.ped_correspondence_school_recipients enable row level security;

revoke all on public.ped_correspondence_school_recipients from public, anon;
grant select on public.ped_correspondence_school_recipients to authenticated;

drop policy if exists ped_correspondence_school_recipients_select
  on public.ped_correspondence_school_recipients;
create policy ped_correspondence_school_recipients_select
on public.ped_correspondence_school_recipients for select to authenticated
using (
  (select public.can_access_ped())
  and (
    (select public.is_admin())
    or ((select public.ped_is_office()) and office_id = (select public.current_workspace_owner()))
    or ((select public.ped_is_school()) and school_id = (select public.current_workspace_owner()))
  )
);

-- School users can read an office-owned outgoing letter only if its recipient
-- row explicitly links the letter to their workspace.
drop policy if exists ped_correspondence_select on public.ped_correspondence;
create policy ped_correspondence_select on public.ped_correspondence
for select to authenticated using (
  (select public.can_access_ped())
  and (
    not (select public.ped_is_school())
    or category in ('school_in', 'school_received')
    or (
      category = 'outgoing'
      and exists (
        select 1 from public.ped_correspondence_school_recipients as recipient
         where recipient.correspondence_id = ped_correspondence.id
           and recipient.school_id = (select public.current_workspace_owner())
      )
    )
  )
  and (
    ((select public.is_admin()) and category <> 'school_received')
    or owner_id = (select public.current_workspace_owner())
    or (category = 'school_in' and school_id = (select public.current_workspace_owner()))
    or (category = 'school_in' and office_id = (select public.current_workspace_owner())
        and (select public.ped_is_office()))
    or (
      category = 'outgoing'
      and exists (
        select 1 from public.ped_correspondence_school_recipients as recipient
         where recipient.correspondence_id = ped_correspondence.id
           and recipient.school_id = (select public.current_workspace_owner())
      )
    )
  )
);

-- Link the school accounts selected (or exactly named) by the office to its
-- outgoing letter. Kept recipients retain their individual status on edits.
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
  office_id uuid := (select public.current_workspace_owner());
  recipient_ids uuid[];
begin
  if not (select public.can_access_ped()) or not (select public.ped_is_office()) then
    raise exception 'Hanya akaun Pejabat boleh menetapkan sekolah penerima.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.ped_correspondence as letter
     where letter.id = p_correspondence_id
       and letter.owner_id = office_id
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
           select regexp_replace(lower(btrim(name)), '\s+', ' ', 'g')
             from unnest(coalesce(p_recipient_names, '{}'::text[])) as typed(name)
         )
       )
     );

  delete from public.ped_correspondence_school_recipients as recipient
   where recipient.correspondence_id = p_correspondence_id
     and not (recipient.school_id = any(recipient_ids));

  insert into public.ped_correspondence_school_recipients
    (correspondence_id, office_id, office_name, school_id, school_name)
  select p_correspondence_id, sending_office.id, sending_office.name, school.id, school.name
    from public.profiles as sending_office
    cross join public.profiles as school
   where sending_office.id = office_id
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

-- A school can acknowledge or update only its own recipient status. The
-- letter's office-owned content and status remain protected.
create or replace function public.ped_school_update_outgoing_recipient_status(
  p_correspondence_id uuid,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  recipient public.ped_correspondence_school_recipients;
  current_school_id uuid := (select public.current_workspace_owner());
begin
  if not (select public.can_access_ped()) or not (select public.ped_is_school()) then
    raise exception 'Hanya akaun sekolah penerima boleh mengemas kini status.' using errcode = '42501';
  end if;
  if p_status not in ('Diterima', 'Dalam proses', 'Selesai') then
    raise exception 'Pilih status penerimaan yang sah.' using errcode = '23514';
  end if;

  select * into recipient
    from public.ped_correspondence_school_recipients
   where correspondence_id = p_correspondence_id
     and ped_correspondence_school_recipients.school_id = current_school_id
   for update;
  if not found then
    raise exception 'Surat ini tidak dihantar kepada sekolah anda.' using errcode = '42501';
  end if;
  if recipient.status = 'Dihantar' and p_status <> 'Diterima' then
    raise exception 'Tekan Terima sebelum mengemas kini status surat.' using errcode = '23514';
  end if;

  update public.ped_correspondence_school_recipients
     set status = p_status,
         received_at = case when p_status = 'Diterima' then coalesce(received_at, now()) else received_at end,
         updated_at = now()
   where correspondence_id = p_correspondence_id
     and ped_correspondence_school_recipients.school_id = current_school_id
  returning * into recipient;

  return to_jsonb(recipient);
end;
$$;

revoke all on function public.sync_ped_outgoing_school_recipients(uuid, uuid[], text[]) from public, anon;
revoke all on function public.ped_school_update_outgoing_recipient_status(uuid, text) from public, anon;
grant execute on function public.sync_ped_outgoing_school_recipients(uuid, uuid[], text[]) to authenticated;
grant execute on function public.ped_school_update_outgoing_recipient_status(uuid, text) to authenticated;

-- Existing office-to-school letters become visible to matching school accounts.
insert into public.ped_correspondence_school_recipients
  (correspondence_id, office_id, office_name, school_id, school_name)
select distinct letter.id, sender.id, sender.name, school.id, school.name
  from public.ped_correspondence as letter
  cross join lateral regexp_split_to_table(coalesce(letter.recipient, letter.correspondent), '\s*;\s*') as sent(name)
  join public.profiles as sender on sender.id = letter.owner_id
  join public.profiles as school
    on regexp_replace(lower(btrim(school.name)), '\s+', ' ', 'g')
       = regexp_replace(lower(btrim(sent.name)), '\s+', ' ', 'g')
 where letter.category = 'outgoing'
   and letter.recipient_type = 'school'
   and school.role = 'agency'
   and lower(btrim(school.agency_type)) = 'sekolah'
on conflict (correspondence_id, school_id) do nothing;

notify pgrst, 'reload schema';
commit;
