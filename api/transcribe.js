export const config = { api: { bodyParser: false, responseLimit: '1mb' } };

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      error: 'Fast cloud transcription is not configured. Add GROQ_API_KEY to Vercel Environment Variables.'
    });
  }

  try {
    const body = await readBody(req);
    if (!body.length) return res.status(400).json({ error: 'Empty audio payload.' });

    const form = new FormData();
    form.append('file', new Blob([body], { type: 'audio/wav' }), 'clip.wav');
    form.append('model', process.env.GROQ_TRANSCRIPTION_MODEL || 'whisper-large-v3-turbo');
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'segment');
    if (req.headers['x-language']) form.append('language', String(req.headers['x-language']));
    form.append('temperature', '0');

    const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form
    });

    const text = await response.text();
    if (!response.ok) return res.status(response.status).send(text);
    return res.status(200).send(text);
  } catch (error) {
    console.error('[transcribe]', error);
    return res.status(500).json({ error: error?.message || 'Cloud transcription failed.' });
  }
}
