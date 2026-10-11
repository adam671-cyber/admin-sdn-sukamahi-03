const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

sb.auth.getSession().then(({ data }) => { if (data.session) location.href = 'index.html'; });

document.getElementById('form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = document.getElementById('error');
  err.classList.add('hidden');
  const { error } = await sb.auth.signInWithPassword({
    email: document.getElementById('email').value.trim(),
    password: document.getElementById('password').value
  });
  if (error) {
    console.error(error);
    err.textContent = (typeof DEBUG !== 'undefined' && DEBUG)
      ? 'Gagal masuk: ' + error.message
      : 'Email atau kata sandi tidak sesuai.';
    err.classList.remove('hidden');
  } else location.href = 'index.html';
});