/* Absensi Siswa per Kelas (admin + guru wali): grid 1–31 dengan kode H/S/I/A,
   H diturunkan (hari efektif tanpa catatan — tidak disimpan di DB; DB hanya S/I/A),
   tanggal merah (Sabtu-Minggu + libur nasional + manual via absensi_libur),
   rekap jumlah & persentase otomatis; setiap perubahan sel (H/S/I/A) tersimpan otomatis.
   Akses ditegakkan RLS migrasi 014: guru hanya rombel binaan (kelas_wali_saya()).
   Bergantung global: app.js (sb, $, esc, peran, bolehAbsensiSiswa),
   absensi.js (BULAN_ID, hariDiBulan, tglKey, liburBulan, liburCache, merahManual, simpanManual),
   siswa.js (sAmbilSemua). Cetak/PDF/Excel adalah milestone M4. */
let asSiswa = [], asGuru = [], asSetelan = {}, asKelas = [];
let asBulan = '', asRombel = 0;
let asSel = new Map(), asLibur = new Map(), asLiburRows = [];

const AS_BTN = 'rounded-lg bg-hijau text-white text-sm font-semibold px-4 py-2 hover:bg-ink';
const AS_BTN_O = 'rounded-lg border border-hijau text-hijau text-xs font-semibold px-3 py-1.5 hover:bg-hijau hover:text-white';
const AS_INP = 'rounded-lg border border-ink/20 px-3 py-1.5 text-sm';
const AS_STATUS = ['H', 'S', 'I', 'A']; // H = hadir eksplisit (●), tersimpan di DB
const AS_WARNA = { S: 'bg-amber-200', I: 'bg-sky-200', A: 'bg-red-300 text-red-900' };

const asKunci = (sid, tgl) => sid + '|' + tgl;
const asBulanIni = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' }).slice(0, 7);
const asHariIni = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
const asSiswaAktif = () => asSiswa.filter((s) => String(s.kelas_id) === String(asRombel) && s.status === 'aktif');
const asMsgGalat = (e, prefix) => (prefix || 'Gagal memuat absensi siswa') + ': ' + ((e && e.code === '42P01') ? 'tabel belum ada — jalankan migrasi 014' : (e.message || e));

/* Cutoff: batas tanggal sel yang masih boleh diisi — bulan lampau = seluruh bulan;
   bulan berjalan = s.d. hari ini; bulan depan = 0. Tidak dipakai untuk statistik:
   "hari efektif" di rekap/RESUME/persentase selalu seluruh bulan (lihat asHET). */
function asCutoff(bln) {
  if (bln > asBulanIni()) return null;
  if (bln < asBulanIni()) return tglKey(bln, hariDiBulan(bln));
  return asHariIni();
}
/* Merah = libur (absensi_libur + libur nasional via liburBulan) + Sabtu-Minggu — strukturnya sama dengan absensi pegawai. */
const asMerah = (tgl) => {
  if (asLibur.has(tgl)) return true;
  const wd = new Date(tgl + 'T00:00:00').getDay();
  return wd === 0 || wd === 6;
};
/* Label kolom merah (untuk teks vertikal, meniru absensi pegawai): libur nasional/manual
   memakai keterangan tersimpan, Sabtu/Minggu memakai nama hari. */
const asLiburLabel = (tgl) => {
  const ket = asLibur.get(tgl);
  if (ket) return ket;
  const wd = new Date(tgl + 'T00:00:00').getDay();
  if (wd === 0) return 'Hari Minggu';
  if (wd === 6) return 'Hari Sabtu';
  return '';
};
const asHitungEfektif = (bln, hingga) => {
  let c = 0;
  for (let d = 1; d <= hingga; d++) if (!asMerah(tglKey(bln, d))) c++;
  return c;
};
const asHET = (bln) => asHitungEfektif(bln, hariDiBulan(bln));

const asPct = (v) => v.toFixed(2).replace('.', ',');

/* Statistik rekap untuk rombel mana pun (halaman, export PDF/Excel, rekap total).
   H kini EKSPLISIT (hitung dari status 'H' yang diisi guru), bukan tersirat.
   Denominator = hari efektif SELURUH bulan (asHET), konsisten untuk semua bulan. */
function asStatistik(daftar, sel, bln) {
  const heb = asHET(bln);
  const per = new Map();
  sel.forEach((v, k) => {
    const sid = k.split('|')[0];
    const h = per.get(sid) || { H: 0, S: 0, I: 0, A: 0 };
    h[v.status] = (h[v.status] || 0) + 1;
    per.set(sid, h);
  });
  const baris = daftar.map((s) => {
    const h = per.get(String(s.id)) || { H: 0, S: 0, I: 0, A: 0 };
    const H = h.H || 0;
    const total = H + (h.S || 0) + (h.I || 0) + (h.A || 0);
    const pers = heb > 0 ? asPct(((H + (h.S || 0)) / heb) * 100) + '%' : '–';
    return { s, H, S: h.S || 0, I: h.I || 0, A: h.A || 0, total, pers };
  });
  const tot = baris.reduce((t, r) => ({ H: t.H + r.H, S: t.S + r.S, I: t.I + r.I, A: t.A + r.A, total: t.total + r.total }), { H: 0, S: 0, I: 0, A: 0, total: 0 });
  const L = baris.filter((r) => r.s.jenis_kelamin === 'Laki-laki').length;
  const P = baris.filter((r) => r.s.jenis_kelamin === 'Perempuan').length;
  const n = baris.length, den = n * heb;
  const pct = (c) => (den > 0 ? asPct((c / den) * 100) : '–');
  return { baris, tot, heb, n, L, P, pctS: pct(tot.S), pctI: pct(tot.I), pctA: pct(tot.A), pctH: pct(tot.H) };
}
const asHitungRekap = () => asStatistik(asSiswaAktif(), asSel, asBulan);
/* ---------- Muat awal (dipanggil route() di app.js) ---------- */
async function muatAbsensiSiswa() {
  if (typeof bolehAbsensiSiswa !== 'function' || !bolehAbsensiSiswa()) { location.hash = '#jurnal'; return; }
  const root = $('#as-root');
  if (!root) return;
  const guruMode = peran() === 'guru';
  root.innerHTML = '<p class="text-sm text-ink/60 p-2">Memuat…</p>';
  try {
    let waliSaya = null;
    if (guruMode) {
      const { data, error } = await sb.rpc('kelas_wali_saya');
      if (error) throw error;
      waliSaya = new Set((data || []).map(String));
    }
    const [kRes, gRes, stRes] = await Promise.all([
      sb.from('kelas').select('*').order('urut').order('nama'),
      sb.from('guru').select('id,nama,nip').order('nama'),
      sb.from('setelan').select('kunci,nilai'),
    ]);
    if (kRes.error) throw kRes.error;
    if (gRes.error) throw gRes.error;
    if (stRes.error) throw stRes.error;
    asKelas = kRes.data || [];
    asGuru = gRes.data || [];
    asSetelan = Object.fromEntries((stRes.data || []).map((x) => [x.kunci, x.nilai]));
    if (guruMode) asKelas = asKelas.filter((k) => waliSaya.has(String(k.id)));
    if (!asKelas.length) { asRenderKosongWali(root); return; }
    asSiswa = await sAmbilSemua('siswa', 'nama');
    if (!asRombel || !asKelas.some((k) => String(k.id) === String(asRombel))) asRombel = asKelas[0].id;
    if (!asBulan) asBulan = asBulanIni();
    await asMuatBulan();
  } catch (e) {
    root.innerHTML = '<p class="text-sm text-red-600 p-2">' + esc(asMsgGalat(e)) + '</p>';
  }
}

async function asMuatBulan() {
  if (!asBulan) asBulan = asBulanIni();
  const akhir = tglKey(asBulan, hariDiBulan(asBulan));
  asLibur = await liburBulan(asBulan);
  const q = sb.from('absensi_siswa').select('id,tanggal,siswa_id,status,keterangan').eq('kelas_id', asRombel).gte('tanggal', asBulan + '-01').lte('tanggal', akhir);
  const { data: liburR, error: eLibur } = await sb.from('absensi_libur').select('tanggal,keterangan').gte('tanggal', asBulan + '-01').lte('tanggal', akhir).order('tanggal');
  if (eLibur) { /* tidak fatal: daftar merah manual kosong; Sabtu-Minggu & libur nasional tetap jalan via liburBulan */ }
  asLiburRows = (eLibur ? [] : liburR) || [];
  const { data, error } = await q;
  if (error) {
    const root = $('#as-root');
    if (root) root.innerHTML = '<p class="text-sm text-red-600 p-2">' + esc(asMsgGalat(error, 'Gagal memuat data absensi')) + '</p>';
    return;
  }
  asSel = new Map();
  (data || []).forEach((r) => { if (AS_STATUS.includes(r.status)) asSel.set(asKunci(r.siswa_id, r.tanggal), { status: r.status, ket: r.keterangan || '' }); });
  asRender();
}

/* ---------- Render ---------- */
function asRender() {
  const root = $('#as-root');
  if (!root) return;
  const rombel = asKelas.find((k) => String(k.id) === String(asRombel)) || {};
  const daftar = asSiswaAktif();
  const [y, m] = asBulan.split('-').map(Number);
  const wali = (asGuru.find((g) => String(g.id) === String(rombel.wali_guru_id)) || {}).nama;
  const het = asHET(asBulan);
  const guruMode = peran() === 'guru';
  // Guru wali tunggal: tanpa label "Rombel X" (info rombel sudah ada di baris info di bawah judul).
  const pilihRombel = (guruMode && asKelas.length === 1)
    ? ''
    : `<label class="text-sm font-semibold">Rombel
        <select id="as-rombel" class="${AS_INP} font-normal ml-1 w-full sm:w-auto">${asKelas.map((k) => `<option value="${k.id}" ${String(k.id) === String(asRombel) ? 'selected' : ''}>${esc(k.nama)}</option>`).join('')}</select></label>`;
  // Tombol aksi: di HP melebar rata per baris, di desktop kembali inline seperti biasa.
  const AS_TOOLBAR_BTN = AS_BTN_O + ' flex-1 min-w-0 sm:flex-none';
  root.innerHTML = `
    <article class="rounded-xl bg-white p-4 space-y-3">
      <div class="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
        <h2 class="w-full font-extrabold text-lg sm:mr-auto sm:w-auto">Absensi Siswa per Kelas</h2>
        <div class="grid grid-cols-1 gap-2 sm:contents">
          ${pilihRombel}
          <label class="text-sm font-semibold">Bulan <input id="as-bulan" type="month" value="${esc(asBulan)}" class="${AS_INP} font-normal ml-1 w-full sm:w-auto"></label>
        </div>
        <div class="flex flex-wrap gap-2 sm:contents">
          <button data-as="cetak" class="${AS_TOOLBAR_BTN}">Cetak</button>
          <button data-as="pdf" class="${AS_TOOLBAR_BTN}">Unduh PDF</button>
          <button data-as="xlsx" class="${AS_TOOLBAR_BTN}">Unduh Excel</button>
          ${adalahAdmin() ? `<button data-as="xlsx-semua" class="${AS_TOOLBAR_BTN}">Unduh Excel (Semua Rombel)</button>` : ''}
        </div>
      </div>
      <p class="text-xs text-ink/60">${BULAN_ID[m - 1]} ${y} · Rombel ${esc(rombel.nama || '')} · Wali: ${esc(wali || 'belum ada')} · ${esc(asSetelan.tahun_pelajaran || '-')} (${esc(asSetelan.semester || '-')}) · Hari Efektif ${het}</p>
      <p id="as-status" class="text-xs"></p>
      ${daftar.length
        ? '<div id="as-grid"></div>\n<div id="as-rekap"></div>'
        : `<div class="rounded-lg border border-dashed border-ink/20 p-6 text-center text-sm text-ink/60">
             Belum ada siswa <b>aktif</b> di rombel ${esc(rombel.nama || '')}.${guruMode ? ' Tanyakan ke admin bila ada siswa yang belum terdaftar.' : ' Tambahkan lewat menu Database Siswa, lalu isi absensinya.'}
           </div>`}
      ${asLiburHtml()}
      <p class="text-xs text-ink/50">Kode: klik sel berputar Kosong → ● (hadir) → S (sakit) → I (izin) → A (alpa) → Kosong lagi. Semua isian oleh guru, tanpa isian otomatis. Klik ganda = keterangan opsional. Kolom merah = hari libur (Sabtu-Minggu, libur nasional &amp; manual) — tidak bisa diisi, tidak dihitung hari efektif.</p>
    </article>`;
  asIsiGrid();
  asIsiRekap();
}

function asRenderKosongWali(root) {
  root.innerHTML = `
    <article class="rounded-xl bg-white p-4 space-y-2">
      <h2 class="font-extrabold text-lg">Absensi Siswa per Kelas</h2>
      <div class="rounded-lg border border-dashed border-ink/20 p-6 text-center space-y-1">
        <p class="text-sm font-semibold">Anda belum ditugaskan sebagai wali kelas.</p>
        <p class="text-sm text-ink/60">Absensi rombel hanya bisa diisi wali yang ditugaskan admin lewat menu <b>Database Siswa → Kelas &amp; Wali Kelas</b>.</p>
        <p class="text-xs text-ink/50">Jika Anda seharusnya menjadi wali, hubungi admin sekolah.</p>
      </div>
    </article>`;
}

function asSelKelas(tgl, row, bisa) {
  let cls = 'px-0.5 py-1 border border-ink/20 text-center';
  let tampil = '';
  if (row) {
    if (row.status === 'H') tampil = '●'; // Hadir: logo bulat hitam
    else { cls += ' ' + AS_WARNA[row.status]; tampil = row.status; }
  }
  // Tanpa isian otomatis: sel kosong tetap kosong sampai guru mengklik
  if (bisa && !row) cls += ' cursor-pointer hover:outline hover:outline-2 hover:outline-hijau/40';
  return { cls: cls.trim(), tampil };
}

function asIsiGrid() {
  const el = $('#as-grid');
  if (!el) return;
  const daftar = asSiswaAktif();
  if (!daftar.length) return;
  const n = hariDiBulan(asBulan);
  const cut = asCutoff(asBulan);
  const B = 'border border-ink/20'; // garis penuh tiap sel agar mudah memilih baris/kolom
  const head = `<tr>
      <th rowspan="2" class="px-1 py-1.5 text-left ${B}">No</th>
      <th rowspan="2" class="px-2 py-1.5 text-left ${B}">Nama Siswa</th>
      <th rowspan="2" class="px-1 py-1.5 ${B}">NISN</th>
      <th rowspan="2" class="px-1 py-1.5 ${B}">NIS</th>
      <th rowspan="2" class="px-1 py-1.5 ${B}">L/P</th>
      <th colspan="${n}" class="px-1 py-1 text-center ${B}">Tanggal</th>
    </tr>
    <tr>${Array.from({ length: n }, (_, i) => {
      const tgl = tglKey(asBulan, i + 1);
      return `<th class="px-0.5 py-1.5 text-center min-w-[1.4rem] ${B} ${asMerah(tgl) ? 'bg-red-600 text-white' : ''}">${i + 1}</th>`;
    }).join('')}</tr>`;
  const body = daftar.map((s, ri) => {
    let hari = '';
    for (let d = 1; d <= n; d++) {
      const tgl = tglKey(asBulan, d);
      if (asMerah(tgl)) {
        // Kolom merah (SABTU/MINGGU/libur): satu sel tinggi + teks vertikal (meniru absensi pegawai), tidak bisa diisi
        if (ri === 0) {
          hari += `<td rowspan="${daftar.length}" class="${B} bg-red-600 text-white p-0 align-middle"><div class="mx-auto [writing-mode:vertical-rl] rotate-180 whitespace-nowrap text-[10px] font-bold">${esc(asLiburLabel(tgl))}</div></td>`;
        }
        continue;
      }
      const row = asSel.get(asKunci(s.id, tgl));
      const bisa = cut && tgl <= cut;
      const { cls, tampil } = asSelKelas(tgl, row, bisa);
      hari += `<td ${bisa ? `data-as-sel="${s.id}|${tgl}"` : ''} class="${cls}">${tampil}</td>`;
    }
    return `<tr>
      <td class="px-1 ${B}">${ri + 1}</td>
      <td class="px-2 text-left font-semibold ${B}">${esc(s.nama)}</td>
      <td class="px-1 ${B}">${esc(s.nisn || '')}</td>
      <td class="px-1 ${B}">${esc(s.nis || '')}</td>
      <td class="px-1 ${B}">${s.jenis_kelamin === 'Laki-laki' ? 'L' : s.jenis_kelamin === 'Perempuan' ? 'P' : ''}</td>
      ${hari}
    </tr>`;
  }).join('');
  el.innerHTML = `<div class="as-tabel overflow-x-auto rounded-lg border border-ink/20">
    <table class="text-center text-xs border-collapse whitespace-nowrap">
      <thead class="bg-gray-200/80 font-bold">${head}</thead>
      <tbody>${body}</tbody>
    </table>
  </div>`;
}

function asIsiRekap() {
  const el = $('#as-rekap');
  if (!el) return;
  const { baris, tot, heb, L, P } = asHitungRekap();
  const num = (v) => (v ? String(v) : '');
  const m = Number(asBulan.slice(5, 7));
  el.innerHTML = `
    <div>
      <h3 class="text-sm font-extrabold mb-1">Rekap ${BULAN_ID[m - 1]}</h3>
      <div class="overflow-x-auto rounded-lg border border-ink/10">
        <table class="text-center text-xs border-collapse whitespace-nowrap">
          <thead class="bg-gray-200/80 font-bold">
            <tr><th class="px-2 py-1.5">No</th><th class="px-2 text-left">Nama Siswa</th><th class="px-2">NISN</th><th class="px-2">L/P</th><th class="px-2">Hadir</th><th class="px-2">S</th><th class="px-2">I</th><th class="px-2">A</th><th class="px-2">Total</th><th class="px-2">Persentase</th></tr>
          </thead>
          <tbody class="divide-y divide-ink/10">
            ${baris.map((r, i) => `<tr>
              <td class="px-2">${i + 1}</td>
              <td class="px-2 text-left font-semibold">${esc(r.s.nama)}</td>
              <td class="px-2">${esc(r.s.nisn || '')}</td>
              <td class="px-2">${r.s.jenis_kelamin === 'Laki-laki' ? 'L' : r.s.jenis_kelamin === 'Perempuan' ? 'P' : ''}</td>
              <td class="px-2">${num(r.H)}</td><td class="px-2">${num(r.S)}</td><td class="px-2">${num(r.I)}</td><td class="px-2">${num(r.A)}</td>
              <td class="px-2 font-bold">${r.total}</td>
              <td class="px-2">${r.pers}</td>
            </tr>`).join('')}
            <tr class="font-bold">
              <td class="px-2" colspan="4">JUMLAH (${baris.length} siswa · L ${L} / P ${P})</td>
              <td class="px-2">${num(tot.H)}</td><td class="px-2">${num(tot.S)}</td><td class="px-2">${num(tot.I)}</td><td class="px-2">${num(tot.A)}</td>
              <td class="px-2">${tot.total}</td><td class="px-2"></td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="mt-1 text-xs text-ink/50">Persentase = (H + S) / hari efektif · ${heb} hari efektif di ${BULAN_ID[m - 1]}. Hari efektif selalu dihitung untuk seluruh bulan, termasuk bulan yang sedang berjalan.</p>
    </div>`;
}

function asLiburHtml() {
  const rows = asLiburRows.map((r) => `<li class="flex items-center gap-2 rounded-lg border border-ink/10 px-2 py-1.5 text-xs">
      <span class="font-semibold whitespace-nowrap">${esc(r.tanggal.split('-').reverse().join('/'))}</span>
      <span class="text-ink/50 whitespace-nowrap">Libur</span>
      <span class="flex-1 truncate" title="${esc(r.keterangan || '')}">${esc(r.keterangan || '')}</span>
      <button data-as="libur-hapus" data-libur="${esc(r.tanggal)}" class="text-red-700 hover:underline whitespace-nowrap">Hapus</button>
    </li>`).join('') || '<li class="text-xs text-ink/50">Belum ada tanggal merah manual bulan ini.</li>';
  return `
    <details class="text-sm">
      <summary class="cursor-pointer font-semibold">Input tanggal merah (libur nasional / sekolah)</summary>
      <div class="mt-2 space-y-2">
        <div class="flex flex-wrap items-end gap-2">
          <label class="text-sm font-semibold">Tanggal <input id="as-m-tanggal" type="date" class="${AS_INP} ml-1 font-normal"></label>
          <label class="text-sm font-semibold">Keterangan <input id="as-m-ket" type="text" placeholder="mis. Libur sekolah" class="${AS_INP} ml-1 font-normal w-48"></label>
          <button data-as="libur-tambah" class="${AS_BTN}">Tambah</button>
        </div>
        <ul class="space-y-1">${rows}</ul>
        <p class="text-xs text-ink/50">Sabtu-Minggu otomatis merah. Menambah/menghapus tanggal merah mengubah jumlah hari efektif dan rekap.</p>
      </div>
    </details>`;
}

function asTandaiUbah(teks) {
  const st = $('#as-status');
  if (!st) return;
  st.textContent = teks || '';
  st.className = teks ? 'text-xs font-semibold text-amber-600' : 'text-xs';
}

/* ---------- Aksi sel & tombol ---------- */
function asKlikSel(td) {
  const k = td.dataset.asSel;
  if (!k) return;
  const row = asSel.get(k);
  // Kosong -> H (hadir) -> S -> I -> A -> Kosong
  const baru = !row ? 'H' : row.status === 'H' ? 'S' : row.status === 'S' ? 'I' : row.status === 'I' ? 'A' : null;
  if (baru) asSel.set(k, { status: baru, ket: row ? row.ket : '' });
  else asSel.delete(k);
  const tgl = k.split('|')[1];
  const { cls, tampil } = asSelKelas(tgl, asSel.get(k), true);
  td.className = cls;
  td.textContent = tampil;
  asIsiRekap();
  asSimpanSatu(k);
}

/* Simpan otomatis per sel: upsert bila S/I/A, hapus baris bila kembali ke H.
   Setiap klik sel / edit keterangan langsung dipertahan tanpa tombol simpan. */
const asMenyimpanSatu = new Set();
async function asSimpanSatu(k) {
  if (asMenyimpanSatu.has(k)) return;
  if (!asKelas.some((kk) => String(kk.id) === String(asRombel))) return;
  const [sid, tgl] = k.split('|');
  asMenyimpanSatu.add(k);
  asTandaiUbah('Menyimpan otomatis…');
  try {
    const row = asSel.get(k);
    if (row) {
      const { error } = await sb.from('absensi_siswa').upsert(
        [{ siswa_id: Number(sid), tanggal: tgl, kelas_id: Number(asRombel), status: row.status, keterangan: row.ket || null }],
        { onConflict: 'tanggal,siswa_id' },
      );
      if (error) throw error;
    } else {
      const { error } = await sb.from('absensi_siswa').delete().eq('tanggal', tgl).eq('siswa_id', Number(sid));
      if (error) throw error;
    }
    asTandaiUbah('Tersimpan otomatis.');
    const st = $('#as-status');
    if (st) st.className = 'text-xs font-semibold text-hijau';
  } catch (e) {
    asTandaiUbah(asMsgGalat(e, 'Gagal menyimpan otomatis'));
  } finally {
    asMenyimpanSatu.delete(k);
  }
}

async function asLiburTambah() {
  const elT = $('#as-m-tanggal'), elK = $('#as-m-ket');
  if (!elT) return;
  const tanggal = elT.value, ket = (elK.value || '').trim();
  if (!tanggal) return alert('Pilih tanggal dulu.');
  if (!ket) return alert('Isi keterangan tanggal merah.');
  if (!tanggal.startsWith(asBulan)) return alert('Tanggal di luar bulan yang sedang ditampilkan (' + asBulan + ').');
  const d = new Date(tanggal + 'T00:00:00');
  if (d.getDay() === 0 || d.getDay() === 6) return alert('Sabtu-Minggu sudah otomatis merah, tidak perlu ditambah.');
  // Dedup: bila tanggal sudah ada (unique tanggal), upsert hanya memperbarui keterangan.
  const { error } = await sb.from('absensi_libur').upsert({ tanggal, keterangan: ket }, { onConflict: 'tanggal' });
  if (error) {
    const semua = merahManual();
    semua[tanggal] = ket;
    simpanManual(semua);
  }
  liburCache.delete(tanggal.slice(0, 7));
  await asMuatBulan();
}

async function asLiburHapus(k) {
  if (!confirm('Hapus tanggal merah ' + k + '?')) return;
  const { error } = await sb.from('absensi_libur').delete().eq('tanggal', k);
  if (error) {
    const semua = merahManual();
    delete semua[k];
    simpanManual(semua);
  }
  liburCache.delete(k.slice(0, 7));
  await asMuatBulan();
}

/* ---------- Event (delegasi, hanya area #as-root) ---------- */
/* Klik sel ditunda 250 ms agar klik ganda (keterangan) tidak ikut memutar status. */
let asTundaKlik = 0, asSelTunda = null;

document.addEventListener('click', (e) => {
  const root = $('#as-root');
  if (!root || !root.contains(e.target)) return;
  const t = e.target.closest('[data-as]');
  if (t) {
    if (t.dataset.as === 'libur-tambah') asLiburTambah();
    else if (t.dataset.as === 'libur-hapus') asLiburHapus(t.dataset.libur);
    else if (t.dataset.as === 'cetak') asCetak();
    else if (t.dataset.as === 'pdf') asUnduhPdf();
    else if (t.dataset.as === 'xlsx') asUnduhExcel();
    else if (t.dataset.as === 'xlsx-semua') asUnduhExcelSemua();
    return;
  }
  const sel = e.target.closest('td[data-as-sel]');
  if (!sel) return;
  clearTimeout(asTundaKlik);
  asSelTunda = sel;
  asTundaKlik = setTimeout(() => { asKlikSel(asSelTunda); asSelTunda = null; }, 250);
});

document.addEventListener('dblclick', (e) => {
  const td = e.target.closest ? e.target.closest('td[data-as-sel]') : null;
  if (!td || !td.dataset.asSel || asSelTunda !== td) return;
  clearTimeout(asTundaKlik);
  asSelTunda = null;
  asKeterangan(td);
});

function asKeterangan(td) {
  const row = asSel.get(td.dataset.asSel);
  if (!row) return alert('Klik dulu sel untuk memilih S/I/A, lalu klik ganda untuk mengisi keterangan.');
  const tgl = td.dataset.asSel.split('|')[1];
  const ket = prompt('Keterangan (opsional) untuk ' + row.status + ' tanggal ' + tgl + ':', row.ket || '');
  if (ket === null) return;
  asSel.set(td.dataset.asSel, { status: row.status, ket: ket.trim() });
  asSimpanSatu(td.dataset.asSel);
}

document.addEventListener('change', (e) => {
  if (e.target.id === 'as-bulan') { asBulan = e.target.value || asBulanIni(); asMuatBulan(); }
  else if (e.target.id === 'as-rombel') { const v = Number(e.target.value); if (v) { asRombel = v; asMuatBulan(); } }
});
/* ---------- M4: Cetak / Unduh PDF / Unduh Excel — layout "Daftar Hadir Siswa" F4 landscape ---------- */
const AS_WARNA_PDF = { S: [255, 255, 153], I: [189, 215, 238], A: [255, 199, 206] };

function asMetaOutput(rombel) {
  const r = rombel || asKelas.find((k) => String(k.id) === String(asRombel)) || {};
  const [y, m] = asBulan.split('-').map(Number);
  const wali = asGuru.find((g) => String(g.id) === String(r.wali_guru_id)) || null;
  return {
    rombel: r, wali,
    judul: ['DAFTAR HADIR SISWA', 'SD NEGERI SUKAMAH 03', 'TAHUN PELAJARAN ' + (asSetelan.tahun_pelajaran || '-')],
    info: 'Jenis Rombel: Kelas Utama - Nama Rombel: ' + (r.nama || '-') + ' - Semester ' + (asSetelan.semester || '-') + ' - Wali: ' + (wali ? wali.nama : 'belum ada'),
    bulanLabel: 'Bulan ' + BULAN_ID[m - 1] + ' ' + y,
    tglAkhir: hariDiBulan(asBulan) + ' ' + BULAN_ID[m - 1] + ' ' + y,
  };
}

function asNamaFile() {
  const r = asKelas.find((k) => String(k.id) === String(asRombel));
  return (r ? r.nama : '-') + '_' + asBulan;
}

function asBuatPdf(st, meta, sel) {
  const doc = new window.jspdf.jsPDF({ unit: 'mm', format: [215, 287], orientation: 'landscape', compress: true });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  const ML = 6, MR = 6, MERAH = [255, 0, 0];
  const n = hariDiBulan(asBulan);
  const redSet = new Set();
  for (let d = 1; d <= n; d++) if (asMerah(tglKey(asBulan, d))) redSet.add(4 + d);

  doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
  meta.judul.forEach((t, i) => doc.text(t, W / 2, 9 + i * 4.5, { align: 'center' }));
  doc.setFont('helvetica', 'normal'); doc.setFontSize(6);
  doc.text(meta.info, W / 2, 24.5, { align: 'center' });

  const fix = [8, 13, 13, 44, 7], jml = [6, 6, 6];
  const dayW = (W - ML - MR - fix.reduce((a, b) => a + b, 0) - jml.reduce((a, b) => a + b, 0)) / n;
  const columnStyles = {};
  fix.forEach((w, i) => { columnStyles[i] = { cellWidth: w }; });
  columnStyles[3] = { cellWidth: fix[3], halign: 'left' };
  for (let i = 0; i < n; i++) columnStyles[5 + i] = { cellWidth: dayW };
  jml.forEach((w, i) => { columnStyles[5 + n + i] = { cellWidth: w }; });

  // Header 2 baris (tanpa rowSpan bersarang — autotable merendernya rapi)
  const head = [
    [
      { content: 'No', rowSpan: 2 }, { content: 'NIS', rowSpan: 2 }, { content: 'NISN', rowSpan: 2 },
      { content: 'NAMA SISWA', rowSpan: 2 }, { content: 'L/P', rowSpan: 2 },
      { content: meta.bulanLabel, colSpan: n }, { content: 'Keterangan', colSpan: 3 },
    ],
    [...Array.from({ length: n }, (_, i) => String(i + 1)), 'S', 'I', 'A'],
  ];
  const cut = asCutoff(asBulan);
  const body = st.baris.map((r, i) => {
    const row = [String(i + 1), r.s.nis || '', r.s.nisn || '', r.s.nama, r.s.jenis_kelamin === 'Laki-laki' ? 'L' : r.s.jenis_kelamin === 'Perempuan' ? 'P' : ''];
    for (let d = 1; d <= n; d++) {
      const tgl = tglKey(asBulan, d);
      const rec = sel.get(r.s.id + '|' + tgl);
      row.push(rec ? (rec.status === 'H' ? '•' : rec.status) : '');
    }
    row.push(r.S ? String(r.S) : '', r.I ? String(r.I) : '', r.A ? String(r.A) : '');
    return row;
  });
  body.push([{ content: 'JUMLAH', colSpan: 4 }, ...Array.from({ length: n }, () => ''), st.tot.S ? String(st.tot.S) : '0', st.tot.I ? String(st.tot.I) : '0', st.tot.A ? String(st.tot.A) : '0']);

  // Tinggi baris dikompresi otomatis bila rombelnya besar, agar blok RESUME + tanda
  // tangan tetap muat di halaman F4 landscape yang sama (H = 215mm). Kelas kecil
  // (±25 siswa) tetap memakai tinggi 4mm seperti sebelumnya; kelas sangat besar
  // (di atas ±48 siswa) masih jatuh ke fallback addPage di bawah.
  const nRows = st.baris.length + 3; // 2 baris header + baris JUMLAH
  const hTersedia = H - 27 - 62; // 62 ≈ RESUME (16) + celah (15) + TTD (30) + margin
  const minCell = Math.min(4, Math.max(2.6, hTersedia / nRows));

  doc.autoTable({
    startY: 27, theme: 'grid', head, body, columnStyles, margin: { left: ML, right: MR },
    styles: { font: 'helvetica', fontSize: 5, cellPadding: 0.4, halign: 'center', valign: 'middle', lineColor: [0, 0, 0], lineWidth: 0.08, minCellHeight: minCell, textColor: [0, 0, 0] },
    headStyles: { fillColor: [235, 235, 235], textColor: [0, 0, 0], fontStyle: 'bold' },
    didParseCell: (d) => {
      const ci = d.column.index;
      if (d.section === 'head') {
        d.cell.styles.fillColor = [235, 235, 235];
        d.cell.styles.textColor = [0, 0, 0];
        if (d.row.index === 1 && redSet.has(ci)) {
          // Baris nomor hari: tanggal merah = isian merah, teks putih
          d.cell.styles.fillColor = MERAH;
          d.cell.styles.textColor = [255, 255, 255];
        }
        return;
      }
      if (redSet.has(ci)) {
        d.cell.styles.fillColor = MERAH;
        return;
      }
      if (d.row.index < st.baris.length) {
        const v = String(d.cell.raw ?? '');
        if (v === 'S') d.cell.styles.fillColor = AS_WARNA_PDF.S;
        else if (v === 'I') d.cell.styles.fillColor = AS_WARNA_PDF.I;
        else if (v === 'A') d.cell.styles.fillColor = AS_WARNA_PDF.A;
      }
    },
  });
  // RESUME (blok rekap presensi di tengah antara posisi tanda tangan kepsek dan wali kelas)
  let yB = doc.lastAutoTable.finalY + 5;
  if (yB > H - 40) { doc.addPage(); yB = 12; }
  const rekapW = [22, 22, 18, 17, 17, 17, 17];
  const RESUME_HIJAU = [26, 188, 156]; // hijau latar resume, teks hitam
  const totalRekapW = rekapW.reduce((a, b) => a + b, 0);
  const xResume = (W - totalRekapW) / 2;

  doc.autoTable({
    startY: yB,
    margin: { left: xResume },
    theme: 'grid',
    head: [
      [{ content: 'RESUME', colSpan: 7, styles: { fontStyle: 'bold', halign: 'center', fillColor: RESUME_HIJAU, textColor: [0, 0, 0] } }],
      ['Laki-Laki', 'Perempuan', 'Hari Efektif', { content: 'Prosentase', colSpan: 4 }],
    ],
    body: [
      [st.L + ' Orang', st.P + ' Orang', String(st.heb), 'Sakit (S) ' + st.pctS, 'Izin (I) ' + st.pctI, 'Alpa (A) ' + st.pctA, 'Kehadiran ' + st.pctH],
      [{ content: 'Jumlah', colSpan: 2 }, { content: st.n + ' Orang', colSpan: 5 }],
    ],
    styles: { font: 'helvetica', fontSize: 6, cellPadding: 0.8, halign: 'center', minCellHeight: 4, textColor: [0, 0, 0] },
    headStyles: { fillColor: [235, 235, 235], textColor: [0, 0, 0], fontStyle: 'bold' },
    columnStyles: Object.fromEntries(rekapW.map((w, i) => [i, { cellWidth: w }])),
  });

  // Blok tanda tangan: kiri = kepsek (mengetahui + area cap), kanan = wali kelas (dipilih admin)
  let yT = doc.lastAutoTable.finalY + 10;
  if (yT + 30 > H) { doc.addPage(); yT = 15; }
  doc.setFont('helvetica', 'normal'); doc.setFontSize(6); doc.setTextColor(0); doc.setLineWidth(0.2);
  // Ruang tanda tangan lebih luas; NIP menempel di bawah garis nama (tanpa gap)
  doc.text('Mengetahui,', ML + 4, yT);
  doc.text('Kepala Sekolah,', ML + 4, yT + 3.5);
  doc.setFont('helvetica', 'bold');
  doc.text(KEPSEK_DEF.nama, ML + 4, yT + 18);
  doc.line(ML + 4, yT + 18.8, ML + 4 + doc.getTextWidth(KEPSEK_DEF.nama), yT + 18.8);
  doc.setFont('helvetica', 'normal');
  doc.text('NIP. ' + KEPSEK_DEF.nip, ML + 4, yT + 21.5);
  const rx = W - MR - 48;
  doc.text('Cikarang Pusat, ' + meta.tglAkhir, rx, yT);
  doc.text('Wali Kelas', rx, yT + 3.5);
  if (meta.wali) {
    doc.setFont('helvetica', 'bold');
    doc.text(meta.wali.nama, rx, yT + 18);
    doc.line(rx, yT + 18.8, rx + doc.getTextWidth(meta.wali.nama), yT + 18.8);
    doc.setFont('helvetica', 'normal');
    if (meta.wali.nip) doc.text('NIP. ' + fmtNip(meta.wali.nip), rx, yT + 21.5);
  } else doc.text('— belum ada —', rx, yT + 18);
  return doc;
}

function asBuatSheet(X, st, meta, sel) {
  const n = hariDiBulan(asBulan);
  const cS = 5 + n, cI = 6 + n, cA = 7 + n, last = cA;
  const ws = X.utils.aoa_to_sheet([
    [meta.judul[0]],
    [meta.judul[1]],
    [meta.judul[2]],
    [meta.info],
    ['NOMOR', '', '', 'NAMA SISWA', 'L/P', meta.bulanLabel, ...Array(Math.max(n - 1, 0)).fill(''), 'Keterangan', '', ''],
    ['URUT', 'NIS', 'NISN', '', '', 'Tanggal', ...Array(Math.max(n - 1, 0)).fill(''), 'S', 'I', 'A'],
    [...Array(5).fill(''), ...Array.from({ length: n }, (_, i) => i + 1)],
  ]);
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: last } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: last } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: last } },
    { s: { r: 3, c: 0 }, e: { r: 3, c: last } },
    { s: { r: 4, c: 0 }, e: { r: 4, c: 2 } },
    { s: { r: 4, c: 3 }, e: { r: 6, c: 3 } },
    { s: { r: 4, c: 4 }, e: { r: 6, c: 4 } },
    { s: { r: 4, c: 5 }, e: { r: 4, c: cS - 1 } },
    { s: { r: 4, c: cS }, e: { r: 4, c: last } },
    { s: { r: 5, c: 5 }, e: { r: 5, c: cS - 1 } },
    { s: { r: 5, c: 0 }, e: { r: 6, c: 0 } },
    { s: { r: 5, c: 1 }, e: { r: 6, c: 1 } },
    { s: { r: 5, c: 2 }, e: { r: 6, c: 2 } },
    { s: { r: 5, c: cS }, e: { r: 6, c: cS } },
    { s: { r: 5, c: cI }, e: { r: 6, c: cI } },
    { s: { r: 5, c: cA }, e: { r: 6, c: cA } },
  ];
  [0, 1, 2].forEach((r) => { const a = X.utils.encode_cell({ r, c: 0 }); if (ws[a]) ws[a].s = { font: { bold: true, sz: 14 - r } }; });
  const aInfo = X.utils.encode_cell({ r: 3, c: 0 }); if (ws[aInfo]) aInfo.s = { font: { italic: true } };
  // Pita header utama: latar abu-abu + teks hitam + rata tengah (seragam dengan PDF)
  for (let hr = 4; hr <= 6; hr++) {
    for (let hc = 0; hc <= last; hc++) {
      const a = X.utils.encode_cell({ r: hr, c: hc });
      const prev = ws[a] || {};
      const font = Object.assign({ color: { rgb: '000000' } }, prev.s && prev.s.font ? prev.s.font : {});
      if (hr < 6) font.bold = true;
      ws[a] = { t: prev.t ? prev.t : 's', v: (prev.v !== undefined ? prev.v : ''), s: { font, fill: { fgColor: { rgb: 'EBEBEB' } }, alignment: { horizontal: 'center' } } };
    }
  }

  const cut = asCutoff(asBulan);
  st.baris.forEach((r, i) => {
    const rr = 7 + i;
    const setSel = (c, v, s) => { const a = X.utils.encode_cell({ r: rr, c }); ws[a] = s ? { t: 's', v: String(v), s } : (v === 0 ? { t: 'n', v } : { t: 's', v: String(v) }); };
    setSel(0, i + 1);
    setSel(1, r.s.nis || '');
    setSel(2, r.s.nisn || '');
    setSel(3, r.s.nama);
    setSel(4, r.s.jenis_kelamin === 'Laki-laki' ? 'L' : r.s.jenis_kelamin === 'Perempuan' ? 'P' : '');
    for (let d = 1; d <= n; d++) {
      const c = 4 + d;
      const tgl = tglKey(asBulan, d);
      const rec = sel.get(r.s.id + '|' + tgl);
      let v = '';
      if (rec) v = rec.status === 'H' ? '●' : rec.status;
      const a = X.utils.encode_cell({ r: rr, c });
      if (asMerah(tgl)) ws[a] = { t: 's', v, s: { fill: { fgColor: { rgb: 'FF5555' } }, font: { color: { rgb: '000000' } } } };
      else if (v === 'S') ws[a] = { t: 's', v, s: { fill: { fgColor: { rgb: 'FFFF99' } }, font: { bold: true } } };
      else if (v === 'I') ws[a] = { t: 's', v, s: { fill: { fgColor: { rgb: 'BDD7EE' } } } };
      else if (v === 'A') ws[a] = { t: 's', v, s: { fill: { fgColor: { rgb: 'FFC7CE' } }, font: { color: { rgb: '9C0006' }, bold: true } } };
      else ws[a] = { t: 's', v };
    }
    setSel(cS, r.S ? r.S : 0);
    setSel(cI, r.I ? r.I : 0);
    setSel(cA, r.A ? r.A : 0);
  });

  const jr = 7 + st.n;
  ws[X.utils.encode_cell({ r: jr, c: 3 })] = { t: 's', v: 'JUMLAH', s: { font: { bold: true } } };
  [[st.tot.S, cS], [st.tot.I, cI], [st.tot.A, cA]].forEach(([v, c]) => { ws[X.utils.encode_cell({ r: jr, c })] = { t: 'n', v }; });

  const setT = (r, c, v, s) => {
    const a = X.utils.encode_cell({ r, c });
    ws[a] = s ? { t: 's', v: String(v), s } : (v === 0 ? { t: 'n', v } : { t: 's', v: String(v) });
  };
  const rr = jr + 2;
  const RESUME_HIJAU_X = '1ABC9C', GRAY_HEADER_X = 'EBEBEB'; // seragam dengan warna PDF
  const tengah = { horizontal: 'center' };
  // Judul RESUME: latar hijau + teks hitam + bold (sama dengan PDF)
  ws[X.utils.encode_cell({ r: rr, c: 3 })] = { t: 's', v: 'RESUME', s: { font: { bold: true, color: { rgb: '000000' } }, fill: { fgColor: { rgb: RESUME_HIJAU_X } }, alignment: tengah } };
  ws['!merges'].push({ s: { r: rr, c: 3 }, e: { r: rr, c: 9 } });
  // Baris label: latar abu-abu + teks hitam + bold (sama dengan judul tabel PDF)
  const labelX = { font: { bold: true, color: { rgb: '000000' } }, fill: { fgColor: { rgb: GRAY_HEADER_X } }, alignment: tengah };
  setT(rr + 1, 3, 'Laki-Laki', labelX); setT(rr + 1, 4, 'Perempuan', labelX); setT(rr + 1, 5, 'Hari Efektif', labelX);
  setT(rr + 1, 6, 'Prosentase', labelX);
  ws['!merges'].push({ s: { r: rr + 1, c: 6 }, e: { r: rr + 1, c: 9 } });
  const nilaiX = { font: { color: { rgb: '000000' } }, alignment: tengah };
  setT(rr + 2, 3, st.L + ' Orang', nilaiX); setT(rr + 2, 4, st.P + ' Orang', nilaiX); setT(rr + 2, 5, st.heb, nilaiX);
  setT(rr + 2, 6, 'Sakit (S) ' + st.pctS, nilaiX); setT(rr + 2, 7, 'Izin (I) ' + st.pctI, nilaiX); setT(rr + 2, 8, 'Alpa (A) ' + st.pctA, nilaiX); setT(rr + 2, 9, 'Kehadiran ' + st.pctH, nilaiX);
  setT(rr + 3, 3, 'Jumlah', nilaiX); setT(rr + 3, 5, st.n + ' Orang', nilaiX);
  ws['!merges'].push({ s: { r: rr + 3, c: 3 }, e: { r: rr + 3, c: 4 } });

  const tr = rr + 5;
  setT(tr, 1, 'Mengetahui,'); setT(tr + 1, 1, 'Kepala Sekolah,');
  setT(tr + 4, 1, KEPSEK_DEF.nama, { font: { bold: true, underline: 'single' } });
  setT(tr + 5, 1, 'NIP. ' + KEPSEK_DEF.nip);
  setT(tr, 12, 'Cikarang Pusat, ' + meta.tglAkhir); setT(tr + 1, 12, 'Wali Kelas');
  if (meta.wali) {
    setT(tr + 4, 12, meta.wali.nama, { font: { bold: true, underline: 'single' } });
    if (meta.wali.nip) setT(tr + 5, 12, 'NIP. ' + fmtNip(meta.wali.nip));
  } else setT(tr + 4, 12, '— belum ada —');

  ws['!cols'] = [{ wch: 4 }, { wch: 11 }, { wch: 11 }, { wch: 26 }, { wch: 4 }, ...Array(n).fill({ wch: 3 }), { wch: 6 }, { wch: 6 }, { wch: 6 }];
  // SheetJS hanya menulis sel di dalam !ref (default dari aoa = baris header saja).
  // Perlu diperluas sampai baris TTD agar data siswa, JUMLAH, RESUME & TTD ikut terunduh.
  ws['!ref'] = X.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: tr + 5, c: last } });
  return ws;
}

function asPdfSiap() {
  if (typeof window.jspdf === 'undefined') { alert('Library PDF belum termuat. Muat ulang halamannya.'); return false; }
  return true;
}

async function asUnduhExcel() {
  const daftar = asSiswaAktif();
  if (!daftar.length) return alert('Belum ada siswa aktif di rombel ini.');
  let X;
  try { X = await muatXlsx(); } catch (e) { return alert(galatXlsx(e)); }
  const rombel = asKelas.find((k) => String(k.id) === String(asRombel));
  const st = asStatistik(daftar, asSel, asBulan);
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, asBuatSheet(X, st, asMetaOutput(rombel), asSel), rombel ? rombel.nama : 'Siswa');
  X.writeFile(wb, 'DaftarHadir_' + asNamaFile() + '.xlsx');
}

async function asUnduhExcelSemua() {
  if (!adalahAdmin()) return;
  let X;
  try { X = await muatXlsx(); } catch (e) { return alert(galatXlsx(e)); }
  const akhir = tglKey(asBulan, hariDiBulan(asBulan));
  const { data, error } = await sb.from('absensi_siswa').select('kelas_id,siswa_id,status,keterangan').gte('tanggal', asBulan + '-01').lte('tanggal', akhir);
  if (error) return alert(asMsgGalat(error, 'Gagal memuat absensi semua rombel'));
  const perKelas = new Map();
  (data || []).forEach((r) => {
    const m = perKelas.get(String(r.kelas_id)) || new Map();
    m.set(r.siswa_id + '|' + r.tanggal, { status: r.status, ket: r.keterangan || '' });
    perKelas.set(String(r.kelas_id), m);
  });
  const wb = X.utils.book_new();
  const rekapBaris = [['Rombel', 'Siswa', 'L', 'P', 'Hari Efektif', 'H', 'S', 'I', 'A', 'Prosentase Kehadiran']];
  asKelas.forEach((k) => {
    const daftar = asSiswa.filter((s) => String(s.kelas_id) === String(k.id) && s.status === 'aktif');
    const sel = perKelas.get(String(k.id)) || new Map();
    const st = asStatistik(daftar, sel, asBulan);
    X.utils.book_append_sheet(wb, asBuatSheet(X, st, asMetaOutput(k), sel), String(k.nama).replace(/[\\/?*[\]:]/g, '').slice(0, 31) || 'rombel');
    rekapBaris.push([k.nama, st.n, st.L, st.P, st.heb, st.tot.H, st.tot.S, st.tot.I, st.tot.A, st.pctH]);
  });
  const wsR = X.utils.aoa_to_sheet(rekapBaris);
  wsR['!cols'] = [{ wch: 10 }, { wch: 8 }, { wch: 4 }, { wch: 4 }, { wch: 6 }, { wch: 5 }, { wch: 5 }, { wch: 5 }, { wch: 5 }, { wch: 20 }];
  rekapBaris[0].forEach((v, i) => { const a = X.utils.encode_cell({ r: 0, c: i }); if (wsR[a]) wsR[a].s = { font: { bold: true } }; });
  X.utils.book_append_sheet(wb, wsR, 'Rekap');
  X.writeFile(wb, 'DaftarHadir_SemuaRombel_' + asBulan + '.xlsx');
}

function asUnduhPdf() {
  const daftar = asSiswaAktif();
  if (!daftar.length) return alert('Belum ada siswa aktif di rombel ini.');
  if (!asPdfSiap()) return;
  const st = asStatistik(daftar, asSel, asBulan);
  asBuatPdf(st, asMetaOutput(), asSel).save('DaftarHadir_' + asNamaFile() + '.pdf');
}

function asCetak() {
  const daftar = asSiswaAktif();
  if (!daftar.length) return alert('Belum ada siswa aktif di rombel ini.');
  if (!asPdfSiap()) return;
  const st = asStatistik(daftar, asSel, asBulan);
  const doc = asBuatPdf(st, asMetaOutput(), asSel);
  doc.autoPrint();
  if (!window.open(doc.output('bloburl'), '_blank')) alert('Pop-up diblokir browser. Izinkan pop-up untuk halaman ini, lalu coba lagi.');
}


