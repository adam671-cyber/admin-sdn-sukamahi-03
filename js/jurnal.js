/* Jurnal kerja harian: 1 tanggal = 3 kegiatan + foto JPG/PNG + cetak bergambar */
const BUKTI_BUCKET = 'bukti-jurnal';
const BUKTI_MAX = 7 * 1048576;
const BUKTI_IMG = ['image/jpeg', 'image/png'];
let jurnalDaftar = [], jurnalEditId = null, jurnalUserId = null;
const jUrlCache = new Map();
let jBuktiViewer = null;

const jIsImg = (j) => {
  const n = String(j.bukti_nama || j.bukti_path || '').toLowerCase();
  return n.endsWith('.jpg') || n.endsWith('.jpeg') || n.endsWith('.png');
};

/* ---------- Kompresi gambar: hemat storage, hasil tetap jelas ---------- */
const J_BUKTI_MAX_BYTES = 300 * 1024; // ±300 KB per foto bukti
async function jMuatGambarSumber(file) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file); } catch { /* lanjut ke fallback */ }
  }
  return await new Promise((selesai, gagal) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); selesai(img); };
    img.onerror = () => { URL.revokeObjectURL(url); gagal(new Error('Gagal membaca gambar.')); };
    img.src = url;
  });
}
function jSkalaKanvas(sumber, lebar, tinggi) {
  const kanvas = document.createElement('canvas');
  kanvas.width = Math.max(1, Math.round(lebar));
  kanvas.height = Math.max(1, Math.round(tinggi));
  const ctx = kanvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, kanvas.width, kanvas.height);
  ctx.drawImage(sumber, 0, 0, kanvas.width, kanvas.height);
  return kanvas;
}
function jKanvasDiBawah(sumber, maxDim) {
  const w = sumber.width, h = sumber.height;
  const rasio = Math.min(1, maxDim / Math.max(w, h));
  return jSkalaKanvas(sumber, w * rasio, h * rasio);
}
const jKanvasKeJpeg = (kanvas, kualitas) => new Promise((selesai) => kanvas.toBlob(selesai, 'image/jpeg', kualitas));
/* Turunkan kualitas JPEG bertahap + perkecil dimensi sampai di bawah batas ukuran. */
async function jKanvasKeBlobMaks(kanvas, maxBytes, kualitasAwal = 0.9) {
  let k = kanvas;
  let blob = await jKanvasKeJpeg(k, kualitasAwal);
  for (let putaran = 0; blob && blob.size > maxBytes && putaran < 8; putaran++) {
    let kualitas = kualitasAwal;
    while (kualitas > 0.45) {
      kualitas = Math.round((kualitas - 0.08) * 100) / 100;
      blob = await jKanvasKeJpeg(k, kualitas);
      if (blob && blob.size <= maxBytes) return blob;
    }
    const faktor = Math.max(0.5, Math.sqrt(maxBytes / blob.size) * 0.9);
    k = jSkalaKanvas(k, k.width * faktor, k.height * faktor);
    blob = await jKanvasKeJpeg(k, 0.82);
  }
  return blob;
}
/* Pilih-file / kamera: perkecil sisi terpanjang lalu encode JPEG hemat ukuran. */
async function jKompresFileFoto(file, { maxDim = 1600, maxBytes = 300 * 1024 } = {}) {
  if (!file) return null;
  const sumber = await jMuatGambarSumber(file);
  const kanvas = jKanvasDiBawah(sumber, maxDim);
  const blob = await jKanvasKeBlobMaks(kanvas, maxBytes);
  if (!blob) return file;
  const nama = String(file.name || 'foto').replace(/\.[^.]+$/, '') + '.jpg';
  return new File([blob], nama, { type: 'image/jpeg', lastModified: Date.now() });
}

/* ---------- Unduhan PDF/JPG: target di bawah 400 KB ---------- */
const J_UNDUH_MAX_BYTES = 400 * 1024;
const jSkalaKanvasDariElemen = (el, skala) => html2canvas(el, {
  scale: skala, useCORS: true, backgroundColor: '#ffffff', logging: false,
  scrollX: 0, scrollY: 0, width: el.scrollWidth, height: el.scrollHeight,
  windowWidth: el.scrollWidth, windowHeight: el.scrollHeight,
});
const jBlobKeDataUrl = (blob) => new Promise((selesai) => {
  const fr = new FileReader();
  fr.onload = () => selesai(fr.result);
  fr.readAsDataURL(blob);
});
async function jSignedUrl(path, detik) {
  const kunci = path + '|' + (detik || 3600);
  if (jUrlCache.has(kunci)) return jUrlCache.get(kunci);
  const { data, error } = await sb.storage.from(BUKTI_BUCKET).createSignedUrl(path, detik || 3600);
  if (error) throw error;
  jUrlCache.set(kunci, data.signedUrl);
  return data.signedUrl;
}
/* Versi ringan (transformasi Supabase) agar thumbnail tidak mengunduh foto asli penuh */
function jThumbUrl(url, lebar = 720, mutu = 70) {
  if (typeof url !== 'string') return url;
  if (url.includes('/object/sign/')) return url.replace('/object/sign/', '/render/image/sign/') + '&width=' + lebar + '&quality=' + mutu;
  if (url.includes('/object/public/')) return url.replace('/object/public/', '/render/image/public/') + '?width=' + lebar + '&quality=' + mutu;
  return url;
}
function jTampilkanBukti(url) {
  if (!jBuktiViewer) {
    const viewer = document.createElement('div');
    viewer.id = 'j-bukti-viewer';
    viewer.className = 'fixed inset-0 z-[100] bg-black/80 p-3 items-center justify-center';
    viewer.style.display = 'none';
    viewer.innerHTML = `<div class="flex max-h-full w-full max-w-5xl flex-col items-end gap-2">
      <button type="button" data-tutup-bukti class="rounded-full bg-white px-3 py-1 text-lg font-bold text-ink" aria-label="Tutup foto">×</button>
      <img alt="Bukti dukung ukuran penuh" style="display:block;max-width:100%;max-height:calc(95vh - 56px);object-fit:contain;border-radius:0.75rem;background:#111">
    </div>`;
    viewer.onclick = (event) => {
      if (event.target === viewer || event.target.closest('[data-tutup-bukti]')) {
        viewer.style.display = 'none';
        viewer.querySelector('img').removeAttribute('src');
      }
    };
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && viewer.style.display !== 'none') {
        viewer.style.display = 'none';
        viewer.querySelector('img').removeAttribute('src');
      }
    });
    document.body.appendChild(viewer);
    jBuktiViewer = viewer;
  }
  jBuktiViewer.querySelector('img').src = url;
  jBuktiViewer.style.display = 'flex';
}
async function jAlamatDariLokasi(lokasi) {
  const { data, error } = await sb.functions.invoke('geocode-maps', {
    body: { lat: lokasi.latitude, lon: lokasi.longitude },
  });
  if (error) {
    let pesan = error.message || 'Gagal menghubungi layanan alamat.';
    if (error.context instanceof Response) {
      const response = error.context.clone();
      try {
        const detail = await response.json();
        if (detail && typeof detail.error === 'string') pesan = detail.error;
      } catch {
        pesan += ' (HTTP ' + response.status + ')';
      }
    }
    throw new Error(pesan);
  }
  if (data && data.error) throw new Error(data.error);
  if (!data || typeof data.address !== 'string' || !data.address.trim()) {
    throw new Error('Alamat tidak ditemukan untuk koordinat ini.');
  }
  return data.address.trim();
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
  const selKeg = 'style="border:1px solid #000;padding:6px;vertical-align:top;text-align:justify"';
  if (!jurnalDaftar.length) {
    tb.innerHTML = `<tr><td colspan="6" ${sel} class="text-center text-ink/50" style="border:1px solid #000;padding:24px;text-align:center">Belum ada kegiatan. Klik "Tambah jurnal harian" untuk mengisi 3 kegiatan sekaligus.</td></tr>`;
    return;
  }
  tb.innerHTML = jurnalDaftar.map((j, i) => `
    <tr>
      <td ${sel} class="text-center tabular-nums">${i + 1}.</td>
      <td ${sel} class="whitespace-nowrap">${esc(j.waktu || '-')}</td>
      <td ${selKeg} class="whitespace-pre-wrap">${esc(j.kegiatan)}</td>
      <td ${sel} class="text-center">
        ${j.bukti_path && jIsImg(j)
          ? `<button data-j="bukti" data-id="${j.id}" class="block mx-auto text-center">
               <img data-bukti-img="${j.id}" alt="Bukti ${i + 1}" loading="lazy" decoding="async" crossorigin="anonymous" style="width:100%;max-width:240px;max-height:320px;height:auto;object-fit:contain;border:1px solid #000;display:block;margin:0 auto;background:#f3f4f6">
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
        img.src = jThumbUrl(url);
        img.onerror = () => { img.style.display = 'none'; };
        img.onclick = (e) => { e.stopPropagation(); jTampilkanBukti(url); };
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
          <textarea name="kegiatan_${i}" rows="7" placeholder="Tulis kegiatan yang dilakukan" style="text-align:justify;min-height:11rem" class="mt-1 h-44 w-full resize-y rounded-lg border border-ink/20 px-3 py-2 text-sm font-normal leading-relaxed">${esc(it.kegiatan || '')}</textarea></label>
        <div>
          <p class="text-sm font-semibold">Bukti dukung <span class="font-normal text-ink/60">(JPG/PNG, otomatis dikompres)</span></p>
          <input name="bukti_file_${i}" id="bukti_file_${i}" type="file" accept=".jpg,.jpeg,.png" class="hidden">
          <div class="mt-1 flex items-stretch gap-2">
            <button type="button" data-pilih-file="${i}"
              class="flex-1 rounded-lg border border-sky-300 bg-gradient-to-b from-sky-200 to-white px-3 py-2 text-xs font-bold text-sky-900 shadow-sm transition hover:from-sky-300 hover:to-sky-50 active:scale-[.98]">
              Pilih File
            </button>
            <button type="button" data-buka-kamera="${i}"
              class="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-emerald-300 bg-gradient-to-b from-emerald-200 to-white px-3 py-2 text-xs font-bold text-emerald-900 shadow-sm transition hover:from-emerald-300 hover:to-emerald-50 active:scale-[.98]">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="size-4 shrink-0">
                <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
                <circle cx="12" cy="13" r="3.5" />
              </svg>
              Ambil dari Kamera
            </button>
          </div>
          <div class="mt-2 hidden items-center gap-2 rounded-lg border border-ink/15 bg-kertas/50 p-2"
            data-bukti-preview="${i}" data-existing="${esc(it.bukti_nama || '')}">
            <img alt="Pratinjau bukti dukung" class="size-14 shrink-0 rounded-md border border-ink/15 bg-white object-cover">
            <div class="min-w-0 flex-1">
              <p class="truncate text-xs font-semibold" data-bukti-nama="${i}"></p>
              <p class="text-[11px] text-ink/60" data-bukti-ukuran="${i}"></p>
            </div>
            <button type="button" data-hapus-bukti="${i}"
              class="hidden shrink-0 rounded-md border border-ink/20 px-2 py-1 text-[11px] font-semibold text-red-700 hover:bg-red-50">Hapus</button>
          </div>
        </div>
      </div>
    </fieldset>`;
}

/* ---------- Kamera: ambil foto langsung dari webcam (desktop) ---------- */
let kameraAktif = null;   // { idx, stream, preview } — null bila kamera ditutup
let modalKamera = null;  // elemen modal kamera yang sedang dipakai

function hentikanKamera() {
  if (kameraAktif) {
    if (kameraAktif.stream) kameraAktif.stream.getTracks().forEach((t) => t.stop());
    kameraAktif = null;
  }
}

function tutupModalKamera() {
  hentikanKamera();
  if (modalKamera) { modalKamera.remove(); modalKamera = null; }
}

function jAmbilLokasi() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Browser tidak mendukung lokasi GPS.'));
      return;
    }
    let terbaik = null;
    let watchId = null;
    let selesai = false;
    const batasAkurasi = 100;
    const pesanAkurasiRendah = () => `Lokasi GPS terlalu tidak akurat (±${Math.round(terbaik.coords.accuracy).toLocaleString('id-ID')} m). Aktifkan Lokasi Presisi atau gunakan ponsel di area terbuka.`;
    const timer = setTimeout(() => {
      if (terbaik && terbaik.coords.accuracy <= batasAkurasi) selesaikan(terbaik);
      else if (terbaik) gagal(new Error(pesanAkurasiRendah()));
      else gagal(new Error('Waktu mencari lokasi habis.'));
    }, 20000);
    const bersihkan = () => {
      clearTimeout(timer);
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    };
    const selesaikan = (pos) => {
      if (selesai) return;
      selesai = true;
      bersihkan();
      resolve({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      });
    };
    const gagal = (error) => {
      if (selesai) return;
      selesai = true;
      bersihkan();
      const pesan = error instanceof Error ? error.message
        : error.code === 1 ? 'Izin lokasi ditolak.'
          : error.code === 2 ? 'Lokasi GPS tidak tersedia.'
            : 'Waktu mencari lokasi habis.';
      reject(new Error(pesan));
    };
    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        if (!terbaik || pos.coords.accuracy < terbaik.coords.accuracy) terbaik = pos;
        if (pos.coords.accuracy <= 50) selesaikan(pos);
      },
      (error) => {
        if (terbaik && terbaik.coords.accuracy <= batasAkurasi) selesaikan(terbaik);
        else if (terbaik) gagal(new Error(pesanAkurasiRendah()));
        else gagal(error);
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 25000 }
    );
  });
}

function jSetStatusKamera(pesan, status = 'info') {
  const el = document.getElementById('kamera-status');
  if (!el) return;
  el.textContent = pesan;
  el.classList.remove('text-ink/70', 'text-hijau', 'text-red-700');
  el.classList.add(status === 'success' ? 'text-hijau' : status === 'error' ? 'text-red-700' : 'text-ink/70');
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
          <button type="button" id="btn-tutup-kamera" class="rounded-lg p-1.5 text-ink/60 hover:bg-ink/10" title="Tutup">×</button>
        </div>
        <div class="flex-1 flex flex-col items-center justify-center gap-3 bg-kertas p-4 overflow-auto">
          <video id="kamera-view" muted playsinline class="max-h-[55vh] max-w-full w-auto rounded-lg bg-black"></video>
          <div id="kamera-preview" class="hidden"></div>
          <p class="text-center text-[11px] text-ink/60">Koordinat GPS dikirim ke Geocode Maps untuk mencari alamat. Nama jalan ditampilkan jika tersedia pada data peta.</p>
          <p id="kamera-status" class="whitespace-pre-line text-center text-xs text-ink/70" role="status" aria-live="polite">Menyiapkan kamera dan lokasi...</p>
        </div>
        <div id="kamera-kontrol-live" class="flex items-center gap-2 border-t border-ink/10 px-4 py-3">
          <div class="flex flex-1 justify-start">
            <button type="button" id="btn-ganti-kamera" class="hidden rounded-lg border border-ink/20 px-3 py-2 text-xs font-semibold hover:bg-kertas">Ganti kamera</button>
          </div>
          <button type="button" id="btn-ambil-foto" disabled title="Ambil foto" aria-label="Ambil foto"
            class="flex size-16 shrink-0 items-center justify-center rounded-full bg-hijau text-white shadow-lg ring-4 ring-hijau/25 transition hover:bg-emerald-700 active:scale-95 disabled:opacity-50 disabled:shadow-none">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="size-7">
              <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
              <circle cx="12" cy="13" r="3.5" />
            </svg>
          </button>
          <div class="flex flex-1 justify-end">
            <button type="button" id="btn-batal-kamera" class="rounded-lg border border-ink/20 px-3 py-2 text-xs font-semibold hover:bg-kertas">Batal</button>
          </div>
        </div>
        <div id="kamera-kontrol-preview" class="hidden items-center justify-center gap-2 border-t border-ink/10 px-4 py-3">
          <button type="button" id="btn-batal-kamera-2" class="rounded-lg border border-ink/20 px-3 py-2 text-xs font-semibold hover:bg-kertas">Batal</button>
          <button type="button" id="btn-gunakan-foto"
            class="rounded-lg bg-hijau px-6 py-3 text-sm font-bold text-white shadow-md transition hover:bg-emerald-700 active:scale-95">Gunakan</button>
          <button type="button" id="btn-ulangi-foto" class="rounded-lg border border-ink/20 px-3 py-2 text-xs font-semibold hover:bg-kertas">Ulangi</button>
        </div>
      </div>`;
    document.body.appendChild(d);
    modalKamera = d;
    $('#btn-tutup-kamera').onclick = () => tutupModalKamera();
    $('#btn-batal-kamera').onclick = () => tutupModalKamera();
    $('#btn-batal-kamera-2').onclick = () => tutupModalKamera();
    $('#btn-ganti-kamera').onclick = gantiKamera;
    $('#btn-ambil-foto').onclick = ambilFoto;
    $('#btn-gunakan-foto').onclick = pakaiFotoKamera;
    $('#btn-ulangi-foto').onclick = ulangiFotoKamera;
  }
  return modalKamera;
}

async function jPasangStreamKamera(k, facingMode) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: facingMode } },
    audio: false,
  });
  if (kameraAktif !== k) {
    stream.getTracks().forEach((t) => t.stop());
    return false;
  }
  const video = document.getElementById('kamera-view');
  if (!video) {
    stream.getTracks().forEach((t) => t.stop());
    return false;
  }
  k.stream = stream;
  k.facingMode = facingMode;
  video.srcObject = stream;
  await video.play();
  tampilkanModeLive();
  return true;
}

async function gantiKamera() {
  const k = kameraAktif;
  if (!k || k.menggantiKamera) return;
  const tombol = document.getElementById('btn-ganti-kamera');
  const modeLama = k.facingMode || 'environment';
  const modeBaru = modeLama === 'environment' ? 'user' : 'environment';
  k.menggantiKamera = true;
  if (tombol) tombol.disabled = true;
  if (k.stream) k.stream.getTracks().forEach((t) => t.stop());
  k.stream = null;
  const video = document.getElementById('kamera-view');
  if (video) video.srcObject = null;
  try {
    await jPasangStreamKamera(k, modeBaru);
  } catch (error) {
    if (k.stream) k.stream.getTracks().forEach((t) => t.stop());
    k.stream = null;
    try {
      await jPasangStreamKamera(k, modeLama);
    } catch (restoreError) {
      jSetStatusKamera('Gagal mengganti kamera: ' + (restoreError.message || restoreError), 'error');
      return;
    }
    jSetStatusKamera('Kamera lain tidak dapat dibuka: ' + (error.message || error), 'error');
  } finally {
    if (kameraAktif === k) {
      k.menggantiKamera = false;
      if (tombol) tombol.disabled = false;
    }
  }
}

async function bukaKamera(idx) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    alert('Browser tidak mendukung pengambilan dari kamera. Buka mode HP, atau gunakan fitur pilih file.');
    return;
  }
  hentikanKamera();
  bukaModalKamera();
  const dibukaPada = new Date();
  const lokasiPromise = jAmbilLokasi()
    .then((lokasi) => {
      if (kameraAktif && kameraAktif.dibukaPada === dibukaPada) {
        kameraAktif.lokasi = lokasi;
        jSetStatusKamera(`GPS siap (akurasi ±${Math.round(lokasi.accuracy)} m); mencari alamat melalui Geocode Maps...`);
        $('#btn-ambil-foto').disabled = false;
      }
      return lokasi;
    })
    .catch((error) => {
      if (kameraAktif && kameraAktif.dibukaPada === dibukaPada) {
        kameraAktif.lokasi = null;
        jSetStatusKamera(`${error.message}\nFoto tetap dapat diambil; watermark mencantumkan lokasi tidak tersedia.`, 'error');
        $('#btn-ambil-foto').disabled = false;
      }
      return null;
    });
  const alamatPromise = lokasiPromise.then(async (lokasi) => {
    if (!lokasi) return null;
    const koordinat = `${lokasi.latitude.toFixed(6)}, ${lokasi.longitude.toFixed(6)} · akurasi ±${Math.round(lokasi.accuracy)} m`;
    try {
      const alamat = await jAlamatDariLokasi(lokasi);
      if (kameraAktif && kameraAktif.dibukaPada === dibukaPada) {
        kameraAktif.alamat = alamat;
        jSetStatusKamera(`Alamat terdekat: ${alamat}\nGPS: ${koordinat}`, 'success');
      }
      return alamat;
    } catch (error) {
      if (kameraAktif && kameraAktif.dibukaPada === dibukaPada) {
        kameraAktif.alamatError = error.message || String(error);
        jSetStatusKamera(`Alamat tidak tersedia: ${kameraAktif.alamatError}\nGPS: ${koordinat}\nFoto tetap dapat diambil.`, 'error');
      }
      return null;
    }
  });
  kameraAktif = { idx, stream: null, facingMode: 'environment', dibukaPada, lokasi: null, alamat: null, alamatError: null, lokasiPromise, alamatPromise };
  try {
    await jPasangStreamKamera(kameraAktif, kameraAktif.facingMode);
  } catch (e) {
    tutupModalKamera();
    alert('Tidak bisa membuka kamera: ' + (e.message || e));
  }
}

function tampilkanModeLive() {
  const preview = document.getElementById('kamera-preview');
  preview.classList.add('hidden');
  document.getElementById('kamera-view').classList.remove('hidden');
  document.getElementById('btn-ganti-kamera').classList.remove('hidden');
  document.getElementById('kamera-kontrol-live').classList.remove('hidden');
  document.getElementById('kamera-kontrol-preview').classList.add('hidden');
  document.getElementById('kamera-kontrol-preview').classList.remove('flex');
}

async function ambilFoto() {
  const k = kameraAktif;
  if (!k) return;
  const video = document.getElementById('kamera-view');
  if (!video.videoWidth) {
    jSetStatusKamera('Kamera belum siap. Tunggu sebentar lalu coba lagi.', 'error');
    return;
  }
  const lokasi = await k.lokasiPromise;
  const alamat = await k.alamatPromise;
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0);
  const waktuFoto = new Date();
  const tanggal = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta', day: 'numeric', month: 'long', year: 'numeric',
  }).format(waktuFoto);
  const hari = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta', weekday: 'long',
  }).format(waktuFoto);
  const jam = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(waktuFoto);
  const padding = Math.max(8, Math.round(canvas.width * 0.018));
  const ukuranJam = Math.max(20, Math.min(72, Math.round(canvas.width * 0.085)));
  const ukuranTeks = Math.max(12, Math.min(26, Math.round(canvas.width * 0.028)));
  const ukuranZona = Math.max(10, Math.round(ukuranTeks * 0.78));
  const jarak = Math.round(ukuranTeks * 1.3);
  const lebarPanel = Math.round(canvas.width * 0.78);
  const panelX = Math.round(canvas.width * 0.015);
  const lebarTeks = lebarPanel - padding * 2;
  const bungkusTeks = (teks, lebarMaks, batasBaris) => {
    const baris = [];
    let bagian = '';
    let terpotong = false;
    teks.split(/\s+/).forEach((kata) => {
      if (terpotong) return;
      const calon = bagian ? bagian + ' ' + kata : kata;
      if (bagian && ctx.measureText(calon).width > lebarMaks) {
        baris.push(bagian);
        bagian = kata;
        if (baris.length === batasBaris) terpotong = true;
      } else {
        bagian = calon;
      }
    });
    if (!terpotong && bagian) baris.push(bagian);
    if (terpotong && baris.length) {
      let terakhir = baris[baris.length - 1];
      while (terakhir && ctx.measureText(terakhir + '…').width > lebarMaks) {
        terakhir = terakhir.slice(0, -1);
      }
      baris[baris.length - 1] = terakhir.trimEnd() + '…';
    }
    return baris;
  };
  const lebarJam = (() => {
    ctx.font = `700 ${ukuranJam}px sans-serif`;
    return ctx.measureText(jam).width;
  })();
  const waktuX = panelX + padding;
  const garisX = Math.min(panelX + lebarPanel - padding * 2, waktuX + lebarJam + padding * 0.7);
  const infoX = garisX + padding * 0.8;
  const infoLebar = panelX + lebarPanel - infoX - padding;
  ctx.font = `600 ${ukuranTeks}px sans-serif`;
  const barisHari = bungkusTeks(hari, infoLebar, 1);
  ctx.font = `500 ${ukuranTeks}px sans-serif`;
  const barisTanggal = bungkusTeks(tanggal, infoLebar, 2);
  const tinggiHeader = Math.max(ukuranJam, (barisHari.length + barisTanggal.length) * jarak);
  const alamatTampil = alamat ? 'Alamat: ' + alamat : 'Alamat tidak tersedia';
  const lokasiTampil = lokasi
    ? `GPS: ${lokasi.latitude.toFixed(6)}, ${lokasi.longitude.toFixed(6)}`
    : 'GPS: tidak tersedia';
  const barisAlamat = bungkusTeks(alamatTampil, lebarTeks, 3);
  ctx.font = `500 ${ukuranZona}px sans-serif`;
  const barisLokasi = bungkusTeks(lokasiTampil, lebarTeks, 2);
  const jarakZona = Math.round(ukuranZona * 1.4);
  const unitKerja = 'Unit Kerja: SDN SUKAMAHI 03';
  const tinggiUnit = jarak + Math.round(padding * 0.6);
  const jarakBagian = Math.round(padding * 0.65);
  const tinggiPanel = padding + tinggiHeader + padding
    + barisAlamat.length * jarak + barisLokasi.length * jarakZona
    + jarakBagian + tinggiUnit + padding;
  const panelY = Math.max(0, canvas.height - tinggiPanel - padding);
  const gradasiLatar = ctx.createLinearGradient(panelX, panelY, panelX + lebarPanel, panelY);
  gradasiLatar.addColorStop(0, 'rgba(0, 0, 0, 0.58)');
  gradasiLatar.addColorStop(0.55, 'rgba(0, 0, 0, 0.3)');
  gradasiLatar.addColorStop(1, 'rgba(0, 0, 0, 0.02)');
  ctx.fillStyle = gradasiLatar;
  ctx.fillRect(panelX, panelY, lebarPanel, tinggiPanel);
  ctx.textBaseline = 'top';
  const headerY = panelY + padding;
  ctx.font = `700 ${ukuranJam}px sans-serif`;
  ctx.fillStyle = '#fff';
  ctx.fillText(jam, waktuX, headerY + (tinggiHeader - ukuranJam) / 2);
  ctx.fillStyle = '#fbbf24';
  ctx.fillRect(garisX, headerY, Math.max(3, Math.round(ukuranTeks * 0.12)), tinggiHeader);
  const teksKeteranganY = headerY + (tinggiHeader - (barisHari.length + barisTanggal.length) * jarak) / 2;
  ctx.font = `600 ${ukuranTeks}px sans-serif`;
  ctx.fillStyle = '#fff';
  barisHari.forEach((teks, i) => ctx.fillText(teks, infoX, teksKeteranganY + i * jarak));
  ctx.font = `500 ${ukuranTeks}px sans-serif`;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  barisTanggal.forEach((teks, i) => ctx.fillText(teks, infoX, teksKeteranganY + (barisHari.length + i) * jarak));
  const alamatY = headerY + tinggiHeader + padding;
  ctx.font = `500 ${ukuranTeks}px sans-serif`;
  ctx.fillStyle = '#fff';
  barisAlamat.forEach((teks, i) => ctx.fillText(teks, waktuX, alamatY + i * jarak));
  const lokasiY = alamatY + barisAlamat.length * jarak;
  ctx.font = `500 ${ukuranZona}px sans-serif`;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.82)';
  barisLokasi.forEach((teks, i) => ctx.fillText(teks, waktuX, lokasiY + i * jarakZona));
  const unitY = lokasiY + barisLokasi.length * jarakZona + jarakBagian;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.fillRect(panelX + padding / 2, unitY, lebarPanel - padding, tinggiUnit);
  ctx.font = `600 ${ukuranTeks}px sans-serif`;
  ctx.fillStyle = '#fff';
  ctx.fillText(unitKerja, waktuX, unitY + Math.round(padding * 0.3));
  const blob = await jKanvasKeBlobMaks(canvas, J_BUKTI_MAX_BYTES, 0.85);
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
  img.className = 'max-h-[55vh] max-w-full rounded-lg object-contain';
  preview.replaceChildren(img);
  preview.classList.remove('hidden');
  document.getElementById('kamera-view').classList.add('hidden');
  document.getElementById('btn-ganti-kamera').classList.add('hidden');
  document.getElementById('kamera-kontrol-live').classList.add('hidden');
  document.getElementById('kamera-kontrol-preview').classList.remove('hidden');
  document.getElementById('kamera-kontrol-preview').classList.add('flex');
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
  jTampilkanBuktiForm(k.idx);
}

/* ---------- Pratinjau bukti dukung di form jurnal ---------- */
let jBuktiUrl = new Map(); // idx -> objectURL agar bisa di-revoke
const jUkuranFile = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');

function jBersihkanBuktiUrl() {
  jBuktiUrl.forEach((url) => URL.revokeObjectURL(url));
  jBuktiUrl.clear();
}

function jAturTombolHapus(idx, tampil) {
  const btn = document.querySelector(`[data-hapus-bukti="${idx}"]`);
  if (btn) btn.classList.toggle('hidden', !tampil);
}

function jTampilkanBuktiForm(idx) {
  const input = document.getElementById('bukti_file_' + idx);
  const wrap = document.querySelector(`[data-bukti-preview="${idx}"]`);
  if (!wrap) return;
  const img = wrap.querySelector('img');
  const nama = wrap.querySelector(`[data-bukti-nama="${idx}"]`);
  const ukur = wrap.querySelector(`[data-bukti-ukuran="${idx}"]`);

  if (jBuktiUrl.has(idx)) { URL.revokeObjectURL(jBuktiUrl.get(idx)); jBuktiUrl.delete(idx); }

  const file = input && input.files && input.files[0];
  if (!file) {
    wrap.classList.add('hidden');
    wrap.classList.remove('flex');
    img.removeAttribute('src');
    jAturTombolHapus(idx, false);
    return;
  }
  const url = URL.createObjectURL(file);
  jBuktiUrl.set(idx, url);
  img.src = url;
  img.classList.remove('hidden');
  nama.textContent = file.name;
  ukur.textContent = jUkuranFile(file.size) + ' · siap diunggah';
  wrap.classList.remove('hidden');
  wrap.classList.add('flex');
  jAturTombolHapus(idx, true);
}

function jHapusBuktiForm(idx) {
  const input = document.getElementById('bukti_file_' + idx);
  if (input) input.value = '';
  if (jBuktiUrl.has(idx)) { URL.revokeObjectURL(jBuktiUrl.get(idx)); jBuktiUrl.delete(idx); }
  // Mode edit: bila sudah ada bukti tersimpan, kembalikan tampilan nama berkas lama
  const wrap = document.querySelector(`[data-bukti-preview="${idx}"]`);
  if (wrap && (wrap.dataset.existing || '')) { jBuktiLamaForm(idx); return; }
  if (wrap) {
    wrap.classList.add('hidden');
    wrap.classList.remove('flex');
    const img = wrap.querySelector('img');
    if (img) img.removeAttribute('src');
  }
  jAturTombolHapus(idx, false);
}

/* Tampilkan nama berkas lama saat mengedit jurnal yang sudah punya bukti */
function jBuktiLamaForm(idx) {
  const wrap = document.querySelector(`[data-bukti-preview="${idx}"]`);
  if (!wrap) return;
  const existing = wrap.dataset.existing || '';
  if (!existing) return;
  const img = wrap.querySelector('img');
  if (img) img.classList.add('hidden');
  wrap.querySelector(`[data-bukti-nama="${idx}"]`).textContent = existing;
  wrap.querySelector(`[data-bukti-ukuran="${idx}"]`).textContent = 'Bukti tersimpan · pilih file baru untuk mengganti';
  wrap.classList.remove('hidden');
  wrap.classList.add('flex');
  // Belum ada file baru, jadi tidak ada yang bisa dihapus dari sini
  jAturTombolHapus(idx, false);
}

function ulangiFotoKamera() {
  const k = kameraAktif;
  if (!k) return;
  bukaKamera(k.idx);
}

function bukaFormJurnal(item) {
  jurnalEditId = item ? item.id : null;
  jBersihkanBuktiUrl();
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
  // Mode edit: tampilkan nama bukti yang sudah tersimpan. Form baru: pastikan tombol hapus tersembunyi.
  const jumlahBlok = item ? 1 : 3 - jurnalDaftar.length;
  for (let b = 0; b < jumlahBlok; b++) {
    if (item) jBuktiLamaForm(b);
    else jAturTombolHapus(b, false);
  }
  $('#j-batal').onclick = () => { jBersihkanBuktiUrl(); $('#modal-mutasi-detail').classList.add('hidden'); };
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
      let file = validFoto(fd.get('bukti_file_0'));
      if (file) {
        file = await jKompresFileFoto(file, { maxBytes: J_BUKTI_MAX_BYTES });
        const path = session.user.id + '/' + Date.now() + '-' + file.name.replace(/[^\w.\-]+/g, '_');
        const { error } = await sb.storage.from(BUKTI_BUCKET).upload(path, file, { contentType: file.type });
        if (error) throw error;
        bukti_path = path; bukti_nama = file.name;
      }
      const kegiatan = String(fd.get('kegiatan_0') || '').trim();
      if (!kegiatan) throw new Error('Kegiatan wajib diisi.');
      const row = {
        user_id: session.user.id,
        tanggal: jTglVal(),
        waktu: String(fd.get('waktu_0') || '').trim(),
        kegiatan,
        bukti_path, bukti_nama,
        keterangan: null,
        diperbarui: new Date().toISOString(),
      };
      const { error } = await sb.from('jurnal_harian').update(row).eq('id', jurnalEditId);
      if (error) throw error;
      if (file && lama.bukti_path) {
        await sb.storage.from(BUKTI_BUCKET).remove([lama.bukti_path]);
        jUrlCache.delete(lama.bukti_path + '|3600');
      }
    } else {
      const rows = [];
      for (let i = 0; i < 3; i++) {
        if (fd.get('kegiatan_' + i) === null) continue;
        const kegiatan = String(fd.get('kegiatan_' + i) || '').trim();
        if (!kegiatan) continue;
        let file = validFoto(fd.get('bukti_file_' + i));
        let bukti_path = null, bukti_nama = null;
        if (file) {
          file = await jKompresFileFoto(file, { maxBytes: J_BUKTI_MAX_BYTES });
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
      try { foto[j.id] = jThumbUrl(await jSignedUrl(j.bukti_path, 3600), 1080, 80); } catch { /* tanpa foto */ }
    }
  }));
  const baris = jurnalDaftar.map((j, i) => `
    <tr>
      <td style="border:1px solid #000;padding:6px;text-align:center;vertical-align:top">${i + 1}.</td>
      <td style="border:1px solid #000;padding:6px;vertical-align:top;white-space:nowrap">${esc(j.waktu || '')}</td>
      <td style="border:1px solid #000;padding:6px;vertical-align:top;text-align:justify">${esc(j.kegiatan).replace(/\n/g, '<br>')}</td>
      <td style="border:1px solid #000;padding:8px;vertical-align:top;text-align:center">${foto[j.id]
        ? `<img src="${foto[j.id]}" crossorigin="anonymous" style="width:240px;max-width:100%;max-height:320px;height:auto;object-fit:contain;display:block;margin:0 auto;border:1px solid #000">`
        : esc(j.bukti_nama || '')}</td>
      <td style="border:1px solid #000;padding:6px;vertical-align:top">${esc(j.keterangan || '')}</td>
    </tr>`).join('');
  const kopBaris = (label, nilai) => `<tr><td style="white-space:nowrap;vertical-align:top;width:130px">${label}</td><td style="padding:0 6px;vertical-align:top;width:12px">:</td><td style="vertical-align:top">${nilai}</td></tr>`;
  const html = `<html><head><meta charset="utf-8"><title>Jurnal Kerja Harian - ${esc(namaCetak)}</title><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https://*.supabase.co data:; style-src 'unsafe-inline'"><style>
    body{font-family:'Times New Roman',serif;color:#000;margin:24px}
    table{border-collapse:collapse;width:100%}
    @page{size:215mm 330mm;margin:12mm}</style></head><body>
    <h3 style="text-align:center;margin:0 0 14px">JURNAL KERJA HARIAN</h3>
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
      <th style="border:1px solid #000;padding:6px;width:36px;vertical-align:middle">No</th>
      <th style="border:1px solid #000;padding:6px;width:90px;vertical-align:middle">Waktu</th>
      <th style="border:1px solid #000;padding:6px;vertical-align:middle">Kegiatan</th>
      <th style="border:1px solid #000;padding:6px;width:260px;vertical-align:middle">Bukti Dukung</th>
      <th style="border:1px solid #000;padding:6px;width:70px;vertical-align:middle">Ket</th>
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
  // html2canvas mengabaikan vertical-align pada header; tambah padding bawah agar teks pas di tengah
  klon.querySelectorAll('thead th').forEach((th) => {
    th.style.padding = '6px 6px 22px';
    th.style.verticalAlign = 'middle';
    th.style.textAlign = 'center';
  });
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
    let kanvas = await jSkalaKanvasDariElemen(klon, 2);
    let blob = await jKanvasKeBlobMaks(kanvas, J_UNDUH_MAX_BYTES, 0.92);
    if (blob && blob.size > J_UNDUH_MAX_BYTES) {
      kanvas = await jSkalaKanvasDariElemen(klon, 1.35);
      blob = await jKanvasKeBlobMaks(kanvas, J_UNDUH_MAX_BYTES, 0.9);
    }
    if (!blob) throw new Error('Gagal membuat gambar.');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.download = jNamaFile('jpg');
    a.href = url;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) {
    alert('Gagal mengunduh gambar: ' + (e.message || e));
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
    let kanvas = await jSkalaKanvasDariElemen(klon, 2);
    let blob = await jKanvasKeBlobMaks(kanvas, J_UNDUH_MAX_BYTES, 0.9);
    if (blob && blob.size > J_UNDUH_MAX_BYTES) {
      kanvas = await jSkalaKanvasDariElemen(klon, 1.35);
      blob = await jKanvasKeBlobMaks(kanvas, J_UNDUH_MAX_BYTES, 0.85);
    }
    const img = await jBlobKeDataUrl(blob);
    const pdf = new jspdfLib({ unit: 'mm', format: [215, 330], orientation: 'portrait', compress: true });
    const margin = 10, lebar = 215 - margin * 2, tinggi = (kanvas.height * lebar) / kanvas.width;
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
  const pilih = e.target.closest('[data-pilih-file]');
  if (pilih) {
    const f = document.getElementById('bukti_file_' + pilih.dataset.pilihFile);
    if (f) f.click();
  }
  const hapus = e.target.closest('[data-hapus-bukti]');
  if (hapus) jHapusBuktiForm(hapus.dataset.hapusBukti);
});
document.addEventListener('change', (e) => {
  const id = e.target.id || '';
  if (id.startsWith('bukti_file_')) jTampilkanBuktiForm(id.slice('bukti_file_'.length));
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
