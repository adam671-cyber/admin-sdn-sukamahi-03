# Admin SDN Sukamahi 03

1. Supabase: jalankan `supabase/schema.sql` di SQL Editor. Untuk fitur terbaru, jalankan juga migrasi yang belum diterapkan dari `supabase/migrations/` sesuai urutan nomornya. Buat akun staf di Authentication > Users, lalu daftarkan:
   `insert into staf (user_id) values ('<UID_AKUN_STAF>');`
   Matikan self-signup publik di Authentication > Settings bila tidak perlu.
   - Kata sandi disimpan dan di-hash oleh Supabase Auth (server side). Buat kata sandi kuat saat membuat akun.
   - Pembatasan percobaan masuk: WAJIB atur Auth > Rate Limits di dashboard Supabase (turunkan batas `token refresh` dan `sign in`), dan aktifkan CAPTCHA/MFA bila tersedia. Pengunci sementara di aplikasi hanya pelengkap UI dan bisa dihapus penyerang lewat console browser.
2. Isi `js/config.js` (URL, anon key, MUTASI_URL).
3. Agen AI: `supabase functions deploy agent` lalu `supabase secrets set ANTHROPIC_API_KEY=...`.
   Tempel system prompt hasil tuning-mu di `supabase/functions/agent/index.ts`.
4. Watermark foto jurnal memakai Geocode Maps melalui Edge Function `geocode-maps`. Buat API key di Geocode Maps, simpan sebagai secret `GEOCODE_MAPS_API_KEY` di Supabase (jangan menaruhnya di kode atau browser), lalu deploy dengan `supabase functions deploy geocode-maps`. Function memakai cache dan antrean geocoding Supabase yang sudah disiapkan oleh migrasi `010_nominatim_geocoding.sql`. Koordinat GPS dikirim ke Geocode Maps; alamat jalan muncul bila tersedia pada data penyedianya. Periksa [paket dan limit](https://geocode.maps.co/plans/) serta [ketentuan layanan](https://geocode.maps.co/terms/).
5. Jalankan lokal: `npx serve .` lalu buka `/login.html`.
6. Upload batch mutasi: buka Mutasi Masuk/Keluar > UPLOAD BATCH, unduh FORMAT EXCEL bila perlu (header kolom = key field, `nama_siswa` wajib).
7. Keamanan bukti jurnal: jalankan `supabase/migrations/011_bukti_jurnal_per_user.sql` agar foto bukti hanya bisa diakses pemiliknya (admin tetap bisa baca semua).
8. Edge Functions `agent` dan `rag` membatasi CORS ke daftar `ORIGIN_DIIZINKAN` — tambahkan domain produksi kamu (mis. `https://admin-sdn-sukamahi-03.vercel.app`) ke daftar itu sebelum deploy. Function `rag` hanya bisa dipakai admin.