/* Berkas digital guru: unggah, lihat, unduh, hapus (Supabase Storage privat) */
const MAKS_MB = 7;
const TIPE_OK = ['application/pdf', 'image/jpeg', 'image/png'];
const EKSTENSI_OK = ['pdf', 'jpg', 'jpeg', 'png'];
const JENIS_DOK = ['KTP', 'Kartu Keluarga', 'NPWP', 'Ijazah', 'SK Pengangkatan', 'SK Pangkat / Golongan', 'SKP', 'Sertifikat', 'Lainnya'];
const ukuran = (b) => (b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');

let daftarB = [], aktifB = null, dokumen = [];

async function muatBerkasGuru() {
  const { data, error } = await sb.from('guru').select('id,nama,jabatan').order('nama');
  if (error) return alert(galat(error, 'Gagal memuat data guru'));
  daftarB = data;
  if (aktifB) aktifB = daftarB.find((g) => g.id === aktifB.id) || null;
  renderDaftarB(); renderPanelB();
}

function renderDaftarB() {
  const q = $('#b-cari').value.trim().toLowerCase();
  const hasil = daftarB.filter((g) => (g.nama || '').toLowerCase().includes(q));
  $('#b-jumlah').textContent = hasil.length + ' dari ' + daftarB.length + ' guru';
  $('#b-list').innerHTML = hasil.length ? hasil.map((g) => `
    <li><button data-id="${g.id}" class="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-kertas ${aktifB && aktifB.id === g.id ? 'bg-kertas' : ''}">
      <span class="block text-sm font-semibold">${esc(g.nama)}</span>
      <span class="block text-xs text-ink/60">${esc(g.jabatan || 'Belum ada jabatan')}</span>
    </button></li>`).join('')
    : '<li class="px-3 py-4 text-sm text-ink/60">Tidak ada guru dengan nama itu.</li>';
}

function renderPanelB() {
  const p = $('#b-panel');
  if (!aktifB) {
    p.innerHTML = '<p class="text-sm text-ink/60">Pilih guru di sebelah kiri untuk mengelola berkas digitalnya.</p>';
    return;
  }
  p.innerHTML = `
    <h2 class="text-lg font-extrabold">${esc(aktifB.nama)}</h2>
    <p class="text-sm text-ink/60">${esc(aktifB.jabatan || '')}</p>
    <section class="mt-4">
      <h3 class="font-extrabold">Berkas digital</h3>
      <p class="text-xs text-ink/60 mt-1">PDF, JPG, atau PNG, maksimal ${MAKS_MB} MB per file. Disimpan privat di Supabase.</p>
      <div class="mt-3 flex flex-wrap items-center gap-2">
        <select id="dok-jenis" class="rounded-lg border border-ink/20 px-3 py-2 text-sm">${JENIS_DOK.map((j) => `<option>${esc(j)}</option>`).join('')}</select>
        <input id="dok-file" type="file" accept=".pdf,.jpg,.jpeg,.png" class="text-sm min-w-0">
        <button id="b-unggah" class="rounded-lg bg-hijau text-white text-sm font-semibold px-3 py-1.5 hover:bg-ink">Unggah</button>
      </div>
      <input id="b-cari-berkas" type="search" placeholder="Cari nama berkas..." class="mt-3 w-full rounded-lg border border-ink/20 px-3 py-1.5 text-sm">
      <ul id="b-dok" class="mt-2 divide-y divide-ink/10 text-sm"><li class="py-3 text-ink/60">Memuat berkas...</li></ul>
    </section>`;
  muatDokumen(aktifB.id);
}

async function muatDokumen(guruId) {
  const { data, error } = await sb.from('dokumen_guru').select('*').eq('guru_id', guruId).order('dibuat', { ascending: false });
  const ul = $('#b-dok');
  if (!ul || !aktifB || aktifB.id !== guruId) return;
  if (error) { ul.innerHTML = `<li class="py-3 text-red-700">${esc(galat(error, 'Gagal memuat berkas'))}</li>`; return; }
  dokumen = data; renderDokumen();
}

function renderDokumen() {
  const ul = $('#b-dok'); if (!ul) return;
  const q = ($('#b-cari-berkas').value || '').trim().toLowerCase();
  const hasil = dokumen.filter((d) => (d.nama_file + ' ' + d.jenis).toLowerCase().includes(q));
  ul.innerHTML = hasil.length ? hasil.map((d) => `
    <li class="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
      <span class="rounded bg-kertas px-2 py-0.5 text-xs font-semibold">${esc(d.jenis)}</span>
      <span class="flex-1 min-w-[10rem] break-all">${esc(d.nama_file)}
        <span class="block text-xs text-ink/60">${ukuran(d.ukuran)} | ${tglID(new Date(d.dibuat))}</span></span>
      <button data-aksi="lihat" data-id="${d.id}" class="text-hijau font-semibold hover:underline">Lihat</button>
      <button data-aksi="unduh" data-id="${d.id}" class="text-hijau font-semibold hover:underline">Unduh</button>
      <button data-aksi="hapus" data-id="${d.id}" class="text-red-700 hover:underline">Hapus</button>
    </li>`).join('') : `<li class="py-3 text-ink/60">${dokumen.length ? 'Tidak ada berkas dengan nama itu.' : 'Belum ada berkas.'}</li>`;
}

async function unggah() {
  const input = $('#dok-file'), file = input.files[0], g = aktifB, btn = $('#b-unggah');
  if (!file) return alert('Pilih file terlebih dahulu.');
  const tolak = (pesan) => { input.value = ''; alert(pesan); };
  const ekstensi = (file.name.split('.').pop() || '').toLowerCase();
  if (!TIPE_OK.includes(file.type) || !EKSTENSI_OK.includes(ekstensi)) return tolak('Format harus PDF, JPG, atau PNG.');
  if (file.size === 0) return tolak('File kosong.');
  if (file.size > MAKS_MB * 1048576) return tolak('Ukuran file maksimal ' + MAKS_MB + ' MB. File ini ' + ukuran(file.size) + '.');
  btn.disabled = true; btn.textContent = 'Mengunggah...';
  const path = g.id + '/' + Date.now() + '-' + file.name.replace(/[^\w.\-]+/g, '_');
  const { error } = await sb.storage.from(BUCKET).upload(path, file, { contentType: file.type });
  if (error) { btn.disabled = false; btn.textContent = 'Unggah'; return alert(galat(error, 'Gagal mengunggah')); }
  const { error: e2 } = await sb.from('dokumen_guru').insert({
    guru_id: g.id, jenis: $('#dok-jenis').value, nama_file: file.name, path, ukuran: file.size, tipe: file.type,
  });
  if (e2) { await sb.storage.from(BUCKET).remove([path]); alert(galat(e2, 'Gagal mencatat berkas')); }
  btn.disabled = false; btn.textContent = 'Unggah'; input.value = '';
  if (aktifB && aktifB.id === g.id) muatDokumen(g.id);
}

async function aksiDokumen(aksi, id) {
  const d = dokumen.find((x) => String(x.id) === id);
  if (!d) return;
  if (aksi === 'lihat') return bukaViewer(d);
  if (aksi === 'hapus') {
    if (!confirm('Hapus berkas ' + d.jenis + ' (' + d.nama_file + ')?')) return;
    const { error } = await sb.storage.from(BUCKET).remove([d.path]);
    if (error) return alert(galat(error, 'Gagal menghapus file'));
    await sb.from('dokumen_guru').delete().eq('id', d.id);
    return muatDokumen(aktifB.id);
  }
  if (aksi === 'unduh') {
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(d.path, 60, { download: d.nama_file });
    if (error) return alert(galat(error, 'Gagal mengunduh berkas'));
    location.href = data.signedUrl;
  }
}

/* ---------- Jendela pratinjau (pop up di halaman ini) ---------- */
let viewerUrl = null, viewerDok = null;
async function bukaViewer(d) {
  viewerDok = d;
  $('#viewer-judul').textContent = d.jenis + ' - ' + d.nama_file;
  $('#viewer-isi').innerHTML = '<p class="text-sm text-ink/60">Memuat berkas...</p>';
  $('#viewer').classList.remove('hidden');
  const { data, error } = await sb.storage.from(BUCKET).download(d.path);
  if ($('#viewer').classList.contains('hidden') || viewerDok !== d) return; // ditutup saat memuat
  if (error) { tutupViewer(); return alert(galat(error, 'Gagal membuka berkas')); }
  viewerUrl = URL.createObjectURL(new Blob([data], { type: d.tipe || data.type }));
  const pdf = (d.tipe || data.type) === 'application/pdf';
  const el = document.createElement(pdf ? 'iframe' : 'img');
  el.src = viewerUrl;
  if (pdf) { el.title = d.nama_file; el.className = 'w-full h-full border-0 bg-white'; }
  else { el.alt = d.nama_file; el.className = 'max-w-full max-h-full object-contain'; }
  $('#viewer-isi').replaceChildren(el);
}
function tutupViewer() {
  $('#viewer').classList.add('hidden');
  if (viewerUrl) URL.revokeObjectURL(viewerUrl);
  viewerUrl = null; viewerDok = null;
  $('#viewer-isi').replaceChildren();
}

/* ---------- Event ---------- */
$('#b-cari').oninput = renderDaftarB;
$('#viewer-tutup').onclick = tutupViewer;
$('#viewer-unduh').onclick = () => { if (viewerDok) aksiDokumen('unduh', String(viewerDok.id)); };
$('#viewer').onclick = (e) => { if (e.target.id === 'viewer') tutupViewer(); };
addEventListener('keydown', (e) => { if (e.key === 'Escape') tutupViewer(); });
$('#b-list').onclick = (e) => {
  const b = e.target.closest('[data-id]'); if (!b) return;
  aktifB = daftarB.find((g) => String(g.id) === b.dataset.id);
  renderDaftarB(); renderPanelB();
};
$('#b-panel').oninput = (e) => { if (e.target.id === 'b-cari-berkas') renderDokumen(); };
$('#b-panel').onclick = (e) => {
  const d = e.target.closest('[data-aksi]');
  if (d) return aksiDokumen(d.dataset.aksi, d.dataset.id);
  if (e.target.id === 'b-unggah') unggah();
};
addEventListener('hashchange', () => { if (location.hash === '#berkas') muatBerkasGuru(); });
sb.auth.getSession().then(({ data }) => { if (data.session && location.hash === '#berkas') muatBerkasGuru(); });