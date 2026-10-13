/* Arsip berkas sekolah: unggah, cari, filter tahun, unduh file terpilih, hapus (Storage privat) */
const ARSIP_BUCKET = 'arsip';
const ARSIP_MAKS_MB = 10;
const ARSIP_EKSTENSI_OK = ['pdf', 'xls', 'xlsx', 'csv', 'doc', 'docx'];

let daftarArsip = [], arsipTerpilih = null;

function isiTahunArsip() {
  const sel = $('#a-tahun');
  if (!sel || sel.options.length) return;
  const kini = new Date().getFullYear();
  let html = '';
  for (let t = kini; t >= kini - 10; t--) html += `<option value="${t}"${t === kini ? ' selected' : ''}>${t}</option>`;
  sel.innerHTML = html;
}

async function muatArsip() {
  isiTahunArsip();
  const tahun = Number($('#a-tahun').value);
  const { data, error } = await sb.from('arsip').select('*').eq('tahun', tahun).order('dibuat', { ascending: false });
  if (error) {
    $('#a-list').innerHTML = `<li class="py-3 text-red-700">${esc(galat(error, 'Gagal memuat arsip'))}</li>`;
    $('#a-jumlah').textContent = '';
    return;
  }
  daftarArsip = data;
  arsipTerpilih = null;
  renderArsip();
}

function renderArsip() {
  const q = ($('#a-cari').value || '').trim().toLowerCase();
  const hasil = daftarArsip.filter((d) => (d.nama_file || '').toLowerCase().includes(q));
  $('#a-jumlah').textContent = hasil.length + ' dari ' + daftarArsip.length + ' berkas tahun ' + $('#a-tahun').value;
  $('#a-list').innerHTML = hasil.length ? hasil.map((d) => `
    <li class="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 ${arsipTerpilih === d.id ? 'bg-kertas rounded-lg px-2' : ''}">
      <input type="radio" name="arsip-pilih" data-pilih="${d.id}" ${arsipTerpilih === d.id ? 'checked' : ''} title="Pilih berkas ini">
      <span class="flex-1 min-w-[10rem] break-all">${esc(d.nama_file)}
        <span class="block text-xs text-ink/60">${ukuran(d.ukuran)} | ${tglID(new Date(d.dibuat))}</span></span>
      <button data-aksi="unduh" data-id="${d.id}" class="text-hijau font-semibold hover:underline">Unduh</button>
      <button data-aksi="hapus" data-id="${d.id}" class="text-red-700 hover:underline">Hapus</button>
    </li>`).join('')
    : `<li class="py-3 text-ink/60">${daftarArsip.length ? 'Tidak ada berkas dengan nama itu.' : 'Belum ada berkas tahun ini.'}</li>`;
}

async function unggahArsip() {
  const input = $('#a-file'), file = input.files[0], btn = $('#a-unggah');
  if (!file) return alert('Pilih file terlebih dahulu.');
  const tolak = (pesan) => { input.value = ''; alert(pesan); };
  const ekstensi = (file.name.split('.').pop() || '').toLowerCase();
  if (!ARSIP_EKSTENSI_OK.includes(ekstensi)) return tolak('Format harus PDF, Excel, CSV, atau Word.');
  if (file.size === 0) return tolak('File kosong.');
  if (file.size > ARSIP_MAKS_MB * 1048576) return tolak('Ukuran file maksimal ' + ARSIP_MAKS_MB + ' MB. File ini ' + ukuran(file.size) + '.');
  const tahun = Number($('#a-tahun').value);
  btn.disabled = true; btn.textContent = 'Mengunggah...';
  const path = tahun + '/' + Date.now() + '-' + file.name.replace(/[^\w.\-]+/g, '_');
  const { error } = await sb.storage.from(ARSIP_BUCKET).upload(path, file, { contentType: file.type || undefined });
  if (error) { btn.disabled = false; btn.textContent = 'Unggah'; return alert(galat(error, 'Gagal mengunggah')); }
  const { error: e2 } = await sb.from('arsip').insert({
    tahun, nama_file: file.name, path, ukuran: file.size, tipe: file.type || null,
  });
  if (e2) { await sb.storage.from(ARSIP_BUCKET).remove([path]); alert(galat(e2, 'Gagal mencatat berkas')); }
  btn.disabled = false; btn.textContent = 'Unggah'; input.value = '';
  muatArsip();
}

async function aksiArsip(aksi, id) {
  const d = daftarArsip.find((x) => String(x.id) === String(id));
  if (!d) return;
  if (aksi === 'unduh') {
    const { data, error } = await sb.storage.from(ARSIP_BUCKET).createSignedUrl(d.path, 60, { download: d.nama_file });
    if (error) return alert(galat(error, 'Gagal mengunduh berkas'));
    location.href = data.signedUrl;
    return;
  }
  if (aksi === 'hapus') {
    if (!confirm('Hapus berkas ' + d.nama_file + '?')) return;
    const { error } = await sb.storage.from(ARSIP_BUCKET).remove([d.path]);
    if (error) return alert(galat(error, 'Gagal menghapus file'));
    await sb.from('arsip').delete().eq('id', d.id);
    return muatArsip();
  }
}

/* ---------- Event ---------- */
$('#a-tahun').onchange = muatArsip;
$('#a-cari').oninput = renderArsip;
$('#a-unggah').onclick = unggahArsip;
$('#a-list').onclick = (e) => {
  const radio = e.target.closest('[data-pilih]');
  if (radio) { arsipTerpilih = Number(radio.dataset.pilih); renderArsip(); return; }
  const b = e.target.closest('[data-aksi]');
  if (b) aksiArsip(b.dataset.aksi, b.dataset.id);
};
addEventListener('hashchange', () => { if (location.hash === '#arsip') muatArsip(); });
sb.auth.getSession().then(({ data }) => { if (data.session && location.hash === '#arsip') muatArsip(); });
