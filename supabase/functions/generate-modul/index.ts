// Deploy: supabase functions deploy generate-modul
// Secrets: supabase secrets set GEMINI_API_KEY=... AI_MODEL=gemini-3.8-flash
// Edge Function untuk generate modul/RPP - dipanggil oleh Python di Render

import { createClient } from 'npm:@supabase/supabase-js@2';

// Domain yang boleh memanggil function ini
const ORIGIN_DIIZINKAN = [
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000',
  'http://localhost:5000',
  'http://127.0.0.1:5000',
  // Tambahkan domain Render di sini setelah deploy
  // 'https://portal-sdn-sukamahi.onrender.com',
];

function cors(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const izinkan = ORIGIN_DIIZINKAN.includes(origin) ? origin : ORIGIN_DIIZINKAN[0];
  return {
    'Access-Control-Allow-Origin': izinkan,
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

Deno.serve(async (req) => {
  const headers = cors(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers });

  try {
    const body = await req.json();
    const { prompt, model, temperature, maxOutputTokens } = body;

    if (!prompt) {
      return Response.json({ error: 'Prompt diperlukan' }, { status: 400, headers });
    }

    const apiKey = Deno.env.get('GEMINI_API_KEY');
    if (!apiKey) {
      return Response.json({ error: 'GEMINI_API_KEY tidak dikonfigurasi' }, { status: 500, headers });
    }

    const geminiModel = model || Deno.env.get('AI_MODEL') || 'gemini-3.8-flash';
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${apiKey}`;

    const response = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [{ text: prompt }]
        }],
        generationConfig: {
          temperature: temperature ?? 0.7,
          maxOutputTokens: maxOutputTokens ?? 8192,
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

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
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