-- Store the avatar selected when an agency owner creates a staff account.

alter table public.profiles
  add column if not exists avatar_key text not null default 'initials';

do $migration$
begin
  if not exists (
    select 1
      from pg_catalog.pg_constraint
     where conname = 'profiles_avatar_key_check'
       and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_avatar_key_check
      check (avatar_key in ('initials', 'professional', 'man', 'woman', 'technology', 'educator'));
  end if;
end;
$migration$;

notify pgrst, 'reload schema';
