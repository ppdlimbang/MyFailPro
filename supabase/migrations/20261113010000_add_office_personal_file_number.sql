-- Optional private-personnel file reference for incoming office correspondence.
begin;

alter table public.ped_correspondence
  add column if not exists office_personal_file_number text not null default '';

grant update (office_personal_file_number)
  on public.ped_correspondence to authenticated;

create or replace function public.ped_protect_office_personal_file_number()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (select public.ped_is_school()) then
    if (tg_op = 'UPDATE' and new.office_personal_file_number is distinct from old.office_personal_file_number)
       or (tg_op = 'INSERT' and new.office_personal_file_number <> '') then
      raise exception 'No. Fail Peribadi hanya boleh diurus oleh Pejabat.'
        using errcode = '42501';
    end if;
  end if;

  if new.category <> 'agency_in' then
    new.office_personal_file_number := '';
  end if;
  return new;
end;
$$;

drop trigger if exists ped_protect_office_personal_file_number on public.ped_correspondence;
create trigger ped_protect_office_personal_file_number
before insert or update on public.ped_correspondence
for each row execute function public.ped_protect_office_personal_file_number();

revoke all on function public.ped_protect_office_personal_file_number() from public;
grant execute on function public.ped_protect_office_personal_file_number() to authenticated;

notify pgrst, 'reload schema';
commit;
