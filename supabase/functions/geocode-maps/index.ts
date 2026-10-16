import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-supabase-api-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function reply(body: Record<string, unknown>, status = 200): Response {
  return Response.json(body, { status, headers: cors });
}

function waitUntil(isoTime: string): Promise<void> {
  const delay = Math.max(0, new Date(isoTime).getTime() - Date.now());
  return new Promise((resolve) => setTimeout(resolve, delay));
}

async function cacheKey(lat: number, lon: number): Promise<string> {
  const bytes = new TextEncoder().encode(`geocode-maps-v1|${lat.toFixed(5)},${lon.toFixed(5)}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply({ error: 'Metode tidak didukung.' }, 405);

  const authorization = req.headers.get('Authorization') ?? '';
  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const geocodeMapsKey = Deno.env.get('GEOCODE_MAPS_API_KEY');
  if (!url || !anonKey || !serviceKey || !geocodeMapsKey) {
    console.error('Konfigurasi Supabase untuk geocoding belum lengkap.');
    return reply({ error: 'Layanan alamat belum dikonfigurasi. Pastikan secret GEOCODE_MAPS_API_KEY sudah diatur.' }, 503);
  }

  const authClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
  });
  const { data: { user }, error: authError } = await authClient.auth.getUser();
  if (authError || !user) return reply({ error: 'Silakan masuk kembali.' }, 401);

  const serviceClient = createClient(url, serviceKey);
  const { data: staf, error: stafError } = await serviceClient
    .from('staf')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (stafError) {
    console.error('Gagal memeriksa akses staf:', stafError.message);
    return reply({ error: 'Tidak dapat memeriksa akses staf. Periksa konfigurasi tabel staf.' }, 500);
  }
  if (!staf) return reply({ error: 'Akun login belum terdaftar di tabel staf.' }, 403);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return reply({ error: 'Permintaan tidak valid.' }, 400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return reply({ error: 'Permintaan koordinat tidak valid.' }, 400);
  }
  const coordinates = body as { lat?: unknown; lon?: unknown };
  const lat = coordinates.lat;
  const lon = coordinates.lon;
  if (typeof lat !== 'number' || typeof lon !== 'number'
    || !Number.isFinite(lat) || !Number.isFinite(lon)
    || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return reply({ error: 'Koordinat GPS tidak valid.' }, 400);
  }

  const roundedLat = Number(lat.toFixed(5));
  const roundedLon = Number(lon.toFixed(5));
  const key = await cacheKey(roundedLat, roundedLon);

  const { data: cached, error: cacheError } = await serviceClient
    .from('nominatim_geocode_cache')
    .select('address')
    .eq('cache_key', key)
    .maybeSingle();
  if (cacheError) {
    console.error('Gagal membaca cache alamat:', cacheError.message);
    return reply({ error: 'Cache alamat belum tersedia. Jalankan migrasi Supabase terlebih dahulu.' }, 503);
  }
  if (cached?.address) return reply({ address: cached.address, cached: true });

  const { data: reservedAt, error: rateError } = await serviceClient
    .rpc('nominatim_reserve_request_slot');
  if (rateError || typeof reservedAt !== 'string') {
    console.error('Gagal mengatur antrean geocoding:', rateError?.message ?? 'Waktu slot tidak valid');
    return reply({ error: 'Antrean pencarian alamat belum tersedia. Jalankan migrasi Supabase terlebih dahulu.' }, 503);
  }
  await waitUntil(reservedAt);

  const { data: cachedAgain, error: secondCacheError } = await serviceClient
    .from('nominatim_geocode_cache')
    .select('address')
    .eq('cache_key', key)
    .maybeSingle();
  if (secondCacheError) {
    console.error('Gagal memeriksa ulang cache alamat:', secondCacheError.message);
    return reply({ error: 'Gagal memeriksa cache alamat.' }, 503);
  }
  if (cachedAgain?.address) return reply({ address: cachedAgain.address, cached: true });

  const query = new URLSearchParams({
    format: 'jsonv2',
    lat: roundedLat.toFixed(5),
    lon: roundedLon.toFixed(5),
    zoom: '18',
    addressdetails: '1',
    'accept-language': 'id',
    api_key: geocodeMapsKey,
  });
  let geocodeResponse: Response;
  try {
    geocodeResponse = await fetch(`https://geocode.maps.co/reverse?${query}`, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(12000),
    });
  } catch (error) {
    console.error('Permintaan Geocode Maps gagal:', error);
    return reply({ error: 'Layanan pencarian alamat tidak dapat dihubungi.' }, 502);
  }
  if (!geocodeResponse.ok) {
    const detail = (await geocodeResponse.text()).replace(/\s+/g, ' ').slice(0, 500);
    console.error('Geocode Maps mengembalikan status:', geocodeResponse.status, 'Detail:', detail);
    return reply({ error: `Geocode Maps menolak permintaan (HTTP ${geocodeResponse.status}). Periksa Logs function untuk detail.` }, 502);
  }

  let result: { display_name?: unknown };
  try {
    result = await geocodeResponse.json();
  } catch {
    return reply({ error: 'Respons pencarian alamat tidak valid.' }, 502);
  }
  if (typeof result.display_name !== 'string' || !result.display_name.trim()) {
    return reply({ error: 'Alamat tidak ditemukan untuk koordinat ini.' }, 404);
  }
  const address = result.display_name.trim().slice(0, 1000);
  const { error: saveError } = await serviceClient
    .from('nominatim_geocode_cache')
    .upsert({ cache_key: key, address }, { onConflict: 'cache_key' });
  if (saveError) {
    console.error('Gagal menyimpan cache alamat:', saveError.message);
    return reply({ error: 'Alamat ditemukan, tetapi cache gagal disimpan.' }, 503);
  }

  return reply({ address, cached: false });
});
