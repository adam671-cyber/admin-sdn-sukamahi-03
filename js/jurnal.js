/* Jurnal kerja harian: 1 tanggal = 3 kegiatan + foto JPG/PNG + cetak bergambar */
const BUKTI_BUCKET = 'bukti-jurnal';
const BUKTI_MAX = 7 * 1048576;
const BUKTI_IMG = ['image/jpeg', 'image/png'];
let jurnalDaftar = [], jurnalEditId = null, jurnalUserId = null;
const jUrlCache = new Map();

const jIsImg = (j) => {
  const n = String(j.bukti_nama || j.bukti_path || '').toLowerCase();
  return n.endsWith('.jpg') || n.endsWith('.jpeg') || n.endsWith('.png');
};
async function jSignedUrl(path, detik) {
  const kunci = path + '|' + (detik || 3600);
  if (jUrlCache.has(kunci)) return jUrlCache.get(kunci);
  const { data, error } = await sb.storage.from(BUKTI_BUCKET).createSignedUrl(path, detik || 3600);
  if (error) throw error;
  jUrlCache.set(kunci, data.signedUrl);
  return data.signedUrl;
}

const jTglVal = () => $('#j-tanggal').value || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
const jNamaSaya = () => (typeof profilSaya !== 'undefined' && profilSaya && profilSaya.nama) || (session && session.user.email) || '';
const HARI_ID = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const jHariTgl = (yyyyMmDd) => {
  const d = new Date(String(yyyyMmDd) + 'T00:00:00');
  return HARI_ID[d.getDay()] + ', ' + tglID(d);
};

async function muatJurnal() {
  if (!$('#j-tanggal').value) $('#j-tanggal').value = jTglVal();
  const tgl = jTglVal();
  const terbatas = (typeof hanyaJurnal === 'function') ? hanyaJurnal() : true;
  const adminLihat = !terbatas && (typeof adalahAdmin === 'function' ? adalahAdmin() : false);
  const fp = $('#j-filter-pemilik');
  if (fp) fp.classList.toggle('hidden', !adminLihat);
  if (adminLihat) await muatFilterPemilik();
  else jurnalUserId = null;
  let q = sb.from('jurnal_harian').select('*').eq('tanggal', tgl);
  if (terbatas) q = q.eq('user_id', session.user.id);
  else if (jurnalUserId) q = q.eq('user_id', jurnalUserId);
  const { data, error } = await q.order('waktu').order('dibuat');
  if (error) return alert('Gagal memuat jurnal: ' + error.message);
  jurnalDaftar = data || [];
  renderJurnal();
  renderIdentitasJurnal();
}

async function muatFilterPemilik() {
  const sel = $('#j-pemilik');
  if (!sel) return;
  const { data } = await sb.from('profiles').select('id,nama,email').eq('is_active', true).order('nama');
  const daftar = data || [];
  const simpan = jurnalUserId;
  sel.innerHTML = '<option value="">Semua pegawai</option>' + daftar.map((p) =>
    `<option value="${p.id}">${esc(p.nama || p.email)}</option>`).join('');
  if (simpan && daftar.some((p) => String(p.id) === String(simpan))) sel.value = simpan;
  jurnalUserId = sel.value || null;
}

async function renderIdentitasJurnal() {
  const el = $('#j-identitas');
  if (!el) return;
  const terbatas = (typeof hanyaJurnal === 'function') ? hanyaJurnal() : true;
  let namaTampil = jNamaSaya(), emailSaya = (session && session.user.email) || '', nip = '-', jabatan = '-';
  let profilLink = null, ttdUrl = '';
  if (!terbatas && jurnalUserId) {
    try {
      const { data: p } = await sb.from('profiles').select('nama,email').eq('id', jurnalUserId).single();
      if (p) { namaTampil = p.nama || p.email; emailSaya = p.email || emailSaya; profilLink = p; }
    } catch { /* pakai default */ }
  } else if (typeof profilSaya !== 'undefined' && profilSaya) {
    emailSaya = profilSaya.email || emailSaya; profilLink = profilSaya;
  }
  try {
    const nama = String(namaTampil).split(',')[0].trim().toLowerCase();
    const mail = String(emailSaya || '').trim().toLowerCase();
    const lokal = mail.split('@')[0].replace(/[0-9._-]+/g, '');
    const { data } = await sb.from('guru').select('id,nip,jabatan,nama,profil,ttd_path').limit(200);
    const daftar = data || [];
    let cocok = null;
    try {
      const gid = profilLink && profilLink.guru_id;
      if (gid) cocok = daftar.find((g) => String(g.id) === String(gid)) || null;
    } catch { /* kolom guru_id belum ada: abaikan */ }
    if (!cocok && mail) cocok = daftar.find((g) => {
      const pr = g.profil || {};
      return [pr.email, pr.email_belajar].some((e) => String(e || '').trim().toLowerCase() === mail);
    }) || null;
    if (!cocok) cocok = daftar.find((g) => String(g.nama || '').split(',')[0].trim().toLowerCase() === nama) || null;
    if (!cocok && lokal.length >= 5) cocok = daftar.find((g) => {
      const kata = String(g.nama || '').toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 4);
      return kata.length && kata.every((w) => lokal.includes(w));
    }) || null;
    if (!cocok && nama && nama.includes('@')) {
      const kata = nama.split('@')[0].replace(/[0-9._-]+/g, ' ').split(' ').filter((w) => w.length >= 4);
      if (kata.length) cocok = daftar.find((g) => {
        const gn = String(g.nama || '').toLowerCase();
        return kata.some((w) => gn.includes(w));
      }) || null;
    }
    if (!cocok && nama && !nama.includes('@')) cocok = daftar.find((g) => String(g.nama || '').toLowerCase().includes(nama)) || null;
    if (cocok) { nip = cocok.nip || '-'; jabatan = cocok.jabatan || '-'; namaTampil = cocok.nama || namaTampil; }
    if (cocok && cocok.ttd_path) {
      try {
        const { data: u, error: eTtd } = await sb.storage.from('ttd-guru').createSignedUrl(cocok.ttd_path, 3600);
        if (!eTtd) ttdUrl = u.signedUrl;
      } catch { /* tanpa tanda tangan */ }
    }
  } catch { /* tetap tampil tanpa NIP */ }
  el.dataset.nip = nip; el.dataset.jabatan = jabatan; el.dataset.nama = namaTampil; el.dataset.ttd = ttdUrl;
  const tglTxt = jHariTgl(jTglVal());
  const tglTtd = tglID(new Date(jTglVal() + 'T00:00:00'));
  const set = (id, v) => { const n = document.getElementById(id); if (n) n.textContent = v; };
  set('j-id-nama', namaTampil); set('j-id-nip', nip); set('j-id-jabatan', jabatan);
  set('j-id-tanggal', tglTxt); set('j-id-ttd-tgl', tglTtd);
  set('j-id-ttd-nama', namaTampil); set('j-id-ttd-nip', nip);
  const ttdImg = document.getElementById('j-id-ttd-img');
  if (ttdImg) {
    if (ttdUrl && !jTtdManual()) { ttdImg.src = ttdUrl; ttdImg.style.display = 'block'; }
    else { if (ttdUrl) ttdImg.src = ttdUrl; ttdImg.style.display = 'none'; }
  }
}

const jTtdManual = () => {
  const c = document.getElementById('j-ttd-hide');
  return !!(c && c.checked);
};
function jTerapkanTtdManual() {
  const idn = $('#j-identitas');
  const ada = !!((idn && idn.dataset.ttd) || '');
  const img = document.getElementById('j-id-ttd-img');
  if (!img) return;
  if (ada && !jTtdManual()) {
    img.src = idn.dataset.ttd;
    img.style.display = 'block';
  } else {
    img.style.display = 'none';
  }
}

function renderJurnal() {
  const tb = $('#j-tabel-body');
  if (!tb) return;
  const tglTxt = jHariTgl(jTglVal());
  $('#j-jumlah').textContent = jurnalDaftar.length + '/3 kegiatan pada ' + tglTxt + ' (1 hari full 3 kegiatan)';
  const sel = 'style="border:1px solid #000;padding:6px;vertical-align:top"';
  if (!jurnalDaftar.length) {
    tb.innerHTML = `<tr><td colspan="6" ${sel} class="text-center text-ink/50" style="border:1px solid #000;padding:24px;text-align:center">Belum ada kegiatan. Klik "Tambah jurnal harian" untuk mengisi 3 kegiatan sekaligus.</td></tr>`;
    return;
  }
  tb.innerHTML = jurnalDaftar.map((j, i) => `
    <tr>
      <td ${sel} class="text-center tabular-nums">${i + 1}.</td>
      <td ${sel} class="whitespace-nowrap">${esc(j.waktu || '-')}</td>
      <td ${sel} class="whitespace-pre-wrap">${esc(j.kegiatan)}</td>
      <td ${sel} class="text-center">
        ${j.bukti_path && jIsImg(j)
          ? `<button data-j="bukti" data-id="${j.id}" class="block mx-auto text-center">
               <img data-bukti-img="${j.id}" alt="Bukti ${i + 1}" crossorigin="anonymous" style="width:220px;height:165px;object-fit:cover;border:1px solid #000;display:block;margin:0 auto;background:#f3f4f6">
             </button>`
          : j.bukti_path
            ? `<button data-j="bukti" data-id="${j.id}" class="text-hijau font-semibold hover:underline">${esc(j.bukti_nama || 'Lihat bukti')}</button>`
            : '-'}
      </td>
      <td ${sel}>${esc(j.keterangan || '-')}</td>
      <td ${sel} data-j-aksi class="text-center whitespace-nowrap">
        <button data-j="edit" data-id="${j.id}" class="rounded-md border border-ink/20 px-2 py-0.5 text-[11px] font-semibold hover:bg-kertas bg-white">Edit</button>
        <button data-j="hapus" data-id="${j.id}" class="rounded-md border border-ink/20 px-2 py-0.5 text-[11px] font-semibold text-red-700 hover:bg-red-50 bg-white">Hapus</button>
      </td>
    </tr>`).join('');
  jurnalDaftar.forEach(async (j) => {
    if (!j.bukti_path || !jIsImg(j)) return;
    try {
      const url = await jSignedUrl(j.bukti_path, 3600);
      const img = tb.querySelector(`img[data-bukti-img="${j.id}"]`);
      if (img) {
        img.src = url;
        img.onerror = () => { img.style.display = 'none'; };
        img.onclick = (e) => { e.stopPropagation(); window.open(url, '_blank', 'noopener'); };
      }
    } catch { /* biarkan tanpa gambar */ }
  });
}

function blokKegiatan(i, item) {
  const it = item || {};
  return `
    <fieldset class="rounded-xl border border-ink/15 p-3" data-blok="${i}">
      <legend class="px-1 text-sm font-extrabold">Kegiatan ${i + 1}</legend>
      <div class="grid gap-2.5">
        <label class="block text-sm font-semibold">Waktu
          <input name="waktu_${i}" placeholder="cth: 07.00 - 08.00" value="${esc(it.waktu || '')}" class="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2 text-sm font-normal"></label>
        <label class="block text-sm font-semibold">Kegiatan
          <textarea name="kegiatan_${i}" rows="2" placeholder="Tulis kegiatan yang dilakukan" class="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2 text-sm font-normal">${esc(it.kegiatan || '')}</textarea></label>
        <label class="block text-sm font-semibold">Bukti dukung (foto JPG/PNG, maks 7 MB)
          <input name="bukti_file_${i}" type="file" accept=".jpg,.jpeg,.png" capture="environment" class="mt-1 w-full text-sm" title="Ambil foto langsung dari kamera (HP maupun laptop)"></label>
        <button type="button" class="rounded-lg border border-ink/20 text-sm font-semibold px-3 py-1.5 hover:bg-kertas"
          data-buka-kamera="${i}">📷 Ambil dari kamera</button>
      </div>
    </fieldset>`;
}

/* ---------- Kamera: ambil foto langsung dari webcam (desktop) ---------- */
let kameraAktif = null;   // { idx, stream, preview } — null bila kamera ditutup
let modalKamera = null;  // elemen modal kamera yang sedang dipakai

function hentikanKamera() {
  if (kameraAktif) {
    kameraAktif.stream.getTracks().forEach((t) => t.stop());
    kameraAktif = null;
  }
}

function tutupModalKamera() {
  hentikanKamera();
  if (modalKamera) { modalKamera.remove(); modalKamera = null; }
}

function bukaModalKamera() {
  if (!modalKamera) {
    const d = document.createElement('div');
    d.id = 'modal-kamera';
    d.className = 'fixed inset-0 z-[70] bg-black/60 p-3 sm:p-6 flex items-center justify-center';
    d.innerHTML = `
      <div class="bg-white rounded-xl w-full max-w-lg h-full max-h-[90vh] flex flex-col overflow-hidden">
        <div class="flex items-center justify-between px-4 py-2 border-b border-ink/10">
          <p class="mr-auto text-sm font-semibold">Ambil foto dari kamera</p>
          <button type="button" class="rounded-lg p-1.5 text-ink/60 hover:bg-ink/10" title="Tutup">×</button>
        </div>
        <div class="flex-1 grid place-items-center bg-kertas p-4 overflow-auto">
          <video id="kamera-view" muted playsinline class="max-h-[55vh] w-auto rounded-lg bg-black"></video>
          <div id="kamera-preview" class="hidden"></div>
        </div>
        <div class="flex flex-wrap items-center justify-end gap-2 px-4 py-3 border-t border-ink/10">
          <button type="button" class="rounded-lg border border-ink/20 px-4 py-2 text-xs font-semibold hover:bg-kertas">Batal</button>
          <button type="button" id="btn-ambil-foto" class="rounded-lg bg-hijau text-white px-4 py-2 text-xs font-bold hover:bg-ink">Ambil</button>
          <button type="button" id="btn-gunakan-foto" class="hidden rounded-lg bg-hijau px-4 py-2 text-xs font-bold hover:bg-ink">Gunakan</button>
          <button type="button" id="btn-ulangi-foto" class="hidden rounded-lg border border-ink/20 px-4 py-2 text-xs font-semibold hover:bg-kertas">Ulangi</button>
        </div>
      </div>`;
    document.body.appendChild(d);
    modalKamera = d;
    $('#btn-tutup-kamera').onclick = () => tutupModalKamera();
    $('#btn-batal-kamera').onclick = () => tutupModalKamera();
    $('#btn-ambil-foto').onclick = ambilFoto;
    $('#btn-gunakan-foto').onclick = pakaiFotoKamera;
    $('#btn-ulangi-foto').onclick = ulangiFotoKamera;
  }
  return modalKamera;
}

async function bukaKamera(idx) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    alert('Browser tidak mendukung pengambilan dari kamera. Buka mode HP, atau gunakan fitur pilih file.');
    return;
  }
  hentikanKamera();
  const d = bukaModalKamera();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    kameraAktif = { idx, stream };
    const video = document.getElementById('kamera-view');
    video.srcObject = stream;
    await video.play();
    tampilkanModeLive();
  } catch (e) {
    tutupModalKamera();
    alert('Tidak bisa membuka kamera: ' + (e.message || e));
  }
}

function tampilkanModeLive() {
  const preview = document.getElementById('kamera-preview');
  preview.classList.add('hidden');
  document.getElementById('kamera-view').classList.remove('hidden');
  document.getElementById('btn-ambil-foto').classList.remove('hidden');
  document.getElementById('btn-gunakan-foto').classList.add('hidden');
  document.getElementById('btn-ulangi-foto').classList.add('hidden');
}

async function ambilFoto() {
  const k = kameraAktif;
  if (!k) return;
  const video = document.getElementById('kamera-view');
  if (!video.videoWidth) return;
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
  if (!blob) return alert('Gagal menangkap foto.');
  kameraAktif.preview = new File([blob], 'foto-' + Date.now() + '.jpg', { type: 'image/jpeg' });
  tampilkanPreviewFoto();
}

function tampilkanPreviewFoto() {
  const k = kameraAktif;
  if (!k || !kameraAktif.preview) return;
  const preview = document.getElementById('kamera-preview');
  const img = document.createElement('img');
  img.src = URL.createObjectURL(kameraAktif.preview);
  preview.replaceChildren(img);
  preview.classList.remove('hidden');
  document.getElementById('kamera-view').classList.add('hidden');
  document.getElementById('btn-ambil-foto').classList.add('hidden');
  document.getElementById('btn-gunakan-foto').classList.remove('hidden');
  document.getElementById('btn-ulangi-foto').classList.remove('hidden');
}

function pakaiFotoKamera() {
  const k = kameraAktif;
  if (!k || !kameraAktif.preview) return;
  const input = document.querySelector('input[name="bukti_file_' + k.idx + '"]');
  if (!input) return;
  const dt = new DataTransfer();
  dt.items.add(kameraAktif.preview);
  input.files = dt.files;
  tutupModalKamera();
}

function ulangiFotoKamera() {
  const k = kameraAktif;
  if (!k) return;
  const preview = document.getElementById('kamera-preview');
  preview.classList.add('hidden');
  document.getElementById('btn-ambil-foto').classList.remove('hidden');
  document.getElementById('btn-gunakan-foto').classList.add('hidden');
  document.getElementById('btn-ulangi-foto').classList.add('hidden');
  bukaKamera(k.idx);
}

function bukaFormJurnal(item) {
  jurnalEditId = item ? item.id : null;
  const isi = $('#md-isi'), aksi = $('#md-actions');
  $('#md-sub').textContent = tglID(new Date(jTglVal() + 'T00:00:00'));
  if (item) {
    $('#md-nama').textContent = 'Edit kegiatan';
    isi.innerHTML = `<form id="j-form" class="grid gap-3">${blokKegiatan(0, item)}</form>`;
  } else {
    if (jurnalDaftar.length >= 3) return alert('Sudah 3 kegiatan pada tanggal ini (1 hari full). Edit atau hapus dulu untuk mengubah.');
    $('#md-nama').textContent = 'Tambah jurnal harian (3 kegiatan)';
    const kosong = 3 - jurnalDaftar.length;
    isi.innerHTML = `<form id="j-form" class="grid gap-3">
      <p class="text-xs text-ink/60">Isi ${kosong} kegiatan untuk ${tglID(new Date(jTglVal() + 'T00:00:00'))}. Blok yang kegiatannya kosong tidak disimpan.</p>
      ${[0, 1, 2].slice(0, kosong).map((k) => blokKegiatan(k, null)).join('')}
    </form>`;
  }
  aksi.innerHTML = `
    <button id="j-batal" class="rounded-lg border border-ink/20 px-4 py-2 text-xs font-semibold hover:bg-kertas">Batal</button>
    <button id="j-simpan" class="rounded-lg bg-hijau text-white px-5 py-2 text-xs font-bold hover:bg-ink">Simpan</button>`;
  $('#modal-mutasi-detail').classList.remove('hidden');
  $('#j-batal').onclick = () => $('#modal-mutasi-detail').classList.add('hidden');
  $('#j-simpan').onclick = simpanJurnal;
}

function validFoto(file) {
  if (!file || !file.size) return null;
  const okTipe = BUKTI_IMG.includes(file.type)
    || /\.(jpe?g|png)$/i.test(file.name || '');
  if (!okTipe) throw new Error('Bukti dukung hanya boleh foto JPG/PNG.');
  if (file.size > BUKTI_MAX) throw new Error('Foto maksimal 7 MB.');
  return file;
}

async function simpanJurnal() {
  const form = $('#j-form');
  if (!form || !form.reportValidity()) return;
  const fd = new FormData(form);
  const btn = $('#j-simpan');
  btn.disabled = true; btn.textContent = 'Menyimpan...';
  try {
    if (jurnalEditId) {
      const lama = jurnalDaftar.find((j) => String(j.id) === String(jurnalEditId)) || {};
      let bukti_path = lama.bukti_path || null, bukti_nama = lama.bukti_nama || null;
      const file = validFoto(fd.get('bukti_file_0'));
      if (file) {
        const path = session.user.id + '/' + Date.now() + '-' + file.name.replace(/[^\w.\-]+/g, '_');
        const { error } = await sb.storage.from(BUKTI_BUCKET).upload(path, file, { contentType: file.type });
        if (error) throw error;
        if (bukti_path) await sb.storage.from(BUKTI_BUCKET).remove([bukti_path]);
        bukti_path = path; bukti_nama = file.name;
      }
      const kegiatan = String(fd.get('kegiatan_0') || '').trim();
      if (!kegiatan) throw new Error('Kegiatan wajib diisi.');
      const row = {
        user_id: session.user.id,
        tanggal: jTglVal(),
        waktu: String(fd.get('waktu_0') || '').trim(),
        kegiatan,
        bukti_dukung: null,
        bukti_path, bukti_nama,
        keterangan: null,
        diperbarui: new Date().toISOString(),
      };
      const { error } = await sb.from('jurnal_harian').update(row).eq('id', jurnalEditId);
      if (error) throw error;
    } else {
      const rows = [];
      for (let i = 0; i < 3; i++) {
        if (fd.get('kegiatan_' + i) === null) continue;
        const kegiatan = String(fd.get('kegiatan_' + i) || '').trim();
        if (!kegiatan) continue;
        const file = validFoto(fd.get('bukti_file_' + i));
        let bukti_path = null, bukti_nama = null;
        if (file) {
          const path = session.user.id + '/' + Date.now() + '-' + i + '-' + file.name.replace(/[^\w.\-]+/g, '_');
          const { error } = await sb.storage.from(BUKTI_BUCKET).upload(path, file, { contentType: file.type });
          if (error) throw error;
          bukti_path = path; bukti_nama = file.name;
        }
        rows.push({
          user_id: session.user.id,
          tanggal: jTglVal(),
          waktu: String(fd.get('waktu_' + i) || '').trim(),
          kegiatan,
          bukti_dukung: null,
          bukti_path, bukti_nama,
          keterangan: null,
        });
      }
      if (!rows.length) throw new Error('Isi minimal 1 kegiatan.');
      if (jurnalDaftar.length + rows.length > 3) throw new Error('Maksimal 3 kegiatan per tanggal (1 hari full).');
      const { error } = await sb.from('jurnal_harian').insert(rows);
      if (error) throw error;
    }
    $('#modal-mutasi-detail').classList.add('hidden');
    muatJurnal();
  } catch (e) {
    alert('Gagal menyimpan jurnal: ' + (e.message || e));
    btn.disabled = false; btn.textContent = 'Simpan';
  }
}

async function aksiJurnal(aksi, id) {
  const item = jurnalDaftar.find((j) => String(j.id) === String(id));
  if (!item) return;
  if (aksi === 'edit') return bukaFormJurnal(item);
  if (aksi === 'hapus') {
    if (!confirm('Hapus kegiatan ini?')) return;
    const { error } = await sb.from('jurnal_harian').delete().eq('id', item.id);
    if (error) return alert('Gagal menghapus: ' + error.message);
    if (item.bukti_path) await sb.storage.from(BUKTI_BUCKET).remove([item.bukti_path]);
    return muatJurnal();
  }
  if (aksi === 'bukti' && item.bukti_path) {
    try {
      const url = await jSignedUrl(item.bukti_path, 300);
      window.open(url, '_blank', 'noopener');
    } catch (e) { alert('Gagal membuka bukti: ' + (e.message || e)); }
  }
}

/* ---------- Cetak: dokumen bersih tanpa kolom Aksi ---------- */
async function cetakJurnal() {
  if (!jurnalDaftar.length) return alert('Belum ada kegiatan pada tanggal ini.');
  const idn = $('#j-identitas');
  const nip = (idn && idn.dataset.nip) || '-';
  const jabatan = (idn && idn.dataset.jabatan) || '-';
  const namaCetak = (idn && idn.dataset.nama) || jNamaSaya();
  const ttdCetak = (!jTtdManual() && idn && idn.dataset.ttd) || '';
  const tgl = jHariTgl(jTglVal());
  const tglTtd = tglID(new Date(jTglVal() + 'T00:00:00'));
  const foto = {};
  await Promise.all(jurnalDaftar.map(async (j) => {
    if (j.bukti_path && jIsImg(j)) {
      try { foto[j.id] = await jSignedUrl(j.bukti_path, 3600); } catch { /* tanpa foto */ }
    }
  }));
  const baris = jurnalDaftar.map((j, i) => `
    <tr>
      <td style="border:1px solid #000;padding:6px;text-align:center;vertical-align:top">${i + 1}.</td>
      <td style="border:1px solid #000;padding:6px;vertical-align:top;white-space:nowrap">${esc(j.waktu || '')}</td>
      <td style="border:1px solid #000;padding:6px;vertical-align:top">${esc(j.kegiatan).replace(/\n/g, '<br>')}</td>
      <td style="border:1px solid #000;padding:8px;vertical-align:top;text-align:center">${foto[j.id]
        ? `<img src="${foto[j.id]}" crossorigin="anonymous" style="width:240px;max-width:100%;height:auto;display:block;margin:0 auto;border:1px solid #000">`
        : esc(j.bukti_nama || '')}</td>
      <td style="border:1px solid #000;padding:6px;vertical-align:top">${esc(j.keterangan || '')}</td>
    </tr>`).join('');
  const kopBaris = (label, nilai) => `<tr><td style="white-space:nowrap;vertical-align:top;width:130px">${label}</td><td style="padding:0 6px;vertical-align:top;width:12px">:</td><td style="vertical-align:top">${nilai}</td></tr>`;
  const html = `<html><head><title>Jurnal Kerja Harian - ${esc(namaCetak)}</title><style>
    body{font-family:'Times New Roman',serif;color:#000;margin:24px}
    table{border-collapse:collapse;width:100%}
    @page{size:215mm 330mm;margin:12mm}</style></head><body>
    <h3 style="text-align:center;margin:0 0 12px">JURNAL KERJA HARIAN</h3>
    <table style="margin-bottom:0"><tr>
      <td style="border:1px solid #000;padding:8px;width:70%;font-size:11pt;line-height:1.6">
        <table style="border-collapse:collapse;width:100%;font-size:11pt;line-height:1.6">
          ${kopBaris('Nama Pegawai', esc(namaCetak))}
          ${kopBaris('NIP', esc(nip))}
          ${kopBaris('Jabatan', esc(jabatan))}
          ${kopBaris('Unit Kerja', 'SDN Sukamahi 03')}
          ${kopBaris('Hari/Tanggal', esc(tgl))}
        </table>
      </td><td style="border:1px solid #000;padding:8px;width:30%"></td>
    </tr></table>
    <table style="margin-top:-1px"><thead><tr style="background:#8fd18f">
      <th style="border:1px solid #000;padding:6px;width:36px">No</th>
      <th style="border:1px solid #000;padding:6px;width:90px">Waktu</th>
      <th style="border:1px solid #000;padding:6px">Kegiatan</th>
      <th style="border:1px solid #000;padding:6px;width:260px">Bukti Dukung</th>
      <th style="border:1px solid #000;padding:6px;width:70px">Ket</th>
    </tr></thead><tbody>${baris}</tbody></table>
    <div style="display:flex;justify-content:flex-end;margin-top:24px;font-size:11pt">
      <div style="text-align:left">Cikarang Pusat, ${esc(tglTtd)}<br>Dibuat oleh:<br>
      <div style="width:140px;height:78px;margin:4px 0;display:flex;align-items:flex-end">${ttdCetak ? `<img src="${ttdCetak}" crossorigin="anonymous" style="width:140px;max-height:70px;display:block">` : ''}</div>
      ${esc(namaCetak)}<br>NIP. ${esc(nip)}</div>
    </div>
    </body></html>`;
  const w = window.open('', '_blank');
  if (!w) {
    const f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    document.body.appendChild(f);
    const doc = f.contentDocument || f.contentWindow.document;
    doc.open(); doc.write(html); doc.close();
    const cetak = () => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch { /* abaikan */ } };
    if (doc.readyState === 'complete') cetak();
    else f.onload = cetak;
    setTimeout(() => f.remove(), 60000);
    return;
  }
  w.document.write(html);
  w.document.close();
  w.onload = () => { try { w.focus(); w.print(); } catch { /* abaikan */ } };
}

/* ---------- Unduh: snapshot laporan persis tampilan menu (F4) ---------- */
function jNamaFile(ekstensi) {
  const idn = $('#j-identitas');
  const nama = ((idn && idn.dataset.nama) || jNamaSaya() || 'jurnal').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-');
  return `jurnal-harian-${nama}-${jTglVal()}.${ekstensi}`;
}
function jSiapkanKlonCetak() {
  const lap = $('#j-laporan');
  const klon = lap.cloneNode(true);
  klon.querySelectorAll('[data-j-aksi]').forEach((el) => el.remove());
  klon.querySelectorAll('button').forEach((b) => {
    const span = document.createElement('span');
    span.innerHTML = b.innerHTML;
    b.replaceWith(span);
  });
  klon.style.cssText = 'position:fixed;left:-9999px;top:0;width:794px;background:#fff;padding:24px 24px 72px;font-family:"Times New Roman",serif;color:#000';
  klon.querySelectorAll('.overflow-x-auto').forEach((el) => { el.style.overflow = 'visible'; });
  const ttd = klon.querySelector('.flex.justify-end');
  if (ttd) ttd.style.cssText = 'display:flex;justify-content:flex-end;margin-top:24px;margin-bottom:24px;padding-bottom:24px;break-inside:avoid;page-break-inside:avoid';
  document.body.appendChild(klon);
  return klon;
}
async function jTungguGambarKlon(klon) {
  const daftar = Array.from(klon.querySelectorAll('img'));
  await Promise.all(daftar.map((img) => {
    if (img.complete && img.naturalWidth) return Promise.resolve();
    return new Promise((selesai) => {
      img.onload = () => selesai();
      img.onerror = () => selesai();
      setTimeout(selesai, 3000);
    });
  }));
}
async function unduhJurnalPNG() {
  if (!jurnalDaftar.length) return alert('Belum ada kegiatan pada tanggal ini.');
  if (typeof html2canvas === 'undefined') return alert('Pustaka gambar belum termuat. Periksa koneksi lalu muat ulang halaman.');
  const klon = jSiapkanKlonCetak();
  try {
    await jTungguGambarKlon(klon);
    await new Promise((r) => setTimeout(r, 150));
    const canvas = await html2canvas(klon, { scale: 2, useCORS: true, backgroundColor: '#ffffff', logging: false, scrollX: 0, scrollY: 0, width: klon.scrollWidth, height: klon.scrollHeight, windowWidth: klon.scrollWidth, windowHeight: klon.scrollHeight });
    const a = document.createElement('a');
    a.download = jNamaFile('png');
    a.href = canvas.toDataURL('image/png');
    a.click();
  } catch (e) {
    alert('Gagal mengunduh PNG: ' + (e.message || e));
  } finally {
    klon.remove();
  }
}
async function unduhJurnalPDF() {
  if (!jurnalDaftar.length) return alert('Belum ada kegiatan pada tanggal ini.');
  if (typeof html2canvas === 'undefined') return alert('Pustaka gambar belum termuat. Periksa koneksi lalu muat ulang halaman.');
  const jspdfLib = window.jspdf && window.jspdf.jsPDF;
  if (!jspdfLib) return alert('Pustaka PDF belum termuat. Periksa koneksi lalu muat ulang halaman.');
  const klon = jSiapkanKlonCetak();
  try {
    await jTungguGambarKlon(klon);
    await new Promise((r) => setTimeout(r, 150));
    const canvas = await html2canvas(klon, { scale: 2, useCORS: true, backgroundColor: '#ffffff', logging: false, scrollX: 0, scrollY: 0, width: klon.scrollWidth, height: klon.scrollHeight, windowWidth: klon.scrollWidth, windowHeight: klon.scrollHeight });
    const img = canvas.toDataURL('image/jpeg', 0.95);
    const pdf = new jspdfLib({ unit: 'mm', format: [215, 330], orientation: 'portrait' });
    const margin = 10, lebar = 215 - margin * 2, tinggi = (canvas.height * lebar) / canvas.width;
    let sisa = tinggi, y = 0, halaman = 0;
    while (sisa > 0) {
      if (halaman > 0) pdf.addPage([215, 330], 'portrait');
      pdf.addImage(img, 'JPEG', margin, margin - y, lebar, tinggi);
      sisa -= 330; y += 330; halaman += 1;
      if (halaman > 5) break;
    }
    pdf.save(jNamaFile('pdf'));
  } catch (e) {
    alert('Gagal mengunduh PDF: ' + (e.message || e));
  } finally {
    klon.remove();
  }
}

$('#j-tanggal').onchange = muatJurnal;
$('#j-ttd-hide').onchange = jTerapkanTtdManual;
$('#j-pemilik').onchange = (e) => { jurnalUserId = e.target.value || null; muatJurnal(); };
$('#j-tambah').onclick = () => bukaFormJurnal(null);
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-buka-kamera]');
  if (b) bukaKamera(Number(b.dataset.bukaKamera));
});
const jAksiBtn = $('#j-aksi'), jAksiMenu = $('#j-aksi-menu');
if (jAksiBtn && jAksiMenu) {
  jAksiBtn.onclick = (e) => { e.stopPropagation(); jAksiMenu.classList.toggle('hidden'); };
  document.addEventListener('click', (e) => { if (!jAksiMenu.classList.contains('hidden') && !e.target.closest('#j-aksi-menu') && !e.target.closest('#j-aksi')) jAksiMenu.classList.add('hidden'); });
  [$('#j-cetak'), $('#j-unduh-pdf'), $('#j-unduh-png')].forEach((b) => { if (b) b.addEventListener('click', () => jAksiMenu.classList.add('hidden')); });
}
$('#j-cetak').onclick = cetakJurnal;
$('#j-unduh-pdf').onclick = unduhJurnalPDF;
$('#j-unduh-png').onclick = unduhJurnalPNG;
$('#j-tabel-body').onclick = (e) => {
  const b = e.target.closest('[data-j]');
  if (b) aksiJurnal(b.dataset.j, b.dataset.id);
};
addEventListener('hashchange', () => { if (location.hash === '#jurnal') muatJurnal(); });
sb.auth.getSession().then(({ data }) => { if (data.session && location.hash === '#jurnal') muatJurnal(); });
