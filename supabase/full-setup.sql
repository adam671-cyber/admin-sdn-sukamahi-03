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
drop policy if exists "staf tugas" on tugas;
drop policy if exists "staf guru" on guru;
drop policy if exists "staf dokumen_guru" on dokumen_guru;
drop policy if exists "staf mutasi_masuk" on mutasi_masuk;
drop policy if exists "staf mutasi_keluar" on mutasi_keluar;
drop policy if exists "staf absensi" on absensi;
create policy "staf tugas" on tugas for all to authenticated using (public.is_staf()) with check (public.is_staf());
create policy "staf guru" on guru for all to authenticated using (public.is_staf()) with check (public.is_staf());
create policy "staf dokumen_guru" on dokumen_guru for all to authenticated using (public.is_staf()) with check (public.is_staf());
create policy "staf mutasi_masuk" on mutasi_masuk for all to authenticated using (public.is_staf()) with check (public.is_staf());
create policy "staf mutasi_keluar" on mutasi_keluar for all to authenticated using (public.is_staf()) with check (public.is_staf());
create policy "staf absensi" on absensi for all to authenticated using (public.is_staf()) with check (public.is_staf());
-- Storage RLS dokumen-guru: hanya staf terdaftar (ponytail: semua staf bisa baca semua berkas; naik ke path-per-guru bila perlu)
drop policy if exists "staf baca dokumen" on storage.objects;
create policy "staf baca dokumen" on storage.objects for select to authenticated using (bucket_id = 'dokumen-guru' and public.is_staf());
drop policy if exists "staf tulis dokumen" on storage.objects;
create policy "staf tulis dokumen" on storage.objects for all to authenticated using (bucket_id = 'dokumen-guru' and public.is_staf()) with check (bucket_id = 'dokumen-guru' and public.is_staf());

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
returns trigger language plpgsql security definer as $$
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
insert into public.profiles (id, email, nama, role, is_active)
select u.id, u.email, coalesce(u.raw_user_meta_data->>'nama', u.email), 'admin', true
from auth.users u where exists (select 1 from public.staf s where s.user_id = u.id)
on conflict (id) do update set role = 'admin', is_active = true;
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
drop policy if exists "guru baca aktif" on public.guru;
create policy "guru baca aktif" on public.guru for select to authenticated using (public.am_active());
insert into storage.buckets (id, name, public) values ('bukti-jurnal','bukti-jurnal', false) on conflict (id) do nothing;
update storage.buckets set file_size_limit = 7340032,
  allowed_mime_types = array['application/pdf','image/jpeg','image/png'] where id = 'bukti-jurnal';
drop policy if exists "staf baca bukti" on storage.objects;
create policy "staf baca bukti" on storage.objects for select to authenticated using (bucket_id = 'bukti-jurnal' and public.am_active());
drop policy if exists "staf tulis bukti" on storage.objects;
create policy "staf tulis bukti" on storage.objects for all to authenticated using (bucket_id = 'bukti-jurnal' and public.am_active()) with check (bucket_id = 'bukti-jurnal' and public.am_active());
