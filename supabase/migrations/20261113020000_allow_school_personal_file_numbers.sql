-- Allow school accounts to maintain personal-file references on their own letters.
begin;

create or replace function public.ped_protect_office_personal_file_number()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (select public.ped_is_school()) then
    if tg_op = 'INSERT' then
      if new.category not in ('school_in', 'school_received')
         and new.office_personal_file_number <> '' then
        raise exception 'No. Fail Peribadi sekolah hanya boleh disimpan pada surat sekolah.'
          using errcode = '42501';
      end if;
    elsif new.category not in ('school_in', 'school_received')
       and new.office_personal_file_number is distinct from old.office_personal_file_number then
      raise exception 'No. Fail Peribadi sekolah hanya boleh diurus pada surat sekolah.'
        using errcode = '42501';
    end if;
  elsif (select public.ped_is_office()) then
    if tg_op = 'INSERT' then
      if new.category <> 'agency_in' and new.office_personal_file_number <> '' then
        raise exception 'No. Fail Peribadi Pejabat hanya boleh disimpan pada surat masuk Pejabat.'
          using errcode = '42501';
      end if;
    elsif new.category <> 'agency_in'
       and new.office_personal_file_number is distinct from old.office_personal_file_number then
      raise exception 'No. Fail Peribadi Pejabat hanya boleh diurus pada surat masuk Pejabat.'
        using errcode = '42501';
    end if;
  end if;

  if tg_op = 'UPDATE' and new.category is distinct from old.category then
    new.office_personal_file_number := '';
  elsif new.category not in ('agency_in', 'school_in', 'school_received') then
    new.office_personal_file_number := '';
  end if;
  return new;
end;
$$;

notify pgrst, 'reload schema';
commit;
