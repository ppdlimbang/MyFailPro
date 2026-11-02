-- During development, only system admins can access PeD records.
-- Other signed-in users see the Coming Soon page without requesting records.
-- Existing RLS policies already call this function for all CRUD operations.
begin;

create or replace function public.can_access_ped()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin();
$$;

revoke all on function public.can_access_ped() from public;
grant execute on function public.can_access_ped() to authenticated;

commit;
