"""Uji live: alur RPP standar_lengkap per section terhadap Edge Function deployed.

Jalankan dari repo root:  python portal/uji_split.py

Menggunakan TestClient Flask + kuki sesi HMAC palsu (role admin) sehingga
alur route /dashboard berjalan apa adanya (termasuk generate_dokumen_per_section
dan gemini_retry). Kriteria sukses:
- STATUS 200
- semua section selesai < 150 detik (lihat baris "[portal] section ... selesai")
- tidak ada 546 WORKER_RESOURCE_LIMIT / tidak ada "[PERINGATAN]"
- hasil gabungan memuat bagian: INFORMASI UMUM, KEGIATAN PEMBELAJARAN,
  ASESMEN, EVALUASI, KUNCI JAWABAN
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import app as p

client = p.app.test_client()
# Sesi portal lokal: kuki HMAC ditandatangani dengan FLASK_SECRET_KEY.
client.set_cookie(
    "sesi_portal",
    p.buat_cookie_sesi("uji-local", "uji@local", "admin"),
    domain="localhost",
)

resp = client.post(
    "/dashboard",
    data={
        "mapel": "Matematika",
        "jenjang": "Kelas 5",
        "topik": "Pecahan senilai",
        "jenis_output": "rpp",
        "template_type": "standar_lengkap",
        "jumlah": "3",
        "catatan_opsional": "",
    },
    headers={"Origin": "http://localhost:3000"},
)

print("=" * 60)
print("STATUS:", resp.status_code)
halaman = resp.get_data(as_text=True)
print("PANJANG HALAMAN:", len(halaman))
for penanda in (
    "INFORMASI UMUM",
    "KEGIATAN PEMBELAJARAN",
    "ASESMEN",
    "EVALUASI",
    "KUNCI JAWABAN",
    "[PERINGATAN]",
    "Gagal menghasilkan dokumen",
):
    print(f'  memuat "{penanda}":', penanda in halaman)
