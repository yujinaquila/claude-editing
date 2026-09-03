# ClipForge AI

A prompt-driven, AI-assisted marketing video editor (TikTok/Reels-style) —
static site, no backend. Import stays local: clips and your timeline are
saved per-account in each visitor's own browser via IndexedDB, never
uploaded to a server.

## Deploy to Vercel

**Option A — Vercel CLI (fastest)**
```bash
npm i -g vercel
cd clipforge-vercel
vercel        # first deploy, follow the prompts
vercel --prod # promote to your production URL
```

**Option B — GitHub + Vercel dashboard**
1. Push this folder to a new GitHub repo
2. In [vercel.com/new](https://vercel.com/new), import that repo
3. Framework preset: "Other" (it's a static site, no build step needed)
4. Deploy

Either way you'll get a URL like `https://clipforge-ai.vercel.app`.

## Set up Google Sign-In for your live URL

**1. In Vercel:** Project Settings → Environment Variables → add one named
exactly:

```
GOOGLE_CLIENT_ID = 1234567890-yourid.apps.googleusercontent.com
```

Set it for **Production**, **Preview**, and **Development**. (A Google
Client ID isn't a secret — it's meant to be public in browser code — this
env var just keeps it out of your committed source.)

**2. In Google Cloud Console** ([console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials)):
create/edit an **OAuth 2.0 Client ID** → type **Web application**, and
under **Authorized JavaScript origins** add every URL you'll open the app
from:
- `https://clipforge-ai.vercel.app` (your production domain)
- specific preview URLs as you hit them (Vercel gives each preview deploy
  its own URL — test Google Sign-In on production to avoid this)
- `http://localhost:3000` (for local dev via `npm run dev`)

**3. Redeploy.** The build script (`build.js`) reads `GOOGLE_CLIENT_ID` at
build time and writes it into `dist/index.html` — Vercel runs this
automatically via `buildCommand` in `vercel.json`.

Until the env var is set, the app still works — it just shows a small
warning and falls back to the plain name/email form on the login screen.

## Notes on how storage works when deployed

- This site has no database and no server-side storage of any kind.
- Every visitor's imported clips and timeline live only in **their own
  browser's** IndexedDB, scoped to the email they sign in with.
- That means: no syncing between devices, and if a visitor clears their
  browser data (or uses a different browser/device), their saved project
  is gone. That's the tradeoff for "no cloud server."
- If you later want cross-device sync, that requires adding real backend
  storage (e.g. a database + file storage) — a bigger step up from this.

## Local development

```bash
npm run dev
# open http://localhost:3000
```
