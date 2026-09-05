# ClipForge AI

A prompt-driven, AI-assisted marketing video editor (TikTok/Reels-style) —
static site, no custom backend. Login is handled by **Supabase Auth**
(Google OAuth). Everything else — imported clips, timeline, trims — stays
local per-account in each visitor's own browser via IndexedDB; it's never
uploaded anywhere.

**Supabase project:** `AI Clip Studio` (`attrgssmemtipoingkpe`, ap-southeast-1)
**Vercel project:** `claude-editing` → https://claude-editing.vercel.app

## Deploy to Vercel

**Option A — Vercel CLI**
```bash
npm i -g vercel
cd clipforge-vercel
vercel --prod
```

**Option B — GitHub + Vercel dashboard**
Push this folder to a repo and import it at [vercel.com/new](https://vercel.com/new).
Framework preset: "Other" — it's static HTML, no build step.

No environment variables are needed. The Supabase URL and publishable
(anon) key are hardcoded in `index.html` — that's intentional, not an
oversight: those two values are meant to be public in client-side code
(they're gated by Row Level Security on Supabase's side), unlike a
service-role key or your Google Client Secret, neither of which appear
anywhere in this file.

## One-time setup: enable Google Sign-In

The Google button is already wired to call Supabase Auth. Three things
need to be configured before it'll actually work — none of them are code
changes, all done in dashboards:

**1. Google Cloud Console** ([console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials))
- Create (or reuse) an **OAuth 2.0 Client ID** → type **Web application**
- Under **Authorized redirect URIs** (not "JavaScript origins" — Supabase
  does a server-side redirect, unlike the old client-side flow), add:
  ```
  https://attrgssmemtipoingkpe.supabase.co/auth/v1/callback
  ```
- Copy the **Client ID** and **Client Secret**

**2. Supabase Dashboard** → your project → **Authentication → Sign In / Providers → Google**
- Toggle it on
- Paste the Client ID and Client Secret from step 1
- Save

**3. Supabase Dashboard → Authentication → URL Configuration**
- **Site URL:** `https://claude-editing.vercel.app`
- **Additional Redirect URLs:** add `http://localhost:3000` if you want
  Google Sign-In to work locally too

That's it — no redeploy needed for these steps, they take effect
immediately since the app reads the Supabase project directly.

Until Google is enabled in step 2, clicking the button shows a clear
"not enabled yet" message and the plain name/email form underneath still
works as a fallback.

## How accounts + storage work

- Supabase only handles **who you are** (the login itself).
- Once signed in, the app opens a browser-local IndexedDB database keyed
  to your email — that's where your imported clips and timeline actually
  live.
- This means: no syncing between devices, and a visitor's saved project
  disappears if they clear browser data or switch browsers/devices. If
  you want real cross-device project sync later, that's the point where
  clip data itself would need to move into Supabase (Storage + a table),
  which is a bigger step up from this.

## Local development

```bash
npm run dev
# open http://localhost:3000
```
(Add `http://localhost:3000` to Supabase's Additional Redirect URLs first,
per step 3 above, or the Google flow will redirect back to production
instead of your local server.)
