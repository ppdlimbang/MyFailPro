-- PeD access is limited to system admins and agency-owner accounts whose
-- profile type is Jabatan or Agensi. Pejabat, Sekolah and staff accounts
-- continue to see the Coming Soon screen and cannot access correspondence.
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
         or (role = 'agency' and lower(btrim(agency_type)) in ('jabatan', 'agensi'))
       )
  );
$$;

revoke all on function public.can_access_ped() from public;
grant execute on function public.can_access_ped() to authenticated;

commit;
