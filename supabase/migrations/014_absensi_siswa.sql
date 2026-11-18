-- ===== 014: DATA SISWA + ABSENSI SISWA PER KELAS =====
-- Jalankan di Supabase SQL Editor (idempoten, aman diulang).
-- Prasyarat: 002 (fungsi role), 004 (profiles.guru_id), 012 (RLS pisah role).
-- Lihat PRD-absensi-siswa.md §5.
--
-- Tabel baru : kelas, siswa, absensi_siswa, setelan
-- Tabel yang dipastikan ada : absensi_libur (sudah dipakai js/absensi.js)
-- Akses: admin penuh; guru hanya rombel binaan (kelas.wali_guru_id via
-- profiles.guru_id); pegawai/kepsek/nonaktif = nol.

-- my_role() didefinisikan di 002; dibuat ulang idempoten karena bisa belum ada
-- di database yang dibangun dengan urutan lain. Definisi identik dengan 002.
do $$
begin
  if to_regclass('public.profiles') is not null then
    create or replace function public.my_role() returns text
    language sql stable security definer set search_path = public as $f$
      select p.role from public.profiles p where p.id = auth.uid();
    $f$;
    grant execute on function public.my_role() to authenticated;
  end if;
end $$;

do $$
begin
  if to_regprocedure('public.is_admin()') is null then
    raise exception 'Fungsi public.is_admin() belum ada. Jalankan 002_jurnal_harian.sql lebih dulu.';
  end if;
  if to_regprocedure('public.am_active()') is null then
    raise exception 'Fungsi public.am_active() belum ada. Jalankan 002_jurnal_harian.sql lebih dulu.';
  end if;
  if to_regprocedure('public.my_role()') is null then
    raise exception 'Fungsi public.my_role() belum ada. Jalankan 002_jurnal_harian.sql lebih dulu.';
  end if;
  if to_regclass('public.guru') is null then
    raise exception 'Tabel public.guru belum ada.';
  end if;
  if to_regclass('public.profiles') is null then
    raise exception 'Tabel public.profiles belum ada. Jalankan 002_jurnal_harian.sql lebih dulu.';
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
  status text not null check (status in ('S','I','A')),
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

-- ---------------------------------------------------------------------------
-- 5. Verifikasi
-- ---------------------------------------------------------------------------
select tablename, policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('kelas','siswa','absensi_siswa','setelan','absensi_libur')
order by tablename, policyname;
