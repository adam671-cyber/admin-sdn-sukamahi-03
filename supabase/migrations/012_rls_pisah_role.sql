-- ===== 012: PEMISAHAN ROLE DI LEVEL DATABASE (RLS) =====
-- Jalankan di Supabase SQL Editor (idempoten, aman diulang).
-- Urutan: setelah 002 (fungsi role), 005/008 (trigger wajib taut), 011 (bukti per user).
--
-- MASALAH YANG DIPERBAIKI
-- Policy lama "staf tugas" / "staf guru" / "staf dokumen_guru" /
-- "staf mutasi_masuk" / "staf mutasi_keluar" / "staf absensi" memakai
-- is_staf() untuk ALL (SELECT + INSERT + UPDATE + DELETE). Artinya SETIAP akun
-- di tabel staf — termasuk guru/pegawai — bisa mengubah & menghapus data inti
-- sekolah hanya dengan anon key + JWT miliknya sendiri (menu yang disembunyikan
-- di UI tidak menghentikan ini).
-- Selain itu is_staf() tidak melihat profiles.is_active, sehingga akun yang
-- sudah dinonaktifkan admin tetap punya akses penuh.
--
-- ATURAN SESUDAH MIGRASI INI
--   * BACA  : hanya staf AKTIF (public.am_active()) — dan hanya pada data yang
--             memang dipakai UI non-admin (data guru + ttd, untuk kop & tanda
--             tangan jurnal).
--   * TULIS : hanya admin aktif (public.is_admin()).
--   * Data siswa (mutasi masuk/keluar), absensi, tugas, dokumen_guru, arsip:
--             admin saja untuk baca maupun tulis.
--
-- Matriks hasil akhir:
--   | Aksi                            | admin | guru/pegawai/kepsek aktif | nonaktif |
--   | baca data guru + TTD            |  ya   | ya                        | tidak    |
--   | tambah/ubah/hapus data guru     |  ya   | tidak                     | tidak    |
--   | mutasi siswa (baca & tulis)     |  ya   | tidak                     | tidak    |
--   | absensi / tugas / dokumen_guru  |  ya   | tidak                     | tidak    |
--   | arsip                           |  ya   | tidak                     | tidak    |
--   | jurnal sendiri (002/011)        |  ya   | ya                        | tidak    |

-- ---------------------------------------------------------------------------
-- 0. Prasyarat: fungsi role dari migrasi 002 harus sudah ada.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regproc('public.is_admin') is null or to_regproc('public.am_active') is null then
    raise exception 'Jalankan migrasi 002_jurnal_harian.sql lebih dulu: fungsi public.is_admin()/public.am_active() belum ada.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Buang policy longgar (semua nama versi lama, supaya aman diulang).
-- ---------------------------------------------------------------------------
drop policy if exists "staf tugas"            on public.tugas;
drop policy if exists "staf guru"             on public.guru;
drop policy if exists "staf dokumen_guru"     on public.dokumen_guru;
drop policy if exists "staf mutasi_masuk"     on public.mutasi_masuk;
drop policy if exists "staf mutasi_keluar"    on public.mutasi_keluar;
drop policy if exists "staf absensi"          on public.absensi;

drop policy if exists "guru baca aktif"       on public.guru;
drop policy if exists "tugas baca aktif"      on public.tugas;
drop policy if exists "guru admin tulis"      on public.guru;
drop policy if exists "tugas admin"           on public.tugas;
drop policy if exists "dokumen_guru admin"    on public.dokumen_guru;
drop policy if exists "mutasi_masuk admin"    on public.mutasi_masuk;
drop policy if exists "mutasi_keluar admin"   on public.mutasi_keluar;
drop policy if exists "absensi admin"         on public.absensi;

drop policy if exists "staf baca dokumen"     on storage.objects;
drop policy if exists "staf tulis dokumen"    on storage.objects;
drop policy if exists "dokumen admin baca"    on storage.objects;
drop policy if exists "dokumen admin tulis"   on storage.objects;
drop policy if exists "staf tulis ttd"        on storage.objects;
drop policy if exists "ttd admin tulis"       on storage.objects;

-- ---------------------------------------------------------------------------
-- 2. DATA GURU — staf aktif boleh BACA (kop/TTD jurnal), hanya admin boleh TULIS.
-- ---------------------------------------------------------------------------
create policy "guru baca aktif" on public.guru
  for select to authenticated
  using (public.am_active());

create policy "guru admin tulis" on public.guru
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- 3. TUGAS — admin saja.
-- ---------------------------------------------------------------------------
create policy "tugas admin" on public.tugas
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- 4. MUTASI SISWA — data pribadi siswa, admin saja.
-- ---------------------------------------------------------------------------
create policy "mutasi_masuk admin" on public.mutasi_masuk
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "mutasi_keluar admin" on public.mutasi_keluar
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- 5. ABSENSI PEGAWAI — admin saja.
-- ---------------------------------------------------------------------------
create policy "absensi admin" on public.absensi
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- 6. DOKUMEN GURU (metadata) — admin saja.
-- ---------------------------------------------------------------------------
create policy "dokumen_guru admin" on public.dokumen_guru
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- 7. STORAGE — samakan dengan aturan tabelnya.
-- ---------------------------------------------------------------------------
-- dokumen-guru (berkas PDF/JPG/PNG data pegawai): admin saja.
create policy "dokumen admin baca" on storage.objects
  for select to authenticated
  using (bucket_id = 'dokumen-guru' and public.is_admin());

create policy "dokumen admin tulis" on storage.objects
  for all to authenticated
  using (bucket_id = 'dokumen-guru' and public.is_admin())
  with check (bucket_id = 'dokumen-guru' and public.is_admin());

-- ttd-guru: staf aktif boleh lihat (dipakai saat cetak jurnal), tulis admin saja.
-- Policy baca "staf baca ttd" (006) sudah memakai am_active() → dibiarkan.
create policy "ttd admin tulis" on storage.objects
  for all to authenticated
  using (bucket_id = 'ttd-guru' and public.is_admin())
  with check (bucket_id = 'ttd-guru' and public.is_admin());

-- Catatan: bukti-jurnal tetap mengikuti 011 (per folder user_id, admin bebas).
-- Kalau 011 belum dijalankan, jalankan sekarang.

-- ---------------------------------------------------------------------------
-- 8. Verifikasi: daftar policy akses data inti setelah migrasi.
-- ---------------------------------------------------------------------------
select schemaname, tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where (schemaname = 'public' and tablename in
        ('tugas','guru','dokumen_guru','mutasi_masuk','mutasi_keluar','absensi'))
   or (schemaname = 'storage' and tablename = 'objects')
order by schemaname, tablename, policyname;
