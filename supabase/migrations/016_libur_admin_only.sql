-- ===== 016: Tanggal merah hanya boleh diubah admin =====
-- Jalankan di SQL Editor Supabase (idempoten, aman diulang).
--
-- MASALAH YANG DIPERBAIKI
-- Policy "libur tulis" versi 014 mengizinkan admin ATAU guru aktif menambah,
-- mengubah, dan menghapus tanggal merah. Karena tanggal merah dikecualikan dari
-- rekap kehadiran (js/absensi.js & js/absensi-siswa.js), guru dapat menandai
-- hari ketika ia tidak hadir sebagai "libur" sehingga rekapnya terlihat bersih.
--
-- ATURAN SESUDAH MIGRASI INI
--   * baca  : semua staf aktif (dipakai grid & rekap absensi)
--   * tulis : admin aktif saja
--
-- Catatan: untuk instalasi baru, 014_absensi_siswa.sql dan full-setup.sql sudah
-- memakai policy admin-only ini; migrasi ini untuk database yang sudah berjalan.

drop policy if exists "libur tulis" on public.absensi_libur;

create policy "libur tulis" on public.absensi_libur for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Verifikasi (opsional):
-- select policyname, cmd, qual, with_check
-- from pg_policies
-- where schemaname = 'public' and tablename = 'absensi_libur'
-- order by policyname;
