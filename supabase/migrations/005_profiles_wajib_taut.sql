-- ===== 005: Kunci verifikasi akun guru/pegawai di database =====
-- Jalankan di Supabase SQL Editor SETELAH 004 (idempoten, aman diulang).
-- Tujuan: akun role guru/pegawai TIDAK BISA aktif bila belum ditautkan
-- ke Data Pegawai (profiles.guru_id NULL). Aturan ini berlaku di level
-- database, jadi tidak bisa dibobol lewat API langsung.
--
-- Catatan: migrasi ini TIDAK mengubah RLS yang sudah ada.

-- 1. Pastikan kolom penaut ada (ulangi 004 agar 005 bisa jalan mandiri)
alter table public.profiles add column if not exists guru_id bigint references public.guru(id) on delete set null;
create index if not exists profiles_guru_id_idx on public.profiles (guru_id);

-- 2. Trigger: tolak aktivasi guru/pegawai tanpa tautan Data Pegawai
create or replace function public.wajib_taut_pegawai()
returns trigger language plpgsql as $$
begin
  if (new.role in ('guru','pegawai') and new.is_active = true and new.guru_id is null) then
    raise exception 'Tautkan dulu akun % ke Data Pegawai sebelum diaktifkan.', coalesce(new.email, new.id::text);
  end if;
  return new;
end; $$;

drop trigger if exists trg_profiles_wajib_taut on public.profiles;
create trigger trg_profiles_wajib_taut
before insert or update of role, is_active, guru_id on public.profiles
for each row execute function public.wajib_taut_pegawai();

-- 3. Laporan: akun guru/pegawai aktif yang masih tanpa tautan (harus 0 baris idealnya)
--    Tautkan manual via menu Pengguna, atau:
--    update public.profiles set guru_id = <id_guru> where email = '<email_login>';
select p.email, p.nama as nama_login, p.role, p.is_active, p.guru_id,
       g.nama as nama_pegawai, g.nip, g.jabatan
from public.profiles p left join public.guru g on g.id = p.guru_id
where p.role in ('guru','pegawai') and p.is_active = true and p.guru_id is null
order by p.email;
