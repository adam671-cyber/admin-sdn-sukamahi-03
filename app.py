import json
import os
import sys
from datetime import datetime

from dotenv import load_dotenv
from flask import (
    Flask, render_template, request, redirect,
    url_for, Response
)
from werkzeug.middleware.proxy_fix import ProxyFix

import requests
import firebase_admin
from firebase_admin import credentials, firestore

# ==========================================
# 1. PENETAPAN DIREKTORI DASAR (Render / Lokal / PyInstaller lama)
# ==========================================
if getattr(sys, 'frozen', False):
    base_dir = getattr(sys, '_MEIPASS', os.path.dirname(os.path.abspath(__file__)))
    env_dir = os.path.dirname(sys.executable)
else:
    base_dir = os.path.dirname(os.path.abspath(__file__))
    env_dir = base_dir

# ==========================================
# 2. INISIALISASI FLASK & CONFIG
# ==========================================
template_dir = os.path.join(base_dir, 'templates')
static_dir = os.path.join(base_dir, 'static')
app = Flask(__name__, template_folder=template_dir, static_folder=static_dir)
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1)
app.secret_key = os.getenv("FLASK_SECRET_KEY", "sk_sukamahi03_rahasia_super_aman")

# Allow iframe embedding for portal feature
@app.after_request
def set_frame_options(response):
    response.headers['X-Frame-Options'] = 'SAMEORIGIN'
    response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob: https://*.supabase.co; connect-src 'self' https://*.supabase.co https://date.nager.at; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"
    return response

UPLOAD_FOLDER = os.path.join(base_dir, 'static', 'uploads')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = 10 * 1024 * 1024

load_dotenv(os.path.join(env_dir, ".env"))
load_dotenv()

# ==========================================
# 3. KONFIGURASI GEMINI AI (via Supabase Edge Function)
# ==========================================
# API key Gemini tidak disimpan di Python, hanya di Supabase Secrets
# Python memanggil Edge Function generate-modul di Supabase
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "")

def call_gemini_via_supabase(prompt, model="gemini-3.8-flash", temperature=0.7, max_output_tokens=8192):
    """Panggil Gemini melalui Supabase Edge Function untuk keamanan."""
    if not SUPABASE_URL or not SUPABASE_ANON_KEY:
        raise RuntimeError("SUPABASE_URL dan SUPABASE_ANON_KEY harus dikonfigurasi di environment variable.")
    
    response = requests.post(
        f"{SUPABASE_URL}/functions/v1/generate-modul",
        headers={
            "Authorization": f"Bearer {SUPABASE_ANON_KEY}",
            "Content-Type": "application/json"
        },
        json={
            "prompt": prompt,
            "model": model,
            "temperature": temperature,
            "maxOutputTokens": max_output_tokens
        },
        timeout=300
    )
    
    if not response.ok:
        raise RuntimeError(f"Edge Function error: {response.status_code} - {response.text}")
    
    data = response.json()
    if 'error' in data:
        raise RuntimeError(f"Gemini error: {data['error']}")
    
    return data.get('text', '')

# Backward compatibility - jika ada API key langsung, gunakan langsung
api_key = os.getenv("GEMINI_API_KEY")
gemini_client = None
if api_key:
    from google import genai
    gemini_client = genai.Client(api_key=api_key)
    print("INFO: Menggunakan Gemini API langsung (untuk development).")
else:
    print("INFO: Akan menggunakan Supabase Edge Function untuk Gemini API.")

# ==========================================
# 4. INISIALISASI FIREBASE CLOUD FIRESTORE
# ==========================================
firebase_key_path = os.path.join(base_dir, "serviceAccountKey.json")
firebase_json_env = os.getenv("FIREBASE_SERVICE_ACCOUNT_JSON")

if not firebase_admin._apps:
    try:
        if firebase_json_env:
            cred = credentials.Certificate(json.loads(firebase_json_env))
            firebase_admin.initialize_app(cred)
            print("Firebase terhubung via FIREBASE_SERVICE_ACCOUNT_JSON!")
        elif os.path.exists(firebase_key_path):
            cred = credentials.Certificate(firebase_key_path)
            firebase_admin.initialize_app(cred)
            print("Firebase berhasil terhubung!")
        else:
            print(f"WARNING: Kredensial Firebase tidak ditemukan!")
    except Exception as err_fb:
        print(f"Error inisialisasi Firebase: {err_fb}")

# ==========================================
# 7. ROUTE: DASHBOARD & GENERATOR RPP / SOAL
# ==========================================
@app.route('/', methods=['GET', 'POST'])
@app.route('/dashboard', methods=['GET', 'POST'])
def dashboard():
    hasil = None
    form_data = {}

    if request.method == 'POST':
        mapel = request.form.get('mapel', '')
        jenjang = request.form.get('jenjang', '')
        topik = request.form.get('topik', '')
        jenis_output = request.form.get('jenis_output', '')
        template_type = request.form.get('template_type', 'deep_learning')
        jumlah = request.form.get('jumlah', '15')
        catatan_opsional = request.form.get('catatan_opsional', '')

        form_data = {
            'mapel': mapel, 'jenjang': jenjang, 'topik': topik,
            'jenis_output': jenis_output, 'template_type': template_type,
            'jumlah': jumlah, 'catatan_opsional': catatan_opsional
        }
        
        # Inisialisasi variabel gambar
        gambar_urls = []

        instruksi_catatan = f"\nCatatan/Instruksi Tambahan dari Guru: {catatan_opsional}\n" if catatan_opsional.strip() else ""

        # Instruksi gambar - meminta ilustrasi yang relevan dengan materi
        instruksi_gambar = (
            f"SANGAT PENTING - MEDIA VISUAL:\n"
            f"Jika membutuhkan media visual/ilustrasi pada Kegiatan Pembelajaran, LKPD, atau Soal, "
            f"Wajib sertakan gambar ilustrasi yang relevan dengan topik '{topik}' dan materi pembelajaran. "
            f"Gambar harus edukatif, sesuai untuk anak SD, dan dapat digunakan untuk memperjelas konsep. "
            f"Sertakan deskripsi gambar dalam format: [GAMBAR: deskripsi_ilustrasi_{topik}]"
        )

        # 1. Prompt Soal Pilihan Ganda
        if jenis_output in ['Soal Pilihan Ganda (HOTS & LOTS)', 'pg']:
            prompt = f"""
Buatkan LEMBAR SOAL UJIAN PILIHAN GANDA Siap Cetak untuk Sekolah Dasar tanpa menyertakan komponen Modul Ajar / RPP (Jangan ada Informasi Umum, CP, TP, atau Kegiatan Pembelajaran).

Detail Dokumen:
- Mata Pelajaran: {mapel}
- Kelas / Jenjang: {jenjang}
- Topik / Materi: {topik}

KETENTUAN WAJIB:
1. DILARANG MENGGUNAKAN SIMBOL LATEX/MATH SEPERTI $ ATAU \\rightarrow! Gunakan panah biasa (->).
2. DILARANG MEMBUAT BAGIAN TANDA TANGAN / MENGETAHUI DI AKHIR TEKS.
3. {instruksi_gambar}

Format Output yang Diinginkan:
1. Header Identitas Siswa (Format Isian): Nama Siswa, Kelas, No. Absen, Tanggal, dan Nilai/Paraf.
2. Petunjuk Pengerjaan Soal.
3. Naskah Soal Pilihan Ganda (Buat {jumlah} soal berurutan nomor 1 sampai selesai, tiap soal opsi A, B, C, D).
4. Bagian Paling Bawah: KUNCI JAWABAN DAN PEDOMAN PENSKORAN.
"""

        # 2. Prompt Soal Esai
        elif jenis_output in ['Soal Uraian / Esai', 'esai']:
            prompt = f"""
Buatkan LEMBAR SOAL UJIAN URAIAN / ESAI Siap Cetak untuk Sekolah Dasar tanpa menyertakan komponen Modul Ajar / RPP (Jangan ada Informasi Umum, CP, TP, atau Kegiatan Pembelajaran).

Detail Dokumen:
- Mata Pelajaran: {mapel}
- Kelas / Jenjang: {jenjang}
- Topik / Materi: {topik}

KETENTUAN WAJIB:
1. DILARANG MENGGUNAKAN SIMBOL LATEX/MATH SEPERTI $ ATAU \\rightarrow! Gunakan panah biasa (->).
2. DILARANG MEMBUAT BAGIAN TANDA TANGAN / MENGETAHUI DI AKHIR TEKS.
3. {instruksi_gambar}

Format Output yang Diinginkan:
1. Header Identitas Siswa (Format Isian): Nama Siswa, Kelas, No. Absen, Tanggal, dan Nilai/Paraf.
2. Petunjuk Pengerjaan Soal Uraian.
3. Naskah Soal Uraian (Buat {jumlah} soal uraian HOTS/LOTS yang jelas).
4. Bagian Paling Bawah: KUNCI JAWABAN DAN RUBRIK PENILAIAN/PEDOMAN PENSKORAN.
"""

        # 3. Prompt Modul Ajar / RPP
        else:
            prompt_utama = f"Buatkan Modul Ajar / RPP untuk mata pelajaran {mapel} tingkat {jenjang} dengan topik '{topik}'."

            instruksi_template = ""
            if template_type == 'merdeka_ringkas':
                instruksi_template = " FORMAT DOKUMEN: Buatkan RPP yang singkat, padat, efisien, dan langsung ke inti untuk 1 kali pertemuan."
            elif template_type == 'deep_learning':
                instruksi_template = " FORMAT DOKUMEN: Gunakan pendekatan Deep Learning dan integrasikan secara eksplisit '8 Dimensi Profil Lulusan' pada kegiatan pembelajaran."
            elif template_type == 'standar_lengkap':
                instruksi_template = (
                    " FORMAT DOKUMEN: Buatkan Modul Ajar lengkap dengan format tabel HTML/Markdown pada bagian kegiatan pembelajaran. "
                    "Sertakan juga bagian Asesmen lengkap dengan rubrik penilaian (kriteria dan skor), serta draf Lembar Kerja Peserta Didik (LKPD) di bagian lampiran."
                )

            prompt = (
                f"Anda adalah seorang guru dan penyusun RPP/Modul Ajar profesional.\n"
                f"{prompt_utama}\n"
                f"{instruksi_template}\n"
                f"{instruksi_catatan}\n"
                f"KETENTUAN WAJIB:\n"
                f"1. RPP dirancang khusus untuk 1 (satu) kali pertemuan.\n"
                f"2. MODEL & METODE PEMBELAJARAN PERLU BERVARIASI:\n"
                f"   - Jangan selalu menggunakan Problem-Based Learning (PBL) atau kerja kelompok.\n"
                f"   - Pilih model/metode yang paling relevan dengan materi, bisa menggunakan Discovery Learning, Direct Instruction (Pembelajaran Langsung), Cooperative Learning, atau Kerja Mandiri/Perorangan.\n"
                f"3. {instruksi_gambar}\n"
                f"4. HANYA GUNAKAN ISTILAH '8 Dimensi Profil Lulusan'.\n"
                f"5. DILARANG KERAS MENGGUNAKAN ISTILAH 'Profil Pelajar Pancasila', 'P3', ATAU 6 ELEMEN PPP. Ganti/sesuaikan seluruh komponennya dengan 8 Dimensi Profil Lulusan.\n"
                f"6. DILARANG MENGGUNAKAN SIMBOL LATEX/MATH SEPERTI $ ATAU \\rightarrow! Gunakan panah biasa (->).\n"
                f"7. WAJIB ADA BAGIAN EVALUASI DI AKHIR:\n"
                f"   - Tuliskan TEPAT {jumlah} SOAL EVALUASI lengkap.\n"
                f"   - Tuliskan KUNCI JAWABAN LENGKAP dan Pedoman Penskoran.\n"
                f"8. DILARANG MEMBUAT BAGIAN TANDA TANGAN / MENGETAHUI DI AKHIR TEKS.\n"
            )

        # Minta Respon dari Gemini AI (via Supabase Edge Function)
        try:
            gemini_model = os.getenv("GEMINI_MODEL", "gemini-3.8-flash")
            
            # Langkah 1: Dapatkan teks dari Gemini melalui Supabase Edge Function
            hasil = call_gemini_via_supabase(prompt, gemini_model, 0.7, 8192)
            
            # Langkah 2: Generate gambar (jika diperlukan)
            gambar_list = []
            image_model = os.getenv("GEMINI_IMAGE_MODEL", "gemini-3.8-flash")
            
            # Buat deskripsi gambar berdasarkan topik dan catatan opsional
            deskripsi_gambar = f"{topik}"
            if catatan_opsional.strip():
                deskripsi_gambar += f" - {catatan_opsional}"
            
            try:
                image_prompt = f"Buatkan gambar ilustrasi edukatif untuk anak SD tentang: {deskripsi_gambar}. Gaya: cerah, menarik, sesuai untuk materi pembelajaran sekolah dasar, dengan warna-warni dan karakter yang ramah."
                image_response = call_gemini_via_supabase(image_prompt, image_model, 0.7, 2048)
                
                # Jika response mengandung data gambar (base64), parse
                if image_response and not image_response.startswith('Maaf'):
                    gambar_list.append({
                        'data': image_response,
                        'mime_type': 'image/png',
                        'deskripsi': deskripsi_gambar
                    })
            except Exception as img_error:
                print(f"Gagal generate gambar: {img_error}")

            # Simpan Otomatis ke Cloud Firestore (Khusus RPP)
            if jenis_output not in ['Soal Pilihan Ganda (HOTS & LOTS)', 'pg', 'Soal Uraian / Esai', 'esai']:
                try:
                    db_firestore = firestore.client()
                    # Simpan gambar ke storage jika ada
                    gambar_urls = []
                    for i, gambar in enumerate(gambar_list):
                        try:
                            # Simpan gambar ke folder static/uploads
                            import base64
                            gambar_bytes = base64.b64decode(gambar['data'])
                            ekstensi = gambar['mime_type'].split('/')[-1] if '/' in gambar['mime_type'] else 'png'
                            nama_file = f"{topik.replace(' ', '_')}_{i+1}.{ekstensi}"
                            path = os.path.join(UPLOAD_FOLDER, nama_file)
                            with open(path, 'wb') as f:
                                f.write(gambar_bytes)
                            gambar_urls.append(f"/static/uploads/{nama_file}")
                        except Exception as e_gambar:
                            print(f"Gagal menyimpan gambar: {e_gambar}")
                    
                    db_firestore.collection('riwayat_rpp').add({
                        'username': 'Admin',
                        'mapel': mapel,
                        'jenjang': jenjang,
                        'topik': topik,
                        'jenis_output': jenis_output,
                        'template_type': template_type,
                        'hasil_markdown': hasil,
                        'gambar_urls': gambar_urls,
                        'created_at': datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                    })
                except Exception as err_db:
                    print(f"Gagal menyimpan ke Firestore: {err_db}")
            else:
                pass
        except Exception as e:
            hasil = f"Gagal menghasilkan dokumen. Error: {e}"

    return render_template('dashboard.html', hasil=hasil, form_data=form_data, gambar_urls=gambar_urls)

# ==========================================
# 9. ROUTE: KURIKULUM
# ==========================================
@app.route('/kurikulum', methods=['GET', 'POST'])
def kurikulum():
    hasil = None
    form_data = {}

    if request.method == 'POST':
        mapel = request.form.get('mapel')
        jenjang = request.form.get('jenjang')
        topik = request.form.get('topik')
        jenis_output_kurikulum = request.form.get('jenis_output_kurikulum')
        jumlah = request.form.get('jumlah')
        catatan_opsional = request.form.get('catatan_opsional', '')

        form_data = {
            'mapel': mapel,
            'jenjang': jenjang,
            'topik': topik,
            'jenis_output_kurikulum': jenis_output_kurikulum,
            'jumlah': jumlah,
            'catatan_opsional': catatan_opsional
        }

        instruksi_catatan = f"\nCatatan Khusus Tambahan: {catatan_opsional}\n" if catatan_opsional.strip() else ""

        prompt = (
            f"Anda adalah ahli penyusun kurikulum sekolah dasar.\n"
            f"Buatkan dokumen {jenis_output_kurikulum} untuk mata pelajaran {mapel} tingkat {jenjang} dengan topik '{topik}'.\n"
            f"{instruksi_catatan}\n"
            f"ATURAN WAJIB:\n"
            f"- Gunakan istilah '8 Dimensi Profil Lulusan'.\n"
            f"- DILARANG MENGGUNAKAN SIMBOL LATEX/MATH ($). Gunakan simbol teks standar.\n"
            f"- Wajib menyertakan bagian Evaluasi sebanyak TEPAT {jumlah} SOAL lengkap beserta KUNCI JAWABAN di bagian akhir.\n"
            f"- Apapun jenis dokumennya (Silabus, CP, ATP, Prota/Promes, RPP, dll.), WAJIB menyertakan lembar pengesahan/tanda tangan di paling akhir dokumen dengan format HTML berikut persis:\n\n"
            f'<br><br>\n'
            f'<table style="width: 100%; border: none; margin-top: 30px;">\n'
            f'    <tr>\n'
            f'        <td style="width: 50%; border: none; vertical-align: top;">\n'
            f'            Mengetahui,<br>\n'
            f'            <b>Kepala SDN Sukamahi 03,</b>\n'
            f'            <br><br><br><br><br>\n'
            f'            <b><u>KASWIN KARTAWIJAYA, M.Pd</u></b><br>\n'
            f'            NIP. 19720506 199903 1 007\n'
            f'        </td>\n'
            f'        <td style="width: 50%; border: none; vertical-align: top;">\n'
            f'            Cikarang Pusat, ______________<br>\n'
            f'            <b>Wali Kelas / Guru Pengampu,</b>\n'
            f'            <br><br><br><br><br>\n'
            f'            (________________________)<br>\n'
            f'            NIP. \n'
            f'        </td>\n'
            f'    </tr>\n'
            f'</table>'
        )

        try:
            gemini_model = os.getenv("GEMINI_MODEL", "gemini-3.8-flash")
            hasil = call_gemini_via_supabase(prompt, gemini_model, 0.7, 8192)

            try:
                db_firestore = firestore.client()
                db_firestore.collection('riwayat_rpp').add({
                    'username': 'Admin',
                    'mapel': mapel,
                    'jenjang': jenjang,
                    'topik': topik,
                    'jenis_output': jenis_output_kurikulum,
                    'hasil_markdown': hasil,
                    'created_at': datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                })
            except Exception as err_db:
                print(f"Gagal menyimpan ke Firestore: {err_db}")

        except Exception as e:
            hasil = f"Gagal menghasilkan dokumen kurikulum. Error: {e}"

    return render_template('kurikulum.html', hasil=hasil, form_data=form_data)

# ==========================================
# 10. ROUTE: RIWAYAT & EKSPOR
# ==========================================
@app.route('/riwayat')
def riwayat():
    riwayat_per_kelas = {}
    try:
        db_firestore = firestore.client()
        docs = db_firestore.collection('riwayat_rpp').order_by('created_at', direction=firestore.Query.DESCENDING).stream()
        
        for doc in docs:
            data = doc.to_dict()
            data['id'] = doc.id
            jenjang = data.get('jenjang', 'Lainnya')
            
            if jenjang not in riwayat_per_kelas:
                riwayat_per_kelas[jenjang] = []
            riwayat_per_kelas[jenjang].append(data)
            
    except Exception as e:
        print(f"Gagal mengambil riwayat: {e}")

    return render_template('riwayat.html', riwayat_per_kelas=riwayat_per_kelas)

@app.route('/hapus_riwayat/<id_doc>', methods=['POST'])
def hapus_riwayat(id_doc):
    try:
        db_firestore = firestore.client()
        db_firestore.collection('riwayat_rpp').document(id_doc).delete()
    except Exception as e:
        print(f"Gagal menghapus riwayat: {e}")
    return redirect(url_for('riwayat'))

@app.route('/download_word', methods=['POST'])
def download_word():
    content = request.form.get('content', '')
    topik = request.form.get('topik', 'RPP')
    return Response(
        content,
        mimetype="text/plain",
        headers={"Content-Disposition": f"attachment;filename=RPP_{topik}.txt"}
    )

# ==========================================
# 11. ROUTE: HEALTH CHECK
# ==========================================
@app.route('/healthz')
def healthz():
    return {'status': 'ok'}, 200


if __name__ == "__main__":
    # Mode desktop/lokal: Render memakai gunicorn, blok ini hanya untuk jalan lokal.
    if os.getenv("RENDER") != "true":
        port = int(os.getenv("PORT", "5000"))
        app.run(host='127.0.0.1', port=port, debug=False)
