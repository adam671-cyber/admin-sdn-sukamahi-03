-- ===== 002: PROFILES + JURNAL HARIAN =====
-- Jalankan di Supabase SQL Editor (idempoten, aman diulang).

-- 1. Tabel profiles (sama seperti yang sudah dibuat; dibuat ulang aman bila belum ada)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  nama text,
  role text not null default 'guru' check (role in ('admin','kepsek','guru','pegawai')),
  is_active boolean not null default true,
  created_at timestamptz default now()
);
alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles for select to authenticated
using (auth.uid() = id);

drop policy if exists "profiles_select_admin" on public.profiles;
drop policy if exists "profiles_update_admin" on public.profiles;
-- CATATAN: policy admin TIDAK dibuat di sini karena versi exists-subquery
-- (select 1 from public.profiles ...) menyebabkan rekursi RLS tak berujung:
-- setiap SELECT ke profiles harus mengevaluasi policy itu, yang query profiles lagi.
-- Policy admin yang aman (pakai fungsi security definer) dibuat di bagian 2b.

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, email, nama, role, is_active)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'nama', new.email), 'guru', false)
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- 2. Helper role (dipakai RLS jurnal + aplikasi)
create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select p.role from public.profiles p where p.id = auth.uid();
$$;
create or replace function public.am_active() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select p.is_active from public.profiles p where p.id = auth.uid()), false);
$$;
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin' and p.is_active);
$$;
create or replace function public.is_kepsek() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','kepsek') and p.is_active);
$$;
grant execute on function public.my_role() to authenticated;
grant execute on function public.am_active() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_kepsek() to authenticated;

-- 2b. Policy admin untuk profiles (pakai fungsi security definer di atas,
-- jadi TIDAK rekursi seperti subquery exists langsung ke profiles)
drop policy if exists "profiles_select_admin" on public.profiles;
create policy "profiles_select_admin" on public.profiles for select to authenticated
using (public.is_admin());
drop policy if exists "profiles_update_admin" on public.profiles;
create policy "profiles_update_admin" on public.profiles for update to authenticated
using (public.is_admin()) with check (public.is_admin());

-- 3. Backfill: pastikan akun staf lama punya profile admin aktif
-- (ganti email di bawah dengan email admin kamu bila perlu, atau jalankan per-user)
insert into public.profiles (id, email, nama, role, is_active)
select u.id, u.email, coalesce(u.raw_user_meta_data->>'nama', u.email), 'admin', true
from auth.users u
where exists (select 1 from public.staf s where s.user_id = u.id)
on conflict (id) do update set role = 'admin', is_active = true;

-- 4. Tabel jurnal_harian
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
create policy "jurnal_owner_select" on public.jurnal_harian for select to authenticated
using (user_id = auth.uid() and public.am_active());

drop policy if exists "jurnal_owner_insert" on public.jurnal_harian;
create policy "jurnal_owner_insert" on public.jurnal_harian for insert to authenticated
with check (user_id = auth.uid() and public.am_active());

drop policy if exists "jurnal_owner_update" on public.jurnal_harian;
create policy "jurnal_owner_update" on public.jurnal_harian for update to authenticated
using (user_id = auth.uid() and public.am_active())
with check (user_id = auth.uid() and public.am_active());

drop policy if exists "jurnal_owner_delete" on public.jurnal_harian;
create policy "jurnal_owner_delete" on public.jurnal_harian for delete to authenticated
using (user_id = auth.uid() and public.am_active());

drop policy if exists "jurnal_kepsek_select" on public.jurnal_harian;
create policy "jurnal_kepsek_select" on public.jurnal_harian for select to authenticated
using (public.is_kepsek());

drop policy if exists "jurnal_admin_all" on public.jurnal_harian;
create policy "jurnal_admin_all" on public.jurnal_harian for all to authenticated
using (public.is_admin())
with check (public.is_admin());

-- 5. Guru/pegawai aktif boleh baca data guru (untuk kop NIP/jabatan di jurnal)
drop policy if exists "guru baca aktif" on public.guru;
create policy "guru baca aktif" on public.guru for select to authenticated
using (public.am_active());

-- 6. Bucket privat bukti-jurnal (buat sekali bila belum ada)
insert into storage.buckets (id, name, public) values ('bukti-jurnal','bukti-jurnal', false)
  on conflict (id) do nothing;
update storage.buckets set file_size_limit = 7340032,
  allowed_mime_types = array['application/pdf','image/jpeg','image/png']
  where id = 'bukti-jurnal';

drop policy if exists "staf baca bukti" on storage.objects;
create policy "staf baca bukti" on storage.objects for select to authenticated
using (bucket_id = 'bukti-jurnal' and public.am_active());

drop policy if exists "staf tulis bukti" on storage.objects;
create policy "staf tulis bukti" on storage.objects for all to authenticated
using (bucket_id = 'bukti-jurnal' and public.am_active())
with check (bucket_id = 'bukti-jurnal' and public.am_active());
