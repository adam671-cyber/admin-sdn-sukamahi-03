-- ===== 011: Bukti jurnal hanya bisa diakses pemiliknya (admin bebas) =====
-- Jalankan di Supabase SQL Editor (idempoten, aman diulang).
-- Sebelumnya: semua staf aktif bisa baca/tulis SEMUA file di bucket bukti-jurnal.
-- Sekarang: file di path <user_id>/... hanya untuk pemilik user_id itu;
--           admin tetap bisa baca/tulis semua (untuk filter pemilik di menu jurnal).

drop policy if exists "staf baca bukti" on storage.objects;
drop policy if exists "staf tulis bukti" on storage.objects;

-- Baca: pemilik folder sendiri, atau admin aktif.
create policy "bukti baca pemilik" on storage.objects for select to authenticated
using (
  bucket_id = 'bukti-jurnal'
  and public.am_active()
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.is_admin()
  )
);

-- Tulis: hanya ke folder milik sendiri (admin juga hanya menulis ke foldernya sendiri).
create policy "bukti tulis pemilik" on storage.objects for all to authenticated
using (
  bucket_id = 'bukti-jurnal'
  and public.am_active()
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'bukti-jurnal'
  and public.am_active()
  and (storage.foldername(name))[1] = auth.uid()::text
);
