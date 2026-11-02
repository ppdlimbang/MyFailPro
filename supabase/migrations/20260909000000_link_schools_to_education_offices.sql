-- Link school accounts to a registered Pejabat Pendidikan account.
alter table public.profiles
  add column if not exists parent_agency_id uuid
  references public.profiles(id) on delete set null;

create index if not exists profiles_parent_agency_id_idx
  on public.profiles(parent_agency_id)
  where parent_agency_id is not null;
