/* ==================== app.js (perbaikan) ==================== */
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));
const FIXED = [['nama', 'Nama'], ['nip', 'NIP'], ['jabatan', 'Jabatan']];
// Dipakai bersama oleh guru.js dan berkas.js
const BUCKET = 'dokumen-guru';
const tglID = (d) => d.toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'long', year: 'numeric' });
const MUTASI_MASUK_TABLE = 'mutasi_masuk';
const MUTASI_KELUAR_TABLE = 'mutasi_keluar';
let session, tugas = [], guru = [], chat = [], mutasiMasuk = [], mutasiKeluar = [];
let jhTgl = '', jhProfilMap = new Map(), jhSudah = new Map();
let profilSaya = null;
const peran = () => (profilSaya && profilSaya.role) || 'guru';
const hanyaJurnal = () => peran() === 'guru' || peran() === 'pegawai' || peran() === 'kepsek';
const adalahAdmin = () => peran() === 'admin';

/* Keluar yang tidak bisa nyangkut: signOut boleh gagal, tapi
   sesi lokal tetap dibersihkan dan halaman tetap pindah. */
async function paksaKeluar(tujuan) {
  try { await sb.auth.signOut(); } catch (e) { console.warn('signOut:', e && e.message); }
  try {
    Object.keys(localStorage).filter((k) => k.indexOf('sb-') === 0).forEach((k) => localStorage.removeItem(k));
    sessionStorage.clear();
  } catch { /* abaikan */ }
  location.href = tujuan || 'login.html';
}

/* ---------- Profil + gerbang role ---------- */
async function muatProfil() {
  try {
    const { data, error } = await sb.from('profiles').select('*').eq('id', session.user.id).single();
    if (data) return data;
    if (error && error.code !== 'PGRST116') console.warn('Profil belum ada:', error.message);
    return null;
  } catch (e) {
    console.warn('Tabel profiles belum ada:', e.message);
    return null;
  }
}
async function pastikanProfil() {
  const p = await muatProfil();
  if (p && p.is_active) return p;
  await paksaKeluar('login.html?err=belum-aktif');
  throw new Error('belum-aktif');
}

function akunDiblokir(p) {
  document.body.innerHTML = '<main class="min-h-screen grid place-items-center p-4"><div class="w-full max-w-sm bg-white rounded-2xl p-8 shadow-lg text-center">'
    + '<h1 class="text-xl font-extrabold text-hijau">Akun belum aktif</h1>'
    + '<p class="text-sm text-ink/70 mt-2">Akun ' + esc(session.user.email) + ' belum diaktifkan admin. Hubungi operator sekolah.</p>'
    + '<button id="btn-blokir-keluar" class="mt-4 w-full rounded-lg bg-hijau text-white font-semibold py-2.5 hover:bg-ink">Keluar</button></div></main>';
  document.getElementById('btn-blokir-keluar').onclick = () => paksaKeluar('login.html');
}
function terapkanRole() {
  const terbatas = hanyaJurnal();
  const navJurnal = $('#nav-jurnal');
  const navPengguna = $('#nav-pengguna');
  if (navJurnal) navJurnal.classList.toggle('hidden', false);
  if (navPengguna) navPengguna.classList.toggle('hidden', !adalahAdmin());
  if (!terbatas) return;
  document.querySelectorAll('#sidebar [data-nav]').forEach((x) => {
    if (x.dataset.nav !== 'jurnal') x.classList.add('hidden');
  });
  ['grup-guru', 'grup-mutasi'].forEach((id) => { const g = document.getElementById(id); if (g) g.classList.add('hidden'); });
  const nama = (profilSaya && profilSaya.nama) || session.user.email;
  const ue = $('#user-email');
  if (ue) ue.textContent = nama + ' (' + peran() + ')';
}

/* ---------- Mulai ---------- */
(async function init() {
  const { data } = await sb.auth.getSession();
  if (!data.session) return (location.href = 'login.html');
  session = data.session;
  $('#user-email').textContent = session.user.email;

  profilSaya = await pastikanProfil();
  if (!profilSaya) {
    await paksaKeluar('login.html?err=belum-aktif');
    return;
  }

  if (!profilSaya.is_active) return akunDiblokir(profilSaya);
  $('#user-email').textContent = (profilSaya.nama || session.user.email) + ' · ' + profilSaya.role;
  terapkanRole();

  $('#ai-nama').textContent = AI_NAMA;
  jam(); setInterval(jam, 1000);
  addEventListener('hashchange', route);
  if (hanyaJurnal()) {
    if (location.hash !== '#jurnal') location.hash = '#jurnal';
    route();
    return;
  }
  route();
  await Promise.all([loadTugas(), loadGuru()]);
  salam();
})();

$('#btn-keluar').onclick = () => paksaKeluar('login.html');
/* ---------- Tema gelap / terang (soft, tersimpan) ---------- */
function terapkanTema(gelap) {
  document.documentElement.classList.toggle('dark', !!gelap);
  const b = $('#btn-tema');
  if (b) b.textContent = gelap ? '☀️' : '🌙';
  try { localStorage.setItem('tema', gelap ? 'gelap' : 'terang'); } catch { /* abaikan */ }
}
try { terapkanTema(localStorage.getItem('tema') === 'gelap'); } catch { /* default terang */ }
const btnTema = $('#btn-tema');
if (btnTema) btnTema.onclick = () => terapkanTema(!document.documentElement.classList.contains('dark'));
const sidebar = $('#sidebar');
function sideToggle(open = document.body.dataset.side !== 'open') {
  document.body.dataset.side = open ? 'open' : 'closed';
  $('#btn-menu').setAttribute('aria-expanded', open);
}
$('#btn-menu').onclick = () => sideToggle();
sidebar.addEventListener('click', (e) => { if (e.target.closest('[data-nav]')) sideToggle(false); });
addEventListener('keydown', (e) => { if (e.key === 'Escape') sideToggle(false); });

// Menu "Guru" dengan sub-menu (Data Guru, Berkas Digital)
function setGrup(id, open) {
  $('#' + id).dataset.open = open;
  $('#btn-' + id).setAttribute('aria-expanded', open);
}
$('#btn-grup-guru').onclick = () => {
  if (document.body.dataset.side !== 'open') { sideToggle(true); setGrup('grup-guru', true); }
  else setGrup('grup-guru', $('#grup-guru').dataset.open !== 'true');
};
// Menu "Mutasi" dengan sub-menu (Mutasi Masuk, Mutasi Keluar)
$('#btn-grup-mutasi').onclick = () => {
  if (document.body.dataset.side !== 'open') { sideToggle(true); setGrup('grup-mutasi', true); }
  else setGrup('grup-mutasi', $('#grup-mutasi').dataset.open !== 'true');
};

function route() {
  const semua = ['dashboard', 'guru', 'berkas', 'whatsapp', 'mutasi-masuk', 'mutasi-keluar', 'absensi', 'jurnal', 'pengguna'];
  let h = location.hash.slice(1);
  if (hanyaJurnal()) {
    if (h !== 'jurnal') { location.hash = '#jurnal'; h = 'jurnal'; }
    semua.forEach((n) => { const el = $('#view-' + n); if (el) el.classList.toggle('hidden', n !== 'jurnal'); });
    document.querySelectorAll('[data-nav]').forEach((x) => { x.dataset.active = x.dataset.nav === 'jurnal'; });
    if (typeof muatJurnal === 'function') muatJurnal();
    return;
  }
  const v = semua.includes(h) ? h : 'dashboard';
  if (v === 'pengguna' && !adalahAdmin()) { location.hash = '#dashboard'; return; }
  semua.forEach((n) => { const el = $('#view-' + n); if (el) el.classList.toggle('hidden', n !== v); });
  if (v === 'dashboard') { muatMutasiDashboard(); if (guru.length && typeof muatJurnalDashboard === 'function') muatJurnalDashboard(); }
  if (v === 'absensi' && typeof muatAbsensi === 'function') muatAbsensi();
  if (v === 'jurnal' && typeof muatJurnal === 'function') muatJurnal();
  if (v === 'pengguna' && typeof muatPengguna === 'function') muatPengguna();
  document.querySelectorAll('[data-nav]').forEach((x) => { x.dataset.active = x.dataset.nav === v; });
  const dalamGrupGuru = v === 'guru' || v === 'berkas';
  $('#btn-grup-guru').dataset.active = dalamGrupGuru;
  if (dalamGrupGuru) setGrup('grup-guru', true);
  const dalamGrupMutasi = v === 'mutasi-masuk' || v === 'mutasi-keluar';
  $('#btn-grup-mutasi').dataset.active = dalamGrupMutasi;
  if (dalamGrupMutasi) setGrup('grup-mutasi', true);
}

/* ---------- Kartu 1: tanggal real time ---------- */
function jam() {
  const n = new Date(), tz = { timeZone: 'Asia/Jakarta' };
  $('#hari').textContent = n.toLocaleDateString('id-ID', { ...tz, weekday: 'long' });
  $('#tanggal').textContent = n.toLocaleDateString('id-ID', { ...tz, day: 'numeric', month: 'long', year: 'numeric' });
  $('#jam').textContent = n.toLocaleTimeString('id-ID', { ...tz, hour12: false }).replace(/\./g, ':');
}

/* ---------- Kartu 2: catatan pekerjaan ---------- */
async function loadTugas() {
  const { data, error } = await sb.from('tugas').select('*').order('selesai').order('tenggat', { nullsFirst: false });
  if (error) return alert('Gagal memuat pekerjaan: ' + error.message);
  tugas = data; renderTugas();
}
function renderTugas() {
  const today = new Date().toISOString().slice(0, 10);
  $('#list-tugas').innerHTML = tugas.length ? tugas.map((t) => `
    <li class="flex items-center gap-2 py-1 text-[13px] leading-snug">
      <input type="checkbox" data-done="${t.id}" ${t.selesai ? 'checked' : ''} class="size-3.5 shrink-0 accent-[#1F6B4F]" aria-label="Selesai">
      <span class="flex-1 ${t.selesai ? 'line-through text-ink/40' : ''}">${esc(t.judul)}</span>
      ${t.tenggat ? `<span class="text-[11px] whitespace-nowrap ${!t.selesai && t.tenggat < today ? 'text-red-700 font-semibold' : 'text-ink/60'}">${esc(t.tenggat)}</span>` : ''}
      <button data-del="${t.id}" class="text-[11px] text-ink/50 hover:text-red-700">Hapus</button>
    </li>`).join('') : '<li class="py-2 text-[13px] text-ink/60">Belum ada pekerjaan. Tulis yang pertama di atas.</li>';
}
$('#form-tugas').onsubmit = async (e) => {
  e.preventDefault();
  const judul = $('#tugas-judul').value.trim(), tenggat = $('#tugas-tenggat').value || null;
  if (!judul) return;
  const { error } = await sb.from('tugas').insert({ judul, tenggat });
  if (error) return alert(error.message);
  e.target.reset(); loadTugas();
};
$('#list-tugas').onclick = async (e) => {
  const id = e.target.dataset.del; if (id && confirm('Hapus pekerjaan ini?')) { await sb.from('tugas').delete().eq('id', id); loadTugas(); }
};
$('#list-tugas').onchange = async (e) => {
  if (e.target.dataset.done) { await sb.from('tugas').update({ selesai: e.target.checked }).eq('id', e.target.dataset.done); loadTugas(); }
};

/* ---------- Kartu 3: data guru (hanya tampil) ---------- */
async function loadGuru() {
  const { data, error } = await sb.from('guru').select('id,nama,jabatan,profil').order('nama');
  if (error) return alert('Gagal memuat data guru: ' + error.message);
  guru = data; renderGuru();
}
const URUT_STATUS = ['PNS', 'PPPK', 'PPPK PW'];
const normNama = (s) => String(s || '').split(',')[0].toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
const URUT_NAMA = ['parda subarnas', 'suyatni', 'sinta', 'niswatun khasanah', 'karnah puspitasari', 'sarbini', 'nuryanah', 'nurhayati', 'rani soraya', 'dewi tiara sagita'];
const URUT_MAPEL = ['muhammad ridwan fauzi', 'eka puspa dewi'];
const rankNama = (g) => { const i = URUT_NAMA.indexOf(normNama(g.nama)); return i < 0 ? 99 : i; };
const rankMapel = (g) => { const i = URUT_MAPEL.indexOf(normNama(g.nama)); return i < 0 ? 99 : i; };
const rankStatus = (g) => {
  const j = jabatBaku(g.jabatan);
  if (j !== 'Guru Kelas' && j !== 'Guru Mapel') return 99;
  const s = String(g.status ?? g.profil?.status ?? '').trim().toUpperCase();
  const i = URUT_STATUS.indexOf(s);
  return i < 0 ? 98 : i;
};
const rankPangkat = (g) => {
  const s = String(g.status ?? g.profil?.status ?? '').trim().toUpperCase();
  if (s !== 'PNS') return 0;
  const m = String(g.pangkat ?? g.profil?.pangkat ?? '').toUpperCase().match(/(IV|III|II|I)\s*[\/.\s-]*([A-E])/);
  if (!m) return -1;
  return { I: 1, II: 2, III: 3, IV: 4 }[m[1]] * 10 + (m[2].charCodeAt(0) - 64);
};
function renderGuru() {
  const rank = (g) => rankJabat(jabatBaku(g.jabatan));
  const urut = urutGuru();
  $('#list-guru').innerHTML = urut.map((g) => `<li class="py-[2px] text-[11px] leading-tight break-words whitespace-normal" title="${esc(g.nama)}">${esc(g.nama)}</li>`).join('')
    || '<li class="py-2 text-[11px] text-ink/60">Belum ada data guru. Isi lewat menu Data Guru.</li>';
  renderGrafikGuru();
  muatJurnalDashboard();
}
function urutGuru() {
  const rank = (g) => rankJabat(jabatBaku(g.jabatan));
  return [...guru].sort((a, b) => rank(a) - rank(b) || ((jabatBaku(a.jabatan) === 'Guru Mapel' && jabatBaku(b.jabatan) === 'Guru Mapel') ? (rankMapel(a) - rankMapel(b) || String(a.nama || '').localeCompare(String(b.nama || ''), 'id')) : 0) || rankStatus(a) - rankStatus(b) || rankPangkat(b) - rankPangkat(a) || rankNama(a) - rankNama(b) || String(a.nama || '').localeCompare(String(b.nama || ''), 'id'));
}

/* ---------- Grafik donat: jumlah guru per jabatan ---------- */
const URUT_JABATAN = ['Kepala Sekolah', 'Guru Kelas', 'Guru Mapel', 'Operator', 'Kebersihan'];
const WARNA_JABATAN = { 'Kepala Sekolah': '#B5832A', 'Guru Kelas': '#1F6B4F', 'Guru Mapel': '#E3A72F', 'Operator': '#86C2A9', 'Kebersihan': '#4C9A7C' };
const jabatBaku = (s) => {
  const v = (s || '').toLowerCase();
  if (v.includes('kepala')) return 'Kepala Sekolah';
  if (v.includes('kelas')) return 'Guru Kelas';
  if (v.includes('mapel')) return 'Guru Mapel';
  if (v.includes('operator')) return 'Operator';
  if (v.includes('bersih')) return 'Kebersihan';
  return (s || '').trim() || 'Belum diisi';
};
const rankJabat = (l) => { const i = URUT_JABATAN.indexOf(l); return i < 0 ? 99 : i; };
const PALET_GRAFIK = ['#1F6B4F', '#E3A72F', '#4C9A7C', '#B5832A', '#86C2A9', '#8A6A1F', '#2E4A3F', '#C9B27A', '#5E8C6A', '#D8E3B5'];
function renderGrafikGuru() {
  const el = $('#grafik-guru'); if (!el) return;
  const grup = new Map();
  guru.forEach((g) => {
    const label = jabatBaku(g.jabatan), cur = grup.get(label);
    grup.set(label, { label, n: (cur ? cur.n : 0) + 1 });
  });
  const data = [...grup.values()].sort((a, b) => rankJabat(a.label) - rankJabat(b.label) || a.label.localeCompare(b.label, 'id'));
  const total = guru.length;
  let w = 0;
  data.forEach((d) => { d.warna = WARNA_JABATAN[d.label] || (d.label === 'Belum diisi' ? '#B8C2BD' : PALET_GRAFIK[w++ % PALET_GRAFIK.length]); });
  let acc = 0;
  const ring = data.map((d) => {
    const pct = (d.n / total) * 100, len = Math.max(pct - (data.length > 1 ? 0.8 : 0), 0.1);
    const c = `<circle cx="21" cy="21" r="15.9155" fill="none" stroke="${d.warna}" stroke-width="6" stroke-dasharray="${len} ${100 - len}" stroke-dashoffset="${25 - acc}"><title>${esc(d.label)}: ${d.n} guru (${Math.round(pct)}%)</title></circle>`;
    acc += pct; return c;
  }).join('');
  const legend = data.map((d) => `
    <li class="flex items-center gap-1.5 py-px">
      <span class="size-2 rounded-sm shrink-0" style="background:${d.warna}"></span>
      <span class="flex-1 min-w-0 truncate" title="${esc(d.label)}">${esc(d.label)}</span>
      <span class="text-ink/60 tabular-nums whitespace-nowrap">${d.n} (${Math.round((d.n / total) * 100)}%)</span>
    </li>`).join('') || '<li class="text-ink/60">Belum ada data guru.</li>';
  el.innerHTML = `
    <svg viewBox="0 0 42 42" class="w-36 h-36 sm:w-44 sm:h-44 mx-auto block shrink-0" role="img" aria-label="Grafik jumlah guru per jabatan">
      <circle cx="21" cy="21" r="15.9155" fill="none" stroke="#E3E9E6" stroke-width="6"/>
      ${ring}
      <text x="21" y="22.6" text-anchor="middle" font-size="7.5" font-weight="800" fill="#14231D">${total}</text>
      <text x="21" y="27" text-anchor="middle" font-size="2.8" fill="#14231D" fill-opacity=".6">guru</text>
    </svg>
    <ul class="mt-1 text-[10px] leading-tight max-h-[4.5rem] overflow-y-auto chat-scroll pr-1 w-full">${legend}</ul>`;
}

/* ---------- Kartu 3b: monitor jurnal harian pegawai (dashboard) ---------- */
const jhHariIni = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
async function muatJurnalDashboard() {
  const list = $('#list-jurnal-harian'), ring = $('#jh-ringkasan'), hint = $('#jh-hint'), input = $('#jh-tanggal');
  if (!list) return;
  if (input && !input.value) input.value = jhTgl || jhHariIni();
  jhTgl = (input && input.value) || jhHariIni();
  if (ring) ring.textContent = 'Memuat...';
  if (hint) hint.textContent = '';
  jhProfilMap = new Map(); jhSudah = new Map();
  let profilBisa = true, jurnalBisa = true;
  try {
    const { data, error } = await sb.from('profiles').select('id,guru_id');
    if (error) throw error;
    (data || []).forEach((p) => { if (p.guru_id != null) jhProfilMap.set(String(p.guru_id), String(p.id)); });
  } catch (e) {
    profilBisa = false;
    console.warn('Monitor jurnal: profiles tak terbaca:', e && e.message);
  }
  try {
    const { data, error } = await sb.from('jurnal_harian').select('user_id').eq('tanggal', jhTgl);
    if (error) throw error;
    (data || []).forEach((r) => {
      const k = String(r.user_id);
      jhSudah.set(k, (jhSudah.get(k) || 0) + 1);
    });
  } catch (e) {
    jurnalBisa = false;
    console.warn('Monitor jurnal: jurnal tak terbaca:', e && e.message);
  }
  renderJurnalDashboard(profilBisa, jurnalBisa);
}
function renderJurnalDashboard(profilBisa, jurnalBisa) {
  const list = $('#list-jurnal-harian'), ring = $('#jh-ringkasan'), hint = $('#jh-hint');
  if (!list) return;
  const daftar = (typeof urutGuru === 'function') ? urutGuru() : [...guru];
  if (!daftar.length) {
    list.innerHTML = '<li class="py-3 text-xs text-ink/60">Belum ada data pegawai. Isi lewat menu Data Guru.</li>';
    if (ring) ring.textContent = 'Belum ada data.';
    return;
  }
  const sudahOf = (g) => {
    const uid = jhProfilMap.get(String(g.id));
    return uid ? (jhSudah.get(String(uid)) || 0) : 0;
  };
  list.innerHTML = daftar.map((g) => {
    const n = sudahOf(g), sudah = n > 0;
    const taut = jhProfilMap.has(String(g.id));
    return `<li class="jh-item flex items-center gap-1.5 rounded-md border px-2 py-[1px] text-[11px] leading-none ${sudah ? 'jh-sudah' : 'jh-belum'}">`
      + `<span class="jh-dot grid place-items-center size-4 rounded-full shrink-0 text-[10px] font-extrabold ${sudah ? 'jh-dot-sudah' : 'jh-dot-belum'}">${sudah ? '✓' : ''}</span>`
      + `<span class="flex-1 min-w-0 py-[1px]"><span class="block font-semibold truncate leading-none" title="${esc(g.nama)}">${esc(g.nama)}</span>`
      + `<span class="block text-[9px] leading-none mt-[3px] ${sudah ? 'text-hijau font-bold' : 'text-ink/50'}">${sudah ? 'Sudah mengisi • ' + n + '/3 kegiatan' : (taut ? 'Belum mengisi' : 'Belum ada akun tertaut')}</span></span>`
      + `</li>`;
  }).join('');
  const total = daftar.length, sudahCount = daftar.filter((g) => sudahOf(g) > 0).length;
  let tglTxt = jhTgl;
  try { tglTxt = tglID(new Date(jhTgl + 'T00:00:00')); } catch { /* pakai mentah */ }
  if (ring) { ring.textContent = sudahCount + ' dari ' + total + ' pegawai sudah mengisi • ' + tglTxt; ring.title = ring.textContent; }
  if (hint) {
    if (!profilBisa) hint.textContent = 'Butuh migrasi 004 + 007 di SQL Editor agar status terbaca (saat ini tampil Belum semua).';
    else if (!jurnalBisa) hint.textContent = 'Data jurnal tak terbaca untuk peran ini.';
    else {
      const belumTaut = daftar.filter((g) => !jhProfilMap.has(String(g.id))).length;
      hint.textContent = belumTaut ? belumTaut + ' pegawai belum ditautkan ke akun (menu Pengguna) — statusnya selalu Belum.' : 'Hijau muda = sudah mengisi, putih = belum. Ganti tanggal untuk cek hari sebelumnya.';
    }
    hint.title = hint.textContent;
  }
}
document.addEventListener('change', (e) => {
  if (e.target && e.target.id === 'jh-tanggal') muatJurnalDashboard();
});

/* ---------- Mutasi siswa: donat total + diagram batang 6 bulan (bisa digeser) ---------- */
const BULAN_PENDEK = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const SERI_MUTASI = [
  { k: 'ml', label: 'Masuk - Laki-laki', warna: '#1F6B4F' },
  { k: 'mp', label: 'Masuk - Perempuan', warna: '#86C2A9' },
  { k: 'kl', label: 'Keluar - Laki-laki', warna: '#B5832A' },
  { k: 'kp', label: 'Keluar - Perempuan', warna: '#E8C877' },
];
let gmBulan = [];

async function muatMutasiDashboard() {
  const kolom = 'tanggal_surat,jenis_kelamin,dibuat';
  const [m, k] = await Promise.all([sb.from(MUTASI_MASUK_TABLE).select(kolom), sb.from(MUTASI_KELUAR_TABLE).select(kolom)]);
  if (m.error || k.error) {
    console.error(m.error || k.error);
    $('#donat-mutasi').innerHTML = '<p class="text-[12px] text-ink/60">Data mutasi belum bisa dimuat.</p>';
    $('#bar-mutasi').innerHTML = '';
    return;
  }
  mutasiMasuk = m.data; mutasiKeluar = k.data;
  renderDonatMutasi(); renderBarMutasi();
}

function renderDonatMutasi() {
  const el = $('#donat-mutasi'); if (!el) return;
  const data = [
    { label: 'Mutasi masuk', n: mutasiMasuk.length, warna: '#1F6B4F' },
    { label: 'Mutasi keluar', n: mutasiKeluar.length, warna: '#E3A72F' },
  ];
  const total = data[0].n + data[1].n, ada = data.filter((d) => d.n);
  let acc = 0;
  const ring = ada.map((d) => {
    const pct = (d.n / total) * 100, len = Math.max(pct - (ada.length > 1 ? 0.8 : 0), 0.1);
    const c = `<circle cx="21" cy="21" r="15.9155" fill="none" stroke="${d.warna}" stroke-width="6" stroke-dasharray="${len} ${100 - len}" stroke-dashoffset="${25 - acc}"><title>${esc(d.label)}: ${d.n} siswa (${Math.round(pct)}%)</title></circle>`;
    acc += pct; return c;
  }).join('');
  const legend = data.map((d) => `
    <li class="flex items-center gap-2 py-0.5">
      <span class="size-2.5 rounded-sm shrink-0" style="background:${d.warna}"></span>
      <span class="flex-1 min-w-0 truncate">${esc(d.label)}</span>
      <span class="text-ink/60 tabular-nums">${d.n} (${total ? Math.round((d.n / total) * 100) : 0}%)</span>
    </li>`).join('');
  el.innerHTML = `
    <svg viewBox="0 0 42 42" class="w-40 h-40 mx-auto block" role="img" aria-label="Grafik jumlah mutasi siswa masuk dan keluar">
      <circle cx="21" cy="21" r="15.9155" fill="none" stroke="#E3E9E6" stroke-width="6"/>
      ${ring}
      <text x="21" y="22.6" text-anchor="middle" font-size="7.5" font-weight="800" fill="#14231D">${total}</text>
      <text x="21" y="27" text-anchor="middle" font-size="2.8" fill="#14231D" fill-opacity=".6">mutasi</text>
    </svg>
    <ul class="mt-3 text-sm">${legend}</ul>`;
}

function renderBarMutasi() {
  const el = $('#bar-mutasi'); if (!el) return;
  const jk = (d) => { const j = (d.jenis_kelamin || '').toLowerCase(); return j.includes('perempuan') || j === 'p' ? 'p' : 'l'; };
  const hitung = new Map();
  const tambah = (rows, t) => rows.forEach((d) => {
    const key = String(d.tanggal_surat || d.dibuat || '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(key)) return;
    const o = hitung.get(key) || { ml: 0, mp: 0, kl: 0, kp: 0 };
    o[t + jk(d)]++; hitung.set(key, o);
  });
  tambah(mutasiMasuk, 'm'); tambah(mutasiKeluar, 'k');
  const idx = (key) => +key.slice(0, 4) * 12 + (+key.slice(5, 7) - 1);
  const kunci = (i) => Math.floor(i / 12) + '-' + String((i % 12) + 1).padStart(2, '0');
  const skr = idx(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' }).slice(0, 7));
  const ada = [...hitung.keys()].map(idx);
  gmBulan = [];
  for (let i = Math.min(skr - 5, ...ada); i <= Math.max(skr, ...ada); i++) gmBulan.push({ key: kunci(i), ...(hitung.get(kunci(i)) || { ml: 0, mp: 0, kl: 0, kp: 0 }) });
  const maks = Math.max(1, ...gmBulan.flatMap((b) => SERI_MUTASI.map((s) => b[s.k])));
  const nama = (b) => BULAN_PENDEK[+b.key.slice(5, 7) - 1], thn = (b) => b.key.slice(0, 4);
  const bar = (n, s, b) => `<div class="flex flex-col items-center justify-end h-full w-full max-w-[14px]" title="${esc(s.label)} (${nama(b)} ${thn(b)}): ${n} siswa">${n ? `<span class="text-[9px] leading-none mb-0.5 text-ink/70 tabular-nums">${n}</span>` : ''}<div class="w-full rounded-t-sm" style="height:${n ? Math.max((n / maks) * 82, 3) : 0}%;background:${s.warna}"></div></div>`;
  const grup = gmBulan.map((b) => `
    <div class="snap-start shrink-0 basis-1/3 sm:basis-1/6 px-0.5">
      <div class="h-36 flex items-end justify-center gap-[2px] border-b border-ink/15">${SERI_MUTASI.map((s) => bar(b[s.k], s, b)).join('')}</div>
      <div class="mt-1 text-center leading-tight"><div class="text-[11px] font-semibold">${nama(b)}</div><div class="text-[10px] text-ink/50">${thn(b)}</div></div>
    </div>`).join('');
  const tahun = [...new Set(gmBulan.map(thn))];
  const tombol = 'rounded-lg border border-ink/20 size-7 grid place-items-center hover:bg-kertas disabled:opacity-30 disabled:hover:bg-transparent';
  const ikon = (d) => `<svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
  el.innerHTML = `
    <div class="flex flex-wrap items-center gap-2 mb-2">
      <p class="mr-auto text-[13px] font-semibold">Mutasi per bulan <span id="gm-rentang" class="font-normal text-ink/50"></span></p>
      <select id="gm-tahun" aria-label="Lompat ke tahun" class="rounded-lg border border-ink/20 px-2 py-1 text-[12px]">${tahun.map((t) => `<option>${t}</option>`).join('')}</select>
      <button id="gm-prev" aria-label="Enam bulan sebelumnya" class="${tombol}">${ikon('m15 6-6 6 6 6')}</button>
      <button id="gm-next" aria-label="Enam bulan berikutnya" class="${tombol}">${ikon('m9 6 6 6-6 6')}</button>
    </div>
    <div id="gm-gulir" class="flex overflow-x-auto snap-x snap-mandatory chat-scroll pb-1">${grup}</div>
    <ul class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">${SERI_MUTASI.map((s) => `<li class="flex items-center gap-1.5"><span class="size-2.5 rounded-sm" style="background:${s.warna}"></span>${esc(s.label)}</li>`).join('')}</ul>`;
  const g = $('#gm-gulir'), prev = $('#gm-prev'), next = $('#gm-next'), sel = $('#gm-tahun');
  const jmlTampil = () => (g.clientWidth < 640 ? 3 : 6);
  const lebar = () => g.clientWidth / jmlTampil() || 1;
  const perbarui = () => {
    const i0 = Math.min(Math.round(g.scrollLeft / lebar()), gmBulan.length - 1), i1 = Math.min(i0 + jmlTampil() - 1, gmBulan.length - 1);
    const a = gmBulan[i0], z = gmBulan[i1];
    $('#gm-rentang').textContent = '(' + nama(a) + (thn(a) === thn(z) ? '' : ' ' + thn(a)) + ' - ' + nama(z) + ' ' + thn(z) + ')';
    prev.disabled = g.scrollLeft <= 1;
    next.disabled = g.scrollLeft + g.clientWidth >= g.scrollWidth - 1;
    sel.value = thn(z);
  };
  g.addEventListener('scroll', () => requestAnimationFrame(perbarui));
  prev.onclick = () => g.scrollBy({ left: -g.clientWidth, behavior: 'smooth' });
  next.onclick = () => g.scrollBy({ left: g.clientWidth, behavior: 'smooth' });
  sel.onchange = () => g.scrollTo({ left: gmBulan.findIndex((b) => thn(b) === sel.value) * lebar(), behavior: 'smooth' });
  // Mulai dari 6 bulan terbaru. Dicoba lagi sebentar kemudian jika gaya Tailwind belum selesai dimuat.
  const keAkhir = () => { g.scrollLeft = g.scrollWidth; perbarui(); };
  requestAnimationFrame(keAkhir);
  setTimeout(() => { if (g.scrollLeft === 0 && g.scrollWidth > g.clientWidth) keAkhir(); }, 300);
}

/* ---------- Chat agen AI ---------- */
function bubble(role, text) {
  const me = role === 'user';
  const d = document.createElement('div');
  d.className = (me ? 'ml-4 sm:ml-8 bg-hijau text-white' : 'mr-4 sm:mr-8 bg-kertas') + ' rounded-xl px-3 py-2 whitespace-pre-wrap break-words';
  d.textContent = text; $('#chat-log').append(d); d.scrollIntoView({ block: 'end' });
  return d;
}
function salam() {
  const sisa = tugas.filter((t) => !t.selesai);
  bubble('assistant', sisa.length
    ? `Ada ${sisa.length} pekerjaan yang belum selesai. Paling dekat: ${sisa[0].judul}${sisa[0].tenggat ? ' (tenggat ' + sisa[0].tenggat + ')' : ''}.`
    : 'Semua pekerjaan sudah selesai. Tulis pekerjaan baru kapan saja.');
}
const setAI = (state, text) => { $('#ai-avatar').dataset.state = state; $('#ai-status').textContent = text; };
async function ketik(el, teks) {
  el.textContent = '';
  for (let i = 0; i < teks.length; i += 2) {
    el.textContent += teks.slice(i, i + 2);
    el.scrollIntoView({ block: 'end' });
    await new Promise((r) => setTimeout(r, 14));
  }
}

$('#form-chat').onsubmit = async (e) => {
  e.preventDefault();
  const text = $('#chat-input').value.trim(); if (!text) return;
  $('#chat-input').value = ''; bubble('user', text); chat.push({ role: 'user', content: text });
  const wait = bubble('assistant', '');
  wait.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
  setAI('thinking', AI_NAMA + ' sedang berpikir...');
  try {
    const { data } = await sb.auth.getSession();
    const r = await fetch(AI_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + data.session.access_token, apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify({ messages: chat })
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || r.status);
    await ketik(wait, j.reply); chat.push({ role: 'assistant', content: j.reply });
  } catch (err) {
    chat.pop(); wait.textContent = 'Agen belum bisa menjawab: ' + err.message;
  }
  setAI('idle', 'Siap membantu');
};

/* ---------- WhatsApp ---------- */
$('#form-wa').onsubmit = (e) => {
  e.preventDefault();
  let n = $('#wa-nomor').value.replace(/\D/g, '');
  if (n.startsWith('0')) n = '62' + n.slice(1);
  window.open(`https://wa.me/${n}?text=${encodeURIComponent($('#wa-pesan').value)}`, '_blank', 'noopener');
};