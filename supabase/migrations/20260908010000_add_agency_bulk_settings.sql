-- Allow only agency owners to add classification settings in bulk.

create or replace function public.bulk_add_agency_settings(
  p_category text,
  p_values text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  authenticated_owner uuid := (select auth.uid());
  existing_values text[];
  cleaned_values text[];
  added_values text[];
  submitted_count integer := 0;
begin
  if authenticated_owner is null then
    raise exception using errcode = '42501', message = 'Log masuk diperlukan.';
  end if;

  if not exists (
    select 1
      from public.profiles as p
     where p.id = authenticated_owner
       and p.role = 'agency'
       and p.agency_id is null
  ) then
    raise exception using errcode = '42501', message = 'Hanya admin agensi boleh menggunakan pengisian data pukal.';
  end if;

  if p_category is null or p_category not in ('fungsi', 'aktiviti', 'subAktiviti', 'transaksi') then
    raise exception using errcode = '22023', message = 'Kategori tetapan tidak sah.';
  end if;

  select count(*)
    into submitted_count
    from unnest(coalesce(p_values, array[]::text[])) as submitted(input_value)
   where btrim(submitted.input_value) <> '';

  if submitted_count = 0 then
    raise exception using errcode = '22023', message = 'Masukkan sekurang-kurangnya satu rekod.';
  end if;

  if submitted_count > 500 then
    raise exception using errcode = '22023', message = 'Maksimum 500 rekod dibenarkan bagi setiap pengisian.';
  end if;

  select coalesce(
    array_agg(deduplicated.clean_value order by deduplicated.first_position),
    array[]::text[]
  )
    into cleaned_values
    from (
      select
        normalized_value,
        (array_agg(clean_value order by item_position))[1] as clean_value,
        min(item_position) as first_position
      from (
        select
          regexp_replace(btrim(input_value), '\s+', ' ', 'g') as clean_value,
          lower(regexp_replace(btrim(input_value), '\s+', ' ', 'g')) as normalized_value,
          item_position
        from unnest(coalesce(p_values, array[]::text[])) with ordinality
          as inputs(input_value, item_position)
        where btrim(input_value) <> ''
      ) as normalized_inputs
      group by normalized_value
    ) as deduplicated;

  insert into public.agency_settings (owner_id)
  values (authenticated_owner)
  on conflict (owner_id) do nothing;

  select case p_category
    when 'fungsi' then settings.functions
    when 'aktiviti' then settings.activities
    when 'subAktiviti' then settings.sub_activities
    when 'transaksi' then settings.transactions
  end
    into existing_values
    from public.agency_settings as settings
   where settings.owner_id = authenticated_owner
   for update;

  select coalesce(array_agg(candidate.clean_value order by candidate.item_position), array[]::text[])
    into added_values
    from unnest(cleaned_values) with ordinality as candidate(clean_value, item_position)
   where not exists (
     select 1
       from unnest(existing_values) as existing(existing_value)
      where lower(regexp_replace(btrim(existing.existing_value), '\s+', ' ', 'g')) = lower(candidate.clean_value)
   );

  update public.agency_settings
     set functions = case when p_category = 'fungsi' then functions || added_values else functions end,
         activities = case when p_category = 'aktiviti' then activities || added_values else activities end,
         sub_activities = case when p_category = 'subAktiviti' then sub_activities || added_values else sub_activities end,
         transactions = case when p_category = 'transaksi' then transactions || added_values else transactions end
   where owner_id = authenticated_owner;

  return jsonb_build_object(
    'submitted_count', submitted_count,
    'added_count', cardinality(added_values),
    'skipped_count', submitted_count - cardinality(added_values),
    'added_values', to_jsonb(added_values)
  );
end;
$$;

revoke all on function public.bulk_add_agency_settings(text, text[]) from public;
grant execute on function public.bulk_add_agency_settings(text, text[]) to authenticated;

notify pgrst, 'reload schema';
