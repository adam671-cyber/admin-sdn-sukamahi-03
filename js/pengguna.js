/* Kelola pengguna (admin): lihat profiles, ubah role, aktif/nonaktif, taut data pegawai */
let penggunaDaftar = [], guruOpsi = [];
const ROLE_OPSI = ['admin', 'kepsek', 'guru', 'pegawai'];

async function muatPengguna() {
  const { data, error } = await sb.from('profiles').select('*').order('created_at', { ascending: false });
  if (error) return alert('Gagal memuat pengguna: ' + error.message);
  penggunaDaftar = data || [];
  try {
    const { data: g } = await sb.from('guru').select('id,nama,nip,jabatan').order('nama');
    guruOpsi = g || [];
  } catch { guruOpsi = []; }
  renderPengguna();
}

function renderPengguna() {
  const tb = $('#p-tabel-body');
  if (!tb) return;
  const q = ($('#p-cari').value || '').trim().toLowerCase();
  const hasil = penggunaDaftar.filter((p) => ((p.nama || '') + ' ' + (p.email || '')).toLowerCase().includes(q));
  $('#p-jumlah').textContent = hasil.length + ' dari ' + penggunaDaftar.length + ' pengguna';
  if (!hasil.length) {
    tb.innerHTML = '<tr><td colspan="6" class="px-2.5 py-8 text-center text-ink/50">Tidak ada pengguna.</td></tr>';
    return;
  }
  tb.innerHTML = hasil.map((p) => `
    <tr class="align-top">
      <td class="px-2.5 py-2 font-semibold">${esc(p.nama || '-')}</td>
      <td class="px-2.5 py-2 text-ink/70">${esc(p.email || '-')}</td>
      <td class="px-2.5 py-2">
        <select data-p="guru" data-id="${p.id}" class="rounded-lg border px-2 py-1 text-xs max-w-[12rem] ${!p.guru_id && (p.role === 'guru' || p.role === 'pegawai' || p.role === 'kepsek') ? 'border-amber-500 bg-amber-50' : 'border-ink/20'}" ${p.id === session.user.id ? 'disabled' : ''} title="Tautkan ke Data Pegawai (nama/NIP/jabatan jurnal)">
          <option value="">Belum ditautkan — wajib sebelum aktif</option>
          ${guruOpsi.map((g) => `<option value="${g.id}" ${String(p.guru_id) === String(g.id) ? 'selected' : ''}>${esc(g.nama)}${g.nip ? ' · ' + esc(g.nip) : ''}</option>`).join('')}
        </select>
      </td>
      <td class="px-2.5 py-2">
        <select data-p="role" data-id="${p.id}" class="rounded-lg border border-ink/20 px-2 py-1 text-xs" ${p.id === session.user.id ? 'disabled' : ''}>
          ${ROLE_OPSI.map((r) => `<option value="${r}" ${p.role === r ? 'selected' : ''}>${r}</option>`).join('')}
        </select>
      </td>
      <td class="px-2.5 py-2 text-center">
        <span class="rounded px-2 py-0.5 text-[11px] font-bold ${p.is_active ? 'bg-hijau/10 text-hijau' : 'bg-red-100 text-red-700'}">${p.is_active ? 'Aktif' : 'Non-aktif'}</span>
      </td>
      <td class="px-2.5 py-2 text-center whitespace-nowrap">
        <button data-p="toggle" data-id="${p.id}" title="${!p.is_active && (p.role === 'guru' || p.role === 'pegawai' || p.role === 'kepsek') && !p.guru_id ? 'Tautkan Data Pegawai dulu sebelum mengaktifkan' : (p.is_active ? 'Nonaktifkan akun' : 'Aktifkan akun')}" class="rounded-md border border-ink/20 px-2 py-0.5 text-[11px] font-semibold hover:bg-kertas ${!p.is_active && (p.role === 'guru' || p.role === 'pegawai' || p.role === 'kepsek') && !p.guru_id ? 'opacity-50' : ''}" ${p.id === session.user.id ? 'disabled' : ''}>${p.is_active ? 'Nonaktifkan' : 'Aktifkan'}</button>
      </td>
    </tr>`).join('');
}

async function aksiPengguna(aksi, id, nilai) {
  if (id === session.user.id) return alert('Tidak bisa mengubah akun sendiri.');
  const p = penggunaDaftar.find((x) => String(x.id) === String(id));
  if (!p) return;
  if (aksi === 'toggle' && !p.is_active && (p.role === 'guru' || p.role === 'pegawai' || p.role === 'kepsek') && !p.guru_id) {
    return alert('Tautkan dulu akun ' + (p.email || '') + ' ke Data Pegawai sebelum diaktifkan, supaya nama/NIP/jabatan di jurnal benar.');
  }
  if (aksi === 'toggle' && !confirm((p.is_active ? 'Nonaktifkan' : 'Aktifkan') + ' akun ' + (p.nama || p.email) + '?')) return;
  const patch = aksi === 'role' ? { role: nilai } : aksi === 'guru' ? { guru_id: nilai ? Number(nilai) : null } : { is_active: !p.is_active };
  const { error } = await sb.from('profiles').update(patch).eq('id', id);
  if (error) {
    if (String(error.message || '').includes('guru_id')) return alert('Kolom penaut belum ada: jalankan migrasi 004_profiles_guru_link.sql lalu 005_profiles_wajib_taut.sql di SQL Editor dulu.');
    if (String(error.message || '').includes('Tautkan dulu')) return alert(error.message);
    return alert('Gagal menyimpan: ' + error.message);
  }
  muatPengguna();
}

$('#p-cari').oninput = renderPengguna;
$('#p-tabel-body').onclick = (e) => {
  const b = e.target.closest('button[data-p="toggle"]');
  if (b) aksiPengguna(b.dataset.p, b.dataset.id);
};
$('#p-tabel-body').onchange = (e) => {
  const s = e.target.closest('[data-p="role"]');
  if (s) return aksiPengguna('role', s.dataset.id, s.value);
  const g = e.target.closest('[data-p="guru"]');
  if (g) return aksiPengguna('guru', g.dataset.id, g.value);
};
addEventListener('hashchange', () => { if (location.hash === '#pengguna') muatPengguna(); });
sb.auth.getSession().then(({ data }) => { if (data.session && location.hash === '#pengguna') muatPengguna(); });
