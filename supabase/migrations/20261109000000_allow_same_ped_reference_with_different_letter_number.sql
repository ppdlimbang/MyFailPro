-- Incoming letters can share the sender's reference and the office file while
-- carrying a different No. Surat. Only treat a letter as a duplicate when the
-- reference, the file reference and the letter number are all the same.
drop index if exists public.ped_correspondence_owner_category_reference_idx;
create unique index ped_correspondence_owner_category_reference_idx
  on public.ped_correspondence (
    owner_id,
    category,
    lower(btrim(reference_number)),
    lower(btrim(office_reference_file)),
    office_reference_letter_number,
    lower(btrim(registry_file_number)),
    registry_file_letter_number
  )
  where nullif(btrim(reference_number), '') is not null;
