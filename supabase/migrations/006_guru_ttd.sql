-- ===== 006: TTD GURU (PNG) =====
-- Jalankan di Supabase SQL Editor (idempoten, aman diulang).

-- 1. Kolom path tanda tangan di tabel guru
alter table public.guru add column if not exists ttd_path text;

-- 2. Bucket privat ttd-guru (PNG saja, maks 2 MB)
insert into storage.buckets (id, name, public) values ('ttd-guru','ttd-guru', false)
  on conflict (id) do nothing;
update storage.buckets set file_size_limit = 2097152,
  allowed_mime_types = array['image/png']
  where id = 'ttd-guru';

-- 3. Policy baca/tulis untuk staf aktif (sama seperti bukti-jurnal)
drop policy if exists "staf baca ttd" on storage.objects;
create policy "staf baca ttd" on storage.objects for select to authenticated
using (bucket_id = 'ttd-guru' and public.am_active());

drop policy if exists "staf tulis ttd" on storage.objects;
create policy "staf tulis ttd" on storage.objects for all to authenticated
using (bucket_id = 'ttd-guru' and public.am_active())
with check (bucket_id = 'ttd-guru' and public.am_active());
