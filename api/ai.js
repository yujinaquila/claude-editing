import { GoogleGenAI } from '@google/genai';

let aiClient = null;
function getGeminiClient() {
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) return null;
    aiClient = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return aiClient;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ai = getGeminiClient();
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (!ai && !anthropicKey) {
    return res.status(503).json({
      error: 'AI service is not configured. Smart Auto Edit deterministic mode remains available.'
    });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    // Build parts for multimodal or text requests
    const parts = [];
    if (body?.content) {
      if (typeof body.content === 'string') {
        parts.push({ text: body.content });
      } else if (Array.isArray(body.content)) {
        for (const item of body.content) {
          if (typeof item === 'string') {
            parts.push({ text: item });
          } else if (item && (item.type === 'text' || item.text)) {
            parts.push({ text: item.text || '' });
          } else if (item && item.type === 'image' && item.source?.data) {
            parts.push({
              inlineData: {
                mimeType: item.source.media_type || 'image/jpeg',
                data: item.source.data
              }
            });
          } else if (item && item.inlineData) {
            parts.push(item);
          }
        }
      }
    } else if (body?.prompt && typeof body.prompt === 'string') {
      parts.push({ text: body.prompt });
    } else {
      const fallbackPrompt = `You are a professional short-form video editor.
Return ONLY valid JSON with a "clips" array.
Preserve sourceFileId/sourceFileName/sourceStart/sourceEnd and improve ordering for a coherent, fast-paced video.
Input:\n${JSON.stringify(body)}`;
      parts.push({ text: fallbackPrompt });
    }

    // 1. Primary: Gemini API
    if (ai) {
      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: { parts }
      });

      const text = response.text || '';
      let parsed = null;
      try {
        const clean = text.replace(/^```json\s*/, '').replace(/^```\s*/, '').replace(/```$/, '').trim();
        parsed = JSON.parse(clean);
      } catch {
        // text is returned as-is
      }

      return res.status(200).json({
        text,
        result: parsed || text,
        ...(parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {})
      });
    }

    // 2. Fallback: Anthropic if Gemini key is missing
    const fallbackResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
        max_tokens: body?.maxTokens || 2500,
        messages: [{ role: 'user', content: body?.content || parts.map(p => p.text).join('\n') }]
      })
    });

    if (!fallbackResponse.ok) {
      const errText = await fallbackResponse.text();
      return res.status(fallbackResponse.status).json({ error: errText });
    }

    const data = await fallbackResponse.json();
    const text = data?.content?.find(x => x.type === 'text')?.text || '{}';
    let parsed = null;
    try {
      const clean = text.replace(/^```json\s*/, '').replace(/^```\s*/, '').replace(/```$/, '').trim();
      parsed = JSON.parse(clean);
    } catch {}

    return res.status(200).json({
      text,
      result: parsed || text,
      ...(parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {})
    });
  } catch (error) {
    console.error('Error in /api/ai:', error);
    return res.status(500).json({ error: error.message || 'AI processing failed' });
  }
}