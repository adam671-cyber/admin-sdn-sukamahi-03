-- ===== 008: Kepsek = pengguna jurnal biasa (bukan admin baca-semua) =====
-- Jalankan di Supabase SQL Editor (idempoten, aman diulang).
-- Tujuan: role kepsek diperlakukan sama seperti guru/pegawai:
--   1. Hanya bisa baca/tulis jurnal miliknya sendiri (cabut akses baca semua jurnal).
--   2. Tidak bisa intip daftar profiles semua orang (cabut policy kepsek-baca).
--   3. Wajib ditautkan ke Data Pegawai sebelum bisa aktif (seperti guru/pegawai).

-- 1. Cabut akses baca-semua jurnal untuk kepsek.
drop policy if exists "jurnal_kepsek_select" on public.jurnal_harian;

-- 2. Cabut akses baca-semua profiles untuk kepsek.
drop policy if exists "profiles_select_kepsek" on public.profiles;

-- 3. Fungsi is_kepsek dipertahankan untuk kompatibilitas, tapi tidak lagi
--    dipakai policy mana pun. Jangan dipakai untuk policy baru.

-- 4. Wajib taut Data Pegawai juga untuk role kepsek.
create or replace function public.wajib_taut_pegawai()
returns trigger language plpgsql as $$
begin
  if (new.role in ('guru','pegawai','kepsek') and new.is_active = true and new.guru_id is null) then
    raise exception 'Tautkan dulu akun % ke Data Pegawai sebelum diaktifkan.', coalesce(new.email, new.id::text);
  end if;
  return new;
end; $$;

drop trigger if exists trg_profiles_wajib_taut on public.profiles;
create trigger trg_profiles_wajib_taut
before insert or update of role, is_active, guru_id on public.profiles
for each row execute function public.wajib_taut_pegawai();

-- 5. Laporan: akun kepsek aktif yang masih tanpa tautan (harus 0 baris idealnya).
--    Tautkan via menu Pengguna (admin), atau:
--    update public.profiles set guru_id = <id_guru> where email = '<email_kepsek>';
select p.email, p.nama as nama_login, p.role, p.is_active, p.guru_id,
       g.nama as nama_pegawai, g.nip, g.jabatan
from public.profiles p left join public.guru g on g.id = p.guru_id
where p.role = 'kepsek' and p.is_active = true and p.guru_id is null
order by p.email;
