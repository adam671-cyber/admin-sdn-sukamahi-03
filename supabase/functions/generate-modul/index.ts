// Deploy: supabase functions deploy generate-modul
// Secrets: supabase secrets set GEMINI_API_KEY=... AI_MODEL=gemini-3.7-flash
//          supabase secrets set PORTAL_SECRET=<sama dengan env PORTAL_SECRET di Flask>
//          (opsional, prioritas primer) supabase secrets set AGNES_API_KEY=... AGNES_BASE_URL=... AGNES_MODEL=agnes-3.0-flash
// Edge Function untuk generate modul/RPP - dipanggil oleh Python Flask (Vercel)
// Teks: provider primer = Agnes AI (jika AGNES_API_KEY terset), fallback = Gemini.
// Gambar: tetap Gemini (generateImage), key Gemini hanya di Supabase Secrets.
// Autentikasi: menerima (1) JWT user Supabase yang valid, atau (2) header
// X-Portal-Key yang cocok dengan secret PORTAL_SECRET (skenario Flask server-to-server).

import { createClient } from 'npm:@supabase/supabase-js@2';

const ORIGIN_DIIZINKAN = [
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000',
  'http://localhost:5000',
  'http://127.0.0.1:5000',
  'https://admin-sdn-sukamahi-03.vercel.app',
  'https://admin-sdn-sukamahi-03-bdlh.vercel.app',
];

function cors(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  if (!ORIGIN_DIIZINKAN.includes(origin)) {
    // Asal tak dikenal: JANGAN ikutkan Access-Control-Allow-Origin apa pun.
    return { 'Vary': 'Origin' };
  }
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-supabase-api-version, x-portal-key',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

function cocokRahasia(a: string, b: string): boolean {
  // Perbandingan constant-time agar tahan timing attack
  if (a.length !== b.length) return false;
  let selisih = 0;
  for (let i = 0; i < a.length; i++) selisih |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return selisih === 0;
}

async function terautorisasi(req: Request): Promise<boolean> {
  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  // Jalur 1: secret bersama dari Flask (server-to-server)
  const portalSecret = Deno.env.get('PORTAL_SECRET') ?? '';
  if (portalSecret) {
    const dikirim = req.headers.get('X-Portal-Key') ?? '';
    if (cocokRahasia(dikirim, portalSecret)) return true;
  }
  // Jalur 2: JWT user login Supabase (pemanggil dari aplikasi admin)
  if (bearer) {
    const sbAuth = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: `Bearer ${bearer}` } } },
    );
    const { data: { user } } = await sbAuth.auth.getUser();
    if (!user) return false;
    // Akun yang dinonaktifkan admin tidak boleh memakai kuota Gemini meskipun
    // JWT-nya masih valid (Supabase Auth tidak tahu kolom profiles.is_active).
    const { data: profil, error: profilErr } = await sbAuth
      .from('profiles')
      .select('role,is_active')
      .eq('id', user.id)
      .maybeSingle();
    if (profilErr || !profil || profil.is_active !== true) return false;
    if (!['admin', 'kepsek', 'guru', 'pegawai'].includes(profil.role)) return false;
    // Hanya staf terdaftar yang boleh memakai kuota Gemini lewat jalur JWT —
    // tanpa ini akun apa pun yang login bisa menguras kuota/biaya API.
    const { data: staf } = await sbAuth.from('staf').select('user_id').eq('user_id', user.id).maybeSingle();
    return !!staf;
  }
  return false;
}

Deno.serve(async (req: Request) => {
  const headers = cors(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers });

  if (req.method !== 'POST') {
    return Response.json({ error: 'Metode tidak didukung. Gunakan POST.' }, { status: 405, headers });
  }

  // Gerbang autentikasi — tanpa ini fungsi bisa dipakai siapa pun dengan anon key.
  if (!(await terautorisasi(req))) {
    return Response.json({ error: 'Belum login. Kirim JWT user atau header X-Portal-Key yang sah.' }, { status: 401, headers });
  }

  try {
    const body = await req.json();
    const { prompt, model, temperature, maxOutputTokens, generateImage } = body;

    if (!prompt) {
      return Response.json({ error: 'Prompt diperlukan' }, { status: 400, headers });
    }

    // ==== PROVIDER PRIMER: Agnes AI (OpenAI-compatible) ====
    // Jika AGNES_API_KEY terkonfigurasi, teks digenerate lewat Agnes.
    // Parameter `model` dari Flask diabaikan — model diambil dari secret AGNES_MODEL.
    const agnesKey = (Deno.env.get('AGNES_API_KEY') ?? '').trim();
    const agnesBase = (Deno.env.get('AGNES_BASE_URL') ?? 'https://agnes.ai/v1').replace(/\/+$/, '');
    const agnesModel = Deno.env.get('AGNES_MODEL') || 'agnes-3.0-flash';

    if (agnesKey && !generateImage) {
      const response = await fetch(`${agnesBase}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${agnesKey}`,
        },
        body: JSON.stringify({
          model: agnesModel,
          messages: [{ role: 'user', content: prompt }],
          temperature: temperature ?? 0.7,
          max_tokens: maxOutputTokens ?? 4096,
        }),
      });
      const ctype = response.headers.get('content-type') ?? '';
      const raw = await response.text();
      let data: any;
      try {
        data = JSON.parse(raw);
      } catch {
        // HTML/konten non-JSON = base URL kemungkinan menunjuk halaman web, bukan API
        return Response.json({
          error: `Agnes membalas non-JSON (${ctype}). Cek AGNES_BASE_URL — pastikan menunjuk ke endpoint API (bukan situs web).`,
          status: response.status,
        }, { status: 500, headers });
      }
      if (!response.ok) {
        return Response.json({
          error: data?.error?.message || data?.message || `Agnes API error (${response.status})`,
          status: response.status,
        }, { status: response.status, headers });
      }
      // Toleransi format: OpenAI klasik (choices[].message.content),
      // gateway yang membalas `choices[].text`, atau payload sederhana `{ text }`.
      const text = data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.text ?? data?.text ?? '';
      if (!text) {
        return Response.json({ error: 'Agnes tidak menghasilkan teks', details: data }, { status: 500, headers });
      }
      return Response.json({ text, model: agnesModel, usage: data?.usage }, { headers });
    }

    // ==== FALLBACK / GAMBAR: Gemini ====
    const apiKey = Deno.env.get('GEMINI_API_KEY');
    if (!apiKey) {
      return Response.json({ error: 'GEMINI_API_KEY tidak dikonfigurasi di Supabase Secrets (diperlukan untuk fallback/gambar)' }, { status: 500, headers });
    }

    const geminiModel = model || Deno.env.get('AI_MODEL') || 'gemini-3.7-flash';
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent`;

    const response = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 
        'content-type': 'application/json',
        'x-goog-api-key': apiKey 
      },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [{ text: prompt }]
        }],
        generationConfig: {
          temperature: temperature ?? 0.7,
          maxOutputTokens: maxOutputTokens ?? 8192,
          ...(generateImage ? { responseModalities: ['TEXT', 'IMAGE'] } : {}),
        }
      })
    });

    const data = await response.json();
    
    if (!response.ok) {
      return Response.json({ 
        error: data.error?.message || 'Gemini API error',
        status: response.status 
      }, { status: response.status, headers });
    }

    const candidate = data.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];

    if (generateImage) {
      const images = parts
        .filter((p: any) => (p.inlineData ?? p.inline_data)?.data)
        .map((p: any) => {
          const d = p.inlineData ?? p.inline_data;
          return { mimeType: d.mimeType ?? d.mime_type ?? 'image/png', data: d.data };
        });
      if (images.length === 0) {
        return Response.json({
          error: `Model ${geminiModel} tidak mengembalikan gambar (${candidate?.finishReason ?? 'kosong'})`,
        }, { status: 502, headers });
      }
      return Response.json({ images, model: geminiModel }, { headers });
    }

    const text = parts.map((p: any) => p.text ?? '').join('');
    
    if (!text) {
      const reason = candidate?.finishReason || data.promptFeedback?.blockReason || 'Respon kosong dari AI';
      return Response.json({ 
        error: `Gemini tidak menghasilkan teks (${reason})`,
        details: data 
      }, { status: 500, headers });
    }

    return Response.json({ 
      text,
      model: geminiModel,
      usage: data.usageMetadata 
    }, { headers });

  } catch (error) {
    console.error('Error:', error);
    return Response.json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500, headers });
  }
});