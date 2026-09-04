# Claude AI Editor

A Vercel-ready, browser-first AI video editor for TikTok, Reels, Shorts and marketing videos.

## Included

- Premiere-inspired editing workspace
- AI prompt editor
- Prompt template dropdown
- EN / ID UI and AI prompt interpretation
- Local multilingual Whisper transcription through Transformers.js
- Auto captions / transcript panel
- Auto Cut / silence removal
- Auto Hook
- Multiple video import
- AI-assisted scene picker
- 9:16 / 1:1 / 16:9 output presets
- FFmpeg.wasm import/export/render
- Local processing in the browser
- SRT subtitle export
- No API key required

## Run

```bash
npm install
npm run dev
```

Production:

```bash
npm run build
npm run preview
```

Deploy the project to Vercel with the default Vite settings.

## AI model

The transcription engine uses `Xenova/whisper-small`, an Apache-2.0 ONNX conversion of OpenAI Whisper, through Hugging Face Transformers.js.

The model is downloaded/cached by the browser on first use. It is multilingual and can process Indonesian and English. WebGPU is attempted first with a WASM fallback.

The editor's natural-language edit planner is intentionally local and deterministic: prompts are translated into an edit plan without requiring a paid LLM API. This makes the project deployable without secrets. The local AI model is Whisper Small (Apache-2.0) for multilingual speech recognition; the edit planner is not presented as a separately trained LLM.

## FFmpeg CORS fix

FFmpeg assets are loaded from the installed npm packages and passed to the browser through blob URLs. The app does not construct a Worker directly from a cross-origin CDN URL.

## Important

Browser video rendering is CPU/GPU intensive. Large videos and long projects can take significant time and memory. For production-scale server rendering, move the render worker to a dedicated compute service rather than Vercel Functions.
