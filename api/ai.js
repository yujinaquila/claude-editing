export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(503).json({
    error: 'AI refinement is not configured. Smart Auto Edit deterministic mode remains available.'
  });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const prompt = `You are a professional short-form video editor.
Return ONLY valid JSON with a "clips" array.
Preserve sourceFileId/sourceFileName/sourceStart/sourceEnd and improve ordering for a coherent, fast-paced video.
Input:\n${JSON.stringify(body)}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
        max_tokens: 2500,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({ error: text });
    }

    const data = await response.json();
    const text = data?.content?.find(x => x.type === 'text')?.text || '{}';
    const clean = text.replace(/^```json\s*/,'').replace(/^```\s*/,'').replace(/```$/,'').trim();
    return res.status(200).json(JSON.parse(clean));
  } catch (error) {
    return res.status(500).json({ error: error.message || 'AI refinement failed' });
  }
}