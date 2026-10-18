# Portal Pembelajaran (Flask)

Deploy this folder as a separate Vercel project so the existing static admin
site can stay at the repository root.

## Vercel project setup

- Import the same GitHub repository as a new Vercel project.
- Set **Root Directory** to `portal`.
- Use the Flask/Python framework preset (or let Vercel detect `app.py`).
- Do not set an output directory or a custom build command.
- Set these environment variables for Production and Preview:
  - `SUPABASE_URL`
  - `SUPABASE_ANON_KEY`
  - `FLASK_SECRET_KEY` (a new random value)
  - `FIREBASE_SERVICE_ACCOUNT_JSON` (the service-account JSON value)
- Do not set `GEMINI_API_KEY` here; Gemini is called through the Supabase Edge
  Function and its key belongs only in Supabase Function Secrets.

After the project is deployed, put its exact `https://...vercel.app` URL in
`window.PORTAL_URL` in the admin site's `js/config.js`, and add that exact origin
to the admin site's `frame-src` CSP and this portal's `frame-ancestors` CSP.

The app uses Firestore for history. Vercel's function filesystem is temporary,
so generated files must not be written to `static/uploads`; image generation
and local image persistence are therefore not enabled here.
