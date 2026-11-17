begin;

-- Full school profiles (email and account activity) are for administrators.
-- The existing profiles_select policy already grants system administrators access.
drop policy if exists profiles_ped_office_schools_select on public.profiles;
create policy profiles_ped_office_schools_select
on public.profiles for select to authenticated
using (
  role = 'agency'
  and lower(btrim(agency_type)) = 'sekolah'
  and ped_office_id = (select auth.uid())
  and (select public.ped_is_office())
);

-- Office staff still need school names for correspondence, without account data.
create or replace function public.ped_assigned_schools()
returns table (id uuid, name text)
language sql
stable
security definer
set search_path = ''
as $$
  select school.id, school.name
    from public.profiles as school
   where (select public.can_access_ped())
     and (select public.ped_is_office())
     and school.role = 'agency'
     and lower(btrim(school.agency_type)) = 'sekolah'
     and school.ped_office_id = (select public.current_workspace_owner())
   order by school.name;
$$;

revoke all on function public.ped_assigned_schools() from public;
grant execute on function public.ped_assigned_schools() to authenticated;

commit;
