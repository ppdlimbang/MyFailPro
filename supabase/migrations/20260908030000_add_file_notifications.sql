-- Notify an agency staff account when another signed-in user moves a file to it.

create table if not exists public.file_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  movement_id uuid not null references public.movements(id) on delete cascade,
  file_id uuid not null references public.files(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  actor_name text not null,
  actor_email text,
  transaction_code text not null,
  volume integer not null,
  from_holder text not null,
  to_holder text not null,
  moved_at timestamptz not null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint file_notifications_recipient_movement_unique unique (recipient_id, movement_id)
);

create index if not exists file_notifications_recipient_created_idx
  on public.file_notifications (recipient_id, created_at desc);

create index if not exists file_notifications_recipient_unread_idx
  on public.file_notifications (recipient_id, created_at desc)
  where read_at is null;

alter table public.file_notifications enable row level security;

drop policy if exists file_notifications_select on public.file_notifications;
create policy file_notifications_select on public.file_notifications
for select to authenticated
using (recipient_id = (select auth.uid()));

drop policy if exists file_notifications_update on public.file_notifications;
create policy file_notifications_update on public.file_notifications
for update to authenticated
using (recipient_id = (select auth.uid()))
with check (recipient_id = (select auth.uid()));

revoke all on public.file_notifications from anon;
revoke all on public.file_notifications from authenticated;
grant select on public.file_notifications to authenticated;
grant update (read_at) on public.file_notifications to authenticated;

create or replace function public.workspace_staff_recipients()
returns table (id uuid, name text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.name
    from public.profiles as p
   where p.role = 'staff'
     and p.agency_id = (select public.current_workspace_owner())
     and btrim(p.name) <> ''
   order by p.name;
$$;

revoke all on function public.workspace_staff_recipients() from public;
grant execute on function public.workspace_staff_recipients() to authenticated;

create or replace function public.create_file_recipient_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  matched_recipient uuid;
  matched_count integer;
  file_code text;
  file_volume integer;
begin
  if lower(btrim(new.from_holder)) = lower('Sistem Pendaftaran') then
    return new;
  end if;

  select (array_agg(p.id order by p.id))[1], count(*)
    into matched_recipient, matched_count
    from public.profiles as p
   where p.role = 'staff'
     and p.agency_id = new.owner_id
     and lower(regexp_replace(btrim(p.name), '\s+', ' ', 'g')) =
         lower(regexp_replace(btrim(new.to_holder), '\s+', ' ', 'g'));

  if matched_count <> 1 or matched_recipient is null or matched_recipient = new.performed_by then
    return new;
  end if;

  select f.transaction_code, f.volume
    into file_code, file_volume
    from public.files as f
   where f.id = new.file_id;

  if not found then
    return new;
  end if;

  insert into public.file_notifications (
    recipient_id,
    movement_id,
    file_id,
    actor_id,
    actor_name,
    actor_email,
    transaction_code,
    volume,
    from_holder,
    to_holder,
    moved_at
  ) values (
    matched_recipient,
    new.id,
    new.file_id,
    new.performed_by,
    coalesce(nullif(btrim(new.performed_by_name), ''), 'Pengguna MyFailPro'),
    nullif(btrim(new.performed_by_email), ''),
    file_code,
    file_volume,
    new.from_holder,
    new.to_holder,
    new.moved_at
  )
  on conflict (recipient_id, movement_id) do nothing;

  return new;
end;
$$;

drop trigger if exists movements_notify_recipient on public.movements;
create trigger movements_notify_recipient
after insert on public.movements
for each row execute function public.create_file_recipient_notification();

revoke all on function public.create_file_recipient_notification() from public;

analyze public.file_notifications;
notify pgrst, 'reload schema';
