-- ===== 015: Izinkan status 'H' (hadir eksplisit) di absensi_siswa =====
-- Sebelumnya H "tersirat" (hari berjalan tanpa catatan S/I/A dianggap hadir,
-- dan UI menampilkan bullet otomatis). Kini hadir diisi EKSPLISIT oleh guru:
-- sel berputar Kosong -> H -> S -> I -> A -> Kosong, tanpa isian otomatis.
-- Jalankan di Supabase SQL Editor (idempoten, aman diulang).
alter table public.absensi_siswa drop constraint if exists absensi_siswa_status_check;
alter table public.absensi_siswa add constraint absensi_siswa_status_check check (status in ('H','S','I','A'));
