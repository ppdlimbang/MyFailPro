-- Record whether an office's outgoing letter is addressed to a school or an
-- external agency/department. Existing correspondence remains valid.
begin;

alter table public.ped_correspondence
  add column if not exists recipient_type text;

alter table public.ped_correspondence
  drop constraint if exists ped_correspondence_recipient_type_check;

alter table public.ped_correspondence
  add constraint ped_correspondence_recipient_type_check
  check (recipient_type is null or recipient_type in ('school', 'external'));

grant update (recipient_type) on public.ped_correspondence to authenticated;

comment on column public.ped_correspondence.recipient_type is
  'Recipient kind for outgoing office correspondence: school or external agency/department.';

notify pgrst, 'reload schema';
commit;
