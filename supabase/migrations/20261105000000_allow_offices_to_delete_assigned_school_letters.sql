drop policy if exists ped_correspondence_delete on public.ped_correspondence;
create policy ped_correspondence_delete on public.ped_correspondence
for delete to authenticated using (
  (select public.can_access_ped())
  and (not (select public.ped_is_school()) or category in ('school_in', 'school_received'))
  and (
    ((select public.is_admin()) and category <> 'school_received')
    or (
      owner_id = (select auth.uid())
      and (
        category <> 'school_in'
        or not (select public.ped_is_school())
        or status in ('Dihantar', 'Dihantar Semula', 'Dikembalikan')
      )
    )
    or (
      category = 'school_in'
      and office_id = (select auth.uid())
      and (select public.ped_is_office())
    )
  )
);
