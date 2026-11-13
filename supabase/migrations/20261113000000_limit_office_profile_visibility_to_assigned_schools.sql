-- Let each PeD office read only school agency profiles assigned to its workspace.
drop policy if exists profiles_ped_office_schools_select on public.profiles;
create policy profiles_ped_office_schools_select
on public.profiles for select to authenticated
using (
  role = 'agency'
  and lower(btrim(agency_type)) = 'sekolah'
  and ped_office_id = (select public.current_workspace_owner())
  and (select public.ped_is_office())
);
