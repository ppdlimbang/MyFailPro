-- Keep the account that first registered each letter in a separate table so
-- school accounts cannot read the attribution through the correspondence API.
create table if not exists public.ped_correspondence_creator (
  correspondence_id uuid primary key references public.ped_correspondence(id) on delete cascade,
  creator_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

insert into public.ped_correspondence_creator (correspondence_id, creator_id, created_at)
select id, owner_id, created_at
  from public.ped_correspondence
on conflict (correspondence_id) do nothing;

create or replace function public.ped_record_correspondence_creator()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.ped_correspondence_creator (correspondence_id, creator_id, created_at)
  values (new.id, coalesce((select auth.uid()), new.owner_id), new.created_at)
  on conflict (correspondence_id) do nothing;
  return new;
end;
$$;

drop trigger if exists ped_record_correspondence_creator on public.ped_correspondence;
create trigger ped_record_correspondence_creator
after insert on public.ped_correspondence
for each row execute function public.ped_record_correspondence_creator();

alter table public.ped_correspondence_creator enable row level security;
revoke all on public.ped_correspondence_creator from anon;
grant select on public.ped_correspondence_creator to authenticated;

drop policy if exists ped_correspondence_creator_select on public.ped_correspondence_creator;
create policy ped_correspondence_creator_select
on public.ped_correspondence_creator for select to authenticated
using (
  not (select public.ped_is_school())
  and (select public.can_access_ped())
  and exists (
    select 1 from public.ped_correspondence letter
     where letter.id = correspondence_id
       and (
         ((select public.is_admin()) and letter.category <> 'school_received')
         or letter.owner_id = (select public.current_workspace_owner())
         or (letter.category = 'school_in' and letter.school_id = (select public.current_workspace_owner()))
         or (letter.category = 'school_in' and letter.office_id = (select public.current_workspace_owner())
             and (select public.ped_is_office()))
       )
  )
);

create or replace function public.ped_correspondence_creators(p_correspondence_ids uuid[])
returns table (correspondence_id uuid, creator_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select audit.correspondence_id, coalesce(nullif(btrim(profile.name), ''), 'Akaun tidak diketahui')
    from public.ped_correspondence_creator audit
    join public.ped_correspondence letter on letter.id = audit.correspondence_id
    left join public.profiles profile on profile.id = audit.creator_id
   where (select auth.uid()) is not null
     and (select public.can_access_ped())
     and not (select public.ped_is_school())
     and audit.correspondence_id = any(coalesce(p_correspondence_ids, '{}'::uuid[]))
     and (
       ((select public.is_admin()) and letter.category <> 'school_received')
       or letter.owner_id = (select public.current_workspace_owner())
       or (letter.category = 'school_in' and letter.school_id = (select public.current_workspace_owner()))
       or (letter.category = 'school_in' and letter.office_id = (select public.current_workspace_owner())
           and (select public.ped_is_office()))
     );
$$;

revoke all on function public.ped_correspondence_creators(uuid[]) from public;
grant execute on function public.ped_correspondence_creators(uuid[]) to authenticated;
revoke all on function public.ped_record_correspondence_creator() from public;
