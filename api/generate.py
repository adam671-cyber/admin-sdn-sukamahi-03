# Vercel Serverless Function untuk generate modul/RPP
# Deploy: otomatis dari Vercel ketika push ke GitHub
# Environment Variables di Vercel Dashboard:
#   - GEMINI_API_KEY
#   - SUPABASE_URL
#   - SUPABASE_ANON_KEY

import os
import json
from datetime import datetime
from flask import Flask, request, jsonify
from google import genai
import requests

app = Flask(__name__)

# Konfigurasi Gemini
api_key = os.environ.get("GEMINI_API_KEY")
gemini_client = None
if api_key:
    gemini_client = genai.Client(api_key=api_key)

# Konfigurasi Supabase (untuk Edge Function proxy)
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "")

def call_gemini_via_supabase(prompt, model="gemini-3.8-flash", temperature=0.7, max_output_tokens=8192):
    """Panggil Gemini melalui Supabase Edge Function."""
    if not SUPABASE_URL or not SUPABASE_ANON_KEY:
        raise RuntimeError("SUPABASE_URL dan SUPABASE_ANON_KEY harus dikonfigurasi.")
    
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

def generate_prompt(mapel, jenjang, topik, jenis_output, template_type, jumlah, catatan_opsional):
    """Generate prompt untuk Gemini AI."""
    
    instruksi_catatan = f"\nCatatan/Instruksi Tambahan dari Guru: {catatan_opsional}\n" if catatan_opsional.strip() else ""
    
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
    
    return prompt

@app.route('/', methods=['POST'])
def handler():
    try:
        data = request.json
        
        # Extract parameters
        mapel = data.get('mapel', '')
        jenjang = data.get('jenjang', '')
        topik = data.get('topik', '')
        jenis_output = data.get('jenis_output', 'Modul Ajar / RPP')
        template_type = data.get('template_type', 'deep_learning')
        jumlah = data.get('jumlah', '5')
        catatan_opsional = data.get('catatan_opsional', '')
        
        # Generate prompt
        prompt = generate_prompt(mapel, jenjang, topik, jenis_output, template_type, jumlah, catatan_opsional)
        
        # Call Gemini (via direct API or Supabase Edge Function)
        gemini_model = os.environ.get("GEMINI_MODEL", "gemini-3.8-flash")
        
        if gemini_client:
            # Direct API call (development)
            response = gemini_client.models.generate_content(
                model=gemini_model,
                contents=prompt,
                config=genai.types.GenerateContentConfig(
                    http_options=genai.types.HttpOptions(timeout=350000)
                )
            )
            hasil = response.text if hasattr(response, 'text') else "Tidak ada respons dari AI"
        else:
            # Via Supabase Edge Function (production)
            hasil = call_gemini_via_supabase(prompt, gemini_model, 0.7, 8192)
        
        return jsonify({
            'success': True,
            'hasil': hasil,
            'model': gemini_model
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# Handler untuk Vercel
def vercel_handler(request):
    return app(request.environ, start_response=lambda status, headers: None)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 5000)))