# Admin SDN Sukamahi 03

1. Supabase: jalankan `supabase/schema.sql` di SQL Editor. Buat akun staf di Authentication > Users, lalu daftarkan:
   `insert into staf (user_id) values ('<UID_AKUN_STAF>');`
   Matikan self-signup publik di Authentication > Settings bila tidak perlu.
   - Kata sandi disimpan dan di-hash oleh Supabase Auth (server side). Buat kata sandi kuat saat membuat akun.
   - Pembatasan percobaan masuk: atur Auth > Rate Limits di dashboard (mis. token endpoint lebih ketat), dan aktifkan CAPTCHA/MFA bila tersedia. Aplikasi juga memiliki pengunci sementara sisi klien setelah 5 percobaan gagal.
2. Isi `js/config.js` (URL, anon key, MUTASI_URL).
3. Agen AI: `supabase functions deploy agent` lalu `supabase secrets set ANTHROPIC_API_KEY=...`.
   Tempel system prompt hasil tuning-mu di `supabase/functions/agent/index.ts`.
4. Jalankan lokal: `npx serve .` lalu buka `/login.html`.
5. Upload batch mutasi: buka Mutasi Masuk/Keluar > UPLOAD BATCH, unduh FORMAT EXCEL bila perlu (header kolom = key field, `nama_siswa` wajib).
