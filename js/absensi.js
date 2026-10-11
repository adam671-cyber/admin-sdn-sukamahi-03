/* Absensi pegawai: rekap bulanan + tanggal merah (otomatis + manual) */
/* ponytail: manual di localStorage, naik ke tabel Supabase saat perlu multi-device */
const BULAN_ID = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const liburCache = new Map();
let absensiGuru = [], absensiMap = new Map(), absensiLibur = new Map();

const merahManual = () => { try { return JSON.parse(localStorage.getItem('tanggal_merah') || '{}'); } catch { return {}; } };
const simpanManual = (o) => localStorage.setItem('tanggal_merah', JSON.stringify(o));

const blnVal = () => $('#a-bulan').value || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' }).slice(0, 7);
const hariDiBulan = (bln) => { const [y, m] = bln.split('-').map(Number); return new Date(y, m, 0).getDate(); };
const tglKey = (bln, d) => bln + '-' + String(d).padStart(2, '0');

async function liburBulan(bln) {
  if (liburCache.has(bln)) return liburCache.get(bln);
  const m = new Map(Object.entries(merahManual()).filter(([k]) => String(k).startsWith(bln)));
  try {
    const r = await fetch(`https://date.nager.at/api/v3/publicholidays/${bln.slice(0, 4)}/ID`);
    if (r.ok) (await r.json()).forEach((h) => { if (String(h.date).startsWith(bln) && !m.has(h.date)) m.set(h.date, h.localName || h.name); });
  } catch { /* offline: tetap jalan, hanya Sabtu-Minggu + manual */ }
  liburCache.set(bln, m);
  return m;
}

async function muatAbsensi() {
  const bln = blnVal();
  if (!$('#a-bulan').value) $('#a-bulan').value = bln;
  const [{ data: g, error: e1 }, { data: a, error: e2 }, libur] = await Promise.all([
    sb.from('guru').select('*').order('nama'),
    sb.from('absensi').select('*').gte('tanggal', bln + '-01').lte('tanggal', tglKey(bln, hariDiBulan(bln))),
    liburBulan(bln),
  ]);
  if (e1) return alert('Gagal memuat guru: ' + e1.message);
  if (e2) return alert('Gagal memuat absensi: ' + e2.message);
  absensiGuru = g || [];
  try {
    const rk = (x) => rankJabat(jabatBaku(x.jabatan));
    absensiGuru.sort((a, b) => rk(a) - rk(b) || ((jabatBaku(a.jabatan) === 'Guru Mapel' && jabatBaku(b.jabatan) === 'Guru Mapel') ? (rankMapel(a) - rankMapel(b) || String(a.nama || '').localeCompare(String(b.nama || ''), 'id')) : 0) || rankStatus(a) - rankStatus(b) || rankPangkat(b) - rankPangkat(a) || rankNama(a) - rankNama(b) || String(a.nama || '').localeCompare(String(b.nama || ''), 'id'));
  } catch { absensiGuru.sort((a, b) => String(a.nama || '').localeCompare(String(b.nama || ''), 'id')); }
  absensiMap = new Map((a || []).map((x) => [x.tanggal + '|' + x.guru_id, x]));
  absensiLibur = libur;
  renderRekap(bln);
  renderDaftarMerah(bln);
}

const gol = (g) => (g.profil || g.data || {}).pangkat || g.pangkat || '-';
const liburTgl = (key) => { const d = new Date(key + 'T00:00:00'); return d.getDay() === 0 || d.getDay() === 6 ? (absensiLibur.get(key) || (d.getDay() === 0 ? 'Hari Minggu' : 'Hari Sabtu')) : absensiLibur.get(key); };

const KEPSEK_DEF = { nama: 'KASWIN KARTAWIJAYA, M.Pd', nip: '19720506 199903 1 007' };
const fmtNip = (n) => { const d = String(n || '').replace(/\D/g, ''); return d.length === 18 ? `${d.slice(0, 8)} ${d.slice(8, 14)} ${d[14]} ${d.slice(15)}` : String(n || '').trim(); };
const golAbsen = (g) => {
  const v = gol(g);
  if (!v || v === '-') return '';
  const m = String(v).match(/\b(IV|III|II|I)\s*[\/.\-]?\s*([A-Ea-e])\b/);
  return m ? `${m[1]}/${m[2].toLowerCase()}` : String(v).trim();
};
const jabatanAbsen = (g) => {
  const j = jabatBaku(g.jabatan);
  if (j === 'Guru Kelas') return 'Guru';
  if (j === 'Guru Mapel') return /pai/i.test(g.jabatan) ? 'Guru PAI' : 'Guru Mapel';
  if (j === 'Operator') return 'Operator/ TU';
  if (j === 'Kebersihan') return 'OB';
  return j;
};
const kepsekAbsen = () => {
  const k = absensiGuru.find((g) => jabatBaku(g.jabatan) === 'Kepala Sekolah');
  return { nama: k?.nama || KEPSEK_DEF.nama, nip: k?.nip ? fmtNip(k.nip) : KEPSEK_DEF.nip };
};

function hitungRekap(bln) {
  const n = hariDiBulan(bln);
  const libur = Array.from({ length: n }, (_, d) => liburTgl(tglKey(bln, d + 1)) || null);
  const baris = absensiGuru.map((g) => {
    let s = 0, iz = 0, a = 0;
    const sel = libur.map((lb, d) => {
      if (lb) return null;
      const st = absensiMap.get(tglKey(bln, d + 1) + '|' + g.id)?.status;
      if (st === 'Sakit') { s++; return 'S'; }
      if (st === 'Izin') { iz++; return 'I'; }
      if (st === 'Alpa') { a++; return 'A'; }
      return st === 'Hadir' ? '✓' : '';
    });
    return { g, sel, s, iz, a, jml: s + iz + a };
  });
  const tot = baris.reduce((t, r) => ({ s: t.s + r.s, iz: t.iz + r.iz, a: t.a + r.a, jml: t.jml + r.jml }), { s: 0, iz: 0, a: 0, jml: 0 });
  return { n, libur, baris, tot };
}

function renderRekap(bln) {
  const [y, m] = bln.split('-').map(Number);
  const { n, libur, baris, tot } = hitungRekap(bln);
  const C = 'border border-ink/10';
  const th = `<tr><th rowspan="2" class="px-2 py-2 ${C}">No.<br>Urut</th><th rowspan="2" class="px-2 py-2 ${C} text-left">Nama Pegawai / Guru</th><th rowspan="2" class="px-2 py-2 ${C}">Golongan<br>Ruang</th><th rowspan="2" class="px-2 py-2 ${C}">Jabatan</th><th colspan="${n}" class="px-2 py-1 ${C} tracking-[.35em]">Tanggal</th><th colspan="4" class="px-2 py-1 ${C} tracking-[.35em]">Jumlah</th></tr>`
    + `<tr>${libur.map((lb, i) => `<th class="px-1 py-1 ${C} min-w-[1.6rem] ${lb ? 'bg-red-600 text-white' : ''}" title="${esc(lb || '')}">${i + 1}</th>`).join('')}<th class="px-1 py-1 ${C}">S</th><th class="px-1 py-1 ${C}">I</th><th class="px-1 py-1 ${C}">A</th><th class="px-1 py-1 ${C}">JML</th></tr>`;
  $('#a-thead').innerHTML = th;

  const sel = (r, i) => libur.map((lb, d) => lb
    ? (i === 0 ? `<td rowspan="${baris.length + 1}" class="${C} bg-red-600 text-white p-0"><div class="mx-auto [writing-mode:vertical-rl] rotate-180 whitespace-nowrap text-[10px] font-bold">${esc(lb)}</div></td>` : '')
    : `<td class="${C}">${esc(r.sel[d])}</td>`).join('');
  const num = (v) => (v || '');
  const isi = baris.map((r, i) => `<tr><td class="${C} px-1">${i + 1}</td><td class="${C} px-2 text-left font-semibold">${esc(r.g.nama)}<br><span class="font-normal text-ink/60">NIP. ${esc(r.g.nip || '-')}</span></td><td class="${C} px-1">${esc(golAbsen(r.g))}</td><td class="${C} px-1">${esc(jabatanAbsen(r.g))}</td>${sel(r, i)}<td class="${C}">${num(r.s)}</td><td class="${C}">${num(r.iz)}</td><td class="${C}">${num(r.a)}</td><td class="${C}">${num(r.jml)}</td></tr>`).join('');
  const jumlah = baris.length
    ? `<tr class="font-bold"><td colspan="4" class="${C} py-1">JUMLAH</td>${libur.map((lb) => (lb ? '' : `<td class="${C}"></td>`)).join('')}<td class="${C}">${num(tot.s)}</td><td class="${C}">${num(tot.iz)}</td><td class="${C}">${num(tot.a)}</td><td class="${C}">${num(tot.jml)}</td></tr>`
    : '';
  $('#a-tabel-body').innerHTML = isi + jumlah || `<tr><td colspan="${8 + n}" class="px-2.5 py-8 text-center text-ink/50">Belum ada data guru. Isi lewat menu Data Guru.</td></tr>`;

  const k = kepsekAbsen();
  $('#a-ttd').innerHTML = baris.length ? `<div class="flex flex-wrap justify-between gap-6 text-xs">
    <div class="min-w-[14rem] flex-1"><p>Catatan Khusus :</p><div class="mt-4 space-y-4"><div class="border-b border-dotted border-ink/60"></div><div class="border-b border-dotted border-ink/60"></div><div class="border-b border-dotted border-ink/60"></div></div></div>
    <div class="w-64 shrink-0"><p>Cikarang Pusat, <span class="ml-6">${BULAN_ID[m - 1]} ${y}</span></p><p>Kepala Sekolah,</p><p class="mt-14 font-bold underline">${esc(k.nama)}</p><p>NIP. ${esc(k.nip)}</p></div>
  </div>` : '';
  $('#a-jumlah').textContent = `${absensiGuru.length} pegawai · ${BULAN_ID[m - 1]} ${y} · merah: Sabtu-Minggu + libur nasional + input manual`;
}

function renderDaftarMerah(bln) {
  const ul = $('#m-daftar'); if (!ul) return;
  const semua = merahManual();
  const rows = Object.entries(semua).filter(([k]) => String(k).startsWith(bln)).sort(([a], [b]) => a < b ? -1 : 1);
  ul.innerHTML = rows.map(([k, ket]) => `<li class="flex items-center gap-2 rounded-lg border border-ink/10 px-2 py-1.5 text-xs"><span class="font-semibold whitespace-nowrap">${esc(k.split('-').reverse().join('/'))}</span><span class="flex-1 truncate">${esc(ket)}</span><button data-hapus-merah="${esc(k)}" class="text-red-700 hover:underline">Hapus</button></li>`).join('')
    || '<li class="text-xs text-ink/50 sm:col-span-2">Belum ada tanggal merah manual bulan ini.</li>';
}

$('#a-bulan').onchange = muatAbsensi;
$('#m-simpan').onclick = () => {
  const tanggal = $('#m-tanggal').value, ket = $('#m-ket').value.trim();
  if (!tanggal) return alert('Pilih tanggal dulu.');
  if (!ket) return alert('Isi keterangan tanggal merah.');
  const d = new Date(tanggal + 'T00:00:00');
  if (d.getDay() === 0 || d.getDay() === 6) return alert('Sabtu-Minggu sudah otomatis merah, tidak perlu ditambah.');
  const semua = merahManual();
  semua[tanggal] = ket;
  simpanManual(semua);
  liburCache.delete(tanggal.slice(0, 7));
  $('#m-tanggal').value = ''; $('#m-ket').value = '';
  muatAbsensi();
};
$('#m-daftar').onclick = (e) => {
  const k = e.target.dataset.hapusMerah; if (!k) return;
  if (!confirm('Hapus tanggal merah ' + k + '?')) return;
  const semua = merahManual();
  delete semua[k];
  simpanManual(semua);
  liburCache.delete(k.slice(0, 7));
  muatAbsensi();
};
function buatPdfAbsensi(format) {
  const bln = blnVal(), [y, m] = bln.split('-').map(Number);
  const { n, libur, baris, tot } = hitungRekap(bln);
  const doc = new window.jspdf.jsPDF({ unit: 'mm', format, orientation: 'landscape' });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), ML = 8, MR = 8;
  const MERAH = [255, 0, 0], num = (v) => (v ? String(v) : '');

  doc.setFont('times', 'bold'); doc.setFontSize(10);
  ['REKAPITULASI KEHADIRAN', 'TENAGA PENDIDIK DAN KEPENDIDIKAN ASN', 'SDN SUKAMAHI 03'].forEach((t, i) => doc.text(t, W / 2, 12 + i * 4, { align: 'center' }));
  doc.setFontSize(8); doc.text(`Bulan : ${BULAN_ID[m - 1].toUpperCase()}      Tahun : ${y}`, W / 2, 25, { align: 'center' });

  const fix = [8, 44, 14, 17], jml = [6, 6, 6, 8];
  const dayW = (W - ML - MR - fix.reduce((a, b) => a + b, 0) - jml.reduce((a, b) => a + b, 0)) / n;
  const columnStyles = { 0: { cellWidth: fix[0] }, 1: { cellWidth: fix[1], halign: 'left' }, 2: { cellWidth: fix[2] }, 3: { cellWidth: fix[3] } };
  for (let i = 0; i < n; i++) columnStyles[4 + i] = { cellWidth: dayW };
  jml.forEach((w, i) => { columnStyles[4 + n + i] = { cellWidth: w }; });

  const head = [
    [
      { content: 'No.\nUrut', rowSpan: 2 }, { content: 'Nama Pegawai / Guru', rowSpan: 2 },
      { content: 'Golongan\nRuang', rowSpan: 2 }, { content: 'Jabatan', rowSpan: 2 },
      { content: 'T a n g g a l', colSpan: n }, { content: 'J u m l a h', colSpan: 4 },
    ],
    [...libur.map((_, i) => String(i + 1)), 'S', 'I', 'A', 'JML'],
  ];
  const body = baris.map((r, i) => [i + 1, r.g.nama + '\nNIP. ' + (r.g.nip || '-'), golAbsen(r.g), jabatanAbsen(r.g), ...r.sel.map((s) => s ?? ''), num(r.s), num(r.iz), num(r.a), num(r.jml)]);
  body.push([{ content: 'JUMLAH', colSpan: 4 }, ...libur.map(() => ''), num(tot.s), num(tot.iz), num(tot.a), num(tot.jml)]);

  const kolomLibur = [];
  libur.forEach((lb, i) => { if (lb) kolomLibur.push({ col: 4 + i, label: lb }); });
  const posisi = new Map();
  let atas = 0;
  doc.autoTable({
    startY: 28, theme: 'grid', head, body, columnStyles, margin: { left: ML, right: MR },
    styles: { font: 'helvetica', fontSize: 6, cellPadding: 0.8, textColor: 0, halign: 'center', valign: 'middle', lineColor: 0, lineWidth: 0.1 },
    headStyles: { fillColor: [235, 235, 235], textColor: 0, fontStyle: 'bold' },
    didParseCell: (d) => {
      const idx = d.column.index - 4;
      if (idx < 0 || idx >= n || !libur[idx]) return;
      if (d.section === 'body' || (d.section === 'head' && d.row.index === 1)) {
        d.cell.styles.fillColor = MERAH;
        if (d.section === 'head') d.cell.styles.textColor = 255;
      }
    },
    didDrawCell: (d) => {
      if (d.section !== 'body') return;
      if (d.row.index === 0) { posisi.set(d.column.index, { x: d.cell.x, w: d.cell.width }); atas = d.cell.y; }
    },
  });
  const bawah = doc.lastAutoTable.finalY;
  if (doc.getNumberOfPages() === 1) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(5.5); doc.setTextColor(0);
    kolomLibur.forEach(({ col, label }) => {
      const p = posisi.get(col); if (!p) return;
      doc.setFillColor(...MERAH); doc.rect(p.x, atas, p.w, bawah - atas, 'F');
      doc.setDrawColor(0); doc.setLineWidth(0.1);
      doc.line(p.x, atas, p.x, bawah); doc.line(p.x + p.w, atas, p.x + p.w, bawah);
      doc.text(label, p.x + p.w / 2 + 0.7, (atas + bawah) / 2 + doc.getTextWidth(label) / 2, { angle: 90 });
    });
  }

  let yy = bawah + 6;
  if (yy > H - 30) { doc.addPage(); yy = 20; }
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(0);
  doc.text('Catatan Khusus :', ML + 2, yy);
  doc.setLineDashPattern([0.4, 0.7], 0); doc.setLineWidth(0.2);
  [5, 10, 15].forEach((o) => doc.line(ML + 14, yy + o, W - 132, yy + o));
  doc.setLineDashPattern([], 0);

  const k = kepsekAbsen(), tx = W - 65;
  doc.text('Cikarang Pusat,', tx, yy); doc.text(`${BULAN_ID[m - 1]} ${y}`, tx + 25, yy);
  doc.text('Kepala Sekolah,', tx, yy + 4);
  doc.setFont('helvetica', 'bold'); doc.text(k.nama, tx, yy + 20);
  doc.setLineWidth(0.2); doc.line(tx, yy + 20.8, tx + doc.getTextWidth(k.nama), yy + 20.8);
  doc.setFont('helvetica', 'normal'); doc.text('NIP. ' + k.nip, tx, yy + 24);
  return { doc, bln };
}

$('#a-pdf').onclick = () => {
  if (!absensiGuru.length) return alert('Tidak ada data untuk diunduh.');
  const { doc, bln } = buatPdfAbsensi('a4');
  doc.save(`Rekap-Absensi-${bln}.pdf`);
};
$('#a-cetak').onclick = () => {
  if (!absensiGuru.length) return alert('Tidak ada data untuk dicetak.');
  const { doc } = buatPdfAbsensi([215, 330]);
  doc.autoPrint();
  if (!window.open(doc.output('bloburl'), '_blank')) alert('Pop-up diblokir browser. Izinkan pop-up untuk halaman ini, lalu coba lagi.');
};

addEventListener('hashchange', () => { if (location.hash === '#absensi') muatAbsensi(); });
