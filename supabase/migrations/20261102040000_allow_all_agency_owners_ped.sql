-- PeD is available to all agency-owner accounts, regardless of agency type.
-- Ordinary staff accounts linked to an agency remain excluded.
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
       and role in ('admin', 'agency')
  );
$$;

revoke all on function public.can_access_ped() from public;
grant execute on function public.can_access_ped() to authenticated;

commit;
