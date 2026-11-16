-- Aggregate existing successful sign-ins without exposing other users' profiles.
-- Requires 20260907050000_add_staff_login_activity.sql.
begin;

create or replace function public.login_traffic_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  snapshot_at timestamptz := statement_timestamp();
  today_start timestamptz := date_trunc('day', snapshot_at at time zone 'Asia/Kuala_Lumpur')
    at time zone 'Asia/Kuala_Lumpur';
  summary jsonb;
begin
  if (select auth.uid()) is null or not exists (
    select 1 from public.profiles where id = (select auth.uid())
  ) then
    raise exception using errcode = '42501', message = 'Sila log masuk untuk melihat trafik pengguna.';
  end if;

  select jsonb_build_object(
    'total_logins', coalesce(sum(p.login_count), 0),
    'unique_users', count(*) filter (where p.login_count > 0),
    'users_today', count(*) filter (where p.last_login_at >= today_start and p.last_login_at <= snapshot_at),
    'users_last_7_days', count(*) filter (
      where p.last_login_at >= today_start - interval '6 days' and p.last_login_at <= snapshot_at
    ),
    'generated_at', snapshot_at,
    'timezone', 'Asia/Kuala_Lumpur'
  ) into summary
  from public.profiles p;

  return summary;
end;
$$;

revoke all on function public.login_traffic_summary() from public, anon;
grant execute on function public.login_traffic_summary() to authenticated;

comment on function public.login_traffic_summary() is
  'Global aggregate sign-in counts for authenticated profiles. Counts current accounts only; dates use Asia/Kuala_Lumpur. Does not expose user identities or online presence.';

notify pgrst, 'reload schema';
commit;
