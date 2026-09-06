export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(503).json({
    error: 'AI service is not configured. Add ANTHROPIC_API_KEY in Vercel Environment Variables.'
  });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const maxTokens = Math.min(4000, Math.max(300, Number(body.maxTokens) || 1600));
    const content = body.content;

    // Phase 4 used to stringify every request into one text prompt. That broke
    // both prompt-edit responses (the client expected `text`) and Phase 4/5
    // vision requests (image blocks were never sent to Anthropic). Preserve the
    // caller's content blocks when supplied, while still accepting plain text.
    const userContent = Array.isArray(content)
      ? content
      : [{ type: 'text', text: String(content || '') }];

    const system = `You are ClipForge AI, a professional short-form video editor.
Give practical, executable editing decisions. Never invent source filenames or timestamps.
If source timestamps are supplied, use them exactly. If the request asks for JSON, return ONLY valid JSON with no markdown fences.
The requested language is ${body.language === 'id' ? 'Indonesian' : 'English'}.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: userContent }]
      })
    });

    const raw = await response.text();
    if (!response.ok) {
      let detail = raw;
      try { detail = JSON.parse(raw)?.error?.message || raw; } catch {}
      return res.status(response.status).json({ error: detail });
    }

    const data = JSON.parse(raw);
    const text = data?.content?.filter(x => x.type === 'text').map(x => x.text).join('\n').trim() || '';
    if (!text) return res.status(502).json({ error: 'AI returned an empty response.' });

    return res.status(200).json({ text });
  } catch (error) {
    console.error('[api/ai]', error);
    return res.status(500).json({ error: error.message || 'AI service failed' });
  }
}
