-- Ensure office-to-school outgoing letters are linked at the database layer,
-- and repair school recipients for letters already saved.
begin;

create or replace function public.link_ped_outgoing_school_recipients()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  sending_office public.profiles;
begin
  if new.category = 'outgoing' and new.recipient_type = 'school' then
    select * into sending_office
      from public.profiles as office
     where office.id = new.owner_id
       and office.role = 'agency'
       and lower(btrim(office.agency_type)) = 'pejabat';

    if sending_office.id is null then
      delete from public.ped_correspondence_school_recipients
       where correspondence_id = new.id;
      return new;
    end if;

    delete from public.ped_correspondence_school_recipients as linked
     where linked.correspondence_id = new.id
       and not exists (
         select 1 from public.profiles as school
          where school.id = linked.school_id
            and school.role = 'agency'
            and lower(btrim(school.agency_type)) = 'sekolah'
            and exists (
              select 1
                from regexp_split_to_table(coalesce(new.recipient, new.correspondent), '\s*[;\r\n]+\s*') as sent_recipient(value)
               where regexp_replace(lower(btrim(school.name)), '\s+', ' ', 'g')
                     = regexp_replace(lower(btrim(sent_recipient.value)), '\s+', ' ', 'g')
            )
       );

    insert into public.ped_correspondence_school_recipients
      (correspondence_id, office_id, office_name, school_id, school_name)
    select new.id, sending_office.id, sending_office.name, school.id, school.name
      from public.profiles as school
     where school.role = 'agency'
       and lower(btrim(school.agency_type)) = 'sekolah'
       and exists (
         select 1
           from regexp_split_to_table(coalesce(new.recipient, new.correspondent), '\s*[;\r\n]+\s*') as sent_recipient(value)
          where regexp_replace(lower(btrim(school.name)), '\s+', ' ', 'g')
                = regexp_replace(lower(btrim(sent_recipient.value)), '\s+', ' ', 'g')
       )
    on conflict (correspondence_id, school_id) do update
      set office_id = excluded.office_id,
          office_name = excluded.office_name,
          school_name = excluded.school_name,
          updated_at = now();
  else
    delete from public.ped_correspondence_school_recipients
     where correspondence_id = new.id;
  end if;

  return new;
end;
$$;

revoke all on function public.link_ped_outgoing_school_recipients() from public, anon, authenticated;

drop trigger if exists link_ped_outgoing_school_recipients on public.ped_correspondence;
create trigger link_ped_outgoing_school_recipients
after insert or update on public.ped_correspondence
for each row execute function public.link_ped_outgoing_school_recipients();

-- Run the same matching for letters created before the trigger was installed.
insert into public.ped_correspondence_school_recipients
  (correspondence_id, office_id, office_name, school_id, school_name)
select distinct letter.id, office.id, office.name, school.id, school.name
  from public.ped_correspondence as letter
  join public.profiles as office
    on office.id = letter.owner_id
   and office.role = 'agency'
   and lower(btrim(office.agency_type)) = 'pejabat'
  cross join lateral regexp_split_to_table(coalesce(letter.recipient, letter.correspondent), '\s*[;\r\n]+\s*') as sent_recipient(value)
  join public.profiles as school
    on school.role = 'agency'
   and lower(btrim(school.agency_type)) = 'sekolah'
   and regexp_replace(lower(btrim(school.name)), '\s+', ' ', 'g')
       = regexp_replace(lower(btrim(sent_recipient.value)), '\s+', ' ', 'g')
 where letter.category = 'outgoing'
   and letter.recipient_type = 'school'
on conflict (correspondence_id, school_id) do nothing;

notify pgrst, 'reload schema';
commit;
