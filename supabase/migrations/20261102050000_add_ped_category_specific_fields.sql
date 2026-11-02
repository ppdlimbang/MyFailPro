-- Category-specific fields used by the PeD SYSTEM forms.
begin;

alter table public.ped_correspondence
  add column if not exists sender text not null default '',
  add column if not exists school_name text not null default '',
  add column if not exists recipient text not null default '',
  add column if not exists department_sectors text[] not null default '{}',
  add column if not exists assigned_officers text[] not null default '{}',
  add column if not exists school_sector text not null default '',
  add column if not exists assigned_to text not null default '',
  add column if not exists office_reference_file text not null default '',
  add column if not exists registry_file_number text not null default '',
  add column if not exists origin_sector text not null default '',
  add column if not exists delivery_methods text[] not null default '{}',
  add column if not exists notes text not null default '',
  add column if not exists attachment_path text;

-- Existing PeD rows keep their current party values when copied into the
-- category-specific columns.
update public.ped_correspondence
   set sender = case when category = 'agency_in' then correspondent else sender end,
       school_name = case when category = 'school_in' then correspondent else school_name end,
       recipient = case when category = 'outgoing' then correspondent else recipient end;

alter table public.ped_correspondence
  alter column reference_number drop not null;

alter table public.ped_correspondence
  drop constraint if exists ped_correspondence_required_text,
  drop constraint if exists ped_correspondence_status_check,
  add constraint ped_correspondence_status_check check (
    lower(btrim(status)) in (
      'baru', 'dalam tindakan', 'belum diminit', 'dalam proses',
      'sudah diminit', 'dihantar', 'dihantar semula', 'diterima',
      'dikembalikan', 'selesai'
    )
  ),
  add constraint ped_correspondence_category_required_fields check (
    btrim(subject) <> '' and
    case category
      when 'agency_in' then btrim(sender) <> ''
      when 'school_in' then btrim(school_name) <> ''
      when 'outgoing' then btrim(recipient) <> ''
      else false
    end
  );

drop index if exists public.ped_correspondence_owner_category_reference_idx;
create unique index ped_correspondence_owner_category_reference_idx
  on public.ped_correspondence (owner_id, category, lower(btrim(reference_number)))
  where nullif(btrim(reference_number), '') is not null;

grant update (
  category, correspondence_date, reference_number, correspondent, subject, status,
  sender, school_name, recipient, department_sectors, assigned_officers,
  school_sector, assigned_to, office_reference_file, registry_file_number,
  origin_sector, delivery_methods, notes, attachment_path
) on public.ped_correspondence to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'ped-correspondence', 'ped-correspondence', false, 20971520,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do nothing;

drop policy if exists ped_correspondence_attachment_select on storage.objects;
create policy ped_correspondence_attachment_select
on storage.objects for select to authenticated
using (
  bucket_id = 'ped-correspondence'
  and (select public.can_access_ped())
  and (
    (select public.is_admin())
    or (storage.foldername(name))[1] = (select auth.uid())::text
  )
);

drop policy if exists ped_correspondence_attachment_insert on storage.objects;
create policy ped_correspondence_attachment_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'ped-correspondence'
  and (select public.can_access_ped())
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists ped_correspondence_attachment_update on storage.objects;
create policy ped_correspondence_attachment_update
on storage.objects for update to authenticated
using (
  bucket_id = 'ped-correspondence'
  and (select public.can_access_ped())
  and (
    (select public.is_admin())
    or (storage.foldername(name))[1] = (select auth.uid())::text
  )
)
with check (
  bucket_id = 'ped-correspondence'
  and (select public.can_access_ped())
  and (
    (select public.is_admin())
    or (storage.foldername(name))[1] = (select auth.uid())::text
  )
);

drop policy if exists ped_correspondence_attachment_delete on storage.objects;
create policy ped_correspondence_attachment_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'ped-correspondence'
  and (select public.can_access_ped())
  and (
    (select public.is_admin())
    or (storage.foldername(name))[1] = (select auth.uid())::text
  )
);

analyze public.ped_correspondence;
notify pgrst, 'reload schema';

commit;
