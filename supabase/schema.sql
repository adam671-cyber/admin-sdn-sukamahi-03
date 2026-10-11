create table if not exists tugas (
  id bigint generated always as identity primary key,
  judul text not null,
  tenggat date,
  selesai boolean not null default false,
  dibuat timestamptz not null default now()
);
create table if not exists guru (
  id bigint generated always as identity primary key,
  nama text not null,
  nip text,
  jabatan text,
  profil jsonb not null default '{}'::jsonb   -- kolom custom (pangkat, status, dsb.)
);
alter table tugas enable row level security;
alter table guru  enable row level security;
-- Staf terdaftar: isi user_id via SQL Editor setelah buat akun di Authentication > Users.
create table if not exists staf (
  user_id uuid primary key references auth.users(id) on delete cascade,
  dibuat timestamptz not null default now()
);
alter table staf enable row level security;
drop policy if exists "staf baca sendiri" on staf;
create policy "staf baca sendiri" on staf for select to authenticated using (user_id = auth.uid());
create or replace function public.is_staf() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staf where user_id = auth.uid());
$$;
grant execute on function public.is_staf() to authenticated;
-- Hanya staf terdaftar yang boleh akses (bukan sembarang akun login)
drop policy if exists "staf tugas" on tugas;
drop policy if exists "staf guru" on guru;
create policy "staf tugas" on tugas for all to authenticated using (public.is_staf()) with check (public.is_staf());
create policy "staf guru"  on guru  for all to authenticated using (public.is_staf()) with check (public.is_staf());

-- ===== DOKUMEN GURU (metadata; file di Storage bucket dokumen-guru) =====
create table if not exists dokumen_guru (
  id bigint generated always as identity primary key,
  guru_id bigint not null references guru(id) on delete cascade,
  jenis text not null,
  nama_file text not null,
  path text not null,
  ukuran bigint,
  tipe text,
  dibuat timestamptz not null default now()
);
alter table dokumen_guru enable row level security;
drop policy if exists "staf dokumen_guru" on dokumen_guru;
create policy "staf dokumen_guru" on dokumen_guru for all to authenticated using (public.is_staf()) with check (public.is_staf());
-- Bucket privat dokumen-guru (buat sekali di Dashboard > Storage bila belum ada):
-- insert into storage.buckets (id, name, public) values ('dokumen-guru','dokumen-guru', false)
--   on conflict (id) do nothing;
-- Pertahanan sisi server (tidak bisa dilewati via console browser): maks 7 MB, hanya PDF/JPG/PNG
update storage.buckets set file_size_limit = 7340032,
  allowed_mime_types = array['application/pdf','image/jpeg','image/png']
  where id = 'dokumen-guru';
-- Storage RLS: hanya staf terdaftar yang boleh baca/tulis via app
-- (ponytail: semua staf bisa baca semua berkas; naik ke path-per-guru/owner_id bila perlu batasan per-pegawai)
drop policy if exists "staf baca dokumen" on storage.objects;
create policy "staf baca dokumen" on storage.objects for select to authenticated using (bucket_id = 'dokumen-guru' and public.is_staf());
drop policy if exists "staf tulis dokumen" on storage.objects;
create policy "staf tulis dokumen" on storage.objects for all to authenticated using (bucket_id = 'dokumen-guru' and public.is_staf()) with check (bucket_id = 'dokumen-guru' and public.is_staf());

-- ===== MUTASI =====
create table if not exists mutasi_masuk (
  id bigint generated always as identity primary key,
  no_surat text,
  tanggal_surat date default current_date,
  nama_kepsek text default 'KASWIN KARTAWIJAYA, M.Pd',
  nip_kepsek text default '19720506 199903 1 007',
  pangkat_gol text default 'Pembina Utama Muda / IVc',
  jabatan_kepsek text default 'Kepala Sekolah',
  unit_kerja text default 'SDN Sukamahi 03, Kec. Cikarang Pusat',
  nama_siswa text not null,
  ttl text,
  jenis_kelamin text,
  nisn text,
  asal_sekolah text,
  kecamatan_asal text,
  kelas text,
  dibuat timestamptz not null default now(),
  diperbarui timestamptz not null default now()
);

-- Menambahkan kolom nisn jika tabel sudah terlanjur dibuat
alter table mutasi_masuk add column if not exists nisn text;

create table if not exists mutasi_keluar (
  id bigint generated always as identity primary key,
  no_surat text,
  tanggal_surat date default current_date,
  lampiran text,
  nama_siswa text not null,
  tempat_tgl_lahir text,
  jenis_kelamin text,
  nisn text,
  kelas text,
  asal_sekolah text default 'SDN SUKAMAHI 03',
  alamat_sekolah text default 'Jl. Raya Sukamahi Kp. Cimahi Rt. 007/004 Ds. Sukamahi Kec. Cikarang Pusat Kab. Bekasi',
  nama_ayah text,
  nama_ibu text,
  alamat_ortu text,
  sekolah_tujuan text,
  kecamatan_tujuan text,
  kabupaten_tujuan text,
  provinsi_tujuan text,
  alasan_pindah text,
  nss_tujuan text,
  nama_sekolah_tujuan text,
  status_sekolah_tujuan text,
  alamat_tujuan text,
  kecamatan_sekolah_tujuan text,
  kabupaten_sekolah_tujuan text,
  nama_siswa_tujuan text,
  diterima_di_kelas text,
  dibuat timestamptz not null default now(),
  diperbarui timestamptz not null default now()
);

alter table mutasi_masuk enable row level security;
alter table mutasi_keluar enable row level security;
drop policy if exists "staf mutasi_masuk" on mutasi_masuk;
drop policy if exists "staf mutasi_keluar" on mutasi_keluar;
create policy "staf mutasi_masuk" on mutasi_masuk for all to authenticated using (public.is_staf()) with check (public.is_staf());
create policy "staf mutasi_keluar" on mutasi_keluar for all to authenticated using (public.is_staf()) with check (public.is_staf());

-- ===== ABSENSI PEGAWAI (daftar dari tabel guru) =====
create table if not exists absensi (
  id bigint generated always as identity primary key,
  tanggal date not null default current_date,
  guru_id bigint not null references guru(id) on delete cascade,
  status text not null default 'Hadir' check (status in ('Hadir','Izin','Sakit','Alpa')),
  keterangan text,
  dibuat timestamptz not null default now(),
  unique (tanggal, guru_id)
);
alter table absensi enable row level security;
drop policy if exists "staf absensi" on absensi;
create policy "staf absensi" on absensi for all to authenticated using (public.is_staf()) with check (public.is_staf());
