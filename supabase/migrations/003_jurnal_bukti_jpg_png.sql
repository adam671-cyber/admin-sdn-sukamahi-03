-- ===== 003: Bukti jurnal hanya JPG/PNG =====
-- Jalankan di Supabase SQL Editor (idempoten, aman diulang).
-- Tidak menyentuh RLS; hanya membatasi tipe file bucket bukti-jurnal.
update storage.buckets set file_size_limit = 7340032,
  allowed_mime_types = array['image/jpeg','image/png']
  where id = 'bukti-jurnal';
