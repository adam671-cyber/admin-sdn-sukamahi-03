-- FULL RESET AMAN (idempoten): tabel + RLS staf. Jalankan sekaligus di SQL Editor.
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
  profil jsonb not null default '{}'::jsonb
);
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
create table if not exists absensi (
  id bigint generated always as identity primary key,
  tanggal date not null default current_date,
  guru_id bigint not null references guru(id) on delete cascade,
  status text not null default 'Hadir' check (status in ('Hadir','Izin','Sakit','Alpa')),
  keterangan text,
  dibuat timestamptz not null default now(),
  unique (tanggal, guru_id)
);
alter table mutasi_masuk add column if not exists nisn text;
alter table guru add column if not exists profil jsonb not null default '{}'::jsonb;

alter table tugas enable row level security;
alter table guru enable row level security;
alter table dokumen_guru enable row level security;
alter table mutasi_masuk enable row level security;
alter table mutasi_keluar enable row level security;
alter table absensi enable row level security;
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
-- PENTING: policy akses data inti TIDAK lagi memakai is_staf() untuk ALL.
-- is_staf() hanya mengecek keanggotaan tabel staf, tanpa melihat role maupun
-- profiles.is_active — akibatnya guru/pegawai bisa mengubah/menghapus data
-- sekolah dan akun nonaktif tetap punya akses penuh.
-- Policy yang benar (baca = staf aktif, tulis = admin aktif) dibuat di bagian
-- "2c" di bawah, setelah fungsi is_admin()/am_active() didefinisikan.
drop policy if exists "staf tugas" on tugas;
drop policy if exists "staf guru" on guru;
drop policy if exists "staf dokumen_guru" on dokumen_guru;
drop policy if exists "staf mutasi_masuk" on mutasi_masuk;
drop policy if exists "staf mutasi_keluar" on mutasi_keluar;
drop policy if exists "staf absensi" on absensi;
drop policy if exists "staf baca dokumen" on storage.objects;
drop policy if exists "staf tulis dokumen" on storage.objects;
drop policy if exists "staf tulis ttd" on storage.objects;

-- ===== PROFILES + JURNAL HARIAN (lihat supabase/migrations/002_jurnal_harian.sql) =====
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  nama text,
  role text not null default 'guru' check (role in ('admin','kepsek','guru','pegawai')),
  is_active boolean not null default true,
  guru_id bigint references public.guru(id) on delete set null,
  created_at timestamptz default now()
);
create index if not exists profiles_guru_id_idx on public.profiles (guru_id);
alter table public.profiles enable row level security;
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles for select to authenticated using (auth.uid() = id);
-- Policy admin menyusul di bawah (pakai fungsi security definer, anti-rekursi).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, nama, role, is_active)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'nama', new.email), 'guru', false)
  on conflict (id) do nothing;
  return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
create or replace function public.my_role() returns text language sql stable security definer set search_path = public as $$
  select p.role from public.profiles p where p.id = auth.uid(); $$;
create or replace function public.am_active() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select p.is_active from public.profiles p where p.id = auth.uid()), false); $$;
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin' and p.is_active); $$;
create or replace function public.is_kepsek() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','kepsek') and p.is_active); $$;
grant execute on function public.my_role() to authenticated;
grant execute on function public.am_active() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_kepsek() to authenticated;
drop policy if exists "profiles_select_admin" on public.profiles;
create policy "profiles_select_admin" on public.profiles for select to authenticated using (public.is_admin());
drop policy if exists "profiles_update_admin" on public.profiles;
create policy "profiles_update_admin" on public.profiles for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- 2c. POLICY DATA INTI: baca = staf aktif, tulis = admin aktif.
-- (Menggantikan policy "staf <tabel>" versi lama yang memberi ALL ke semua staf.)
-- ---------------------------------------------------------------------------
drop policy if exists "guru baca aktif" on public.guru;
drop policy if exists "guru admin tulis" on public.guru;
drop policy if exists "tugas admin" on public.tugas;
drop policy if exists "dokumen_guru admin" on public.dokumen_guru;
drop policy if exists "mutasi_masuk admin" on public.mutasi_masuk;
drop policy if exists "mutasi_keluar admin" on public.mutasi_keluar;
drop policy if exists "absensi admin" on public.absensi;
drop policy if exists "dokumen admin baca" on storage.objects;
drop policy if exists "dokumen admin tulis" on storage.objects;
drop policy if exists "ttd admin tulis" on storage.objects;

-- Data guru: staf aktif boleh baca (kop & TTD jurnal), tulis hanya admin.
create policy "guru baca aktif" on public.guru for select to authenticated using (public.am_active());
create policy "guru admin tulis" on public.guru for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "tugas admin" on public.tugas for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "dokumen_guru admin" on public.dokumen_guru for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "mutasi_masuk admin" on public.mutasi_masuk for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "mutasi_keluar admin" on public.mutasi_keluar for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "absensi admin" on public.absensi for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "dokumen admin baca" on storage.objects for select to authenticated using (bucket_id = 'dokumen-guru' and public.is_admin());
create policy "dokumen admin tulis" on storage.objects for all to authenticated using (bucket_id = 'dokumen-guru' and public.is_admin()) with check (bucket_id = 'dokumen-guru' and public.is_admin());
-- ttd-guru: baca untuk staf aktif (lihat 006), tulis hanya admin.
create policy "ttd admin tulis" on storage.objects for all to authenticated using (bucket_id = 'ttd-guru' and public.is_admin()) with check (bucket_id = 'ttd-guru' and public.is_admin());

-- Backfill admin awal: HANYA bila profil belum ada. Jangan promote ulang saat
-- file ini dijalankan ulang, supaya role yang sudah diatur di menu Pengguna
-- tidak tertimpa menjadi admin.
insert into public.profiles (id, email, nama, role, is_active)
select u.id, u.email, coalesce(u.raw_user_meta_data->>'nama', u.email), 'admin', true
from auth.users u where exists (select 1 from public.staf s where s.user_id = u.id)
on conflict (id) do nothing;
create table if not exists public.jurnal_harian (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  tanggal date not null default current_date,
  waktu text not null default '',
  kegiatan text not null,
  bukti_dukung text,
  bukti_path text,
  bukti_nama text,
  keterangan text,
  dibuat timestamptz not null default now(),
  diperbarui timestamptz not null default now()
);
create index if not exists jurnal_harian_user_tanggal_idx on public.jurnal_harian (user_id, tanggal desc);
alter table public.jurnal_harian enable row level security;
drop policy if exists "jurnal_owner_select" on public.jurnal_harian;
create policy "jurnal_owner_select" on public.jurnal_harian for select to authenticated using (user_id = auth.uid() and public.am_active());
drop policy if exists "jurnal_owner_insert" on public.jurnal_harian;
create policy "jurnal_owner_insert" on public.jurnal_harian for insert to authenticated with check (user_id = auth.uid() and public.am_active());
drop policy if exists "jurnal_owner_update" on public.jurnal_harian;
create policy "jurnal_owner_update" on public.jurnal_harian for update to authenticated using (user_id = auth.uid() and public.am_active()) with check (user_id = auth.uid() and public.am_active());
drop policy if exists "jurnal_owner_delete" on public.jurnal_harian;
create policy "jurnal_owner_delete" on public.jurnal_harian for delete to authenticated using (user_id = auth.uid() and public.am_active());
create or replace function public.wajib_taut_pegawai() returns trigger language plpgsql as $$
begin
  if (new.role in ('guru','pegawai','kepsek') and new.is_active = true and new.guru_id is null) then
    raise exception 'Tautkan dulu akun % ke Data Pegawai sebelum diaktifkan.', coalesce(new.email, new.id::text);
  end if;
  return new;
end; $$;
drop trigger if exists trg_profiles_wajib_taut on public.profiles;
create trigger trg_profiles_wajib_taut before insert or update of role, is_active, guru_id on public.profiles for each row execute function public.wajib_taut_pegawai();
drop policy if exists "jurnal_admin_all" on public.jurnal_harian;
create policy "jurnal_admin_all" on public.jurnal_harian for all to authenticated using (public.is_admin()) with check (public.is_admin());
-- ("guru baca aktif" sudah dibuat di bagian 2c — jangan dibuat ulang di sini.)
insert into storage.buckets (id, name, public) values ('bukti-jurnal','bukti-jurnal', false) on conflict (id) do nothing;
update storage.buckets set file_size_limit = 7340032,
  allowed_mime_types = array['application/pdf','image/jpeg','image/png'] where id = 'bukti-jurnal';
-- Bukti jurnal: hanya pemilik folder (user_id) + admin (sama seperti migrasi 011).
drop policy if exists "staf baca bukti" on storage.objects;
drop policy if exists "staf tulis bukti" on storage.objects;
drop policy if exists "bukti baca pemilik" on storage.objects;
drop policy if exists "bukti tulis pemilik" on storage.objects;
create policy "bukti baca pemilik" on storage.objects for select to authenticated
using (
  bucket_id = 'bukti-jurnal'
  and public.am_active()
  and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
);
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
-- ===== ARSIP BERKAS SEKOLAH (per tahun) =====
create table if not exists public.arsip (
  id bigint generated always as identity primary key,
  tahun int not null,
  nama_file text not null,
  path text not null,
  ukuran bigint,
  tipe text,
  dibuat timestamptz not null default now()
);
create index if not exists arsip_tahun_idx on public.arsip (tahun desc, dibuat desc);
alter table public.arsip enable row level security;
drop policy if exists "staf arsip" on public.arsip;
create policy "staf arsip" on public.arsip for all to authenticated
using (public.is_admin()) with check (public.is_admin());
insert into storage.buckets (id, name, public) values ('arsip', 'arsip', false) on conflict (id) do nothing;
update storage.buckets set file_size_limit = 10485760,
  allowed_mime_types = array[
    'application/pdf',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ] where id = 'arsip';
drop policy if exists "staf baca arsip" on storage.objects;
create policy "staf baca arsip" on storage.objects for select to authenticated
using (bucket_id = 'arsip' and public.is_admin());
drop policy if exists "staf tulis arsip" on storage.objects;
create policy "staf tulis arsip" on storage.objects for all to authenticated
using (bucket_id = 'arsip' and public.is_admin())
with check (bucket_id = 'arsip' and public.is_admin());


-- ===== 014: DATA SISWA + ABSENSI SISWA PER KELAS =====
-- Jalankan di Supabase SQL Editor (idempoten, aman diulang).
-- Prasyarat: 002 (fungsi role), 004 (profiles.guru_id), 012 (RLS pisah role).
-- Lihat PRD-absensi-siswa.md Â§5.
--
-- Tabel baru : kelas, siswa, absensi_siswa, setelan
-- Tabel yang dipastikan ada : absensi_libur (sudah dipakai js/absensi.js)
-- Akses: admin penuh; guru hanya rombel binaan (kelas.wali_guru_id via
-- profiles.guru_id); pegawai/kepsek/nonaktif = nol.

do $$
begin
  if to_regproc('public.is_admin') is null
     or to_regproc('public.am_active') is null
     or to_regproc('public.my_role') is null then
    raise exception 'Jalankan migrasi 002_jurnal_harian.sql lebih dulu.';
  end if;
  if to_regclass('public.guru') is null then
    raise exception 'Tabel guru belum ada.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Tabel
-- ---------------------------------------------------------------------------
create table if not exists public.kelas (
  id bigint generated always as identity primary key,
  nama text not null unique,
  urut int not null default 0,
  wali_guru_id bigint references public.guru(id) on delete set null,
  dibuat timestamptz not null default now(),
  diperbarui timestamptz not null default now()
);

create table if not exists public.siswa (
  id bigint generated always as identity primary key,
  nis text,
  nisn text,
  nama text not null,
  jenis_kelamin text check (jenis_kelamin in ('Laki-laki','Perempuan')),
  tempat_lahir text,
  tgl_lahir date,
  nik text,
  agama text,
  alamat text,
  no_hp_ortu text,
  nama_ayah text,
  nama_ibu text,
  kelas_id bigint not null references public.kelas(id) on delete restrict,
  status text not null default 'aktif' check (status in ('aktif','pindah','lulus')),
  dibuat timestamptz not null default now(),
  diperbarui timestamptz not null default now()
);

create unique index if not exists siswa_nisn_uq
  on public.siswa (nisn) where nisn is not null and trim(nisn) <> '';
create index if not exists idx_siswa_kelas_status on public.siswa (kelas_id, status);

create table if not exists public.absensi_siswa (
  id bigint generated always as identity primary key,
  tanggal date not null,
  siswa_id bigint not null references public.siswa(id) on delete cascade,
  kelas_id bigint not null references public.kelas(id) on delete restrict,
  status text not null check (status in ('H','S','I','A')),
  keterangan text,
  dibuat timestamptz not null default now(),
  unique (tanggal, siswa_id)
);
create index if not exists idx_absensi_siswa_kelas_tgl on public.absensi_siswa (kelas_id, tanggal);

create table if not exists public.setelan (
  kunci text primary key,
  nilai text not null
);

create table if not exists public.absensi_libur (
  tanggal date primary key,
  keterangan text not null default '',
  dibuat timestamptz not null default now()
);

-- Trigger waktu ubah
create or replace function public.set_diperbarui() returns trigger
language plpgsql as $$
begin
  new.diperbarui := now();
  return new;
end $$;

drop trigger if exists trg_kelas_diperbarui on public.kelas;
create trigger trg_kelas_diperbarui before update on public.kelas
  for each row execute function public.set_diperbarui();
drop trigger if exists trg_siswa_diperbarui on public.siswa;
create trigger trg_siswa_diperbarui before update on public.siswa
  for each row execute function public.set_diperbarui();

-- ---------------------------------------------------------------------------
-- 2. Seed (idempoten)
-- ---------------------------------------------------------------------------
insert into public.setelan (kunci, nilai) values
  ('tahun_pelajaran', '2026/2027'),
  ('semester', 'Ganjil')
on conflict (kunci) do nothing;

insert into public.kelas (nama, urut) values
  ('1a',1),('1b',2),('2a',3),('2b',4),('3a',5),('3b',6),
  ('4a',7),('4b',8),('5a',9),('5b',10),('6a',11),('6b',12)
on conflict (nama) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Fungsi akses (security definer: anti-rekursi RLS)
-- ---------------------------------------------------------------------------
-- Rombel binaan akun ini; kosong untuk akun nonaktif / bukan guru.
create or replace function public.kelas_wali_saya()
returns setof bigint language sql stable security definer
set search_path = public as $$
  select k.id
  from public.kelas k
  where public.am_active()
    and public.my_role() = 'guru'
    and k.wali_guru_id is not null
    and k.wali_guru_id = (select p.guru_id from public.profiles p where p.id = auth.uid());
$$;
grant execute on function public.kelas_wali_saya() to authenticated;

-- Siswa yang boleh dibaca guru: siswa rombel binaan + siswa yang punya arsip
-- absensi di rombel binaan (aman pasca kenaikan kelas).
create or replace function public.siswa_boleh_dibaca(p_siswa_id bigint, p_kelas_id bigint)
returns boolean language sql stable security definer
set search_path = public as $$
  select public.is_admin()
    or (
      public.am_active() and public.my_role() = 'guru'
      and (
        p_kelas_id in (select public.kelas_wali_saya())
        or exists (
          select 1 from public.absensi_siswa a
          where a.siswa_id = p_siswa_id
            and a.kelas_id in (select public.kelas_wali_saya())
        )
      )
    );
$$;
grant execute on function public.siswa_boleh_dibaca(bigint, bigint) to authenticated;

-- Siswa memang terdaftar di rombel tsb (dipakai with check tulis absensi).
create or replace function public.siswa_di_kelas(p_siswa_id bigint, p_kelas_id bigint)
returns boolean language sql stable security definer
set search_path = public as $$
  select exists (
    select 1 from public.siswa s
    where s.id = p_siswa_id and s.kelas_id = p_kelas_id
  );
$$;
grant execute on function public.siswa_di_kelas(bigint, bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. RLS
-- ---------------------------------------------------------------------------
alter table public.kelas          enable row level security;
alter table public.siswa          enable row level security;
alter table public.absensi_siswa  enable row level security;
alter table public.setelan        enable row level security;
alter table public.absensi_libur  enable row level security;

-- kelas: baca staf aktif admin/guru, tulis admin.
-- Pegawai/kepsek tidak perlu data kelas, jadi baca dibatasi admin + guru.
drop policy if exists "kelas baca" on public.kelas;
drop policy if exists "kelas admin tulis" on public.kelas;
create policy "kelas baca" on public.kelas for select to authenticated
  using (public.is_admin() or (public.am_active() and public.my_role() = 'guru'));
create policy "kelas admin tulis" on public.kelas for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- setelan: baca staf aktif (header cetak), tulis admin.
drop policy if exists "setelan baca" on public.setelan;
drop policy if exists "setelan admin tulis" on public.setelan;
create policy "setelan baca" on public.setelan for select to authenticated
  using (public.am_active());
create policy "setelan admin tulis" on public.setelan for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- absensi_libur: baca staf aktif, tulis admin atau guru aktif.
drop policy if exists "libur baca" on public.absensi_libur;
drop policy if exists "libur tulis" on public.absensi_libur;
create policy "libur baca" on public.absensi_libur for select to authenticated
  using (public.am_active());
create policy "libur tulis" on public.absensi_libur for all to authenticated
  using (public.is_admin() or (public.am_active() and public.my_role() = 'guru'))
  with check (public.is_admin() or (public.am_active() and public.my_role() = 'guru'));

-- siswa: baca admin / guru wali (lihat fungsi), tulis admin.
drop policy if exists "siswa baca" on public.siswa;
drop policy if exists "siswa admin tulis" on public.siswa;
create policy "siswa baca" on public.siswa for select to authenticated
  using (public.siswa_boleh_dibaca(id, kelas_id));
create policy "siswa admin tulis" on public.siswa for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- absensi_siswa: admin semua; guru hanya rombel binaan + siswa benar-benar di rombel itu.
drop policy if exists "absensi_siswa admin" on public.absensi_siswa;
drop policy if exists "absensi_siswa guru baca" on public.absensi_siswa;
drop policy if exists "absensi_siswa guru tulis" on public.absensi_siswa;
create policy "absensi_siswa admin" on public.absensi_siswa for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "absensi_siswa guru baca" on public.absensi_siswa for select to authenticated
  using (kelas_id in (select public.kelas_wali_saya()));
create policy "absensi_siswa guru tulis" on public.absensi_siswa for all to authenticated
  using (kelas_id in (select public.kelas_wali_saya()))
  with check (
    kelas_id in (select public.kelas_wali_saya())
    and public.siswa_di_kelas(siswa_id, kelas_id)
  );
