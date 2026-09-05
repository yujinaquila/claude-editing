# Claude AI Editor

A Vercel-ready, browser-first AI video editor for TikTok, Reels, Shorts and marketing videos.

## Included

- Premiere-inspired editing workspace
- AI prompt editor and prompt presets
- EN / ID UI and local deterministic edit planner
- Multilingual Whisper transcription
- Auto captions / transcript panel
- Auto Cut / silence removal
- Auto Hook
- Multiple video import
- AI-assisted scene picker
- 9:16 / 1:1 / 16:9 output presets
- Interactive preview and timeline
- Cloud FFmpeg rendering for final exports
- Connected cuts and transitions
- SRT subtitle export

## Rendering architecture

Final exports use a dedicated FFmpeg worker instead of Shotstack or FFmpeg.wasm in the browser:

```text
Browser
  -> Vercel API
  -> Cloudflare R2 direct upload
  -> Cloud FFmpeg worker
  -> R2 MP4
  -> Vercel signed download URL
  -> Browser preview/download
```

The render worker lives in `render-worker/` and can be deployed as a Docker service on Railway or another container host. Railway can build a service directly from this repository's Dockerfile. Cloudflare R2 provides S3-compatible storage and presigned PUT/GET URLs for browser uploads and downloads.

## Required Vercel environment variables

```text
R2_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=<R2_ACCESS_KEY_ID>
R2_SECRET_ACCESS_KEY=<R2_SECRET_ACCESS_KEY>
R2_BUCKET=<R2_BUCKET_NAME>
RENDER_WORKER_URL=https://<YOUR_WORKER_DOMAIN>
RENDER_WORKER_SECRET=<LONG_RANDOM_SECRET>
```

## Required render-worker environment variables

```text
R2_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=<R2_ACCESS_KEY_ID>
R2_SECRET_ACCESS_KEY=<R2_SECRET_ACCESS_KEY>
R2_BUCKET=<R2_BUCKET_NAME>
RENDER_WORKER_SECRET=<SAME_LONG_RANDOM_SECRET>
PORT=8080
```

Create the R2 API token with object read/write access scoped to the render bucket. Configure R2 bucket CORS to allow the deployed editor origin to use presigned PUT/GET requests.

## Deploy the worker

Create a Railway service from this GitHub repository and set its root directory to `render-worker`, or deploy that directory with the Railway CLI. Railway detects the included Dockerfile and builds the FFmpeg worker image.

## Run the editor locally

```bash
npm install
npm run dev
```

Production:

```bash
npm run build
npm run preview
```

## Notes

- Vercel is the control/API layer; it does not run long FFmpeg jobs.
- R2 handles large source/output files so videos do not pass through Vercel request bodies.
- The worker keeps job state in memory for the MVP. For multi-worker scaling, move job state/queueing to Redis or a database.
- The browser FFmpeg implementation remains available as legacy/fallback code, but the Render button now targets the cloud worker.
