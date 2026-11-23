-- Use the same letter-processing statuses in the school's PeD inbox.
begin;

alter table public.ped_correspondence_school_recipients
  drop constraint if exists ped_correspondence_school_recipients_status_check;

update public.ped_correspondence_school_recipients
   set status = 'Belum diminit'
 where status = 'Diterima';

alter table public.ped_correspondence_school_recipients
  add constraint ped_correspondence_school_recipients_status_check
  check (status in ('Dihantar', 'Belum diminit', 'Dalam proses', 'Sudah diminit', 'Selesai'));

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
  if p_status not in ('Belum diminit', 'Dalam proses', 'Sudah diminit', 'Selesai') then
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
  if recipient.status = 'Dihantar' and p_status <> 'Belum diminit' then
    raise exception 'Tekan Sudah Terima sebelum mengemas kini status surat.' using errcode = '23514';
  end if;

  update public.ped_correspondence_school_recipients
     set status = p_status,
         received_at = case when p_status = 'Belum diminit' then coalesce(received_at, now()) else received_at end,
         updated_at = now()
   where correspondence_id = p_correspondence_id
     and ped_correspondence_school_recipients.school_id = current_school_id
  returning * into recipient;

  return to_jsonb(recipient);
end;
$$;

notify pgrst, 'reload schema';
commit;
