# ClipForge AI

A Supabase-connected browser video editor. Google login and email magic-link authentication are handled by Supabase Auth. Project/timeline metadata syncs to Supabase; imported video blobs remain local in the browser so large media is not silently uploaded.

## Environment
Set `SUPABASE_PUBLISHABLE_KEY` in Vercel for Production, Preview, and Development. The Supabase URL is configured for project `attrgssmemtipoingkpe`.

In Supabase Auth → Providers, enable Google and configure the Google OAuth client. Add your Vercel production URL and callback URL to the Supabase Auth URL configuration.

## Development
`npm run build`
