-- Agency staff can manage their shared classification and recipient settings.
-- Account creation remains restricted to the agency owner by the Edge Function.

drop policy if exists agency_settings_insert on public.agency_settings;
create policy agency_settings_insert on public.agency_settings
for insert to authenticated
with check (
  owner_id = (select public.current_workspace_owner()) or
  (select public.is_admin())
);

drop policy if exists agency_settings_update on public.agency_settings;
create policy agency_settings_update on public.agency_settings
for update to authenticated
using (
  owner_id = (select public.current_workspace_owner()) or
  (select public.is_admin())
)
with check (
  owner_id = (select public.current_workspace_owner()) or
  (select public.is_admin())
);

notify pgrst, 'reload schema';
