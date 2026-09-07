-- Track successful sign-ins so agency owners can review staff usage frequency.

alter table public.profiles
  add column if not exists login_count bigint not null default 0,
  add column if not exists last_login_at timestamptz;

create index if not exists profiles_agency_last_login_idx
  on public.profiles (agency_id, last_login_at desc)
  where role = 'staff';

create or replace function public.record_login_activity()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  activity_count bigint;
  activity_at timestamptz;
begin
  select coalesce(u.last_sign_in_at, now())
    into activity_at
    from auth.users as u
   where u.id = (select auth.uid());

  update public.profiles
     set login_count = login_count + case when last_login_at is distinct from activity_at then 1 else 0 end,
         last_login_at = activity_at
   where id = (select auth.uid())
  returning login_count into activity_count;

  if not found then
    raise exception using errcode = '42501', message = 'Profil pengguna tidak ditemui.';
  end if;

  return jsonb_build_object(
    'login_count', activity_count,
    'last_login_at', activity_at
  );
end;
$$;

revoke all on function public.record_login_activity() from public;
grant execute on function public.record_login_activity() to authenticated;

analyze public.profiles;
notify pgrst, 'reload schema';
