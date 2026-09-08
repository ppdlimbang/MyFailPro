-- Preserve the authenticated user responsible for every new movement.

alter table public.movements
  add column if not exists performed_by uuid,
  add column if not exists performed_by_name text,
  add column if not exists performed_by_email text;

do $migration$
begin
  if not exists (
    select 1
      from pg_catalog.pg_constraint
     where conname = 'movements_performed_by_fkey'
       and conrelid = 'public.movements'::regclass
  ) then
    alter table public.movements
      add constraint movements_performed_by_fkey
      foreign key (performed_by) references public.profiles(id) on delete set null;
  end if;
end;
$migration$;

create index if not exists movements_owner_performed_by_idx
  on public.movements (owner_id, performed_by);

create or replace function public.set_movement_actor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  authenticated_user uuid := (select auth.uid());
  actor_name text;
  actor_email text;
begin
  if authenticated_user is null then
    raise exception using errcode = '42501', message = 'Log masuk diperlukan untuk merekodkan pergerakan.';
  end if;

  select nullif(btrim(p.name), ''), nullif(btrim(p.email), '')
    into actor_name, actor_email
    from public.profiles as p
   where p.id = authenticated_user;

  if not found then
    raise exception using errcode = '42501', message = 'Profil pengguna tidak ditemui.';
  end if;

  new.performed_by := authenticated_user;
  new.performed_by_name := coalesce(actor_name, actor_email, 'Pengguna MyFailPro');
  new.performed_by_email := actor_email;
  return new;
end;
$$;

drop trigger if exists movements_set_actor on public.movements;
create trigger movements_set_actor
before insert on public.movements
for each row execute function public.set_movement_actor();

revoke all on function public.set_movement_actor() from public;

analyze public.movements;
notify pgrst, 'reload schema';
