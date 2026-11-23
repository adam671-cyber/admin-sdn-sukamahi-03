import hashlib
import hmac
import json
import os
import re
import secrets
import sys
import time
from datetime import datetime
from functools import wraps
from urllib.parse import urlsplit

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
# .env di root repo (parent folder portal) — agar development lokal tetap
# menemukan kredensial apa pun direktori kerja saat menjalankan Flask.
_root_env = os.path.join(os.path.dirname(base_dir), ".env")
if os.path.exists(_root_env):
    load_dotenv(_root_env)

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
        "connect-src 'self' https://*.supabase.co https://cdn.jsdelivr.net; "
        "object-src 'none'; base-uri 'self'; "
        "frame-ancestors 'self' http://localhost:3000 http://127.0.0.1:3000 "
        "https://admin-sdn-sukamahi-03.vercel.app "
        "https://admin-sdn-sukamahi-03-bdlh.vercel.app; form-action 'self'"
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

def _post_edge(payload, timeout=240):
    if not SUPABASE_URL or not SUPABASE_ANON_KEY:
        raise RuntimeError("SUPABASE_URL dan SUPABASE_ANON_KEY harus dikonfigurasi di environment variable.")
    response = requests.post(
        f"{SUPABASE_URL}/functions/v1/generate-modul",
        headers={
            "Authorization": "Bearer " + SUPABASE_ANON_KEY,
            "Content-Type": "application/json",
            # Rahasia bersama Flask <-> Edge Function (env PORTAL_SECRET di kedua sisi).
            # .strip() memotong newline terselubung di nilai env (mis. hasil paste
            # di dashboard Vercel) — header HTTP tidak boleh memuat character krusial.
            "X-Portal-Key": os.getenv("PORTAL_SECRET", "").strip(),
        },
        json=payload,
        timeout=timeout
    )
    if not response.ok:
        raise RuntimeError(f"Edge Function error: {response.status_code} - {response.text}")
    data = response.json()
    if 'error' in data:
        raise RuntimeError(f"Gemini error: {data['error']}")
    return data

def call_gemini_via_supabase(prompt, model="gemini-3.7-flash", temperature=0.7,
                             max_output_tokens=4096, timeout=140):
    """Panggil Gemini melalui Supabase Edge Function untuk keamanan.

    timeout default 140 detik: di bawah batas wall-clock worker Supabase
    (150 detik di plan Free), agar panggilan yang akan di-kill oleh
    Supabase gagal cepat dan bisa di-retry oleh gemini_retry().
    """
    return _post_edge({
        "prompt": prompt,
        "model": model,
        "temperature": temperature,
        "maxOutputTokens": max_output_tokens
    }, timeout=timeout).get('text', '')

def generate_gambar_via_supabase(prompt, model="gemini-3.7-flash"):
    """Generate gambar; mengembalikan list data URI (base64)."""
    data = _post_edge({"prompt": prompt, "model": model, "generateImage": True}, timeout=60)
    return [f"data:{im.get('mimeType', 'image/png')};base64,{im['data']}" for im in data.get('images', [])]

# ==========================================
# 3b. GENERASI PER SECTION + RETRY (ANTI LIMIT WORKER SUPABASE)
# ==========================================
# Worker Supabase punya batas wall-clock 150 detik (Free) / 400 detik
# (Paid). Generasi satu dokumen 8192 token sering menembus batas itu dan
# worker-nya di-kill dengan error 546 WORKER_RESOURCE_LIMIT. Solusi:
# dokumen dipecah jadi beberapa section kecil (<= 4096 token) dengan
# konteks berantai, dan tiap section dipanggil terpisah + retry/backoff,
# sehingga satu section yang gagal tidak membuang seluruh dokumen.

TOKEN_PER_SEKSI = 4096
TIMEOUT_PER_PANGGILAN = 140  # < 150 detik agar call yang akan di-kill gagal cepat lalu di-retry
MAKS_RETRY = 3


def _is_retriable(err):
    """Apakah error Gemini/Edge Function layak dicoba lagi?"""
    pesan = str(err).lower()
    markers = (
        "546", "worker_resource_limit", "429", "500", "502", "503", "504",
        "timeout", "timed out", "connection",
    )
    return any(m in pesan for m in markers)


def gemini_retry(prompt, model="gemini-3.7-flash", temperature=0.7,
                 max_output_tokens=TOKEN_PER_SEKSI):
    """Panggil Gemini via Edge Function dengan retry + backoff (5s, 20s).

    Hanya error sementara (546/429/5xx/timeout) yang dicoba ulang;
    error lain (mis. 401 auth) langsung dilempar.
    """
    for percobaan in range(1, MAKS_RETRY + 1):
        try:
            return call_gemini_via_supabase(
                prompt, model, temperature, max_output_tokens,
                timeout=TIMEOUT_PER_PANGGILAN,
            )
        except Exception as e:
            if percobaan == MAKS_RETRY or not _is_retriable(e):
                raise
            # Backoff: 5s lalu 20s — cukup panjang untuk "high demand" (503)
            # tanpa membuat total menunggu seluruh section membengkak.
            print(f"[portal] retry {percobaan}/{MAKS_RETRY - 1} untuk Gemini: {e}")
            time.sleep(5 if percobaan == 1 else 20)


def generate_dokumen_per_section(daftar_section, model="gemini-3.7-flash", temperature=0.7):
    """Jalankan daftar section (judul, prompt, max_tokens) berurutan.

    Teks section sebelumnya disisipkan ke prompt section berikutnya sebagai
    konteks agar dokumen tetap koheren. Return (hasil_gabungan, peringatan).
    Jika sebuah section gagal habis retry, hasil section yang sudah selesai
    tetap dikembalikan beserta peringatan bahwa dokumen belum lengkap.
    """
    bagian_selesai = []
    konteks = ""
    for judul, prompt, maks in daftar_section:
        if konteks:
            prompt_penuh = (
                prompt
                + "\n\n--- KONTEKS: bagian dokumen yang SUDAH SELESAI "
                  "(jangan diulang; buat HANYA bagian yang diminta agar tetap koheren)\n"
                  + konteks
            )
        else:
            prompt_penuh = prompt
        mulai = time.time()
        try:
            teks = gemini_retry(prompt_penuh, model, temperature, maks)
        except Exception as e:
            print(f"[portal] section '{judul}' gagal setelah retry ({time.time() - mulai:.0f}s): {e}")
            peringatan = (
                f"[PERINGATAN] Dokumen terhenti di bagian '{judul}' setelah {MAKS_RETRY} percobaan. "
                "Hasil di atas belum lengkap — silakan generate ulang."
            )
            if bagian_selesai:
                return "\n\n".join(bagian_selesai) + "\n\n" + peringatan, peringatan
            return f"Gagal menghasilkan dokumen. Error: {e}", None
        print(f"[portal] section '{judul}' selesai dalam {time.time() - mulai:.0f}s")
        bagian_selesai.append(teks)
        konteks = "\n\n".join(bagian_selesai)
    return "\n\n".join(bagian_selesai), None

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
#
# Alur SSO:
#   1. Aplikasi admin membuka iframe ke /sso#token=<access_token Supabase>
#      (token di fragment URL → tidak ikut ke log server).
#   2. Halaman /sso (tanpa auth) membaca fragment, lalu POST token ke /sso.
#   3. Server memverifikasi token ke Supabase Auth + memastikan user punya role
#      admin/guru/pegawai yang aktif di profiles (RLS "profiles_select_own"),
#      lalu menyetel kuki sesi HMAC.
#   4. Semua route lain dilindungi decorator @wajib_login.

PORTAL_SESI_NAMA = "sesi_portal"
PORTAL_SESI_UMUR = 8 * 3600  # 8 jam
# Role yang diizinkan membuka portal (dari tabel profiles).
ROLE_PORTAL_DIIZINKAN = {"admin", "guru", "pegawai"}
ASAL_ADMIN = [
    "admin-sdn-sukamahi-03.vercel.app",
    "admin-sdn-sukamahi-03-bdlh.vercel.app",
]

HALAMAN_SSO = """<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Menyiapkan sesi portal&hellip;</title>
<style>
  body { font-family: system-ui, sans-serif; display: grid; place-items: center;
         min-height: 100vh; margin: 0; color: #1f2937; background: #f8fafc; }
  main { text-align: center; padding: 2rem; max-width: 24rem; }
  h1 { font-size: 1.1rem; } p { color: #6b7280; }
</style>
</head>
<body>
<main>
  <h1>Menyiapkan sesi portal&hellip;</h1>
  <p id="pesan">Mohon tunggu sebentar.</p>
</main>
<script>
(function () {
  var pesan = document.getElementById('pesan');
  var token = '';
  try {
    var cocok = location.hash.match(/token=([^&]+)/);
    token = cocok ? decodeURIComponent(cocok[1]) : '';
    location.hash = '';
  } catch (e) { /* abaikan */ }
  if (!token) {
    pesan.textContent = 'Sesi tidak ditemukan. Buka portal ini dari aplikasi admin (menu Portal).';
    return;
  }
  fetch('/sso', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ token: token })
  })
    .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
    .then(function (h) {
      if (h.ok) { location.replace('/dashboard'); }
      else { pesan.textContent = (h.j && h.j.pesan) || 'Gagal menyiapkan sesi.'; }
    })
    .catch(function () { pesan.textContent = 'Gagal menghubungi server portal. Coba muat ulang.'; });
})();
</script>
</body>
</html>"""


def _tandatangan(muatan: str) -> str:
    return hmac.new(flask_secret_key.encode(), muatan.encode(), hashlib.sha256).hexdigest()


def buat_cookie_sesi(uid: str, email: str, role: str) -> str:
    kedaluwarsa = int(time.time()) + PORTAL_SESI_UMUR
    muatan = f"{uid}|{kedaluwarsa}|{email}|{role}"
    return f"{muatan}|{_tandatangan(muatan)}"


def baca_sesi():
    nilai = request.cookies.get(PORTAL_SESI_NAMA, "")
    if not nilai:
        return None
    bagian = nilai.split("|")
    if len(bagian) != 5:
        return None
    uid, exp_str, email, role, tanda = bagian
    if not exp_str.isdigit() or int(exp_str) < int(time.time()):
        return None
    if role not in ROLE_PORTAL_DIIZINKAN:
        return None
    if not secrets.compare_digest(_tandatangan(f"{uid}|{exp_str}|{email}|{role}"), tanda):
        return None
    return {"uid": uid, "email": email, "role": role}


def wajib_login(view):
    @wraps(view)
    def dibungkus(*args, **kwargs):
        sesi = baca_sesi()
        if not sesi:
            return redirect(url_for("sso"))
        g.sesi = sesi
        return view(*args, **kwargs)
    return dibungkus


@app.before_request
def cek_asal_post():
    """Proteksi CSRF: permintaan pengubah data wajib berasal dari asal tepercaya."""
    if request.method not in ("POST", "PUT", "PATCH", "DELETE"):
        return None
    asal = request.headers.get("Origin") or request.headers.get("Referer")
    if not asal:
        return Response("Permintaan ditolak: asal permintaan tidak diketahui.", 403)
    try:
        host = urlsplit(asal).netloc.lower()
    except ValueError:
        return Response("Permintaan ditolak: asal permintaan tidak valid.", 403)
    diizinkan = {request.host.lower(), *ASAL_ADMIN}
    if not os.getenv("VERCEL"):
        # Pengembangan lokal: admin bisa jalan di port mana pun.
        if host.startswith("localhost:") or host.startswith("127.0.0.1:"):
            return None
    if host not in diizinkan:
        return Response("Permintaan ditolak: asal tidak diizinkan.", 403)
    return None


@app.context_processor
def injeksi_sesi():
    return {"sesi": getattr(g, "sesi", None) or {}}


@app.route("/sso", methods=["GET", "POST"])
def sso():
    if request.method == "POST":
        data = request.get_json(silent=True) or {}
        token = str(data.get("token", "")).strip()
        if not token or not SUPABASE_URL or not SUPABASE_ANON_KEY:
            return Response(
                json.dumps({"ok": False, "pesan": "Sesi tidak valid atau konfigurasi portal belum lengkap."}),
                mimetype="application/json", status=400)

        try:
            cek = requests.get(
                f"{SUPABASE_URL}/auth/v1/user",
                headers={"Authorization": f"Bearer {token}", "apikey": SUPABASE_ANON_KEY},
                timeout=15,
            )
            user = cek.json() if cek.ok else {}
            uid = str(user.get("id", "")) if isinstance(user, dict) else ""
            email = str(user.get("email", "")) if isinstance(user, dict) else ""
            if not cek.ok or not uid:
                return Response(
                    json.dumps({"ok": False, "pesan": "Sesi tidak valid. Muat ulang portal dari aplikasi admin."}),
                    mimetype="application/json", status=401)

            # Pastikan user punya role (admin/guru/pegawai) yang aktif di profiles.
            # RLS "profiles_select_own": setiap akun hanya bisa baca barisnya sendiri.
            cek_profil = requests.get(
                f"{SUPABASE_URL}/rest/v1/profiles",
                params={"id": f"eq.{uid}", "select": "role,is_active"},
                headers={"Authorization": f"Bearer {token}", "apikey": SUPABASE_ANON_KEY},
                timeout=15,
            )
            baris = cek_profil.json() if cek_profil.ok else []
            profil = baris[0] if isinstance(baris, list) and baris else {}
            role = str(profil.get("role", "")).strip().lower()
            if role not in ROLE_PORTAL_DIIZINKAN or profil.get("is_active") is not True:
                return Response(
                    json.dumps({
                        "ok": False,
                        "pesan": "Akun belum terdaftar sebagai admin/guru/pegawai aktif di sekolah.",
                    }),
                    mimetype="application/json", status=403)
        except (requests.RequestException, ValueError):
            return Response(
                json.dumps({"ok": False, "pesan": "Gagal menghubungi layanan autentikasi. Coba lagi."}),
                mimetype="application/json", status=502)

        produksi = bool(os.getenv("VERCEL"))
        respons = Response(json.dumps({"ok": True}), mimetype="application/json", status=200)
        argumen_kuki = dict(
            max_age=PORTAL_SESI_UMUR, httponly=True, path="/",
            samesite="None" if produksi else "Lax", secure=produksi,
        )
        if produksi:
            # CHIPS: kuki terpartisi + SameSite=None + Secure agar tersimpan
            # dalam konteks iframe pihak ketiga (Vercel -> portal produksi).
            try:
                respons.set_cookie(PORTAL_SESI_NAMA, buat_cookie_sesi(uid, email, role), partitioned=True, **argumen_kuki)
            except TypeError:
                respons.set_cookie(PORTAL_SESI_NAMA, buat_cookie_sesi(uid, email, role), **argumen_kuki)
        else:
            # Lokal: kuki biasa (Lax, tanpa Partitioned) di loopback.
            # Partisi + Lax ditolak Chrome secara diam-diam di iframe,
            # sehingga kuki tidak pernah kembali ke /dashboard.
            respons.set_cookie(PORTAL_SESI_NAMA, buat_cookie_sesi(uid, email, role), **argumen_kuki)
        return respons

    # GET: halaman penukar token fragment -> kuki sesi.
    return HALAMAN_SSO


@app.route('/', methods=['GET', 'POST'])
@app.route('/dashboard', methods=['GET', 'POST'])
@wajib_login
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

        # Aturan bersama diulang di SETIAP section agar model tidak "lupa"
        # aturan meskipun dokumen dipecah jadi beberapa pemanggilan terpisah.
        aturan_bersama = (
            "ATURAN BERSAMA:\n"
            "1. DILARANG menggunakan simbol LATEX/MATH seperti $ atau \\rightarrow! Gunakan panah biasa (->).\n"
            "2. DILARANG membuat bagian TANDA TANGAN / MENGETAHUI di akhir teks.\n"
            "3. Tuliskan HANYA bagian yang diminta; jangan mengulang bagian lain.\n"
            f"4. {instruksi_gambar}"
        )
        aturan_rpp = (
            "HANYA gunakan istilah '8 Dimensi Profil Lulusan'. "
            "DILARANG KERAS istilah 'Profil Pelajar Pancasila', 'P3', atau 6 ELEMEN PPP."
        )
        ctx_doc = f"Mata Pelajaran: {mapel}. Kelas/Jenjang: {jenjang}. Topik/Materi: {topik}."
        try:
            n_soal = int(jumlah or 15)
        except ValueError:
            n_soal = 15

        daftar_section = []

        # 1. Section Soal Pilihan Ganda
        if jenis_output in ['Soal Pilihan Ganda (HOTS & LOTS)', 'pg']:
            akhir_a = n_soal // 2
            if n_soal > 15:
                daftar_section.append((
                    "soal_pg_keping_1",
                    (
                        f"Buat LEMBAR SOAL UJIAN PILIHAN GANDA siap cetak untuk Sekolah Dasar, "
                        "tanpa komponen Modul Ajar / RPP.\n"
                        f"{ctx_doc}\n"
                        "Tuliskan HANYA bagian berikut (JANGAN kunci jawaban):\n"
                        "1. Header Identitas Siswa (format isian: Nama, Kelas, No. Absen, Tanggal, Nilai/Paraf).\n"
                        "2. Petunjuk Pengerjaan Soal.\n"
                        f"3. Naskah soal PILIHAN GANDA nomor 1 s.d. {akhir_a} "
                        "(tiap soal opsi A,B,C,D; campuran HOTS & LOTS).\n"
                        f"{aturan_bersama}"
                    ),
                    TOKEN_PER_SEKSI,
                ))
                daftar_section.append((
                    "soal_pg_keping_2",
                    (
                        f"DOKUMEN: LEMBAR SOAL PILIHAN GANDA. {ctx_doc}\n"
                        f"Lanjutkan naskah: soal PILIHAN GANDA nomor {akhir_a + 1} s.d. {n_soal} "
                        "(tiap soal opsi A,B,C,D; campuran HOTS & LOTS; lanjutkan urutan dari konteks).\n"
                        f"{aturan_bersama}"
                    ),
                    TOKEN_PER_SEKSI,
                ))
            else:
                daftar_section.append((
                    "naskah_soal_pg",
                    (
                        f"Buat LEMBAR SOAL UJIAN PILIHAN GANDA siap cetak untuk Sekolah Dasar, "
                        "tanpa komponen Modul Ajar / RPP.\n"
                        f"{ctx_doc}\n"
                        "Tuliskan HANYA bagian berikut (JANGAN kunci jawaban):\n"
                        "1. Header Identitas Siswa (format isian: Nama, Kelas, No. Absen, Tanggal, Nilai/Paraf).\n"
                        "2. Petunjuk Pengerjaan Soal.\n"
                        f"3. Naskah {n_soal} soal PILIHAN GANDA berurutan nomor 1 s.d. {n_soal} "
                        "(tiap soal opsi A,B,C,D; campuran HOTS & LOTS).\n"
                        f"{aturan_bersama}"
                    ),
                    TOKEN_PER_SEKSI,
                ))
            daftar_section.append((
                "kunci_jawaban",
                (
                    f"Tuliskan HANYA bagian KUNCI JAWABAN DAN PEDOMAN PENSKORAN untuk {n_soal} soal "
                    f"pilihan ganda di konteks. {ctx_doc}\n"
                    f"Cantumkan nomor 1 s.d. {n_soal} dengan jawaban benar dan penjelasan singkat tiap nomor. "
                    "DILARANG membuat bagian tanda tangan / mengetahui."
                ),
                2048,
            ))

        # 2. Section Soal Esai
        elif jenis_output in ['Soal Uraian / Esai', 'esai']:
            akhir_a = n_soal // 2
            if n_soal > 10:
                daftar_section.append((
                    "soal_esai_keping_1",
                    (
                        f"Buat LEMBAR SOAL UJIAN URAIAN/ESAI siap cetak untuk Sekolah Dasar, "
                        "tanpa komponen Modul Ajar / RPP.\n"
                        f"{ctx_doc}\n"
                        "Tuliskan HANYA bagian berikut (JANGAN kunci jawaban):\n"
                        "1. Header Identitas Siswa (format isian: Nama, Kelas, No. Absen, Tanggal, Nilai/Paraf).\n"
                        "2. Petunjuk Pengerjaan Soal Uraian.\n"
                        f"3. Soal uraian HOTS/LOTS nomor 1 s.d. {akhir_a} yang jelas dan terukur.\n"
                        f"{aturan_bersama}"
                    ),
                    TOKEN_PER_SEKSI,
                ))
                daftar_section.append((
                    "soal_esai_keping_2",
                    (
                        f"DOKUMEN: LEMBAR SOAL URAIAN/ESAI. {ctx_doc}\n"
                        f"Lanjutkan naskah: soal uraian HOTS/LOTS nomor {akhir_a + 1} s.d. {n_soal} "
                        "yang jelas dan terukur (lanjutkan urutan dari konteks).\n"
                        f"{aturan_bersama}"
                    ),
                    TOKEN_PER_SEKSI,
                ))
            else:
                daftar_section.append((
                    "naskah_soal_esai",
                    (
                        f"Buat LEMBAR SOAL UJIAN URAIAN/ESAI siap cetak untuk Sekolah Dasar, "
                        "tanpa komponen Modul Ajar / RPP.\n"
                        f"{ctx_doc}\n"
                        "Tuliskan HANYA bagian berikut (JANGAN kunci jawaban):\n"
                        "1. Header Identitas Siswa (format isian: Nama, Kelas, No. Absen, Tanggal, Nilai/Paraf).\n"
                        "2. Petunjuk Pengerjaan Soal Uraian.\n"
                        f"3. Naskah {n_soal} soal uraian HOTS/LOTS yang jelas.\n"
                        f"{aturan_bersama}"
                    ),
                    TOKEN_PER_SEKSI,
                ))
            daftar_section.append((
                "kunci_rubrik",
                (
                    f"Tuliskan HANYA bagian KUNCI JAWABAN DAN RUBRIK PENILAIAN/PEDOMAN PENSKORAN "
                    f"untuk {n_soal} soal uraian di konteks. {ctx_doc}\n"
                    f"Cantumkan jawaban ideal dan rubrik penskoran per soal, nomor 1 s.d. {n_soal}. "
                    "DILARANG membuat bagian tanda tangan / mengetahui."
                ),
                4096,
            ))

        # 3. Section Modul Ajar / RPP
        else:
            if template_type == 'merdeka_ringkas':
                daftar_section.append((
                    "rpp_merdeka_ringkas",
                    (
                        "Kamu adalah guru dan penyusun RPP/Modul Ajar profesional.\n"
                        f"Buat Modul Ajar / RPP untuk {ctx_doc}.\n"
                        "FORMAT DOKUMEN: RPP singkat, padat, efisien, dan langsung ke inti "
                        "untuk 1 kali pertemuan.\n"
                        "Tuliskan seluruh dokumen: Informasi Umum, Tujuan Pembelajaran, dan Kegiatan "
                        "Pembelajaran (model & metode BERVARIASI: tidak selalu PBL atau kerja kelompok; "
                        "boleh Discovery Learning, Direct Instruction, Cooperative Learning, atau "
                        f"kerja mandiri/perorangan), lalu EVALUASI: TEPAT {n_soal} SOAL + KUNCI JAWABAN "
                        "LENGKAP + Pedoman Penskoran di bagian akhir.\n"
                        f"{instruksi_catatan}\n{aturan_rpp}\n{aturan_bersama}"
                    ),
                    TOKEN_PER_SEKSI,
                ))
            elif template_type == 'standar_lengkap':
                daftar_section.append((
                    "info_umum_dan_kegiatan",
                    (
                        "Kamu adalah guru dan penyusun RPP/Modul Ajar profesional.\n"
                        f"Buat Modul Ajar / RPP untuk {ctx_doc}.\n"
                        "FORMAT DOKUMEN: modul ajar lengkap dengan format tabel HTML/Markdown "
                        "pada bagian kegiatan pembelajaran, dirancang untuk 1 kali pertemuan.\n"
                        "Tuliskan HANYA bagian: 1) INFORMASI UMUM (CP, TP, materi, identitas) dan "
                        "2) KEGIATAN PEMBELAJARAN dalam tabel. Model & metode BERVARIASI: tidak "
                        "selalu PBL atau kerja kelompok; boleh Discovery Learning, Direct "
                        "Instruction, Cooperative Learning, atau kerja mandiri/perorangan. "
                        "Integrasikan '8 Dimensi Profil Lulusan' secara eksplisit.\n"
                        f"{instruksi_catatan}\n{aturan_rpp}\n{aturan_bersama}"
                    ),
                    TOKEN_PER_SEKSI,
                ))
                daftar_section.append((
                    "asesmen_dan_lkpd",
                    (
                        f"DOKUMEN: Modul Ajar / RPP yang sama ({ctx_doc}).\n"
                        "Tuliskan HANYA bagian: 1) ASESMEN lengkap dengan rubrik penilaian "
                        "(kriteria dan skor) dan 2) draf LEMBAR KERJA PESERTA DIDIK (LKPD) di "
                        "bagian lampiran. Sesuaikan isi dengan bagian sebelumnya di konteks.\n"
                        f"{aturan_rpp}\n{aturan_bersama}"
                    ),
                    TOKEN_PER_SEKSI,
                ))
                daftar_section.append((
                    "evaluasi",
                    (
                        f"DOKUMEN: Modul Ajar / RPP yang sama ({ctx_doc}).\n"
                        f"Tuliskan HANYA bagian EVALUASI di akhir dokumen: TEPAT {n_soal} SOAL EVALUASI, "
                        "KUNCI JAWABAN LENGKAP, dan Pedoman Penskoran. Sesuaikan dengan materi dan "
                        "kegiatan pembelajaran di konteks.\n"
                        f"{aturan_rpp}\n{aturan_bersama}"
                    ),
                    TOKEN_PER_SEKSI,
                ))
            else:  # template_type == 'deep_learning' (default)
                daftar_section.append((
                    "info_umum_dan_kegiatan",
                    (
                        "Kamu adalah guru dan penyusun RPP/Modul Ajar profesional.\n"
                        f"Buat Modul Ajar / RPP untuk {ctx_doc} dengan pendekatan Deep Learning.\n"
                        "Tuliskan HANYA bagian: 1) INFORMASI UMUM (CP, TP, materi, identitas) dan "
                        "2) KEGIATAN PEMBELAJARAN untuk 1 kali pertemuan yang mengintegrasikan "
                        "secara eksplisit '8 Dimensi Profil Lulusan'. Model & metode BERVARIASI: "
                        "tidak selalu PBL atau kerja kelompok.\n"
                        f"{instruksi_catatan}\n{aturan_rpp}\n{aturan_bersama}"
                    ),
                    TOKEN_PER_SEKSI,
                ))
                daftar_section.append((
                    "evaluasi",
                    (
                        f"DOKUMEN: Modul Ajar / RPP yang sama ({ctx_doc}).\n"
                        f"Tuliskan HANYA bagian EVALUASI di akhir dokumen: TEPAT {n_soal} SOAL EVALUASI, "
                        "KUNCI JAWABAN LENGKAP, dan Pedoman Penskoran. Sesuaikan dengan materi dan "
                        "kegiatan pembelajaran di konteks.\n"
                        f"{instruksi_catatan}\n{aturan_rpp}\n{aturan_bersama}"
                    ),
                    TOKEN_PER_SEKSI,
                ))

        # Minta Respon dari Gemini AI (via Supabase Edge Function)
        try:
            gemini_model = os.getenv("GEMINI_MODEL", "gemini-3.7-flash")
            
            # Langkah 1: Dapatkan teks per section (anti limit worker Supabase) + retry
            hasil, peringatan = generate_dokumen_per_section(daftar_section, gemini_model, 0.7)
            if peringatan:
                print(peringatan)

            # Langkah 2: Generate gambar ilustrasi (gagal tidak membatalkan teks)
            try:
                prompt_gambar = (
                    f"Buat satu gambar ilustrasi edukatif, berwarna, ramah anak SD, tanpa teks, "
                    f"untuk materi '{topik}' pelajaran {mapel}. {catatan_opsional}"
                )
                gambar_urls = generate_gambar_via_supabase(
                    prompt_gambar, os.getenv("GEMINI_IMAGE_MODEL", "gemini-2.5-flash-image"))
            except Exception as err_img:
                import traceback
                traceback.print_exc()
                print(f"Gagal generate gambar: {err_img}")

            # Simpan Otomatis ke Cloud Firestore (Khusus RPP)
            if jenis_output not in ['Soal Pilihan Ganda (HOTS & LOTS)', 'pg', 'Soal Uraian / Esai', 'esai']:
                try:
                    user_uid = g.sesi.get('uid', '') if hasattr(g, 'sesi') and g.sesi else ''
                    user_email = g.sesi.get('email', '') if hasattr(g, 'sesi') and g.sesi else ''
                    db_firestore = firestore.client()
                    db_firestore.collection('riwayat_rpp').add({
                        'user_id': user_uid,
                        'username': user_email or 'Pengguna',
                        'mapel': mapel,
                        'jenjang': jenjang,
                        'topik': topik,
                        'jenis_output': jenis_output,
                        'template_type': template_type,
                        'hasil_markdown': hasil,
                        'gambar_urls': [],
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
@wajib_login
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

        ctx_kurikulum = f"mata pelajaran {mapel} tingkat {jenjang} dengan topik '{topik}'"
        try:
            n_soal = int(jumlah or 15)
        except ValueError:
            n_soal = 15

        aturan_kurikulum = (
            f"{instruksi_catatan}\n"
            "ATURAN WAJIB:\n"
            "- Gunakan istilah '8 Dimensi Profil Lulusan'.\n"
            "- DILARANG menggunakan simbol LATEX/MATH ($). Gunakan simbol teks standar.\n"
            "- Tuliskan HANYA bagian yang diminta; jangan mengulang bagian lain.\n"
        )

        # Blok pengesahan/tanda tangan — WAJIB ada di paling akhir dokumen.
        blok_ttd = (
            '<br><br>\n'
            '<table style="width: 100%; border: none; margin-top: 30px;">\n'
            '    <tr>\n'
            '        <td style="width: 50%; border: none; vertical-align: top;">\n'
            '            Mengetahui,<br>\n'
            '            <b>Kepala SDN Sukamahi 03,</b>\n'
            '            <br><br><br><br><br>\n'
            '            <b><u>KASWIN KARTAWIJAYA, M.Pd</u></b><br>\n'
            '            NIP. 19720506 199903 1 007\n'
            '        </td>\n'
            '        <td style="width: 50%; border: none; vertical-align: top;">\n'
            '            Cikarang Pusat, ______________<br>\n'
            '            <b>Wali Kelas / Guru Pengampu,</b>\n'
            '            <br><br><br><br><br>\n'
            '            (________________________)<br>\n'
            '            NIP. \n'
            '        </td>\n'
            '    </tr>\n'
            '</table>'
        )

        daftar_section = [
            ("isi_dokumen_kurikulum",
             ("Anda adalah ahli penyusun kurikulum sekolah dasar.\n"
              f"Buat ISI DOKUMEN UTAMA {jenis_output_kurikulum} untuk {ctx_kurikulum}.\n"
              f"{aturan_kurikulum}"),
             TOKEN_PER_SEKSI),
            ("evaluasi_dan_pengesahan",
             (f"DOKUMEN {jenis_output_kurikulum} untuk {ctx_kurikulum}. "
              "Apapun jenis dokumennya (Silabus, CP, ATP, Prota/Promes, RPP, dll.), "
              "tuliskan HANYA bagian akhir dokumen:\n"
              f"1) EVALUASI: TEPAT {n_soal} SOAL lengkap beserta KUNCI JAWABAN.\n"
              "2) LEMBAR PENGESAHAN/TANDA TANGAN di paling akhir, dengan format HTML berikut persis:\n"
              f"{blok_ttd}\n"
              f"{aturan_kurikulum}"),
             TOKEN_PER_SEKSI),
        ]

        try:
            gemini_model = os.getenv("GEMINI_MODEL", "gemini-3.7-flash")
            # Generate per section (anti limit worker Supabase) + retry
            hasil, peringatan = generate_dokumen_per_section(daftar_section, gemini_model, 0.7)
            if peringatan:
                print(peringatan)

            try:
                user_uid = g.sesi.get('uid', '') if hasattr(g, 'sesi') and g.sesi else ''
                user_email = g.sesi.get('email', '') if hasattr(g, 'sesi') and g.sesi else ''
                db_firestore = firestore.client()
                db_firestore.collection('riwayat_rpp').add({
                    'user_id': user_uid,
                    'username': user_email or 'Pengguna',
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
@wajib_login
def riwayat():
    riwayat_per_kelas = {}
    try:
        db_firestore = firestore.client()
        docs = db_firestore.collection('riwayat_rpp').order_by('created_at', direction=firestore.Query.DESCENDING).stream()
        
        # Otorisasi: non-admin hanya melihat dokumen miliknya sendiri;
        # admin boleh melihat seluruh riwayat.
        user_uid = g.sesi.get('uid', '') if hasattr(g, 'sesi') and g.sesi else ''
        user_role = g.sesi.get('role', '') if hasattr(g, 'sesi') and g.sesi else ''

        for doc in docs:
            data = doc.to_dict() or {}
            if user_role != 'admin' and data.get('user_id') != user_uid:
                continue
            data['id'] = doc.id
            jenjang = data.get('jenjang', 'Lainnya')
            
            if jenjang not in riwayat_per_kelas:
                riwayat_per_kelas[jenjang] = []
            riwayat_per_kelas[jenjang].append(data)
            
    except Exception as e:
        print(f"Gagal mengambil riwayat: {e}")

    return render_template('riwayat.html', riwayat_per_kelas=riwayat_per_kelas)

@app.route('/hapus_riwayat/<id_doc>', methods=['POST'])
@wajib_login
def hapus_riwayat(id_doc):
    try:
        db_firestore = firestore.client()
        doc_ref = db_firestore.collection('riwayat_rpp').document(id_doc)
        doc = doc_ref.get()
        if not doc.exists:
            return redirect(url_for('riwayat'))

        data = doc.to_dict() or {}
        user_uid = g.sesi.get('uid') if hasattr(g, 'sesi') and g.sesi else None
        user_role = g.sesi.get('role') if hasattr(g, 'sesi') and g.sesi else None

        # Otorisasi ketat: hanya Admin atau pemilik dokumen yang berhak menghapus
        if user_role == 'admin' or (user_uid and data.get('user_id') == user_uid):
            doc_ref.delete()
        else:
            print(f"Otorisasi ditolak: User {user_uid} (role: {user_role}) mencoba menghapus dokumen {id_doc} milik {data.get('user_id')}")
    except Exception as e:
        print(f"Gagal menghapus riwayat: {e}")
    return redirect(url_for('riwayat'))

@app.route('/download_word', methods=['POST'])
@wajib_login
def download_word():
    content = request.form.get('content', '')
    # Sanitasi nama file: hanya huruf/angka/underscore, batasi panjang (anti header injection).
    topik = re.sub(r'[^A-Za-z0-9_-]+', '_', request.form.get('topik', 'RPP')).strip('_') or 'RPP'
    topik = topik[:60]
    if len(content) > 2_000_000:
        content = content[:2_000_000]
    return Response(
        content,
        mimetype="text/plain",
        headers={
            "Content-Disposition": f"attachment;filename=RPP_{topik}.txt",
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "no-store",
        }
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
