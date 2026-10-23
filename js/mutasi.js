/* ==================== mutasi.js ==================== */
/* Mutasi Masuk & Keluar: Dashboard Table, Donut Chart, Modal Detail & Form, PDF (F4), Word (F4), Print (F4 - Fit Page) */

/* ========== PILIHAN KELAS (ROMAWI + TEKS) ========== */
const PILIHAN_KELAS = [
  'I (Satu)',
  'II (Dua)',
  'III (Tiga)',
  'IV (Empat)',
  'V (Lima)',
  'VI (Enam)'
];

/* ========== FIELD DEFINITIONS ========== */
const FIELD_MASUK = [
  { k: 'no_surat', label: 'No. Surat', placeholder: '400.7.22.1/___/SDN.SKM.03/___/___' },
  { k: 'tanggal_surat', label: 'Tanggal Surat', type: 'date' },
  { k: 'nama_kepsek', label: 'Nama Kepala Sekolah', def: 'KASWIN KARTAWIJAYA, M.Pd' },
  { k: 'nip_kepsek', label: 'NIP Kepala Sekolah', def: '19720506 199903 1 007' },
  { k: 'pangkat_gol', label: 'Pangkat / Golongan', def: 'Pembina Utama Muda / IVc' },
  { k: 'jabatan_kepsek', label: 'Jabatan', def: 'Kepala Sekolah' },
  { k: 'unit_kerja', label: 'Unit Kerja', def: 'SDN Sukamahi 03, Kec. Cikarang Pusat' },
  { k: 'nama_siswa', label: 'Nama Siswa', req: true, group: 'Data Siswa Pindahan' },
  { k: 'ttl', label: 'Tempat, Tanggal Lahir' },
  { k: 'jenis_kelamin', label: 'Jenis Kelamin', type: 'select', opts: ['Laki-laki', 'Perempuan'] },
  { k: 'nisn', label: 'NISN (Opsional)' },
  { k: 'asal_sekolah', label: 'Asal Sekolah' },
  { k: 'kelas', label: 'Kelas', type: 'select', opts: PILIHAN_KELAS },
];

const FIELD_KELUAR = [
  { k: 'no_surat', label: 'No. Surat', placeholder: '400.3.12.1/___/SDN.SKM.03/___/___' },
  { k: 'tanggal_surat', label: 'Tanggal Surat', type: 'date' },
  { k: 'lampiran', label: 'Lampiran', def: '-' },
  { k: 'nama_siswa', label: 'Nama Siswa', req: true, group: 'Data Siswa' },
  { k: 'tempat_tgl_lahir', label: 'Tempat, Tgl. Lahir' },
  { k: 'jenis_kelamin', label: 'Jenis Kelamin', type: 'select', opts: ['Laki-laki', 'Perempuan'] },
  { k: 'nisn', label: 'NISN (Opsional)' },
  { k: 'kelas', label: 'Kelas', type: 'select', opts: PILIHAN_KELAS },
  { k: 'asal_sekolah', label: 'Asal Sekolah', def: 'SDN SUKAMAHI 03' },
  { k: 'alamat_sekolah', label: 'Alamat Sekolah', def: 'Jl. Raya Sukamahi Kp. Cimahi Rt. 007/004 Ds. Sukamahi Kec. Cikarang Pusat Kab. Bekasi' },
  { k: 'nama_ayah', label: 'Nama Ayah', group: 'Data Orang Tua' },
  { k: 'nama_ibu', label: 'Nama Ibu' },
  { k: 'alamat_ortu', label: 'Alamat Orang Tua' },
  { k: 'sekolah_tujuan', label: 'Nama Sekolah Tujuan', group: 'Melanjutkan / Pindah ke' },
  { k: 'kecamatan_tujuan', label: 'Kecamatan' },
  { k: 'kabupaten_tujuan', label: 'Kabupaten / Kota' },
  { k: 'provinsi_tujuan', label: 'Provinsi' },
  { k: 'alasan_pindah', label: 'Alasan' },
];

/* ========== STATE ========== */
let daftarMM = [];
let daftarMK = [];
let currentModalItem = null, currentModalType = null;

/* ========== HELPER ========== */
const galat = (e, prefix) => prefix + ': ' + (e.message || e);
const v = (d, k) => (d && d[k]) ?? '';
const inputKolom = (f, val) => {
  const base = 'mt-1 w-full rounded-lg border border-ink/20 px-3 py-2 text-sm font-normal';
  const value = val || f.def || '';
  if (f.type === 'select')
    return `<select name="${f.k}" class="${base}"><option value="">Pilih...</option>${f.opts.map(o => `<option value="${esc(o)}" ${o === value ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
  return `<input name="${f.k}" type="${f.type || 'text'}" value="${esc(value)}" ${f.req ? 'required' : ''} ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''} class="${base}">`;
};

/* ========== KOP SURAT HTML (LOGO KABUPATEN BEKASI) ========== */
function kopSuratHTML() {
  const logoSrc = (typeof LOGO_KOP !== 'undefined' && LOGO_KOP) ? LOGO_KOP : new URL('src/logo-bekasi.png', document.baseURI).href;
  return `
    <table style="width:100%;padding-bottom:6px;border-collapse:collapse;">
      <tr>
        <td style="width:80px;vertical-align:middle;text-align:center;padding-right:10px;">
          <img src="${logoSrc}" width="75" height="90" style="width:75px;height:auto;max-width:75px;display:block;margin:0 auto;" alt="Logo Kabupaten Bekasi">
        </td>
        <td style="text-align:center;vertical-align:middle;padding-right:80px;">
          <p style="font-size:14pt;font-weight:bold;margin:0;line-height:1.2;letter-spacing:0.5px;">PEMERINTAH KABUPATEN BEKASI</p>
          <p style="font-size:14pt;font-weight:bold;margin:0;line-height:1.2;letter-spacing:0.5px;">DINAS PENDIDIKAN</p>
          <p style="font-size:20pt;font-weight:bold;margin:2px 0;line-height:1.2;letter-spacing:1px;">SDN SUKAMAHI 03</p>
          <p style="font-size:11pt;font-weight:bold;margin:0;line-height:1.2;">KECAMATAN CIKARANG PUSAT</p>
          <p style="font-size:9pt;margin:2px 0 0 0;line-height:1.2;">Jl. Sukamahi Kp. Cimahi Rt. 007 Rw. 004 Ds. Sukamahi</p>
          <p style="font-size:9pt;margin:0;line-height:1.2;">Kec. Cikarang Pusat Kab. Bekasi &ndash; 17530 Email: <span style="color:#0044cc;text-decoration:underline;">sdnsukamahi03@gmail.com</span></p>
        </td>
      </tr>
    </table>
    <div style="border-bottom:3px double #000;margin-bottom:10px;"></div>`;
}

/* Nomor surat: bila ada garis miring ganda (nomor manual belum diisi),
   sisipkan satu spasi tak-putus (nbsp) sebagai ruang penulisan manual —
   tetap 1 baris, mis. 400.3.12.11/ /SDN.SKM.03/X/2026 */
function nomorSurat(nilai, bawaan) {
  const raw = String(nilai || bawaan || "");
  return esc(raw.replace(/^(.+?\/)\s*\/(.+)$/, "$1\u00a0\u00a0\u00a0/$2"));
}

/* ==========================================================
   DONUT CHART GENERATOR (SVG)
   ========================================================== */
function renderDonutChart(containerId, dataList, titlePrefix, colors) {
  const el = $('#' + containerId);
  if (!el) return;
  const total = dataList.length;
  if (!total) {
    el.innerHTML = '<div class="py-10 text-center text-xs text-ink/50">Belum ada data untuk grafik.</div>';
    return;
  }

  let lCount = 0, pCount = 0;
  dataList.forEach(d => {
    const jk = (d.jenis_kelamin || '').toLowerCase();
    if (jk.includes('perempuan') || jk === 'p') pCount++;
    else if (jk.includes('laki') || jk === 'l') lCount++;
    else lCount++;
  });

  const slices = [
    { label: `${titlePrefix} Laki-laki`, count: lCount, color: colors.l },
    { label: `${titlePrefix} Perempuan`, count: pCount, color: colors.p }
  ].filter(s => s.count > 0);

  let acc = 0;
  const ring = slices.map(s => {
    const pct = (s.count / total) * 100;
    const len = Math.max(pct - (slices.length > 1 ? 0.6 : 0), 0.1);
    const c = `<circle cx="21" cy="21" r="15.9155" fill="none" stroke="${s.color}" stroke-width="6" stroke-dasharray="${len} ${100 - len}" stroke-dashoffset="${25 - acc}">
      <title>${esc(s.label)}: ${s.count} siswa (${Math.round(pct)}%)</title>
    </circle>`;
    acc += pct;
    return c;
  }).join('');

  const legend = slices.map(s => {
    const pct = Math.round((s.count / total) * 100);
    return `
      <li class="flex items-center gap-2 py-1 text-xs">
        <span class="size-3 rounded-full shrink-0" style="background:${s.color}"></span>
        <span class="flex-1 truncate font-medium text-ink/80">${esc(s.label)}</span>
        <span class="font-bold tabular-nums text-ink">${s.count} (${pct}%)</span>
      </li>`;
  }).join('');

  el.innerHTML = `
    <div class="relative flex items-center justify-center my-2">
      <svg viewBox="0 0 42 42" class="w-36 h-36 transform -rotate-90 block">
        <circle cx="21" cy="21" r="15.9155" fill="none" stroke="#E3E9E6" stroke-width="6"/>
        ${ring}
      </svg>
      <div class="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
        <span class="text-2xl font-black text-ink leading-none">${total}</span>
        <span class="text-[10px] text-ink/60 font-semibold uppercase tracking-wider mt-0.5">Siswa</span>
      </div>
    </div>
    <ul class="mt-3 divide-y divide-ink/10">${legend}</ul>`;
}

/* ==========================================================
   MUTASI MASUK
   ========================================================== */

async function loadMutasiMasuk() {
  const { data, error } = await sb.from(MUTASI_MASUK_TABLE).select('*').order('dibuat', { ascending: false });
  if (error) return alert(galat(error, 'Gagal memuat mutasi masuk'));
  daftarMM = data;
  renderTableMM();
  renderGrafikMM();
}

function hasilCariMM() {
  const q = ($('#mm-cari').value || '').trim().toLowerCase();
  return daftarMM.filter(d => 
    (d.nama_siswa || '').toLowerCase().includes(q) ||
    (d.asal_sekolah || '').toLowerCase().includes(q) ||
    (d.no_surat || '').toLowerCase().includes(q)
  );
}

function renderGrafikMM() {
  renderDonutChart('mm-grafik', daftarMM, 'Mutasi Masuk', {
    l: '#65a30d',
    p: '#a3e635'
  });
}

function renderTableMM() {
  const tbody = $('#mm-tabel-body');
  if (!tbody) return;
  const hasil = hasilCariMM();
  $('#mm-jumlah').textContent = hasil.length + ' dari ' + daftarMM.length + ' siswa';

  if (!hasil.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="py-8 text-center text-xs text-ink/50">
          ${daftarMM.length ? 'Tidak ada data yang sesuai pencarian.' : 'Belum ada data siswa mutasi masuk. Klik tombol hijau di kiri untuk input.'}
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = hasil.map(d => `
    <tr class="hover:bg-kertas/60 transition text-xs whitespace-nowrap">
      <td class="px-2.5 py-2 whitespace-nowrap">
        <button data-aksi="detail" data-id="${d.id}" data-type="masuk" class="text-left font-bold text-hijau hover:underline cursor-pointer whitespace-nowrap">
          ${esc(d.nama_siswa)}
        </button>
      </td>
      <td class="px-2.5 py-2 whitespace-nowrap text-ink/80">${esc(d.ttl || '-')}</td>
      <td class="px-2.5 py-2 whitespace-nowrap text-ink/80">${esc(d.jenis_kelamin || '-')}</td>
      <td class="px-2.5 py-2 whitespace-nowrap text-ink/80 tabular-nums">${esc(d.nisn || '-')}</td>
      <td class="px-2.5 py-2 whitespace-nowrap text-ink/70 text-[11px]">${esc(d.no_surat || '-')}</td>
      <td class="px-2.5 py-2 whitespace-nowrap text-ink/80">${esc(d.asal_sekolah || '-')}</td>
      <td class="px-2.5 py-2 whitespace-nowrap text-center">
        <div class="flex items-center justify-center gap-1 whitespace-nowrap">
          <button data-aksi="edit" data-id="${d.id}" data-type="masuk" class="rounded-md border border-ink/20 bg-white px-2 py-0.5 text-[11px] font-semibold text-ink hover:bg-kertas shadow-sm transition">Edit</button>
          <button data-aksi="pdf" data-id="${d.id}" data-type="masuk" class="rounded-md bg-hijau px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-ink shadow-sm transition">PDF</button>
          <button data-aksi="word" data-id="${d.id}" data-type="masuk" class="rounded-md border border-ink/20 bg-white px-2 py-0.5 text-[11px] font-semibold text-ink hover:bg-kertas shadow-sm transition">Word</button>
          <button data-aksi="print" data-id="${d.id}" data-type="masuk" class="rounded-md border border-ink/20 bg-white px-2 py-0.5 text-[11px] font-semibold text-ink hover:bg-kertas shadow-sm transition">Print</button>
          <button data-aksi="hapus" data-id="${d.id}" data-type="masuk" class="rounded-md border border-ink/20 bg-white px-2 py-0.5 text-[11px] font-semibold text-red-700 hover:bg-red-50 shadow-sm transition">Hapus</button>
        </div>
      </td>
    </tr>`).join('');
}

/* ==========================================================
   MUTASI KELUAR
   ========================================================== */

async function loadMutasiKeluar() {
  const { data, error } = await sb.from(MUTASI_KELUAR_TABLE).select('*').order('dibuat', { ascending: false });
  if (error) return alert(galat(error, 'Gagal memuat mutasi keluar'));
  daftarMK = data;
  renderTableMK();
  renderGrafikMK();
}

function hasilCariMK() {
  const q = ($('#mk-cari').value || '').trim().toLowerCase();
  return daftarMK.filter(d => 
    (d.nama_siswa || '').toLowerCase().includes(q) ||
    (d.sekolah_tujuan || '').toLowerCase().includes(q) ||
    (d.no_surat || '').toLowerCase().includes(q)
  );
}

function renderGrafikMK() {
  renderDonutChart('mk-grafik', daftarMK, 'Mutasi Keluar', {
    l: '#dc2626',
    p: '#851336'
  });
}

function renderTableMK() {
  const tbody = $('#mk-tabel-body');
  if (!tbody) return;
  const hasil = hasilCariMK();
  $('#mk-jumlah').textContent = hasil.length + ' dari ' + daftarMK.length + ' siswa';

  if (!hasil.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="py-8 text-center text-xs text-ink/50">
          ${daftarMK.length ? 'Tidak ada data yang sesuai pencarian.' : 'Belum ada data siswa mutasi keluar. Klik tombol merah di kiri untuk input.'}
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = hasil.map(d => `
    <tr class="hover:bg-kertas/60 transition text-xs whitespace-nowrap">
      <td class="px-2.5 py-2 whitespace-nowrap">
        <button data-aksi="detail" data-id="${d.id}" data-type="keluar" class="text-left font-bold text-[#851336] hover:underline cursor-pointer whitespace-nowrap">
          ${esc(d.nama_siswa)}
        </button>
      </td>
      <td class="px-2.5 py-2 whitespace-nowrap text-ink/80">${esc(d.tempat_tgl_lahir || '-')}</td>
      <td class="px-2.5 py-2 whitespace-nowrap text-ink/80">${esc(d.jenis_kelamin || '-')}</td>
      <td class="px-2.5 py-2 whitespace-nowrap text-ink/80 tabular-nums">${esc(d.nisn || '-')}</td>
      <td class="px-2.5 py-2 whitespace-nowrap text-ink/70 text-[11px]">${esc(d.no_surat || '-')}</td>
      <td class="px-2.5 py-2 whitespace-nowrap text-ink/80">${esc(d.sekolah_tujuan || '-')}</td>
      <td class="px-2.5 py-2 whitespace-nowrap text-center">
        <div class="flex items-center justify-center gap-1 whitespace-nowrap">
          <button data-aksi="edit" data-id="${d.id}" data-type="keluar" class="rounded-md border border-ink/20 bg-white px-2 py-0.5 text-[11px] font-semibold text-ink hover:bg-kertas shadow-sm transition">Edit</button>
          <button data-aksi="pdf" data-id="${d.id}" data-type="keluar" class="rounded-md bg-hijau px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-ink shadow-sm transition">PDF</button>
          <button data-aksi="word" data-id="${d.id}" data-type="keluar" class="rounded-md border border-ink/20 bg-white px-2 py-0.5 text-[11px] font-semibold text-ink hover:bg-kertas shadow-sm transition">Word</button>
          <button data-aksi="print" data-id="${d.id}" data-type="keluar" class="rounded-md border border-ink/20 bg-white px-2 py-0.5 text-[11px] font-semibold text-ink hover:bg-kertas shadow-sm transition">Print</button>
          <button data-aksi="hapus" data-id="${d.id}" data-type="keluar" class="rounded-md border border-ink/20 bg-white px-2 py-0.5 text-[11px] font-semibold text-red-700 hover:bg-red-50 shadow-sm transition">Hapus</button>
        </div>
      </td>
    </tr>`).join('');
}

/* ==========================================================
   MODAL DETAIL SISWA (Compact Pop-up)
   ========================================================== */
function bukaModalDetail(d, type) {
  currentModalItem = d;
  currentModalType = type;
  const isMasuk = type === 'masuk';
  const fields = isMasuk ? FIELD_MASUK : FIELD_KELUAR;

  $('#md-nama').textContent = d.nama_siswa || 'Detail Siswa';
  $('#md-sub').textContent = (isMasuk ? 'Mutasi Masuk' : 'Mutasi Keluar') + (d.no_surat ? ' â€¢ No. ' + d.no_surat : '');

  let lastGroup = '';
  $('#md-isi').innerHTML = `
    <dl class="grid gap-x-4 gap-y-2 sm:grid-cols-2">
      ${fields.map(f => {
        let groupHdr = '';
        if (f.group && f.group !== lastGroup) {
          lastGroup = f.group;
          groupHdr = `<div class="sm:col-span-2 pt-2 border-t border-ink/10"><h4 class="font-extrabold text-xs uppercase tracking-wider ${isMasuk ? 'text-hijau' : 'text-[#851336]'}">${esc(f.group)}</h4></div>`;
        }
        return groupHdr + `
          <div>
            <dt class="text-[11px] font-semibold text-ink/60">${esc(f.label)}</dt>
            <dd class="text-xs font-bold text-ink break-words">${esc(v(d, f.k) || '-')}</dd>
          </div>`;
      }).join('')}
    </dl>`;

  $('#md-actions').innerHTML = `
    <button id="mda-edit" class="rounded-lg border border-ink/20 bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:bg-kertas shadow-sm transition">Edit</button>
    <button id="mda-pdf" class="rounded-lg bg-hijau px-3 py-1.5 text-xs font-semibold text-white hover:bg-ink shadow-sm transition">Unduh PDF</button>
    <button id="mda-word" class="rounded-lg border border-ink/20 bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:bg-kertas shadow-sm transition">Unduh Word</button>
    <button id="mda-print" class="rounded-lg border border-ink/20 bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:bg-kertas shadow-sm transition">Print</button>
    <button id="mda-tutup" class="rounded-lg bg-ink/10 px-3 py-1.5 text-xs font-semibold text-ink hover:bg-ink/20 transition">Tutup</button>`;

  $('#modal-mutasi-detail').classList.remove('hidden');
}

function tutupModalDetail() {
  $('#modal-mutasi-detail').classList.add('hidden');
  currentModalItem = null;
}

/* ==========================================================
   MODAL FORM INPUT / EDIT
   ========================================================== */
function bukaModalForm(d, type) {
  currentModalItem = d;
  currentModalType = type;
  const isMasuk = type === 'masuk';
  const fields = isMasuk ? FIELD_MASUK : FIELD_KELUAR;

  $('#mf-judul').textContent = (d ? 'Edit ' : 'Tambah ') + (isMasuk ? 'Siswa Mutasi Masuk' : 'Siswa Mutasi Keluar');

  let lastGroup = '';
  const fieldsHtml = fields.map(f => {
    let groupHdr = '';
    if (f.group && f.group !== lastGroup) {
      lastGroup = f.group;
      groupHdr = `<div class="sm:col-span-2 pt-2 border-t border-ink/10"><h4 class="font-extrabold text-xs uppercase tracking-wider ${isMasuk ? 'text-hijau' : 'text-[#851336]'}">${esc(f.group)}</h4></div>`;
    }
    return groupHdr + `<label class="block text-xs font-bold text-ink">${esc(f.label)}${inputKolom(f, d ? v(d, f.k) : '')}</label>`;
  }).join('');

  $('#mf-form').innerHTML = `
    ${fieldsHtml}
    <div class="sm:col-span-2 flex justify-end gap-2 pt-3 border-t border-ink/10 mt-2">
      <button type="button" id="mf-batal" class="rounded-lg border border-ink/20 px-4 py-2 text-xs font-semibold hover:bg-kertas">Batal</button>
      <button type="submit" class="rounded-lg ${isMasuk ? 'bg-hijau' : 'bg-[#851336]'} text-white px-5 py-2 text-xs font-bold hover:opacity-90 shadow transition">Simpan</button>
    </div>`;

  $('#modal-mutasi-form').classList.remove('hidden');
}

function tutupModalForm() {
  $('#modal-mutasi-form').classList.add('hidden');
  currentModalItem = null;
}

/* ==========================================================
   EVENT HANDLERS
   ========================================================== */

$('#mm-cari').oninput = renderTableMM;
$('#mm-tambah').onclick = () => bukaModalForm(null, 'masuk');

$('#mk-cari').oninput = renderTableMK;
$('#mk-tambah').onclick = () => bukaModalForm(null, 'keluar');

$('#view-mutasi-masuk').onclick = async e => {
  const btn = e.target.closest('[data-aksi]');
  if (!btn) return;
  const aksi = btn.dataset.aksi;
  const id = btn.dataset.id;
  const item = daftarMM.find(d => String(d.id) === id);
  if (!item) return;

  if (aksi === 'detail') bukaModalDetail(item, 'masuk');
  else if (aksi === 'edit') bukaModalForm(item, 'masuk');
  else if (aksi === 'pdf') generatePdfMasuk(item);
  else if (aksi === 'word') generateWordMasuk(item);
  else if (aksi === 'print') printMasuk(item);
  else if (aksi === 'hapus' && confirm('Hapus data mutasi masuk siswa ' + item.nama_siswa + '?')) {
    const { error } = await sb.from(MUTASI_MASUK_TABLE).delete().eq('id', item.id);
    if (error) return alert(galat(error, 'Gagal menghapus'));
    loadMutasiMasuk();
  }
};

$('#view-mutasi-keluar').onclick = async e => {
  const btn = e.target.closest('[data-aksi]');
  if (!btn) return;
  const aksi = btn.dataset.aksi;
  const id = btn.dataset.id;
  const item = daftarMK.find(d => String(d.id) === id);
  if (!item) return;

  if (aksi === 'detail') bukaModalDetail(item, 'keluar');
  else if (aksi === 'edit') bukaModalForm(item, 'keluar');
  else if (aksi === 'pdf') generatePdfKeluar(item);
  else if (aksi === 'word') generateWordKeluar(item);
  else if (aksi === 'print') printKeluar(item);
  else if (aksi === 'hapus' && confirm('Hapus data mutasi keluar siswa ' + item.nama_siswa + '?')) {
    const { error } = await sb.from(MUTASI_KELUAR_TABLE).delete().eq('id', item.id);
    if (error) return alert(galat(error, 'Gagal menghapus'));
    loadMutasiKeluar();
  }
};

$('#md-tutup').onclick = tutupModalDetail;
$('#modal-mutasi-detail').onclick = e => {
  if (e.target.id === 'modal-mutasi-detail' || e.target.id === 'mda-tutup') tutupModalDetail();
  else if (e.target.id === 'mda-edit') {
    const item = currentModalItem, type = currentModalType;
    tutupModalDetail();
    bukaModalForm(item, type);
  }
  else if (e.target.id === 'mda-pdf') {
    if (currentModalType === 'masuk') generatePdfMasuk(currentModalItem);
    else generatePdfKeluar(currentModalItem);
  }
  else if (e.target.id === 'mda-word') {
    if (currentModalType === 'masuk') generateWordMasuk(currentModalItem);
    else generateWordKeluar(currentModalItem);
  }
  else if (e.target.id === 'mda-print') {
    if (currentModalType === 'masuk') printMasuk(currentModalItem);
    else printKeluar(currentModalItem);
  }
};

$('#mf-tutup').onclick = tutupModalForm;
$('#modal-mutasi-form').onclick = e => {
  if (e.target.id === 'modal-mutasi-form' || e.target.id === 'mf-batal') tutupModalForm();
};

$('#mf-form').addEventListener('submit', async e => {
  e.preventDefault();
  const fd = new FormData(e.target), row = {};
  const isMasuk = currentModalType === 'masuk';
  const fields = isMasuk ? FIELD_MASUK : FIELD_KELUAR;
  const table = isMasuk ? MUTASI_MASUK_TABLE : MUTASI_KELUAR_TABLE;

  fields.forEach(f => {
    const val = (fd.get(f.k) || '').toString().trim();
    if (val) row[f.k] = val;
    else row[f.k] = null;
  });

  if (!row.nama_siswa) return alert('Nama siswa wajib diisi!');
  row.diperbarui = new Date().toISOString();

  // Jika nisn kosong pada mutasi masuk, hapus dari payload agar tidak error bila kolom belum di-alter di Supabase
  if (isMasuk && !row.nisn) delete row.nisn;

  const isEdit = !!currentModalItem;
  const { data, error } = await (isEdit
    ? sb.from(table).update(row).eq('id', currentModalItem.id).select().single()
    : sb.from(table).insert(row).select().single());

  if (error) {
    if (error.message && error.message.includes('nisn')) {
      alert('Kolom NISN belum ada di tabel mutasi_masuk Supabase. Silakan jalankan query: ALTER TABLE mutasi_masuk ADD COLUMN IF NOT EXISTS nisn text; di Supabase SQL Editor.');
    } else {
      alert(galat(error, 'Gagal menyimpan data'));
    }
    return;
  }

  // Selesai simpan: langsung tutup modal form dan refresh tabel tanpa memunculkan pop-up detail
  tutupModalForm();
  if (isMasuk) await loadMutasiMasuk();
  else await loadMutasiKeluar();
});

addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    tutupModalDetail();
    tutupModalForm();
    if (typeof tutupModalBatch === 'function') tutupModalBatch();
  }
});

addEventListener('hashchange', () => {
  if (location.hash === '#mutasi-masuk') loadMutasiMasuk();
  else if (location.hash === '#mutasi-keluar') loadMutasiKeluar();
});
sb.auth.getSession().then(({ data }) => {
  if (data.session) {
    if (location.hash === '#mutasi-masuk') loadMutasiMasuk();
    else if (location.hash === '#mutasi-keluar') loadMutasiKeluar();
  }
});

/* ==========================================================
   PDF — file .pdf langsung unduh, dirender dari HTML surat
   yang SAMA PERSIS dengan format cetak (215x330mm F4)
   ========================================================== */
function bangunCetakDiv(html) {
  const div = document.createElement('div');
  div.className = 'cetak-f4';
  div.style.cssText = 'position:fixed;left:-10000px;top:0;background:#fff;';
  div.innerHTML = `<style>
    .cetak-f4 { width: 215mm; font-family:'Times New Roman',serif; font-size:11pt; line-height:1.25; color:#000;
                padding:12mm 15mm 12mm 20mm; box-sizing:border-box; }
    .cetak-f4 table { border-collapse:collapse; width:100%; margin:2px 0; }
    .cetak-f4 td, .cetak-f4 th { padding:1px 4px; vertical-align:top; font-size:11pt; }
    .cetak-f4 p { margin:2px 0; }
    .cetak-f4 .center { text-align:center; }
    .cetak-f4 .justify { text-align:justify; text-justify:inter-word; }
    .cetak-f4 .bold { font-weight:bold; }
    .cetak-f4 .underline { text-decoration:underline; }
    .cetak-f4 img { max-width:75px; height:auto; }
  </style>` + html;
  document.body.appendChild(div);
  return div;
}

async function buatPdfMutasi(html, namaFile) {
  const div = bangunCetakDiv(html);
  try {
    // tunggu semua gambar (logo) benar-benar termuat sebelum digambar
    await Promise.all([...div.querySelectorAll('img')].map(img => img.decode().catch(() => {})));
    await new Promise(r => setTimeout(r, 80));
    const canvas = await html2canvas(div, { scale: 2, backgroundColor: '#ffffff' });
    const pdf = new window.jspdf.jsPDF({ unit: 'mm', format: [215, 330], orientation: 'portrait' });
    const L = 215, T = 330;
    const tinggiMM = L * (canvas.height / canvas.width);
    if (tinggiMM <= T) {
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, L, tinggiMM);
    } else {
      // isi melebihi 1 lembar: potong per halaman
      const pxPerMM = canvas.width / L;
      const pxTinggiLembar = T * pxPerMM;
      let sisa = canvas.height, hal = 0;
      while (sisa > 0) {
        const ambil = Math.min(pxTinggiLembar, sisa);
        const pot = document.createElement('canvas');
        pot.width = canvas.width; pot.height = ambil;
        pot.getContext('2d').drawImage(canvas, 0, hal * pxTinggiLembar, canvas.width, ambil, 0, 0, canvas.width, ambil);
        if (hal > 0) pdf.addPage([215, 330], 'portrait');
        pdf.addImage(pot.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, L, ambil / pxPerMM);
        sisa -= ambil; hal++;
      }
    }
    pdf.save(namaFile);
  } catch (err) {
    console.error('Gagal membuat PDF:', err);
    alert('Gagal membuat PDF: ' + (err && err.message ? err.message : err));
  } finally {
    div.remove();
  }
}

const namaAman = (d) => ('-' + ((d && d.nama_siswa) || 'siswa')).replace(/[^\w-]+/g, '-');

function generatePdfMasuk(d) {
  buatPdfMutasi(htmlSuratMasuk(d), 'Surat-Mutasi-Masuk' + namaAman(d) + '.pdf');
}

function generatePdfKeluar(d) {
  buatPdfMutasi(htmlSuratKeluar(d), 'Surat-Mutasi-Keluar' + namaAman(d) + '.pdf');
}

/* ==========================================================
   GENERATE WORD (.doc) â€” FORMAT F4 & TANPA PROMPT CONVERT
   ========================================================== */
function downloadAsWord(html, filename) {
  const fullHtml = `<html xmlns:v="urn:schemas-microsoft-com:vml"
xmlns:o="urn:schemas-microsoft-com:office:office"
xmlns:w="urn:schemas-microsoft-com:office:word"
xmlns:m="http://schemas.microsoft.com/office/2004/12/omml"
xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8">
<!--[if gte mso 9]>
<xml>
<w:WordDocument>
<w:View>Print</w:View>
<w:Zoom>100</w:Zoom>
<w:DoNotOptimizeForBrowser/>
</w:WordDocument>
</xml>
<![endif]-->
<style>
@page Section1 {
  size: 215.9mm 330.2mm; /* F4 / Folio */
  margin: 8mm 15mm 12mm 20mm;
  mso-header-margin: 1cm;
  mso-footer-margin: 1cm;
  mso-paper-source: 0;
}
div.Section1 { page: Section1; }
body { font-family: 'Times New Roman', serif; font-size: 11pt; color: #000; line-height: 1.25; }
table { border-collapse: collapse; width: 100%; margin: 2px 0; }
td, th { padding: 1px 4px; vertical-align: top; font-size: 11pt; }
p { margin: 2px 0; }
.center { text-align: center; }
.justify { text-align: justify; }
.bold { font-weight: bold; }
.underline { text-decoration: underline; }
img { max-width: 75px; height: auto; }
</style>
</head>
<body>
<div class="Section1">
${html}
</div>
</body>
</html>`;

  const blob = new Blob(['\ufeff' + fullHtml], { type: 'application/msword;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function htmlSuratMasuk(d) {
  const tanggalStr = d.tanggal_surat ? tglID(new Date(d.tanggal_surat + 'T00:00:00')) : '_______________';
  return `
    ${kopSuratHTML()}
    <p class="center bold underline" style="font-size:13pt;margin-top:12px;">SURAT KETERANGAN MENERIMA SISWA PINDAHAN</p>
    <p class="center" style="margin-bottom:14px;">No. : ${nomorSurat(d.no_surat, '400.7.22.1/____/SDN.SKM.03/____/____')}</p>

    <p>Yang bertanda tangan di bawah ini :</p>
    <table>
      <tr><td style="width:25px;"></td><td style="width:140px;">Nama</td><td style="width:10px;">:</td><td class="bold">${esc(d.nama_kepsek || 'KASWIN KARTAWIJAYA, M.Pd')}</td></tr>
      <tr><td></td><td>NIP</td><td>:</td><td>${esc(d.nip_kepsek || '19720506 199903 1 007')}</td></tr>
      <tr><td></td><td>Pangkat/Gol</td><td>:</td><td>${esc(d.pangkat_gol || 'Pembina Utama Muda / IVc')}</td></tr>
      <tr><td></td><td>Jabatan</td><td>:</td><td>${esc(d.jabatan_kepsek || 'Kepala Sekolah')}</td></tr>
      <tr><td></td><td>Unit Kerja</td><td>:</td><td class="justify">${esc(d.unit_kerja || 'SDN Sukamahi 03, Kec. Cikarang Pusat')}</td></tr>
    </table>

    <p style="margin-top:12px;">Menerangkan bahwa siap menerima siswa pindahan :</p>
    <table>
      <tr><td style="width:25px;"></td><td style="width:140px;">Nama</td><td style="width:10px;">:</td><td class="bold">${esc(d.nama_siswa || '')}</td></tr>
      <tr><td></td><td>TTL</td><td>:</td><td>${esc(d.ttl || '')}</td></tr>
      <tr><td></td><td>Jenis Kelamin</td><td>:</td><td>${esc(d.jenis_kelamin || '')}</td></tr>
      ${d.nisn ? `<tr><td></td><td>NISN</td><td>:</td><td>${esc(d.nisn)}</td></tr>` : ''}
      <tr><td></td><td>Asal Sekolah</td><td>:</td><td class="justify">${esc(d.asal_sekolah || '')}</td></tr>
      <tr><td></td><td>Kelas</td><td>:</td><td>${esc(d.kelas || '')}</td></tr>
    </table>

    <p class="bold" style="margin-top:12px;">Dengan Persyaratan :</p>
    <table style="margin-left:15px;">
      <tr><td style="width:25px;">1.</td><td>Membawa Surat Pindah/mutasi dari Sekolah asal.</td></tr>
      <tr><td>2.</td><td>Membawa Surat Mutasi Dapodik dari Sekolah asal.</td></tr>
      <tr><td>3.</td><td>Membawa Fotocopy Raport (dari sekolah asal).</td></tr>
      <tr><td>4.</td><td>Menyerahkan fotocopy KK (Kartu Keluarga).</td></tr>
      <tr><td>5.</td><td>Menyerahkan Fotocopy Akta Kelahiran.</td></tr>
      <tr><td>6.</td><td>Menyerahkan Fotocopy KTP kedua orang tua.</td></tr>
    </table>

    <p class="justify" style="margin-top:14px;">Demikian surat keterangan ini dibuat untuk dipergunakan dan dipatuhi sebagaimana mestinya.</p>

    <br/><br/>
    <table style="width:100%;">
      <tr><td style="width:55%;"></td><td>Cikarang Pusat, ${esc(tanggalStr)}</td></tr>
      <tr><td></td><td>Kepala SDN Sukamahi 03,</td></tr>
      <tr><td></td><td><br/><br/><br/><br/><br/></td></tr>
      <tr><td></td><td class="bold underline">${esc(d.nama_kepsek || 'KASWIN KARTAWIJAYA, M.Pd')}</td></tr>
      <tr><td></td><td>NIP. ${esc(d.nip_kepsek || '19720506 199903 1 007')}</td></tr>
    </table>`;
}

function generateWordMasuk(d) {
  downloadAsWord(htmlSuratMasuk(d), 'Surat-Mutasi-Masuk-' + (d.nama_siswa || 'siswa').replace(/[^\w]+/g, '-') + '.doc');
}

function htmlSuratKeluar(d) {
  const tanggalSurat = d.tanggal_surat ? tglID(new Date(d.tanggal_surat + 'T00:00:00')) : '_______________';
  return `
    ${kopSuratHTML()}
    <table style="width:100%;">
      <tr>
        <td style="width:60px;"></td><td></td><td></td>
        <td style="width:11mm;"></td>
        <td style="width:44%;vertical-align:top;">Cikarang Pusat, ${esc(tanggalSurat)}</td>
      </tr>
      <tr>
        <td>Nomor</td><td>:</td>
        <td style="white-space:nowrap;">${nomorSurat(d.no_surat, '400.3.12.1/____/SDN.SKM.03/____/____')}</td>
        <td></td><td style="vertical-align:top;">Kepada Yth.</td>
      </tr>
      <tr>
        <td>Lampiran</td><td>:</td><td>${esc(d.lampiran || '-')}</td>
        <td></td>
        <td style="vertical-align:top;">${d.sekolah_tujuan ? 'Kepala <span class="bold">' + esc(d.sekolah_tujuan) + '.</span>' : 'Kepala _______________'}</td>
      </tr>
      <tr>
        <td>Perihal</td><td>:</td><td>Surat Mutasi/Pindah Sekolah</td>
        <td></td><td style="vertical-align:top;">di</td>
      </tr>
      <tr>
        <td></td><td></td><td></td>
        <td></td><td style="vertical-align:top;">Tempat</td>
      </tr>
    </table>

    <p class="justify" style="margin-top:8px;">Kepala Sekolah Dasar Negeri Sukamahi 03 Kecamatan Cikarang Pusat Kabupaten Bekasi, dengan ini memberikan izin pindah sekolah/rayon kepada:</p>

    <table>
      <tr><td style="width:140px;">Nama</td><td style="width:10px;">:</td><td class="bold">${esc(d.nama_siswa || '')}</td></tr>
      <tr><td>Tempat, Tgl. Lahir</td><td>:</td><td>${esc(d.tempat_tgl_lahir || '')}</td></tr>
      <tr><td>Jenis Kelamin</td><td>:</td><td>${esc(d.jenis_kelamin || '')}</td></tr>
      <tr><td>NISN</td><td>:</td><td>${esc(d.nisn || '')}</td></tr>
      <tr><td>Kelas</td><td>:</td><td>${esc(d.kelas || '')}</td></tr>
      <tr><td>Asal Sekolah</td><td>:</td><td>${esc(d.asal_sekolah || 'SDN SUKAMAHI 03')}</td></tr>
      <tr><td>Alamat Sekolah</td><td>:</td><td class="justify">${esc(d.alamat_sekolah || 'Jl. Raya Sukamahi Kp. Cimahi Rt. 007/004 Ds. Sukamahi Kec. Cikarang Pusat Kab. Bekasi')}</td></tr>
    </table>

    <table style="margin-top:4px;">
      <tr><td style="width:140px;">Nama Orang Tua</td><td style="width:10px;">:</td><td>Ayah : ${esc(d.nama_ayah || '_______________')}&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Ibu : ${esc(d.nama_ibu || '_______________')}</td></tr>
      <tr><td>Alamat Orang Tua</td><td>:</td><td class="justify">${esc(d.alamat_ortu || '_______________')}</td></tr>
    </table>

    <p class="bold" style="margin-top:8px;">Melanjutkan / Pindah ke :</p>
    <table>
      <tr><td style="width:140px;">Nama Sekolah</td><td style="width:10px;">:</td><td class="bold">${esc(d.sekolah_tujuan || '')}</td></tr>
      <tr><td>Kecamatan</td><td>:</td><td>${esc(d.kecamatan_tujuan || '')}</td></tr>
      <tr><td>Kabupaten / Kota</td><td>:</td><td>${esc(d.kabupaten_tujuan || '')}</td></tr>
      <tr><td>Provinsi</td><td>:</td><td>${esc(d.provinsi_tujuan || '')}</td></tr>
      <tr><td>Alasan</td><td>:</td><td class="justify">${esc(d.alasan_pindah || '')}</td></tr>
    </table>

    <p class="justify" style="margin-top:8px;">Demikian surat ini kami buat untuk dipergunakan sebagaimana mestinya dan agar menjadi maklum adanya.</p>

    <table style="width:100%;margin-top:6px;">
      <tr><td style="width:55%;"></td><td>Kepala SDN Sukamahi 03,</td></tr>
      <tr><td></td><td><br/><br/><br/><br/><br/></td></tr>
      <tr><td></td><td class="bold underline">${esc(d.nama_kepsek || 'KASWIN KARTAWIJAYA, M.Pd')}</td></tr>
      <tr><td></td><td>NIP. ${esc(d.nip_kepsek || '19720506 199903 1 007')}</td></tr>
    </table>

    <hr style="border:0;border-top:1px solid #000;margin:10px 0 8px 0;"/>

    <p>NSS : __________________________________________________</p>
    <table>
      <tr><td style="width:140px;">Nama Sekolah</td><td style="width:10px;">:</td><td>________________________________________________</td></tr>
      <tr><td>Status Sekolah</td><td>:</td><td>________________________________________________</td></tr>
      <tr><td>Alamat</td><td>:</td><td>________________________________________________</td></tr>
      <tr><td>Kecamatan</td><td>:</td><td>________________________________________________</td></tr>
      <tr><td>Kabupaten</td><td>:</td><td>________________________________________________</td></tr>
      <tr><td>Nama Siswa</td><td>:</td><td>________________________________________________</td></tr>
      <tr><td>Diterima di Kelas</td><td>:</td><td>________________________________________________</td></tr>
    </table>

    <table style="width:100%;margin-top:6px;">
      <tr><td style="width:55%;"></td><td>____________________, __________________</td></tr>
      <tr><td></td><td>Kepala Sekolah,</td></tr>
      <tr><td></td><td><br/><br/><br/></td></tr>
      <tr><td></td><td>________________________________________</td></tr>
      <tr><td></td><td>NIP.</td></tr>
    </table>`;
}

function generateWordKeluar(d) {
  downloadAsWord(htmlSuratKeluar(d), 'Surat-Mutasi-Keluar-' + (d.nama_siswa || 'siswa').replace(/[^\w]+/g, '-') + '.doc');
}

/* ==========================================================
   PRINT â€” FORMAT F4 FOLIO (FIT PROPOSIONAL 1 LEMBAR)
   ========================================================== */
function openPrintWindow(html, title) {
  const win = window.open('', '_blank');
  if (!win) return alert('Pop-up diblokir browser. Izinkan pop-up untuk halaman ini, lalu coba lagi.');
  win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: blob: https:">
    <style>
      @page {
        size: 215mm 330mm; /* Standar F4 / Folio */
        margin: 0; /* margin 0 = Chrome tidak menggambar header/footer (tanggal, judul, about:blank) */
      }
      @media print {
        html, body {
          width: 215mm;
          margin: 0 auto;
          padding: 0;
        }
        .page-container {
          padding: 8mm 15mm 12mm 20mm; /* atas kanan bawah kiri — hemat, isi lebih memenuhi kertas */
          page-break-after: avoid;
          page-break-inside: avoid;
        }
      }
      body {
        font-family: 'Times New Roman', serif;
        font-size: 12pt;
        color: #000;
        margin: 0 auto;
        padding: 0; /* margin diatur @page saja — jangan ditumpuk lagi */
        line-height: 1.25;
      }
      table { border-collapse: collapse; width: 100%; margin: 2px 0; }
      td, th { padding: 1px 4px; vertical-align: top; font-size: 11pt; }
      p { margin: 2px 0; }
      .center { text-align: center; }
      .justify { text-align: justify; text-justify: inter-word; }
      .bold { font-weight: bold; }
      .underline { text-decoration: underline; }
    </style></head><body><div class="page-container">${html}</div></body></html>`);
  win.document.close();
  win.onload = () => { win.print(); };
}

function printMasuk(d) {
  openPrintWindow(htmlSuratMasuk(d), 'Surat Mutasi Masuk - ' + (d.nama_siswa || ''));
}

function printKeluar(d) {
  openPrintWindow(htmlSuratKeluar(d), 'Surat Mutasi Keluar - ' + (d.nama_siswa || ''));
}

/* ==========================================================
   UPLOAD BATCH (Excel) â€” header kolom = key FIELD_*
   ========================================================== */
let batchType = 'masuk', batchRows = [];
const batchFields = () => batchType === 'masuk' ? FIELD_MASUK : FIELD_KELUAR;
const batchTable = () => batchType === 'masuk' ? MUTASI_MASUK_TABLE : MUTASI_KELUAR_TABLE;
const xlsxSiap = () => {
  if (typeof XLSX !== 'undefined') return true;
  alert('Library Excel belum termuat. Periksa koneksi internet lalu coba lagi.');
  return false;
};

function unduhTemplateBatch(type) {
  if (!xlsxSiap()) return;
  const fields = type === 'masuk' ? FIELD_MASUK : FIELD_KELUAR;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([fields.map((f) => f.k)]), 'data');
  XLSX.writeFile(wb, 'template-mutasi-' + type + '.xlsx');
}

function bukaModalBatch(type) {
  batchType = type; batchRows = [];
  $('#mb-judul').textContent = 'Upload Batch Mutasi ' + (type === 'masuk' ? 'Masuk' : 'Keluar');
  $('#mb-file').value = ''; $('#mb-preview').innerHTML = ''; $('#mb-hasil').textContent = '';
  $('#modal-mutasi-batch').classList.remove('hidden');
}

function tutupModalBatch() { $('#modal-mutasi-batch').classList.add('hidden'); batchRows = []; }

$('#mm-batch').onclick = () => bukaModalBatch('masuk');
$('#mk-batch').onclick = () => bukaModalBatch('keluar');
$('#mm-template').onclick = () => unduhTemplateBatch('masuk');
$('#mk-template').onclick = () => unduhTemplateBatch('keluar');
$('#mb-template-link').onclick = () => unduhTemplateBatch(batchType);
$('#mb-tutup').onclick = tutupModalBatch;
$('#mb-batal').onclick = tutupModalBatch;
$('#modal-mutasi-batch').onclick = (e) => { if (e.target.id === 'modal-mutasi-batch') tutupModalBatch(); };

$('#mb-file').onchange = async (e) => {
  if (!xlsxSiap()) return;
  const file = e.target.files[0];
  if (!file) return;
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
  const json = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
  const keys = batchFields().map((f) => f.k);
  batchRows = json.map((r) => {
    const row = {};
    keys.forEach((k) => {
      const val = r[k];
      row[k] = (val instanceof Date ? val.toISOString().slice(0, 10) : String(val ?? '').trim()) || null;
    });
    return row;
  }).filter((r) => r.nama_siswa);
  const lewati = json.length - batchRows.length;
  $('#mb-hasil').textContent = batchRows.length + ' baris siap diunggah' + (lewati ? ', ' + lewati + ' baris dilewati (nama kosong)' : '');
  $('#mb-preview').innerHTML = batchRows.length ? `<table class="w-full text-left"><thead><tr><th class="px-2 py-1">Nama Siswa</th><th class="px-2 py-1">NISN</th><th class="px-2 py-1">No. Surat</th></tr></thead><tbody>${batchRows.slice(0, 5).map((r) => `<tr class="border-t border-ink/10"><td class="px-2 py-1 font-semibold">${esc(r.nama_siswa)}</td><td class="px-2 py-1">${esc(r.nisn || '-')}</td><td class="px-2 py-1">${esc(r.no_surat || '-')}</td></tr>`).join('')}</tbody></table>${batchRows.length > 5 ? `<p class="px-2 py-1 text-ink/60">...dan ${batchRows.length - 5} baris lagi</p>` : ''}` : '';
};

$('#mb-simpan').onclick = async () => {
  if (!batchRows.length) return alert('Belum ada data. Pilih file Excel sesuai format dulu.');
  const rows = batchRows.map((r) => ({ ...r, diperbarui: new Date().toISOString() }));
  if (batchType === 'masuk') rows.forEach((r) => { if (!r.nisn) delete r.nisn; });
  // ponytail: single insert ok s/d ~500 baris; pecah jadi chunk 200 + progress bar bila file rutin >500 baris.
  const { error } = await sb.from(batchTable()).insert(rows);
  if (error) return alert(galat(error, 'Gagal menyimpan batch'));
  tutupModalBatch();
  if (batchType === 'masuk') await loadMutasiMasuk(); else await loadMutasiKeluar();
  alert(rows.length + ' data berhasil disimpan.');
};

/* ==========================================================
   RAG CHAT â€” Tanya Jawab Data Mutasi (via Gemini + pgvector)
   ========================================================== */
let ragChatHistory = [];

function bukaModalRAG() {
  $('#rag-chat-messages').innerHTML = '';
  ragChatHistory = [];
  $('#modal-rag-chat').classList.remove('hidden');
  $('#rag-input').focus();
  tambahPesanRAG('assistant', 'Halo! Saya siap menjawab pertanyaan tentang data mutasi masuk/keluar. Contoh: "Berapa siswa pindah ke Bekasi tahun ini?" atau "Siapa siswa yang pindah dari SDN Sukamahi 03?"');
}

function tutupModalRAG() {
  $('#modal-rag-chat').classList.add('hidden');
}

function tambahPesanRAG(role, content) {
  const el = document.createElement('div');
  el.className = `mb-3 p-3 rounded-lg ${role === 'user' ? 'bg-hijau/10 ml-8 text-right' : 'bg-ink/5 mr-8'}`;
  el.innerHTML = `<div class="text-xs font-semibold ${role === 'user' ? 'text-hijau' : 'text-ink/60'}">${role === 'user' ? 'Anda' : 'Asisten'}</div><div class="text-sm whitespace-pre-wrap">${esc(content)}</div>`;
  $('#rag-chat-messages').appendChild(el);
  $('#rag-chat-messages').scrollTop = $('#rag-chat-messages').scrollHeight;
}

async function kirimPesanRAG() {
  const input = $('#rag-input');
  const query = input.value.trim();
  if (!query) return;

  input.value = '';
  input.disabled = true;
  $('#rag-kirim').disabled = true;

  tambahPesanRAG('user', query);
  ragChatHistory.push({ role: 'user', content: query });

  const loadingEl = document.createElement('div');
  loadingEl.id = 'rag-loading';
  loadingEl.className = 'mb-3 p-3 rounded-lg bg-ink/5 mr-8 text-sm text-ink/60 animate-pulse';
  loadingEl.textContent = 'Mencari data dan memproses...';
  $('#rag-chat-messages').appendChild(loadingEl);
  $('#rag-chat-messages').scrollTop = $('#rag-chat-messages').scrollHeight;

  try {
    const { data: { session } } = await sb.auth.getSession();
    const res = await fetch(`${SUPABASE_URL}/functions/v1/rag`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + session.access_token,
        'apikey': SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ action: 'ask', query, history: ragChatHistory.slice(-10) }),
    });
    const data = await res.json();
    loadingEl.remove();

    if (data.error) throw new Error(data.error);

    tambahPesanRAG('assistant', data.answer);
    ragChatHistory.push({ role: 'assistant', content: data.answer });

    // Show sources if any
    if (data.sources?.length) {
      const srcEl = document.createElement('div');
      srcEl.className = 'mb-3 p-2 rounded bg-ink/5 text-[11px] text-ink/70 border border-ink/10';
      srcEl.innerHTML = '<strong>Sumber:</strong><br>' + data.sources.map((s, i) =>
        `${i + 1}. ${esc(s.nama_siswa)} (${s._table === 'mutasi_masuk' ? 'Masuk' : 'Keluar'}) â€” ${Math.round(s.similarity * 100)}%`
      ).join('<br>');
      $('#rag-chat-messages').appendChild(srcEl);
    }
  } catch (e) {
    loadingEl.remove();
    tambahPesanRAG('assistant', 'Maaf, terjadi kesalahan: ' + e.message);
  } finally {
    input.disabled = false;
    $('#rag-kirim').disabled = false;
    input.focus();
  }
}

async function generateEmbeddingsRAG(type) {
  const btn = type === 'masuk' ? $('#rag-embed-masuk') : $('#rag-embed-keluar');
  const original = btn.textContent;
  btn.textContent = 'Memproses...';
  btn.disabled = true;

  try {
    const { data: { session } } = await sb.auth.getSession();
    const res = await fetch(`${SUPABASE_URL}/functions/v1/rag`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + session.access_token,
        'apikey': SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ action: 'embed', type }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    alert(`Berhasil generate embedding untuk ${data.embedded} data mutasi ${type}.`);
  } catch (e) {
    alert('Gagal: ' + e.message);
  } finally {
    btn.textContent = original;
    btn.disabled = false;
  }
}

// Event listeners for RAG
$('#rag-tutup').onclick = tutupModalRAG;
$('#rag-kirim').onclick = kirimPesanRAG;
$('#rag-input').onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); kirimPesanRAG(); } };
$('#rag-embed-masuk').onclick = () => generateEmbeddingsRAG('masuk');
$('#rag-embed-keluar').onclick = () => generateEmbeddingsRAG('keluar');
$('#btn-rag-chat').onclick = bukaModalRAG;
