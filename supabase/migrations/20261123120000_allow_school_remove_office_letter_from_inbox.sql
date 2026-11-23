-- Let a school remove an office letter from only its own PeD inbox.
begin;

create or replace function public.ped_school_remove_outgoing_recipient(p_correspondence_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_school_id uuid := (select public.current_workspace_owner());
begin
  if not (select public.can_access_ped()) or not (select public.ped_is_school()) then
    raise exception 'Hanya akaun sekolah boleh membuang surat daripada peti masuknya.' using errcode = '42501';
  end if;

  delete from public.ped_correspondence_school_recipients
   where correspondence_id = p_correspondence_id
     and school_id = current_school_id;
  if not found then
    raise exception 'Surat ini tiada dalam peti masuk sekolah anda.' using errcode = '42501';
  end if;

  return true;
end;
$$;

revoke all on function public.ped_school_remove_outgoing_recipient(uuid) from public, anon;
grant execute on function public.ped_school_remove_outgoing_recipient(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
