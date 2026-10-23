import base64
import hashlib
import hmac
import json
import os
import secrets
import sys
import time
from datetime import datetime
from functools import wraps

from dotenv import load_dotenv
from flask import (
    Flask, g, render_template, request, redirect,
    url_for, Response
)
from werkzeug.middleware.proxy_fix import ProxyFix

import requests
import firebase_admin
from firebase_admin import credentials, firestore

# ==========================================
# 1. PENETAPAN DIREKTORI DASAR (Vercel / Lokal / PyInstaller lama)
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
load_dotenv(os.path.join(env_dir, ".env"))
load_dotenv()

template_dir = os.path.join(base_dir, 'templates')
static_dir = os.path.join(base_dir, 'static')
app = Flask(
    __name__,
    template_folder=template_dir,
    static_folder=None if os.getenv("VERCEL") else static_dir,
)
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1)
flask_secret_key = os.getenv("FLASK_SECRET_KEY", "")
if not flask_secret_key or flask_secret_key.startswith("your_"):
    if os.getenv("VERCEL"):
        raise RuntimeError("FLASK_SECRET_KEY harus dikonfigurasi di environment Vercel.")
    flask_secret_key = secrets.token_hex(32)
app.secret_key = flask_secret_key

# Allow iframe embedding for portal feature
@app.after_request
def set_frame_options(response):
    response.headers.pop('X-Frame-Options', None)
    response.headers['Content-Security-Policy'] = (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; "
        "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; "
        "font-src 'self' data: https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; "
        "img-src 'self' data: blob: https://*.supabase.co; "
        "connect-src 'self' https://*.supabase.co; "
        "object-src 'none'; base-uri 'self'; "
        "frame-ancestors 'self' http://localhost:62807 http://127.0.0.1:62807 "
        "https://admin-sdn-sukamahi-03.vercel.app; form-action 'self'"
    )
    return response

UPLOAD_FOLDER = os.path.join(base_dir, 'static', 'uploads')
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = 10 * 1024 * 1024

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
            "Content-Type": "application/json",
            # Rahasia bersama Flask <-> Edge Function (env PORTAL_SECRET di kedua sisi)
            "X-Portal-Key": os.getenv("PORTAL_SECRET", ""),
        },
        json={
            "prompt": prompt,
            "model": model,
            "temperature": temperature,
            "maxOutputTokens": max_output_tokens
        },
        timeout=240
    )
    
    if not response.ok:
        raise RuntimeError(f"Edge Function error: {response.status_code} - {response.text}")
    
    data = response.json()
    if 'error' in data:
        raise RuntimeError(f"Gemini error: {data['error']}")
    
    return data.get('text', '')

# ==========================================
# 4. INISIALISASI FIREBASE CLOUD FIRESTORE
# ==========================================
firebase_key_path = os.path.join(base_dir, "serviceAccountKey.json")
firebase_json_env = os.getenv("FIREBASE_SERVICE_ACCOUNT_JSON")
if firebase_json_env and firebase_json_env.startswith("your_"):
    firebase_json_env = None
if not os.path.exists(firebase_key_path) and not os.getenv("VERCEL"):
    firebase_key_path = os.path.join(os.path.dirname(base_dir), "serviceAccountKey.json")

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
# 5. AUTENTIKASI & SESI PORTAL (SSO Supabase -> Flask, iframe + CHIPS)
# ==========================================
# Sesi portal = kuki HttpOnly bertanda tangan HMAC (FLASK_SECRET_KEY).
# Atribut Partitioned (CHIPS) agar kuki tetap sampai di dalam iframe admin
# pada Chrome/Edge/Firefox. Safari/iOS tidak mendukung CHIPS → halaman login
# menampilkan tombol "Buka di tab baru" sebagai jalan keluar.
ASAL_ADMIN_DIIZINKAN = [
    "https://admin-sdn-sukamahi-03.vercel.app",
    "https://admin-sdn-sukamahi-03-bdlh.vercel.app",
    "http://localhost:62807",
    "http://127.0.0.1:62807",
    "http://localhost:5173",
    "http://localhost:3000",
]
UMUR_SESI = 8 * 3600      # masa berlaku sesi portal: 8 jam
UMUR_TOKEN_SSO = 120      # token penukaran ?st= hanya 2 menit
ROLE_PORTAL_OK = ("admin", "pegawai", "guru", "kepsek")


def _ttd_hmac(data):
    return hmac.new(app.secret_key.encode(), data.encode(), hashlib.sha256).hexdigest()


def buat_token_portal(payload):
    body = base64.urlsafe_b64encode(
        json.dumps(payload, separators=(",", ":")).encode()
    ).decode().rstrip("=")
    return body + "." + _ttd_hmac(body)


def baca_token_portal(token):
    if not token or "." not in token:
        return None
    body, tanda = token.rsplit(".", 1)
    if not hmac.compare_digest(_ttd_hmac(body), tanda):
        return None
    try:
        payload = json.loads(base64.urlsafe_b64decode(body + "===").decode())
    except Exception:
        return None
    if payload.get("exp", 0) < int(time.time()):
        return None
    return payload


def verifikasi_jwt_supabase(jwt):
    """Verifikasi JWT user ke Supabase Auth (server-to-server)."""
    if not jwt or not SUPABASE_URL or not SUPABASE_ANON_KEY:
        return None
    try:
        resp = requests.get(
            f"{SUPABASE_URL}/auth/v1/user",
            headers={"apikey": SUPABASE_ANON_KEY, "Authorization": f"Bearer {jwt}"},
            timeout=10,
        )
        if resp.ok:
            return resp.json()
        print(f"SSO: JWT ditolak Supabase (HTTP {resp.status_code})")
    except Exception as err_auth:
        print(f"SSO: gagal verifikasi JWT: {err_auth}")
    return None


def periksa_akun_portal(uid, email, jwt):
    """Cek is_active (profiles) + keanggotaan staf. Hasil: (nama, role, error)."""
    if not SUPABASE_URL or not SUPABASE_ANON_KEY:
        return None, None, "Portal belum dikonfigurasi SUPABASE_URL/ANON_KEY."
    header_user = {"apikey": SUPABASE_ANON_KEY, "Authorization": f"Bearer {jwt}"}
    nama, role, pesan_selain = email, "guru", None
    try:
        resp = requests.get(
            f"{SUPABASE_URL}/rest/v1/profiles?id=eq.{uid}&select=nama,role,is_active",
            headers=header_user, timeout=10,
        )
        if resp.ok and resp.json():
            profil = resp.json()[0]
            nama = profil.get("nama") or email
            role = profil.get("role") or "guru"
            if not profil.get("is_active"):
                return None, None, "Akun belum diaktifkan admin."
        if role not in ROLE_PORTAL_OK:
            role = "guru"
    except Exception as err_pro:
        print(f"SSO: gagal memuat profil: {err_pro}")
        return None, None, "Gagal memuat profil akun."
    # Cek tabel staf: pakai service role bila ada env, jika tidak pakai token user
    kunci_service = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    header_staf = (
        {"apikey": kunci_service, "Authorization": f"Bearer {kunci_service}"}
        if kunci_service
        else header_user
    )
    try:
        resp = requests.get(
            f"{SUPABASE_URL}/rest/v1/staf?user_id=eq.{uid}&select=user_id",
            headers=header_staf, timeout=10,
        )
        if resp.ok:
            if not resp.json():
                return None, None, "Akun belum terdaftar di tabel staf."
        else:
            pesan_selain = "Gagal memeriksa akses staf."
    except Exception as err_staf:
        print(f"SSO: gagal memeriksa staf: {err_staf}")
        pesan_selain = "Gagal memeriksa akses staf."
    if pesan_selain:
        return None, None, pesan_selain
    return nama, role, None


def sesi_portal_baru(data_sso):
    """Payload sesi portal penuh (8 jam) dengan token CSRF di dalamnya."""
    return {
        "uid": data_sso["uid"],
        "email": data_sso.get("email", ""),
        "nama": data_sso.get("nama", ""),
        "role": data_sso.get("role", "guru"),
        "csrf": secrets.token_hex(16),
        "exp": int(time.time()) + UMUR_SESI,
    }


def tetapkan_kuki_sesi(resp, payload_sesi):
    token = buat_token_portal(payload_sesi)
    resp.headers.add(
        "Set-Cookie",
        f"portal_sesi={token}; Path=/; Secure; HttpOnly; SameSite=None; "
        f"Partitioned; Max-Age={UMUR_SESI}",
    )
    return resp


def muat_sesi():
    """Sesi aktif: dari cookie, atau dari token penukaran ?st= (SSO)."""
    if "sesi" in g:
        return g.sesi
    token_st = request.args.get("st")
    if token_st:
        data = baca_token_portal(token_st)
        if data and data.get("sso"):
            sesi = sesi_portal_baru(data)
            g.sesi = sesi
            g.sesi_baru = sesi   # dipasang sebagai kuki lewat after_request
            return sesi
        return None
    sesi = baca_token_portal(request.cookies.get("portal_sesi"))
    if sesi:
        g.sesi = sesi
    return sesi


def perlu_login(view):
    @wraps(view)
    def dilindungi(*args, **kwargs):
        if muat_sesi() is None:
            return redirect(url_for("login"))
        return view(*args, **kwargs)
    return dilindungi


def perlu_csrf(view):
    @wraps(view)
    def diperiksa(*args, **kwargs):
        if request.method != "POST":
            return view(*args, **kwargs)
        sesi = g.get("sesi") or {}
        token_form = request.form.get("csrf", "")
        if not token_form or not hmac.compare_digest(token_form, sesi.get("csrf", "")):
            return Response(
                "Token CSRF tidak valid. Muat ulang halaman sebelum mengirim form.",
                status=400,
                mimetype="text/plain",
            )
        return view(*args, **kwargs)
    return diperiksa


@app.context_processor
def injeksi_sesi():
    return {"sesi": (g.get("sesi") if g else None) or {}}


@app.after_request
def pasang_kuki_sesi(response):
    sesi_baru = g.get("sesi_baru") if g else None
    if sesi_baru is not None:
        try:
            response = tetapkan_kuki_sesi(response, sesi_baru)
        except Exception as err_kuki:
            # Jangan jatuhkan seluruh response; catat untuk log runtime
            print(f"KUKI-DIAG: {type(err_kuki).__name__}: {err_kuki}")
    return response


@app.route("/sso", methods=["POST", "OPTIONS"])
def sso_handshake():
    """Menukar JWT Supabase (dari aplikasi admin) dengan token penukaran ?st=."""
    origin = request.headers.get("Origin", "")
    cors = {}
    if origin in ASAL_ADMIN_DIIZINKAN:
        cors = {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Headers": "authorization, content-type",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Vary": "Origin",
        }
    if request.method == "OPTIONS":
        return Response(status=204, headers=cors)
    if origin not in ASAL_ADMIN_DIIZINKAN:
        return Response(
            json.dumps({"error": "Asal situs tidak diizinkan."}),
            status=403, mimetype="application/json", headers={"Vary": "Origin"},
        )
    jwt = (request.headers.get("Authorization", "") or "").replace("Bearer ", "").strip()
    user = verifikasi_jwt_supabase(jwt)
    if not user or not user.get("id"):
        return Response(
            json.dumps({"error": "Sesi Supabase tidak valid. Masuk kembali di aplikasi admin."}),
            status=401, mimetype="application/json", headers=cors,
        )
    nama, role, galat = periksa_akun_portal(user["id"], user.get("email", ""), jwt)
    if galat:
        return Response(
            json.dumps({"error": galat}),
            status=403, mimetype="application/json", headers=cors,
        )
    token = buat_token_portal({
        "sso": True,
        "uid": user["id"],
        "email": user.get("email", ""),
        "nama": nama,
        "role": role,
        "exp": int(time.time()) + UMUR_TOKEN_SSO,
    })
    return Response(json.dumps({"st": token}), mimetype="application/json", headers=cors)


@app.route("/login", methods=["GET", "POST"])
def login():
    galat = None
    if muat_sesi():
        return redirect(url_for("dashboard"))
    if request.method == "POST":
      try:
        email = (request.form.get("email") or "").strip()
        sandi = request.form.get("password") or ""
        try:
            resp_auth = requests.post(
                f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
                headers={"apikey": SUPABASE_ANON_KEY, "Content-Type": "application/json"},
                json={"email": email, "password": sandi},
                timeout=15,
            )
        except Exception as err_login:
            resp_auth = None
            print(f"Login portal gagal: {err_login}")
            galat = "Gagal menghubungi layanan login."
        if resp_auth is not None and resp_auth.ok:
            data_auth = resp_auth.json()
            jwt = data_auth.get("access_token", "")
            user = data_auth.get("user", {}) or {}
            nama, role, galat_profil = periksa_akun_portal(user.get("id", ""), email, jwt)
            if galat_profil:
                galat = galat_profil
            else:
                sesi = {
                    "uid": user.get("id", ""),
                    "email": email,
                    "nama": nama,
                    "role": role,
                    "csrf": secrets.token_hex(16),
                    "exp": int(time.time()) + UMUR_SESI,
                }
                g.sesi = sesi
                g.sesi_baru = sesi
                return redirect(url_for("dashboard"))
        else:
            galat = "Email atau kata sandi tidak sesuai."
      except Exception as err_diagnos:
          # Diagnosis temporer: tampilkan penyebab running di UI pembaca, bukan 500 buntu.
          galat = f"[Diagnostik] {type(err_diagnos).__name__}: {str(err_diagnos)[:300]}"
          print(f"LOGIN-DIAG: {type(err_diagnos).__name__}: {err_diagnos}")
    return render_template("login.html", galat=galat)


@app.route("/logout", methods=["GET", "POST"])
def logout():
    resp = redirect(url_for("login"))
    resp.headers.add(
        "Set-Cookie",
        "portal_sesi=; Path=/; Secure; HttpOnly; SameSite=None; Partitioned; Max-Age=0",
    )
    resp.headers.add(
        "Set-Cookie",
        "portal_sesi=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0",
    )
    return resp


# ==========================================
# 7. ROUTE: DASHBOARD & GENERATOR RPP / SOAL
# ==========================================
@app.route('/', methods=['GET', 'POST'])
@app.route('/dashboard', methods=['GET', 'POST'])
@perlu_login
@perlu_csrf
def dashboard():
    hasil = None
    form_data = {}
    gambar_urls = []

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
            
            # Simpan Otomatis ke Cloud Firestore (Khusus RPP)
            if jenis_output not in ['Soal Pilihan Ganda (HOTS & LOTS)', 'pg', 'Soal Uraian / Esai', 'esai']:
                try:
                    db_firestore = firestore.client()
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
@perlu_login
@perlu_csrf
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
@perlu_login
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
@perlu_login
@perlu_csrf
def hapus_riwayat(id_doc):
    try:
        db_firestore = firestore.client()
        db_firestore.collection('riwayat_rpp').document(id_doc).delete()
    except Exception as e:
        print(f"Gagal menghapus riwayat: {e}")
    return redirect(url_for('riwayat'))

@app.route('/download_word', methods=['POST'])
@perlu_login
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
    # Blok ini hanya untuk pengembangan lokal (python app.py).
    # Di Vercel, aplikasi dijalankan oleh runtime Python Vercel — blok ini tidak dieksekusi.
    port = int(os.getenv("PORT", "5000"))
    app.run(host='127.0.0.1', port=port, debug=False)
