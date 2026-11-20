/* Database Siswa (admin): data siswa, kelas & wali kelas, kenaikan kelas, upload batch Excel.
   Akses ditegakkan RLS (migrasi 014); pengecekan adalah di sini hanya pelengkap UI. */
let sKelas = [], sSiswa = [], sGuru = [], sSetelan = {};
let sTab = 'data', sCari = '', sFilter = '';

const S_KOLOM_BATCH = ['No', 'Nama Siswa', 'Jenis Kelamin', 'NISN', 'NIS', 'Tempat Lahir', 'Tanggal Lahir', 'NIK', 'Agama', 'Alamat', 'No Hp. Orang Tua', 'Nama Ayah', 'Nama Ibu', 'Rombel/Kelas'];
const S_AGAMA = ['Islam', 'Kristen', 'Katolik', 'Hindu', 'Buddha', 'Konghucu'];
const S_BTN = 'rounded-lg bg-hijau text-white text-xs font-semibold px-3 py-1.5 hover:bg-ink';
const S_BTN_O = 'rounded-lg border border-hijau text-hijau text-xs font-semibold px-3 py-1.5 hover:bg-hijau hover:text-white';
const S_INP = 'rounded-lg border border-ink/20 px-3 py-1.5 text-sm';
const sGalat = (e, p) => p + ': ' + (e && e.code === '23505' ? 'NISN sudah dipakai siswa lain.' : (e.message || e));
const sNorm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, '');

async function sAmbilSemua(tabel, urut) {
  const out = [];
  for (let dari = 0; ; dari += 1000) {
    const { data, error } = await sb.from(tabel).select('*').order(urut).range(dari, dari + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

async function muatSiswa() {
  const root = $('#ds-root');
  if (!root) return;
  if (!adalahAdmin()) { location.hash = '#absensi-siswa'; return; }
  root.innerHTML = '<p class="text-sm text-ink/60 p-2">Memuat…</p>';
  try {
    const [k, s, g, st] = await Promise.all([
      sb.from('kelas').select('*').order('urut').order('nama'),
      sAmbilSemua('siswa', 'nama'),
      sb.from('guru').select('id,nama').order('nama'),
      sb.from('setelan').select('kunci,nilai'),
    ]);
    if (k.error) throw k.error;
    if (g.error) throw g.error;
    if (st.error) throw st.error;
    sKelas = k.data || []; sSiswa = s || []; sGuru = g.data || [];
    sSetelan = Object.fromEntries((st.data || []).map((x) => [x.kunci, x.nilai]));
  } catch (e) {
    root.innerHTML = '<p class="text-sm text-red-600 p-2">' + esc(sGalat(e, 'Gagal memuat data siswa (sudah menjalankan migrasi 014?)')) + '</p>';
    return;
  }
  sRender();
}

const sNamaKelas = (id) => (sKelas.find((k) => k.id === id) || {}).nama || '-';
const sTglID = (d) => d ? new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

function sRender() {
  const tabs = [['data', 'Data Siswa'], ['kelas', 'Kelas & Wali Kelas'], ['naik', 'Kenaikan Kelas']];
  // Tab "Data Siswa" disembunyikan di halaman data siswa itu sendiri (default saat menu dibuka),
  // tetap tampil di tab lain sebagai cara kembali.
  const tampilTabs = sTab === 'data' ? tabs.filter(([k]) => k !== 'data') : tabs;
  $('#ds-root').innerHTML = `
    <article class="rounded-xl bg-white p-4 space-y-3">
      <div class="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
        <h2 class="col-span-2 font-extrabold text-lg sm:col-span-1 sm:mr-auto">Database Siswa</h2>
        ${tampilTabs.map(([k, l]) => `<button data-stab="${k}" class="${sTab === k ? S_BTN : S_BTN_O} w-full sm:w-auto">${l}</button>`).join('')}
      </div>
      <div id="ds-isi"></div>
    </article>`;
  sRenderTab();
}

function sRenderTab() {
  if (sTab === 'data') sRenderData();
  else if (sTab === 'kelas') sRenderKelas();
  else sRenderNaik();
}

/* ---------- Tab: Data Siswa ---------- */
function sRenderData() {
  const opsiKelas = '<option value="">Semua rombel</option>' + sKelas.map((k) => `<option value="${k.id}" ${String(k.id) === sFilter ? 'selected' : ''}>${esc(k.nama)}</option>`).join('');
  $('#ds-isi').innerHTML = `
    <div class="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-end mb-3">
      <button data-saksi="tambah" class="${S_BTN} w-full sm:w-auto">+ Tambah Siswa</button>
      <button data-saksi="batch" class="${S_BTN_O} w-full sm:w-auto">Upload Batch Excel</button>
      <button data-saksi="unduh" title="Unduh data siswa per rombel (sheet per kelas + rekap semua) dalam satu file .xlsx" class="${S_BTN_O} w-full sm:w-auto">Unduh Data Excel</button>
      <button data-saksi="hapus-batch" class="col-span-2 sm:col-span-1 w-full sm:w-auto rounded-lg border border-red-600 text-red-600 text-xs font-semibold px-3 py-1.5 hover:bg-red-600 hover:text-white">Hapus per Rombel</button>
      <input id="ds-cari" type="search" value="${esc(sCari)}" placeholder="Cari nama / NIS / NISN" class="${S_INP} col-span-2 sm:col-span-1 w-full sm:w-auto sm:min-w-[14rem] sm:ml-auto">
      <select id="ds-filter" class="${S_INP} col-span-2 sm:col-span-1 w-full sm:w-auto">${opsiKelas}</select>
    </div>
    <div class="ds-tabel rounded-lg border border-ink/10">
      <table class="text-left text-xs whitespace-nowrap w-full">
        <thead class="bg-gray-200/80 font-bold"><tr>
          ${['No', 'Rombel', 'NIS', 'NISN', 'Nama', 'L/P', 'Tempat/Tgl Lahir', 'NIK', 'Agama', 'Alamat', 'No HP Ortu', 'Orang Tua', 'Status', 'Aksi'].map((h) => `<th class="px-2 py-2">${h}</th>`).join('')}
        </tr></thead>
        <tbody id="ds-body"></tbody>
      </table>
    </div>
    <p id="ds-info" class="mt-2 text-xs text-ink/60"></p>`;
  sIsiTabel();
}

function sIsiTabel() {
  const q = sCari.trim().toLowerCase();
  const cocok = (s) => (!sFilter || String(s.kelas_id) === sFilter)
    && (!q || [s.nama, s.nis, s.nisn].some((x) => String(x || '').toLowerCase().includes(q)));
  const daftar = sSiswa.filter(cocok);
  let html = '', total = 0;
  sKelas.forEach((k) => {
    const isi = daftar.filter((s) => s.kelas_id === k.id);
    if (!isi.length) return;
    html += `<tr class="bg-hijau/10 font-bold"><td colspan="14" class="px-2 py-1.5">Rombel ${esc(k.nama)} — ${isi.length} siswa</td></tr>`;
    isi.forEach((s, i) => {
      total++;
      html += `<tr class="border-t border-ink/10">
        <td class="px-2 py-1.5">${i + 1}</td><td class="px-2">${esc(k.nama)}</td>
        <td class="px-2">${esc(s.nis || '')}</td><td class="px-2">${esc(s.nisn || '')}</td>
        <td class="px-2 font-semibold">${esc(s.nama)}</td>
        <td class="px-2">${s.jenis_kelamin === 'Laki-laki' ? 'L' : s.jenis_kelamin === 'Perempuan' ? 'P' : ''}</td>
        <td class="px-2">${esc([s.tempat_lahir, sTglID(s.tgl_lahir)].filter(Boolean).join(', '))}</td>
        <td class="px-2">${esc(s.nik || '')}</td><td class="px-2">${esc(s.agama || '')}</td>
        <td class="px-2 max-w-[14rem] truncate" title="${esc(s.alamat || '')}">${esc(s.alamat || '')}</td>
        <td class="px-2">${esc(s.no_hp_ortu || '')}</td>
        <td class="px-2">${esc([s.nama_ayah, s.nama_ibu].filter(Boolean).join(' / '))}</td>
        <td class="px-2">${esc(s.status)}</td>
        <td class="px-2 space-x-2">
          <button data-saksi="edit" data-id="${s.id}" class="font-semibold text-hijau hover:underline">Edit</button>
          <button data-saksi="hapus" data-id="${s.id}" class="font-semibold text-red-600 hover:underline" title="Hapus permanen">Hapus</button>
        </td></tr>`;
    });
  });
  $('#ds-body').innerHTML = html || '<tr><td colspan="14" class="px-2 py-4 text-center text-ink/60">Belum ada data siswa.</td></tr>';
  $('#ds-info').textContent = total + ' siswa ditampilkan dari ' + sSiswa.length + ' total.';
}

/* ---------- Modal umum ---------- */
function sModal(judul, isi, lebar = 'max-w-2xl') {
  sTutupModal();
  const o = document.createElement('div');
  o.id = 's-modal';
  o.className = 'fixed inset-0 z-[60] bg-black/60 p-3 flex items-center justify-center overflow-y-auto';
  o.innerHTML = `<div class="bg-white rounded-2xl w-full ${lebar} shadow-2xl max-h-[92vh] flex flex-col overflow-hidden">
    <div class="flex items-center justify-between px-5 py-3 border-b border-ink/10">
      <h3 class="font-extrabold text-base">${esc(judul)}</h3>
      <button type="button" data-smodal-tutup class="rounded-lg px-2 py-1 text-ink/60 hover:bg-ink/10" title="Tutup">✕</button>
    </div>
    <div class="flex-1 overflow-y-auto p-5">${isi}</div></div>`;
  o.addEventListener('click', (e) => { if (e.target === o || e.target.closest('[data-smodal-tutup]')) sTutupModal(); });
  document.body.appendChild(o);
  return o;
}
function sTutupModal() { const o = $('#s-modal'); if (o) o.remove(); }

/* ---------- Form tambah / edit siswa ---------- */
function sFormSiswa(id) {
  const s = id ? sSiswa.find((x) => x.id === id) : null;
  const d = s || { status: 'aktif', kelas_id: sFilter ? Number(sFilter) : (sKelas[0] || {}).id };
  const f = (k, label, tipe = 'text', extra = '') => `<label class="text-sm font-semibold block">${label}
      <input name="${k}" type="${tipe}" value="${esc(d[k] || '')}" ${extra} class="${S_INP} w-full mt-1 font-normal"></label>`;
  const sel = (k, label, opts, nilai) => `<label class="text-sm font-semibold block">${label}
      <select name="${k}" class="${S_INP} w-full mt-1 font-normal">${opts.map(([v, t]) => `<option value="${esc(v)}" ${String(v) === String(nilai ?? '') ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`;
  const o = sModal(s ? 'Edit Siswa' : 'Tambah Siswa', `<form id="s-form" class="grid gap-3 sm:grid-cols-2">
    <div class="sm:col-span-2">${f('nama', 'Nama Siswa *', 'text', 'required')}</div>
    ${sel('jenis_kelamin', 'Jenis Kelamin', [['', '-'], ['Laki-laki', 'Laki-laki'], ['Perempuan', 'Perempuan']], d.jenis_kelamin)}
    ${sel('kelas_id', 'Rombel *', sKelas.map((k) => [k.id, k.nama]), d.kelas_id)}
    ${f('nisn', 'NISN')}${f('nis', 'NIS')}
    ${f('tempat_lahir', 'Tempat Lahir')}${f('tgl_lahir', 'Tanggal Lahir', 'date')}
    ${f('nik', 'NIK')}
    ${sel('agama', 'Agama', [['', '-'], ...S_AGAMA.map((a) => [a, a])], d.agama)}
    <div class="sm:col-span-2">${f('alamat', 'Alamat')}</div>
    ${f('no_hp_ortu', 'No HP Orang Tua')}${sel('status', 'Status', [['aktif', 'aktif'], ['pindah', 'pindah'], ['lulus', 'lulus']], d.status)}
    ${f('nama_ayah', 'Nama Ayah')}${f('nama_ibu', 'Nama Ibu')}
    <div class="sm:col-span-2 flex justify-end gap-2 pt-2">
      <button type="button" data-smodal-tutup class="${S_BTN_O}">Batal</button>
      <button type="submit" class="${S_BTN}">Simpan</button>
    </div></form>`);
  o.querySelector('#s-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const v = (k) => String(fd.get(k) || '').trim() || null;
    const row = {
      nama: v('nama'), jenis_kelamin: v('jenis_kelamin'), kelas_id: Number(fd.get('kelas_id')),
      nisn: v('nisn'), nis: v('nis'), tempat_lahir: v('tempat_lahir'), tgl_lahir: v('tgl_lahir'),
      nik: v('nik'), agama: v('agama'), alamat: v('alamat'), no_hp_ortu: v('no_hp_ortu'),
      nama_ayah: v('nama_ayah'), nama_ibu: v('nama_ibu'), status: v('status') || 'aktif',
    };
    if (!row.nama) return alert('Nama siswa wajib diisi.');
    if (!row.kelas_id) return alert('Rombel wajib dipilih.');
    const btn = e.target.querySelector('[type=submit]'); btn.disabled = true;
    const { error } = s ? await sb.from('siswa').update(row).eq('id', s.id) : await sb.from('siswa').insert(row);
    btn.disabled = false;
    if (error) return alert(sGalat(error, 'Gagal menyimpan siswa'));
    sTutupModal();
    await muatSiswa();
  };
}

function sHapusSiswa(id) {
  const s = sSiswa.find((x) => x.id === id);
  if (!s) return;
  const o = sModal('Hapus Siswa', `<p class="text-sm">Hapus permanen data siswa <b>${esc(s.nama)}</b> (${esc(s.nisn || 'tanpa NISN')})?
    Gunakan ini jika siswa mutasi keluar atau pindah sekolah. <b>Data absensi siswa ini juga akan terhapus.</b>
    Jika hanya ingin menonaktifkan, ubah statusnya menjadi "pindah" lewat Edit.</p>
    <div class="flex justify-end gap-2 pt-4">
      <button type="button" data-smodal-tutup class="${S_BTN_O}">Batal</button>
      <button type="button" id="s-hapus-ya" class="rounded-lg bg-red-600 text-white text-xs font-semibold px-3 py-1.5 hover:bg-red-700">Hapus Permanen</button>
    </div>`, 'max-w-md');
  o.querySelector('#s-hapus-ya').onclick = async (e) => {
    e.target.disabled = true;
    const { error } = await sb.from('siswa').delete().eq('id', id);
    if (error) { e.target.disabled = false; return alert(sGalat(error, 'Gagal menghapus siswa')); }
    sTutupModal();
    await muatSiswa();
  };
}

/* ---------- Hapus batch per rombel ---------- */
function sHapusBatch() {
  const jml = (id) => sSiswa.filter((s) => String(s.kelas_id) === String(id)).length;
  const opts = sKelas.map((k) => `<option value="${k.id}">${esc(k.nama)} — ${jml(k.id)} siswa</option>`).join('');
  const o = sModal('Hapus per Rombel', `<p class="text-sm">Pilih rombel, lalu seluruh data siswa rombel tersebut dihapus <b>permanen</b> sekaligus
    agar bisa di-upload ulang lewat Batch Excel. <b>Data absensi siswa rombel ini juga akan terhapus.</b> Tidak bisa dikembalikan.</p>
    <label class="text-sm font-semibold block my-2">Rombel
      <select id="sbh-rombel" class="${S_INP} w-full mt-1 font-normal">${opts}</select></label>
    <div class="flex justify-end gap-2 pt-4">
      <button type="button" data-smodal-tutup class="${S_BTN_O}">Batal</button>
      <button type="button" id="sbh-ya" class="rounded-lg bg-red-600 text-white text-xs font-semibold px-3 py-1.5 hover:bg-red-700">Hapus Permanen</button>
    </div>`, 'max-w-md');
  o.querySelector('#sbh-ya').onclick = async (e) => {
    const kelasId = Number(o.querySelector('#sbh-rombel').value);
    if (!kelasId) return alert('Pilih rombel dulu.');
    const n = jml(kelasId);
    if (!n) return alert('Rombel ini belum punya data siswa.');
    if (!confirm(`Hapus ${n} siswa di ${esc(sNamaKelas(kelasId))}? Data absensinya ikut terhapus dan tidak bisa dikembalikan.`)) return;
    e.target.disabled = true;
    const { error } = await sb.from('siswa').delete().eq('kelas_id', kelasId);
    if (error) { e.target.disabled = false; return alert(sGalat(error, 'Gagal menghapus rombel')); }
    sTutupModal();
    await muatSiswa();
    alert(n + ' siswa berhasil dihapus dari ' + sNamaKelas(kelasId) + '.');
  };
}

/* ---------- Upload batch Excel ---------- */
let sBatch = { valid: [], invalid: [] };

async function sUnduhTemplate() {
  let X;
  try { X = await muatXlsx(); } catch (e) { return alert(galatXlsx(e)); }
  const contoh = [1, 'Contoh Siswa', 'L', '0123456789', '1234', 'Bekasi', '2018-05-21', '3216000000000001', 'Islam', 'Jl. Contoh No. 1', '081234567890', 'Nama Ayah', 'Nama Ibu', '1a'];
  const ws = X.utils.aoa_to_sheet([S_KOLOM_BATCH, contoh]);
  // NISN/NIS/NIK sebagai teks agar angka 0 di depan tidak hilang
  [3, 4, 7, 10].forEach((c) => { const a = X.utils.encode_cell({ r: 1, c }); if (ws[a]) { ws[a].t = 's'; ws[a].v = String(ws[a].v); } });
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, ws, 'Siswa');
  X.writeFile(wb, 'Template_Siswa_SDNSukamahi03.xlsx');
}

/* ---------- Unduh data siswa (per rombel, satu file Excel) ---------- */
async function sUnduhExcel() {
  let X;
  try { X = await muatXlsx(); } catch (e) { return alert(galatXlsx(e)); }
  const jkS = (v) => (v === 'Laki-laki' ? 'L' : v === 'Perempuan' ? 'P' : '');
  // NIS/NISN/NIK/No HP dipaksa String agar sel Excel bertipe teks (angka 0 di depan tidak hilang)
  const barisSiswa = (daftar) => daftar.map((s, i) =>
    [i + 1, String(s.nama ?? ''), jkS(s.jenis_kelamin), String(s.nis ?? ''), String(s.nisn ?? ''), String(s.tempat_lahir ?? ''), String(s.tgl_lahir ?? ''), String(s.nik ?? ''), String(s.agama ?? ''), String(s.alamat ?? ''), String(s.no_hp_ortu ?? ''), String(s.nama_ayah ?? ''), String(s.nama_ibu ?? ''), String(s.status ?? '')]);
  const KOLOM = ['No', 'Nama Siswa', 'L/P', 'NIS', 'NISN', 'Tempat Lahir', 'Tanggal Lahir', 'NIK', 'Agama', 'Alamat', 'No Hp. Orang Tua', 'Nama Ayah', 'Nama Ibu', 'Status'];
  const wb = X.utils.book_new();
  // Sheet per rombel mengikuti urutan tabel kelas; siswa dalam satu rombel urut nama (sama seperti tabel di layar)
  sKelas.forEach((k) => {
    const isi = sSiswa.filter((s) => String(s.kelas_id) === String(k.id)).sort((a, b) => String(a.nama || '').localeCompare(String(b.nama || ''), 'id'));
    if (!isi.length) return;
    const ws = X.utils.aoa_to_sheet([KOLOM, ...barisSiswa(isi)]);
    ws['!cols'] = [{ wch: 4 }, { wch: 26 }, { wch: 5 }, { wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 20 }, { wch: 10 }, { wch: 28 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 8 }];
    X.utils.book_append_sheet(wb, ws, String(k.nama).replace(/[\\/?*[\]:]/g, '').slice(0, 31) || 'rombel');
  });
  // Sheet "Semua": seluruh siswa (aktif/pindah/lulus) dikelompokkan per rombel, urut nama
  if (sSiswa.length) {
    const aoa = [KOLOM];
    let no = 0;
    sKelas.forEach((k) => {
      const isi = sSiswa.filter((s) => String(s.kelas_id) === String(k.id)).sort((a, b) => String(a.nama || '').localeCompare(String(b.nama || ''), 'id'));
      if (!isi.length) return;
      no += isi.length;
      aoa.push([`Rombel ${k.nama} — ${isi.length} siswa`, '', '', '', '', '', '', '', '', '', '', '', '']);
      aoa.push(...barisSiswa(isi).map((r, i) => [no - isi.length + i + 1].concat(r.slice(1))));
    });
    const ws2 = X.utils.aoa_to_sheet(aoa);
    ws2['!cols'] = [{ wch: 4 }, { wch: 26 }, { wch: 5 }, { wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 20 }, { wch: 10 }, { wch: 28 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 8 }];
    X.utils.book_append_sheet(wb, ws2, 'Semua');
  }
  X.writeFile(wb, 'DataSiswa_SDNSukamahi03.xlsx');
}

function sParseTgl(v) {
  if (v === '' || v == null) return null;
  const iso = (d) => d.toISOString().slice(0, 10);
  if (v instanceof Date) {
    if (isNaN(v)) return undefined;
    // +12 jam agar selisih detik/zona waktu dari SheetJS tidak menggeser tanggal
    const d = new Date(v.getTime() + 12 * 3600 * 1000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  if (typeof v === 'number') return iso(new Date(Math.round((v - 25569) * 86400000)));
  const t = String(v).trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return undefined;
}

function sParseJK(v) {
  const t = String(v ?? '').trim().toLowerCase();
  if (!t) return null;
  if (['l', 'lk', 'laki-laki', 'laki laki', 'laki'].includes(t)) return 'Laki-laki';
  if (['p', 'pr', 'perempuan'].includes(t)) return 'Perempuan';
  return undefined;
}

function sValidasiBatch(baris) {
  const peta = new Map(sKelas.map((k) => [sNorm(k.nama), k.id]));
  const nisnAda = new Set(sSiswa.map((s) => s.nisn).filter(Boolean));
  const nisnFile = new Set();
  const str = (v) => String(v ?? '').trim() || null;
  const hasil = { valid: [], invalid: [] };
  baris.forEach((r, i) => {
    const err = [];
    const nama = str(r[1]);
    if (!nama) err.push('nama kosong');
    const jk = sParseJK(r[2]); if (jk === undefined) err.push('jenis kelamin tidak dikenal');
    const tgl = sParseTgl(r[6]); if (tgl === undefined) err.push('tanggal lahir tidak valid');
    const kelasId = peta.get(sNorm(r[13]));
    if (!kelasId) err.push('rombel "' + (str(r[13]) || '') + '" tidak terdaftar');
    const nisn = str(r[3]);
    if (nisn) {
      if (nisnAda.has(nisn)) err.push('NISN sudah ada di database');
      else if (nisnFile.has(nisn)) err.push('NISN ganda di file');
      nisnFile.add(nisn);
    }
    if (err.length) { hasil.invalid.push({ no: i + 2, nama: nama || '(kosong)', err: err.join(', ') }); return; }
    hasil.valid.push({
      nama, jenis_kelamin: jk, nisn, nis: str(r[4]), tempat_lahir: str(r[5]), tgl_lahir: tgl, nik: str(r[7]),
      agama: str(r[8]), alamat: str(r[9]), no_hp_ortu: str(r[10]), nama_ayah: str(r[11]), nama_ibu: str(r[12]),
      kelas_id: kelasId, status: 'aktif',
    });
  });
  return hasil;
}

function sBukaBatch() {
  sBatch = { valid: [], invalid: [] };
  const o = sModal('Upload Batch Siswa', `<div class="space-y-3">
    <p class="text-xs text-ink/70">Unggah file Excel (.xlsx) dengan 14 kolom sesuai template. Rombel harus cocok dengan nama kelas (mis. 1a … 6b).
      <button type="button" id="sb-template" class="font-bold text-hijau hover:underline">Unduh Template Excel</button></p>
    <input id="sb-file" type="file" accept=".xlsx,.xls" class="w-full text-sm">
    <p id="sb-hasil" class="text-sm font-semibold"></p>
    <div id="sb-invalid" class="text-xs text-red-600 max-h-48 overflow-y-auto"></div>
    <div class="flex justify-end gap-2">
      <button type="button" data-smodal-tutup class="${S_BTN_O}">Batal</button>
      <button type="button" id="sb-simpan" class="${S_BTN}" disabled>Simpan</button>
    </div></div>`, 'max-w-xl');
  o.querySelector('#sb-template').onclick = sUnduhTemplate;
  o.querySelector('#sb-file').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return alert('File terlalu besar (maks 5 MB).');
    let X;
    try { X = await muatXlsx(); } catch (err) { return alert(galatXlsx(err)); }
    let baris;
    try {
      const wb = X.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
      baris = X.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: true })
        .slice(1).filter((r) => r.some((c) => String(c).trim() !== ''));
    } catch (err) { return alert('File tidak bisa dibaca: ' + err.message); }
    if (baris.length > 2000) return alert('Maksimal 2000 baris per upload.');
    sBatch = sValidasiBatch(baris);
    o.querySelector('#sb-hasil').textContent = `${sBatch.valid.length} baris valid, ${sBatch.invalid.length} baris tidak valid (dilewati)`;
    o.querySelector('#sb-invalid').innerHTML = sBatch.invalid.map((x) => `<div>Baris ${x.no} — ${esc(x.nama)}: ${esc(x.err)}</div>`).join('');
    o.querySelector('#sb-simpan').disabled = !sBatch.valid.length;
  };
  o.querySelector('#sb-simpan').onclick = async (e) => {
    e.target.disabled = true;
    let tersimpan = 0;
    for (let i = 0; i < sBatch.valid.length; i += 100) {
      const { error } = await sb.from('siswa').insert(sBatch.valid.slice(i, i + 100));
      if (error) {
        alert(sGalat(error, `Gagal menyimpan (${tersimpan} baris sebelumnya sudah tersimpan)`));
        await muatSiswa();
        return;
      }
      tersimpan += Math.min(100, sBatch.valid.length - i);
    }
    sTutupModal();
    await muatSiswa();
    alert(tersimpan + ' siswa berhasil disimpan.');
  };
}

/* ---------- Tab: Kelas & Wali Kelas ---------- */
function sRenderKelas() {
  const jml = (id) => sSiswa.filter((s) => s.kelas_id === id && s.status === 'aktif').length;
  const opsiGuru = (pilih) => '<option value="">— belum ada wali —</option>' + sGuru.map((g) => `<option value="${g.id}" ${g.id === pilih ? 'selected' : ''}>${esc(g.nama)}</option>`).join('');
  $('#ds-isi').innerHTML = `
    <div class="flex flex-wrap items-end gap-2 mb-3">
      <label class="text-sm font-semibold">Tahun Pelajaran <input id="st-tahun" value="${esc(sSetelan.tahun_pelajaran || '')}" class="${S_INP} font-normal w-32 ml-1"></label>
      <label class="text-sm font-semibold">Semester
        <select id="st-semester" class="${S_INP} font-normal ml-1">${['Ganjil', 'Genap'].map((x) => `<option ${sSetelan.semester === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
      <button data-skelas="setelan" class="${S_BTN}">Simpan Setelan</button>
      <button data-skelas="tambah" class="${S_BTN_O} ml-auto">+ Tambah Rombel</button>
    </div>
    <div class="overflow-x-auto rounded-lg border border-ink/10">
      <table class="text-left text-sm w-full">
        <thead class="bg-gray-200/80 font-bold text-xs"><tr><th class="px-2 py-2">Rombel</th><th class="px-2">Siswa aktif</th><th class="px-2">Wali Kelas</th><th class="px-2">Aksi</th></tr></thead>
        <tbody>${sKelas.map((k) => `<tr class="border-t border-ink/10" data-kid="${k.id}">
          <td class="px-2 py-1.5"><input data-f="nama" value="${esc(k.nama)}" class="${S_INP} w-24"></td>
          <td class="px-2">${jml(k.id)}</td>
          <td class="px-2"><select data-f="wali" class="${S_INP} min-w-[14rem]">${opsiGuru(k.wali_guru_id)}</select></td>
          <td class="px-2 space-x-2 whitespace-nowrap">
            <button data-skelas="simpan" data-id="${k.id}" class="font-semibold text-hijau hover:underline">Simpan</button>
            <button data-skelas="hapus" data-id="${k.id}" class="font-semibold text-red-600 hover:underline">Hapus</button>
          </td></tr>`).join('')}</tbody>
      </table>
    </div>
    <p class="mt-2 text-xs text-ink/60">Guru mata pelajaran boleh ditugaskan sebagai wali kelas. Mengganti wali langsung mengubah rombel binaan guru tersebut di Absensi Siswa.</p>`;
}

async function sAksiKelas(aksi, id) {
  if (aksi === 'setelan') {
    const tahun = $('#st-tahun').value.trim(), sem = $('#st-semester').value;
    if (!/^\d{4}\/\d{4}$/.test(tahun)) return alert('Format tahun pelajaran: 2026/2027');
    const { error } = await sb.from('setelan').upsert([{ kunci: 'tahun_pelajaran', nilai: tahun }, { kunci: 'semester', nilai: sem }], { onConflict: 'kunci' });
    if (error) return alert(sGalat(error, 'Gagal menyimpan setelan'));
    sSetelan.tahun_pelajaran = tahun; sSetelan.semester = sem;
    return alert('Setelan tersimpan.');
  }
  if (aksi === 'tambah') {
    const nama = (prompt('Nama rombel baru (mis. 1c):') || '').trim();
    if (!nama) return;
    const { error } = await sb.from('kelas').insert({ nama, urut: Math.max(0, ...sKelas.map((k) => k.urut)) + 1 });
    if (error) return alert(sGalat(error, 'Gagal menambah rombel'));
    return muatSiswa();
  }
  const tr = document.querySelector(`#ds-isi tr[data-kid="${id}"]`);
  if (aksi === 'simpan') {
    const nama = tr.querySelector('[data-f=nama]').value.trim();
    if (!nama) return alert('Nama rombel wajib diisi.');
    const wali = tr.querySelector('[data-f=wali]').value;
    const { error } = await sb.from('kelas').update({ nama, wali_guru_id: wali ? Number(wali) : null }).eq('id', id);
    if (error) return alert(sGalat(error, 'Gagal menyimpan rombel'));
    return muatSiswa();
  }
  if (aksi === 'hapus') {
    const k = sKelas.find((x) => x.id === id);
    if (!confirm('Hapus rombel ' + k.nama + '? Hanya bisa bila tidak ada siswa/arsip absensi di dalamnya.')) return;
    const { error } = await sb.from('kelas').delete().eq('id', id);
    if (error) return alert(error.code === '23503' ? 'Rombel masih berisi siswa atau arsip absensi; pindahkan dulu.' : sGalat(error, 'Gagal menghapus rombel'));
    return muatSiswa();
  }
}

/* ---------- Tab: Kenaikan Kelas ---------- */
let sNaikAsal = '', sNaikTujuan = '';

function sRenderNaik() {
  const opt = (pilih, lulus) => '<option value="">— pilih —</option>' + sKelas.map((k) => `<option value="${k.id}" ${String(k.id) === pilih ? 'selected' : ''}>${esc(k.nama)}</option>`).join('')
    + (lulus ? `<option value="lulus" ${pilih === 'lulus' ? 'selected' : ''}>Lulus</option>` : '');
  $('#ds-isi').innerHTML = `
    <div class="flex flex-wrap items-end gap-2 mb-3">
      <label class="text-sm font-semibold">Rombel asal <select id="nk-asal" class="${S_INP} font-normal ml-1">${opt(sNaikAsal, false)}</select></label>
      <label class="text-sm font-semibold">Tujuan <select id="nk-tujuan" class="${S_INP} font-normal ml-1">${opt(sNaikTujuan, true)}</select></label>
      <button data-snaik="jalan" class="${S_BTN}">Jalankan Kenaikan</button>
    </div>
    <div id="nk-daftar"></div>`;
  sIsiNaik();
}

function sIsiNaik() {
  const box = $('#nk-daftar');
  if (!sNaikAsal) { box.innerHTML = '<p class="text-sm text-ink/60">Pilih rombel asal untuk menampilkan siswa aktif.</p>'; return; }
  const isi = sSiswa.filter((s) => String(s.kelas_id) === sNaikAsal && s.status === 'aktif');
  box.innerHTML = isi.length
    ? `<label class="text-sm font-semibold block mb-1"><input type="checkbox" id="nk-semua" checked> Pilih semua (${isi.length} siswa)</label>
       <div class="grid gap-1 sm:grid-cols-2 lg:grid-cols-3 text-sm">${isi.map((s) => `<label><input type="checkbox" class="nk-cek" value="${s.id}" checked> ${esc(s.nama)}</label>`).join('')}</div>`
    : '<p class="text-sm text-ink/60">Tidak ada siswa aktif di rombel ini.</p>';
}

async function sJalankanNaik() {
  if (!sNaikAsal || !sNaikTujuan) return alert('Pilih rombel asal dan tujuan.');
  if (sNaikAsal === sNaikTujuan) return alert('Rombel tujuan harus berbeda dari asal.');
  const ids = [...document.querySelectorAll('.nk-cek:checked')].map((c) => Number(c.value));
  if (!ids.length) return alert('Centang minimal satu siswa.');
  const lulus = sNaikTujuan === 'lulus';
  const tujuanNama = lulus ? 'LULUS' : sNamaKelas(Number(sNaikTujuan));
  if (!confirm(`Pindahkan ${ids.length} siswa dari ${sNamaKelas(Number(sNaikAsal))} ke ${tujuanNama}?`)) return;
  const q = sb.from('siswa').update(lulus ? { status: 'lulus' } : { kelas_id: Number(sNaikTujuan) }).in('id', ids);
  const { error } = await q;
  if (error) return alert(sGalat(error, 'Gagal menjalankan kenaikan kelas'));
  sNaikAsal = ''; sNaikTujuan = '';
  await muatSiswa();
  alert(ids.length + ' siswa berhasil diproses.');
}

/* ---------- Event ---------- */
document.addEventListener('click', (e) => {
  const root = $('#ds-root');
  if (!root || !root.contains(e.target)) return;
  const t = e.target.closest('[data-stab],[data-saksi],[data-skelas],[data-snaik]');
  if (!t) return;
  if (t.dataset.stab) { sTab = t.dataset.stab; sRender(); return; }
  const id = t.dataset.id ? Number(t.dataset.id) : null;
  if (t.dataset.saksi === 'tambah') sFormSiswa(null);
  else if (t.dataset.saksi === 'edit') sFormSiswa(id);
  else if (t.dataset.saksi === 'hapus') sHapusSiswa(id);
  else if (t.dataset.saksi === 'batch') sBukaBatch();
  else if (t.dataset.saksi === 'unduh') sUnduhExcel();
  else if (t.dataset.saksi === 'hapus-batch') sHapusBatch();
  else if (t.dataset.skelas) sAksiKelas(t.dataset.skelas, id);
  else if (t.dataset.snaik) sJalankanNaik();
});
document.addEventListener('input', (e) => {
  if (e.target.id === 'ds-cari') { sCari = e.target.value; sIsiTabel(); }
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'ds-filter') { sFilter = e.target.value; sIsiTabel(); }
  else if (e.target.id === 'nk-asal') { sNaikAsal = e.target.value; sIsiNaik(); }
  else if (e.target.id === 'nk-tujuan') sNaikTujuan = e.target.value;
  else if (e.target.id === 'nk-semua') document.querySelectorAll('.nk-cek').forEach((c) => { c.checked = e.target.checked; });
});
