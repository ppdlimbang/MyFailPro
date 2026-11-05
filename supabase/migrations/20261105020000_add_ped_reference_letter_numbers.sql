alter table public.ped_correspondence
  add column if not exists office_reference_letter_number text not null default '',
  add column if not exists registry_file_letter_number text not null default '';

alter table public.ped_correspondence
  drop constraint if exists ped_office_reference_letter_number_digits,
  drop constraint if exists ped_registry_file_letter_number_digits;

alter table public.ped_correspondence
  add constraint ped_office_reference_letter_number_digits
    check (office_reference_letter_number = '' or office_reference_letter_number ~ '^[0-9]+$'),
  add constraint ped_registry_file_letter_number_digits
    check (registry_file_letter_number = '' or registry_file_letter_number ~ '^[0-9]+$');

grant update (
  office_reference_letter_number,
  registry_file_letter_number
) on public.ped_correspondence to authenticated;

create or replace function public.ped_protect_reference_letter_numbers()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (select public.ped_is_school()) and (
    new.office_reference_letter_number is distinct from old.office_reference_letter_number
    or new.registry_file_letter_number is distinct from old.registry_file_letter_number
  ) then
    raise exception 'Nombor surat rujukan Pejabat hanya boleh diubah oleh Pejabat.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists ped_protect_reference_letter_numbers on public.ped_correspondence;
create trigger ped_protect_reference_letter_numbers
before update on public.ped_correspondence
for each row execute function public.ped_protect_reference_letter_numbers();

revoke all on function public.ped_protect_reference_letter_numbers() from public;
grant execute on function public.ped_protect_reference_letter_numbers() to authenticated;
