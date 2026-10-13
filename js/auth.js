const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Batas percobaan masuk dari sisi antarmuka (pelengkap, bukan pengganti
// rate limit server Supabase). Kata sandi sendiri selalu di-hash oleh
// Supabase Auth di server; aplikasi tidak pernah menyimpannya plain.
const BATAS_PERCOBAAN = 5;
const KUNCI_LOCK_MENIT = 15;

function kunciLock(email) {
  return 'loginLock:' + String(email || '').trim().toLowerCase();
}
function bacaLock(email) {
  try { return JSON.parse(localStorage.getItem(kunciLock(email)) || '{}'); }
  catch { return {}; }
}
function sisaLockDetik(email) {
  const st = bacaLock(email);
  if (!st.lockUntil) return 0;
  const sisa = Math.ceil((st.lockUntil - Date.now()) / 1000);
  if (sisa <= 0) { localStorage.removeItem(kunciLock(email)); return 0; }
  return sisa;
}
function catatGagal(email) {
  const st = bacaLock(email);
  const now = Date.now();
  if (st.lockUntil && st.lockUntil <= now) { st.count = 0; st.lockUntil = null; }
  const count = (st.count || 0) + 1;
  if (count >= BATAS_PERCOBAAN) {
    localStorage.setItem(kunciLock(email), JSON.stringify({ count, lockUntil: now + KUNCI_LOCK_MENIT * 60 * 1000 }));
    return { count, terkunci: true };
  }
  localStorage.setItem(kunciLock(email), JSON.stringify({ count }));
  return { count, terkunci: false };
}
function hapusLock(email) {
  localStorage.removeItem(kunciLock(email));
}

function formatMenit(detik) {
  const m = Math.floor(detik / 60), s = detik % 60;
  return m + ' menit' + (s ? ' ' + s + ' detik' : '');
}

sb.auth.getSession().then(({ data }) => { if (data.session) location.href = 'index.html'; });

document.getElementById('form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = document.getElementById('error');
  err.classList.add('hidden');
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const sisa = sisaLockDetik(email);
  if (sisa > 0) {
    err.textContent = 'Terlalu banyak percobaan gagal. Coba lagi dalam ' + formatMenit(sisa) + '.';
    err.classList.remove('hidden');
    return;
  }
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    console.error(error);
    const hasil = catatGagal(email);
    if (hasil.terkunci) {
      err.textContent = 'Terlalu banyak percobaan gagal. Akun dikunci sementara selama ' + KUNCI_LOCK_MENIT + ' menit.';
    } else {
      const sisaPercobaan = BATAS_PERCOBAAN - hasil.count;
      const basis = (typeof DEBUG !== 'undefined' && DEBUG)
        ? 'Gagal masuk: ' + error.message
        : 'Email atau kata sandi tidak sesuai.';
      err.textContent = basis + (sisaPercobaan > 0 ? ' Sisa ' + sisaPercobaan + ' percobaan.' : '');
    }
    err.classList.remove('hidden');
  } else {
    hapusLock(email);
    location.href = 'index.html';
  }
});
