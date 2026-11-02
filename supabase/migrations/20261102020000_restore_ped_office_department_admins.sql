-- Full PeD access: system admins and Pejabat/Jabatan agency owners.
-- School agency owners and staff accounts keep the Coming Soon page.
-- Existing RLS policies retain record ownership isolation for agency owners.
begin;

create or replace function public.can_access_ped()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.profiles
     where id = (select auth.uid())
       and (
         role = 'admin'
         or (role = 'agency' and lower(btrim(agency_type)) in ('pejabat', 'jabatan'))
       )
  );
$$;

revoke all on function public.can_access_ped() from public;
grant execute on function public.can_access_ped() to authenticated;

commit;
