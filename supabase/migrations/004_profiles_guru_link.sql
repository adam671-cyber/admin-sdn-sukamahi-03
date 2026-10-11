-- 1. Kolom penaut opsional: profiles.guru_id -> guru.id
alter table public.profiles add column if not exists guru_id bigint references public.guru(id) on delete set null;
create index if not exists profiles_guru_id_idx on public.profiles (guru_id);

-- 2. Coba pasangkan otomatis yang namanya sudah sama persis (abaikan gelar ", ...")
update public.profiles p set guru_id = g.id
from public.guru g
where p.guru_id is null
  and split_part(lower(trim(p.nama)), ',', 1) = split_part(lower(trim(g.nama)), ',', 1);

-- 3. Verifikasi: baris guru_id NULL = belum tertaut, tautkan manual via menu Pengguna
--    atau: update public.profiles set guru_id = <id_guru> where email = '<email_login>';
select p.email, p.nama as nama_login, g.nama as nama_pegawai, g.nip, g.jabatan, p.guru_id
from public.profiles p left join public.guru g on g.id = p.guru_id
order by p.nama;
