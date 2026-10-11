/* Data guru: input, pratinjau, pencarian, dan PDF */
const SEKOLAH = { nama: 'SDN SUKAMAHI 03', alamat: 'Cikarang Pusat, Kabupaten Bekasi' }; // ubah alamat sesuai kop sekolah
const TTD_BUCKET = 'ttd-guru';
const TTD_MAX = 2 * 1048576;

// Daftar isian. col:true = kolom tabel; lainnya masuk ke kolom "profil".
const FIELD = [
  { k: 'nama', label: 'Nama lengkap', col: true, req: true },
  { k: 'nip', label: 'NIP', col: true },
  { k: 'jabatan', label: 'Jabatan', col: true, type: 'select', opts: ['Kepala Sekolah', 'Guru Kelas', 'Guru Mapel', 'Operator', 'Kebersihan'] },
  { k: 'nuptk', label: 'NUPTK' },
  { k: 'jk', label: 'Jenis kelamin', type: 'select', opts: ['Laki-laki', 'Perempuan'] },
  { k: 'tempat_lahir', label: 'Tempat lahir' },
  { k: 'tgl_lahir', label: 'Tanggal lahir', type: 'date' },
  { k: 'status', label: 'Status kepegawaian', type: 'select', opts: ['PNS', 'PPPK', 'PPPK PW', 'Honorer', 'OUTSOURCING'] },
  { k: 'pangkat', label: 'Pangkat / Golongan' },
  { k: 'pendidikan', label: 'Pendidikan terakhir' },
  { k: 'hp', label: 'No. HP', type: 'tel' },
  { k: 'email', label: 'Email', type: 'email' },
  { k: 'email_belajar', label: 'Email belajar.id', type: 'email' },
];

let daftar = [], aktif = null, mode = 'kosong';

const nilai = (g, f) => (f.col ? g[f.k] : (g.profil || {})[f.k]) ?? '';
function tampil(g, f) {
  const v = nilai(g, f);
  if (!v) return '-';
  return f.type === 'date' ? tglID(new Date(v + 'T00:00:00')) : v;
}
const hasilCari = () => {
  const q = $('#g-cari').value.trim().toLowerCase();
  return daftar.filter((g) => (g.nama || '').toLowerCase().includes(q));
};

async function muatDaftar() {
  const { data, error } = await sb.from('guru').select('*').order('nama');
  if (error) return alert('Gagal memuat data guru: ' + error.message);
  daftar = data || [];
  await Promise.all(daftar.map(async (g) => {
    if (!g.ttd_path) { g.ttd_url = ''; return; }
    try {
      const { data: u, error: e } = await sb.storage.from(TTD_BUCKET).createSignedUrl(g.ttd_path, 3600);
      g.ttd_url = e ? '' : u.signedUrl;
    } catch { g.ttd_url = ''; }
  }));
  if (aktif) aktif = daftar.find((g) => g.id === aktif.id) || null;
  renderList(); renderPanel();
}

function validTtd(file) {
  if (!file || !file.size) return null;
  const okTipe = file.type === 'image/png' || /\.png$/i.test(file.name || '');
  if (!okTipe) throw new Error('Tanda tangan hanya boleh file PNG.');
  if (file.size > TTD_MAX) throw new Error('Ukuran tanda tangan maksimal 2 MB.');
  return file;
}

async function simpanTtdGuru() {
  if (!aktif) return;
  const input = $('#g-ttd-file');
  const file = validTtd(input && input.files && input.files[0]);
  if (!file) return alert('Pilih file PNG dulu.');
  const btn = $('#g-ttd-simpan');
  btn.disabled = true; btn.textContent = 'Mengunggah...';
  try {
    const path = 'ttd-' + aktif.id + '-' + Date.now() + '.png';
    const { error } = await sb.storage.from(TTD_BUCKET).upload(path, file, { contentType: 'image/png', upsert: true });
    if (error) throw error;
    if (aktif.ttd_path) await sb.storage.from(TTD_BUCKET).remove([aktif.ttd_path]);
    const { error: e2 } = await sb.from('guru').update({ ttd_path: path }).eq('id', aktif.id);
    if (e2) throw e2;
    await muatDaftar();
  } catch (e) {
    alert('Gagal mengunggah tanda tangan: ' + (e.message || e));
    btn.disabled = false; btn.textContent = 'Upload TTD';
  }
}

async function hapusTtdGuru() {
  if (!aktif || !aktif.ttd_path) return;
  if (!confirm('Hapus tanda tangan ini?')) return;
  try {
    await sb.storage.from(TTD_BUCKET).remove([aktif.ttd_path]);
    const { error } = await sb.from('guru').update({ ttd_path: null }).eq('id', aktif.id);
    if (error) throw error;
    await muatDaftar();
  } catch (e) {
    alert('Gagal menghapus tanda tangan: ' + (e.message || e));
  }
}

function renderList() {
  const hasil = hasilCari();
  $('#g-jumlah').textContent = hasil.length + ' dari ' + daftar.length + ' guru';
  $('#g-list').innerHTML = hasil.length ? hasil.map((g) => `
    <li><button data-id="${g.id}" class="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-kertas ${aktif && aktif.id === g.id ? 'bg-kertas' : ''}">
      <span class="block text-sm font-semibold">${esc(g.nama)}</span>
      <span class="block text-xs text-ink/60">${esc(g.jabatan || 'Belum ada jabatan')}</span>
    </button></li>`).join('')
    : '<li class="px-3 py-4 text-sm text-ink/60">Tidak ada guru dengan nama itu.</li>';
}

function renderPanel() {
  const p = $('#g-panel');
  if (mode === 'form') return renderForm(p);
  if (!aktif) {
    p.innerHTML = '<p class="text-sm text-ink/60">Pilih guru di sebelah kiri untuk melihat datanya, atau klik Tambah.</p>';
    return;
  }
  const btn = 'rounded-lg border border-ink/20 text-sm font-semibold px-3 py-1.5 hover:bg-kertas';
  const ttdUrl = aktif.ttd_url || '';
  p.innerHTML = `
    <div class="flex flex-wrap items-start gap-2">
      <div class="mr-auto">
        <h2 class="text-lg font-extrabold">${esc(aktif.nama)}</h2>
        <p class="text-sm text-ink/60">${esc(aktif.jabatan || '')}</p>
      </div>
      <button id="g-edit" class="${btn}">Edit</button>
      <button id="g-pdf" class="rounded-lg bg-hijau text-white text-sm font-semibold px-3 py-1.5 hover:bg-ink">Unduh PDF</button>
      <button id="g-hapus" class="${btn} text-red-700">Hapus</button>
    </div>
    <div class="mt-4 rounded-xl border border-ink/15 p-3">
      <p class="text-sm font-extrabold">Tanda tangan (PNG)</p>
      ${ttdUrl
        ? `<img src="${ttdUrl}" alt="Tanda tangan ${esc(aktif.nama)}" style="max-width:220px;max-height:110px;background:#fff" class="mt-2 border border-ink/15 rounded-lg">`
        : '<p class="mt-1 text-xs text-ink/60">Belum ada tanda tangan. Upload file PNG (maks 2 MB) agar muncul di jurnal harian.</p>'}
      <div class="mt-2 flex flex-wrap items-center gap-2">
        <input id="g-ttd-file" type="file" accept=".png" class="text-xs">
        <button id="g-ttd-simpan" class="${btn}">Upload TTD</button>
        ${aktif.ttd_path ? `<button id="g-ttd-hapus" class="${btn} text-red-700">Hapus TTD</button>` : ''}
      </div>
    </div>
    <dl class="mt-4 grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
      ${FIELD.map((f) => `<div class="${f.type === 'textarea' ? 'sm:col-span-2' : ''}">
        <dt class="text-xs text-ink/60">${esc(f.label)}</dt>
        <dd class="font-semibold break-words">${esc(tampil(aktif, f))}</dd></div>`).join('')}
    </dl>`;
}

function kolomInput(f, v) {
  const base = 'mt-1 w-full rounded-lg border border-ink/20 px-3 py-2 text-sm font-normal';
  let el;
  if (f.type === 'select') el = `<select name="${f.k}" class="${base}"><option value="">Pilih...</option>${f.opts.map((o) => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
  else if (f.type === 'textarea') el = `<textarea name="${f.k}" rows="3" class="${base}">${esc(v)}</textarea>`;
  else el = `<input name="${f.k}" type="${f.type || 'text'}" value="${esc(v)}" ${f.req ? 'required' : ''} class="${base}">`;
  return `<label class="block text-sm font-semibold ${f.type === 'textarea' ? 'sm:col-span-2' : ''}">${esc(f.label)}${el}</label>`;
}

function renderForm(p) {
  p.innerHTML = `
    <h2 class="text-lg font-extrabold">${aktif ? 'Edit data guru' : 'Tambah guru'}</h2>
    <form id="g-form" class="mt-3 grid gap-3 sm:grid-cols-2">
      ${FIELD.map((f) => kolomInput(f, aktif ? nilai(aktif, f) : '')).join('')}
      <div class="sm:col-span-2 flex gap-2">
        <button class="rounded-lg bg-hijau text-white text-sm font-semibold px-4 py-2 hover:bg-ink">Simpan</button>
        <button type="button" id="g-batal" class="rounded-lg border border-ink/20 text-sm font-semibold px-4 py-2 hover:bg-kertas">Batal</button>
      </div>
    </form>`;
}

/* ---------- PDF ---------- */
function kop(doc) {
  const w = doc.internal.pageSize.getWidth();
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.text(SEKOLAH.nama, w / 2, 16, { align: 'center' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.text(SEKOLAH.alamat, w / 2, 22, { align: 'center' });
  doc.setLineWidth(0.6); doc.line(15, 26, w - 15, 26);
}
function unduhPDF(g) {
  const doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4' });
  kop(doc);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text('DATA GURU', 105, 36, { align: 'center' });
  doc.autoTable({
    startY: 42, theme: 'grid', margin: { left: 15, right: 15 },
    body: FIELD.map((f) => [f.label, tampil(g, f)]),
    columnStyles: { 0: { cellWidth: 55, fontStyle: 'bold', fillColor: [238, 242, 240] } },
    styles: { fontSize: 10, cellPadding: 2.5, textColor: 20 },
  });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text('Dicetak: ' + tglID(new Date()), 15, doc.lastAutoTable.finalY + 8);
  doc.save('Data-Guru-' + g.nama.replace(/[^\w]+/g, '-') + '.pdf');
}
function unduhRekap() {
  const hasil = hasilCari();
  if (!hasil.length) return alert('Tidak ada data untuk diunduh.');
  const doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
  kop(doc);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text('REKAP DATA GURU', doc.internal.pageSize.getWidth() / 2, 36, { align: 'center' });
  const kolom = ['nama', 'nip', 'jabatan', 'status', 'pangkat', 'hp'].map((k) => FIELD.find((f) => f.k === k));
  doc.autoTable({
    startY: 42, theme: 'grid', margin: { left: 15, right: 15 },
    head: [['No', ...kolom.map((f) => f.label)]],
    body: hasil.map((g, i) => [i + 1, ...kolom.map((f) => tampil(g, f))]),
    headStyles: { fillColor: [31, 107, 79] }, styles: { fontSize: 9, cellPadding: 2 },
  });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text('Dicetak: ' + tglID(new Date()), 15, doc.lastAutoTable.finalY + 8);
  doc.save('Rekap-Data-Guru.pdf');
}

/* ---------- Event ---------- */
$('#g-cari').oninput = renderList;
$('#g-rekap').onclick = unduhRekap;
$('#g-tambah').onclick = () => { aktif = null; mode = 'form'; renderList(); renderPanel(); };
$('#g-list').onclick = (e) => {
  const b = e.target.closest('[data-id]'); if (!b) return;
  aktif = daftar.find((g) => String(g.id) === b.dataset.id); mode = 'preview';
  renderList(); renderPanel();
};
$('#g-panel').onclick = async (e) => {
  const id = e.target.id;
  if (id === 'g-edit') { mode = 'form'; renderPanel(); }
  else if (id === 'g-batal') { mode = aktif ? 'preview' : 'kosong'; renderPanel(); }
  else if (id === 'g-pdf') unduhPDF(aktif);
  else if (id === 'g-ttd-simpan') simpanTtdGuru();
  else if (id === 'g-ttd-hapus') hapusTtdGuru();
  else if (id === 'g-hapus' && confirm('Hapus data ' + aktif.nama + ' beserta semua dokumennya?')) {
    const { error: errGuru } = await sb.from('guru').delete().eq('id', aktif.id);
    if (errGuru) return alert('Gagal menghapus guru: ' + errGuru.message);
    const { data: dok } = await sb.from('dokumen_guru').select('path').eq('guru_id', aktif.id);
    if (dok && dok.length) {
      const { error: errStor } = await sb.storage.from(BUCKET).remove(dok.map(x => x.path));
      if (errStor) console.warn('Berhasil hapus DB, tapi gagal hapus file storage:', errStor.message);
    }
    if (aktif.ttd_path) await sb.storage.from(TTD_BUCKET).remove([aktif.ttd_path]);
    aktif = null; mode = 'kosong';
    await muatDaftar(); loadGuru();
  }
};
$('#g-panel').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target), row = { profil: {} };
  FIELD.forEach((f) => {
    const v = (fd.get(f.k) || '').toString().trim();
    if (f.col) row[f.k] = f.k === 'nama' ? v : (v || null); else row.profil[f.k] = v;
  });
  if (!row.nama) return;
  const { data, error } = await (aktif
    ? sb.from('guru').update(row).eq('id', aktif.id).select().single()
    : sb.from('guru').insert(row).select().single());
  if (error) return alert('Gagal menyimpan: ' + error.message);
  aktif = data; mode = 'preview'; await muatDaftar(); loadGuru();
});

addEventListener('hashchange', () => { if (location.hash === '#guru') muatDaftar(); });
sb.auth.getSession().then(({ data }) => { if (data.session && location.hash === '#guru') muatDaftar(); });