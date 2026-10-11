// Deploy: supabase functions deploy agent
// Secret: supabase secrets set GEMINI_API_KEY=... AI_MODEL=gemini-3.6-flash SUPABASE_SERVICE_ROLE_KEY=...
import { createClient } from 'npm:@supabase/supabase-js@2';

// TEMPEL SYSTEM PROMPT HASIL TUNING-MU DI SINI
const SYSTEM_PROMPT = `Namamu adalah GHAA AI. Kamu asisten staf administrasi SDN Sukamahi 03, Cikarang Pusat.

Tugas utama:
- Mengingatkan pekerjaan yang belum selesai. Utamakan yang tenggatnya sudah lewat atau paling dekat.
- Membantu menyusun surat, catatan, dan daftar kerja administrasi sekolah bila diminta.
- Menjawab pertanyaan tentang data guru dan data mutasi masuk/keluar yang ada di konteks. Hanya jawab dari data di konteks, jangan mengarang.
- Data mutasi masuk/keluar SUDAH tersedia di konteks (termasuk jumlah total). Jangan pernah bilang tidak punya akses ke data mutasi.
- Data pengisian jurnal harian pegawai SUDAH tersedia di konteks (tanggal, siapa sudah, siapa belum, jumlah kegiatan). Jawab dari data itu, jangan mengarang. Jangan pernah bilang tidak punya akses ke data jurnal.

Gaya bicara: ramah, bahasa Indonesia, singkat dan jelas.

Aturan:
- Jangan mengarang data. Kalau informasi tidak ada di konteks, katakan terus terang.
- Jangan membuat keputusan administrasi atas nama sekolah, hanya memberi saran.
- Jangan gunakan format markdown seperti tanda bintang atau pagar; tulis teks biasa.`;

const cors = { 'Access-Control-Allow-Origin': 'https://tiny-king-3c16.adam671.workers.dev', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type' };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const sbAuth = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
  const { data: { user } } = await sbAuth.auth.getUser();
  if (!user) return Response.json({ error: 'Belum login' }, { status: 401, headers: cors });
  // Ambil konteks pakai service_role agar tidak terblokir RLS (guru biasa hanya bisa baca jurnal sendiri).
  // Secret tambahan: supabase secrets set SUPABASE_SERVICE_ROLE_KEY=...
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const sb = serviceKey
    ? createClient(Deno.env.get('SUPABASE_URL')!, serviceKey)
    : sbAuth;

  const { messages } = await req.json();
  const hari = new Date().toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'full' });
  const tglHariIni = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
  const [rt, rg, rd, rmm, rmk, cmm, cmk, rp, rj] = await Promise.all([
    sb.from('tugas').select('judul,tenggat,selesai').order('tenggat'),
    sb.from('guru').select('id,nama,jabatan,profil').order('nama'),
    sb.from('dokumen_guru').select('guru_id,jenis'),
    sb.from('mutasi_masuk').select('nama_siswa,asal_sekolah,kelas,tanggal_surat').order('dibuat', { ascending: false }).limit(100),
    sb.from('mutasi_keluar').select('nama_siswa,sekolah_tujuan,kelas,tanggal_surat').order('dibuat', { ascending: false }).limit(100),
    sb.from('mutasi_masuk').select('id', { count: 'exact', head: true }),
    sb.from('mutasi_keluar').select('id', { count: 'exact', head: true }),
    sb.from('profiles').select('id,guru_id'),
    sb.from('jurnal_harian').select('user_id').eq('tanggal', tglHariIni),
  ]);
  const tugas = rt.data ?? [], guru = rg.data ?? [], dok = rd.data ?? [];
  const mm = rmm.data ?? [], mk = rmk.data ?? [];
  const totalMM = cmm.count ?? mm.length, totalMK = cmk.count ?? mk.length;
  const profilMap = new Map((rp.data ?? []).filter((p: any) => p.guru_id != null).map((p: any) => [String(p.guru_id), String(p.id)]));
  const hitungJurnal = new Map<string, number>();
  (rj.data ?? []).forEach((r: any) => {
    const k = String(r.user_id);
    hitungJurnal.set(k, (hitungJurnal.get(k) ?? 0) + 1);
  });
  const statusJurnal = guru.map((g: any) => {
    const uid = profilMap.get(String(g.id));
    const n = uid ? (hitungJurnal.get(uid) ?? 0) : 0;
    return `- ${g.nama}: ${n > 0 ? `sudah mengisi (${n}/3 kegiatan)` : (uid ? 'belum mengisi' : 'belum ada akun tertaut')}`;
  }).join('\n') || '(belum ada data)';
  const sudahJurnal = guru.filter((g: any) => {
    const uid = profilMap.get(String(g.id));
    return uid && (hitungJurnal.get(uid) ?? 0) > 0;
  }).length;
  const belum = tugas.filter((t) => !t.selesai);
  const daftar = belum.map((t) => `- ${t.judul}${t.tenggat ? ` (tenggat ${t.tenggat})` : ''}`).join('\n') || '(tidak ada)';
  const daftarGuru = guru.map((g) => {
    const jenis = dok.filter((d) => d.guru_id === g.id).map((d) => d.jenis);
    return `- ${g.nama} (${g.jabatan ?? '-'}) dokumen: ${jenis.length ? jenis.join(', ') : 'belum ada'}`;
  }).join('\n') || '(belum ada data)';
  const daftarMM = mm.map((m) => `- ${m.nama_siswa} dari ${m.asal_sekolah ?? '-'} kelas ${m.kelas ?? '-'} (${m.tanggal_surat ?? '-'})`).join('\n') || '(belum ada)';
  const daftarMK = mk.map((m) => `- ${m.nama_siswa} ke ${m.sekolah_tujuan ?? '-'} kelas ${m.kelas ?? '-'} (${m.tanggal_surat ?? '-'})`).join('\n') || '(belum ada)';
  const konteks = `Hari ini: ${hari}\nPekerjaan belum selesai (${belum.length} dari ${tugas.length}):\n${daftar}\n\nJumlah guru/pegawai: ${guru.length}\n${daftarGuru}\n\nJurnal harian tanggal ${tglHariIni}: ${sudahJurnal} dari ${guru.length} pegawai sudah mengisi.\n${statusJurnal}\n\nTotal mutasi masuk: ${totalMM} siswa, total mutasi keluar: ${totalMK} siswa, total keseluruhan: ${totalMM + totalMK} siswa.\nMutasi masuk (100 terbaru):\n${daftarMM}\n\nMutasi keluar (100 terbaru):\n${daftarMK}`;
  // ponytail: tanpa tabel kalender di DB; tambah query + baris konteks saat tabel kalender ada.

  const model = Deno.env.get('AI_MODEL') ?? 'gemini-3.6-flash';
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${Deno.env.get('GEMINI_API_KEY')!}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: `${SYSTEM_PROMPT}\n\n${konteks}` }] },
      contents: (messages ?? []).slice(-20).map((m: any) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      generationConfig: { maxOutputTokens: 800 }
    })
  });
  const j = await r.json();
  if (!r.ok) return Response.json({ reply: 'Agen error: ' + (j.error?.message ?? r.status) }, { headers: cors });
  return Response.json({ reply: j.candidates?.[0]?.content?.parts?.[0]?.text ?? 'Maaf, agen tidak merespons.' }, { headers: cors });
});
