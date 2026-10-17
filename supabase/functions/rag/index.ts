// Deploy: supabase functions deploy rag
// Secrets: supabase secrets set GEMINI_API_KEY=... AI_MODEL=gemini-3.6-flash
// Setelah mengganti penyedia embedding, kosongkan embedding lama:
//     UPDATE mutasi_masuk SET embedding = NULL; UPDATE mutasi_keluar SET embedding = NULL;
// lalu klik "Generate embedding" di RAG Chat.
// DB: ALTER TABLE mutasi_masuk ADD COLUMN embedding vector(1536);
//     ALTER TABLE mutasi_keluar ADD COLUMN embedding vector(1536);
//     CREATE EXTENSION IF NOT EXISTS vector;

import { createClient } from 'npm:@supabase/supabase-js@2';

// Domain yang boleh memanggil function ini. Tambahkan domain produksi
// (mis. https://admin-sdn-sukamahi-03.vercel.app) ke daftar di bawah.
const ORIGIN_DIIZINKAN = [
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000',
];

function cors(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const izinkan = ORIGIN_DIIZINKAN.includes(origin) ? origin : ORIGIN_DIIZINKAN[0];
  return {
    'Access-Control-Allow-Origin': izinkan,
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Vary': 'Origin',
  };
}

const GEMINI_KEY = Deno.env.get('GEMINI_API_KEY')!;
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const EMBEDDING_MODEL = 'gemini-embedding-001';
const EMBEDDING_DIMS = 1536; // harus sama dengan kolom vector(1536)

async function getEmbedding(text: string, taskType: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY'): Promise<number[]> {
  const res = await fetch(`${GEMINI_BASE}/${EMBEDDING_MODEL}:embedContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': GEMINI_KEY },
    body: JSON.stringify({
      model: `models/${EMBEDDING_MODEL}`,
      content: { parts: [{ text }] },
      taskType,
      outputDimensionality: EMBEDDING_DIMS,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message ?? `Embedding gagal (${res.status})`);
  return data.embedding.values;
}

function buildContext(record: any, type: 'masuk' | 'keluar'): string {
  if (type === 'masuk') {
    return `Mutasi Masuk: Siswa ${record.nama_siswa}, TTL ${record.ttl}, JK ${record.jenis_kelamin}, NISN ${record.nisn}, Asal Sekolah ${record.asal_sekolah}, Kelas ${record.kelas}, No Surat ${record.no_surat}, Tanggal ${record.tanggal_surat}`;
  }
  return `Mutasi Keluar: Siswa ${record.nama_siswa}, TTL ${record.tempat_tgl_lahir}, JK ${record.jenis_kelamin}, NISN ${record.nisn}, Kelas ${record.kelas}, Sekolah Tujuan ${record.sekolah_tujuan}, Kecamatan ${record.kecamatan_tujuan}, Kabupaten ${record.kabupaten_tujuan}, Provinsi ${record.provinsi_tujuan}, Alasan ${record.alasan_pindah}, No Surat ${record.no_surat}, Tanggal ${record.tanggal_surat}`;
}

async function handle(req: Request): Promise<Response> {
  const headers = cors(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers });

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } }
  );

  const { data: { user } } = await sb.auth.getUser();
  if (!user) return Response.json({ error: 'Belum login' }, { status: 401, headers });

  // Data mutasi seluruh siswa hanya untuk admin aktif (RLS profiles membatasi
  // baca profiles, jadi cek role lewat fungsi security definer is_admin()).
  const { data: isAdmin, error: roleErr } = await sb.rpc('is_admin');
  if (roleErr || !isAdmin) {
    return Response.json({ error: 'Hanya admin yang boleh memakai fitur ini.' }, { status: 403, headers });
  }

  const body = await req.json();
  const { action } = body;
  const query = typeof body.query === 'string' ? body.query.slice(0, 1000) : body.query;
  const history = Array.isArray(body.history)
    ? body.history
      .filter((m: any) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-10)
      .map((m: any) => ({ role: m.role, content: m.content.slice(0, 2000) }))
    : [];
  const type = body.type === 'masuk' ? 'masuk' : 'keluar';
  const limit = Math.min(Math.max(Number(body.limit) || 5, 1), 20);

  if (action === 'embed') {
    // Generate embeddings for all records without embeddings
    const table = type === 'masuk' ? 'mutasi_masuk' : 'mutasi_keluar';
    const { data: records, error } = await sb
      .from(table)
      .select('*')
      .is('embedding', null)
      .limit(100);

    if (error) return Response.json({ error: error.message }, { status: 500, headers });

    let count = 0;
    for (const record of records ?? []) {
      const text = buildContext(record, type);
      const embedding = await getEmbedding(text, 'RETRIEVAL_DOCUMENT');
      const { error: updErr } = await sb
        .from(table)
        .update({ embedding })
        .eq('id', record.id);
      if (updErr) console.error('Update error:', updErr);
      else count++;
    }
    return Response.json({ embedded: count }, { headers });
  }

  if (action === 'search') {
    if (!query) return Response.json({ error: 'Query required' }, { status: 400, headers });

    const qEmbedding = await getEmbedding(query, 'RETRIEVAL_QUERY');
    const table = type === 'masuk' ? 'mutasi_masuk' : 'mutasi_keluar';

    // Vector similarity search using pgvector
    const { data, error } = await sb.rpc('match_mutasi', {
      query_embedding: qEmbedding,
      match_table: table,
      match_threshold: 0.7,
      match_count: limit,
    });

    if (error) {
      // Fallback: manual cosine similarity if RPC not created
      const { data: allRecords, error: selErr } = await sb
        .from(table)
        .select('*')
        .not('embedding', 'is', null)
        .limit(500);

      if (selErr) return Response.json({ error: selErr.message }, { status: 500, headers });

      const scored = (allRecords ?? [])
        .map(r => ({
          ...r,
          similarity: cosineSimilarity(qEmbedding, r.embedding),
        }))
        .filter(r => r.similarity > 0.7)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, limit);

      return Response.json({ results: scored }, { headers });
    }

    return Response.json({ results: data }, { headers });
  }

  if (action === 'ask') {
    if (!query) return Response.json({ error: 'Query required' }, { status: 400, headers });

    // Search relevant records
    const qEmbedding = await getEmbedding(query, 'RETRIEVAL_QUERY');
    const results: any[] = [];

    for (const t of ['mutasi_masuk', 'mutasi_keluar']) {
      try {
        const { data } = await sb.rpc('match_mutasi', {
          query_embedding: qEmbedding,
          match_table: t,
          match_threshold: 0.5,
          match_count: 3,
        });
        if (data) results.push(...data.map((r: any) => ({ ...r, _table: t })));
      } catch (_) { /* pakai cadangan di bawah */ }
    }

    // Fallback if RPC not available
    if (!results.length) {
      for (const t of ['mutasi_masuk', 'mutasi_keluar']) {
        const { data: allRecords } = await sb
          .from(t)
          .select('*')
          .not('embedding', 'is', null)
          .limit(200);
        if (allRecords) {
          const scored = allRecords
            .map(r => ({ ...r, _table: t, similarity: cosineSimilarity(qEmbedding, r.embedding) }))
            .filter(r => r.similarity > 0.5)
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, 3);
          results.push(...scored);
        }
      }
    }

    // Pertanyaan umum (daftar/jumlah) jarang mirip satu baris data: pakai data terbaru
    if (!results.length) {
      for (const t of ['mutasi_masuk', 'mutasi_keluar']) {
        const { data: recent } = await sb
          .from(t)
          .select('*')
          .order('dibuat', { ascending: false })
          .limit(10);
        if (recent) results.push(...recent.map(r => ({ ...r, _table: t })));
      }
    }

    // Build context for LLM
    const context = results
      .slice(0, 20)
      .map(r => buildContext(r, r._table === 'mutasi_masuk' ? 'masuk' : 'keluar'))
      .join('\n\n');

    // Call LLM (Gemini)
    const llmRes = await fetch(`${GEMINI_BASE}/${Deno.env.get('AI_MODEL') ?? 'gemini-3.6-flash'}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': GEMINI_KEY },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: 'Kamu asisten data mutasi SDN Sukamahi 03. Jawab berdasarkan konteks data siswa mutasi masuk/keluar. Jika data tidak cukup, katakan tidak tahu. Jawab singkat, bahasa Indonesia, tanpa format markdown.' }],
        },
        contents: [
          ...history.map((m: any) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
          { role: 'user', parts: [{ text: `Konteks data:\n${context || '(tidak ada data relevan)'}\n\nPertanyaan: ${query}` }] },
        ],
        generationConfig: { temperature: 0.2, maxOutputTokens: 500 },
      }),
    });

    const llmData = await llmRes.json();
    const answer = llmData.candidates?.[0]?.content?.parts?.[0]?.text ?? 'Maaf, gagal menghasilkan jawaban.';

    const sources = results.slice(0, 3).map(({ embedding: _e, ...rest }) => rest);
    return Response.json({ answer, sources }, { headers });
  }

  return Response.json({ error: 'Invalid action' }, { status: 400, headers });
}

Deno.serve(async (req) => {
  try {
    return await handle(req);
  } catch (e) {
    console.error(e);
    return Response.json({ error: e instanceof Error ? e.message : 'Kesalahan server' }, { status: 500, headers });
  }
});

function cosineSimilarity(a: number[], b: number[] | string): number {
  if (typeof b === 'string') b = JSON.parse(b);
  const v = b as number[];
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * v[i];
    na += a[i] * a[i];
    nb += v[i] * v[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}