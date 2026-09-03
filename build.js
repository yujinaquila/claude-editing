// Runs at build time (Vercel or locally via `npm run build`).
// Reads the GOOGLE_CLIENT_ID environment variable and substitutes it into
// index.html, writing the result to dist/index.html for Vercel to serve.
//
// Note: a Google OAuth Client ID is not a secret — it's designed to be
// public in client-side code. Using an env var here is just so you don't
// have to hardcode/commit it, not for security.

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'index.html');
const OUT_DIR = path.join(__dirname, 'dist');
const OUT = path.join(OUT_DIR, 'index.html');

const clientId = process.env.GOOGLE_CLIENT_ID || '';

if (!clientId) {
  console.warn(
    '\n[build] Warning: GOOGLE_CLIENT_ID is not set.\n' +
    '[build] Google Sign-In will show its "not configured" fallback until you\n' +
    '[build] add GOOGLE_CLIENT_ID in Vercel → Project Settings → Environment Variables.\n'
  );
}

let html = fs.readFileSync(SRC, 'utf8');
html = html.split('__GOOGLE_CLIENT_ID__').join(clientId);

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT, html);

console.log('[build] Wrote', OUT, clientId ? '(with GOOGLE_CLIENT_ID injected)' : '(no client ID set)');
