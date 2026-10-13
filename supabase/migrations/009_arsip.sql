-- ===== 009: ARSIP BERKAS SEKOLAH (per tahun) =====
-- Jalankan di Supabase SQL Editor (idempoten, aman diulang).
-- Format yang diizinkan: PDF, Excel, CSV, Word. Maks 10 MB per file.

-- 1. Tabel arsip (metadata; file di Storage bucket arsip)
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

-- 2. Bucket privat arsip (buat sekali bila belum ada)
insert into storage.buckets (id, name, public)
values ('arsip', 'arsip', false)
on conflict (id) do nothing;
update storage.buckets set file_size_limit = 10485760,
  allowed_mime_types = array[
    'application/pdf',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
  where id = 'arsip';

-- 3. Storage RLS: hanya staf terdaftar yang boleh baca/tulis via app
drop policy if exists "staf baca arsip" on storage.objects;
create policy "staf baca arsip" on storage.objects for select to authenticated
using (bucket_id = 'arsip' and public.is_admin());

drop policy if exists "staf tulis arsip" on storage.objects;
create policy "staf tulis arsip" on storage.objects for all to authenticated
using (bucket_id = 'arsip' and public.is_admin())
with check (bucket_id = 'arsip' and public.is_admin());
