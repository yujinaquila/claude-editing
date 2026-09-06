export const config = { api: { bodyParser: false } };

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!process.env.GROQ_API_KEY) return res.status(503).json({ error: 'Cloud transcription is not configured' });
  try {
    const audio = await readBody(req);
    if (!audio.length) return res.status(400).json({ error: 'Empty audio' });
    const form = new FormData();
    form.append('file', new Blob([audio], { type: 'audio/wav' }), 'audio.wav');
    form.append('model', process.env.GROQ_TRANSCRIPTION_MODEL || 'whisper-large-v3-turbo');
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'word');
    form.append('timestamp_granularities[]', 'segment');
    form.append('temperature', '0');
    const lang = req.headers['x-language'];
    if (lang) form.append('language', String(lang));
    const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST', headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` }, body: form
    });
    const text = await r.text();
    res.status(r.status).setHeader('content-type', 'application/json').send(text);
  } catch (e) {
    res.status(500).json({ error: e?.message || 'Transcription failed' });
  }
}
