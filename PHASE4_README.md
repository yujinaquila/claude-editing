# ClipForge Phase 4 — Smart AI Editing

## Features
- Auto Cut: silence-aware, speech-protecting usable ranges
- Auto Highlight: energy + speech + content scoring
- Auto Hook: strongest opening candidate
- Best Scene: best-scoring moment across all videos
- Smart Auto Edit All: multiple videos → Edit Decision List → timeline

## How it works
The deterministic engine analyzes Web Audio locally and uses transcript data when available.
`/api/ai` is optional and only refines the resulting edit order.

## Environment variables
Optional for AI refinement:
- ANTHROPIC_API_KEY
- ANTHROPIC_MODEL

Smart Auto Edit still works without Anthropic configured.

## Expected UI IDs
The engine automatically binds these if present:
- #autoEditBtn
- #autoCutBtn
- #autoHighlightBtn
- #autoHookBtn
- #bestSceneBtn

It also supports data-action equivalents.
