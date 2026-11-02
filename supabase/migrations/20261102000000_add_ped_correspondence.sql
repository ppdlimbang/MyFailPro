-- PeD correspondence register for Pejabat/Jabatan agency owners.
-- Access is enforced in Postgres as well as in the browser navigation.

create table if not exists public.ped_correspondence (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete restrict,
  category text not null check (category in ('agency_in', 'school_in', 'outgoing')),
  correspondence_date date not null,
  reference_number text not null,
  correspondent text not null,
  subject text not null,
  status text not null default 'Baru' check (status in ('Baru', 'Dalam Tindakan', 'Selesai')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ped_correspondence_required_text check (
    btrim(reference_number) <> '' and
    btrim(correspondent) <> '' and
    btrim(subject) <> ''
  )
);

create index if not exists ped_correspondence_owner_category_date_idx
  on public.ped_correspondence (owner_id, category, correspondence_date desc);

create unique index if not exists ped_correspondence_owner_category_reference_idx
  on public.ped_correspondence (owner_id, category, lower(btrim(reference_number)));

drop trigger if exists ped_correspondence_set_updated_at on public.ped_correspondence;
create trigger ped_correspondence_set_updated_at
before update on public.ped_correspondence
for each row execute function public.set_updated_at();

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

alter table public.ped_correspondence enable row level security;

drop policy if exists ped_correspondence_select on public.ped_correspondence;
create policy ped_correspondence_select
on public.ped_correspondence for select to authenticated
using (
  (select public.can_access_ped())
  and ((select public.is_admin()) or owner_id = (select auth.uid()))
);

drop policy if exists ped_correspondence_insert on public.ped_correspondence;
create policy ped_correspondence_insert
on public.ped_correspondence for insert to authenticated
with check (
  (select public.can_access_ped())
  and owner_id = (select auth.uid())
);

drop policy if exists ped_correspondence_update on public.ped_correspondence;
create policy ped_correspondence_update
on public.ped_correspondence for update to authenticated
using (
  (select public.can_access_ped())
  and ((select public.is_admin()) or owner_id = (select auth.uid()))
)
with check (
  (select public.can_access_ped())
  and ((select public.is_admin()) or owner_id = (select auth.uid()))
);

drop policy if exists ped_correspondence_delete on public.ped_correspondence;
create policy ped_correspondence_delete
on public.ped_correspondence for delete to authenticated
using (
  (select public.can_access_ped())
  and ((select public.is_admin()) or owner_id = (select auth.uid()))
);

revoke all on public.ped_correspondence from anon;
grant select, insert, delete on public.ped_correspondence to authenticated;
grant update (category, correspondence_date, reference_number, correspondent, subject, status)
  on public.ped_correspondence to authenticated;

revoke all on function public.can_access_ped() from public;
grant execute on function public.can_access_ped() to authenticated;

analyze public.ped_correspondence;
