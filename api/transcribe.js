import { GoogleGenAI } from '@google/genai';

export const config = { api: { bodyParser: false } };

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

  const ai = getGeminiClient();
  const groqKey = process.env.GROQ_API_KEY;

  if (!ai && !groqKey) {
    return res.status(503).json({ error: 'Cloud transcription is not configured' });
  }

  try {
    const audio = await readBody(req);
    if (!audio.length) return res.status(400).json({ error: 'Empty audio' });
    const lang = req.headers['x-language'];

    // 1. Primary: Gemini Transcription
    if (ai) {
      try {
        const response = await ai.models.generateContent({
          model: 'gemini-3.5-transcribe',
          contents: {
            parts: [
              {
                inlineData: {
                  mimeType: 'audio/wav',
                  data: audio.toString('base64'),
                },
              },
              {
                text: `Transcribe this audio cleanly. Language: ${lang || 'auto'}.`,
              },
            ],
          },
        });

        const transcriptText = response.text ? response.text.trim() : '';
        const rawWords = transcriptText ? transcriptText.split(/\s+/).filter(Boolean) : [];
        // 16kHz 16-bit mono PCM = 32000 bytes per second
        const duration = Math.max(0.1, audio.length / 32000);
        const wordStep = rawWords.length > 0 ? duration / rawWords.length : 0;
        const words = rawWords.map((w, idx) => ({
          word: w,
          start: +(idx * wordStep).toFixed(2),
          end: +((idx + 1) * wordStep).toFixed(2),
        }));

        const segments = transcriptText
          ? [
              {
                start: 0,
                end: +duration.toFixed(2),
                text: transcriptText,
              },
            ]
          : [];

        return res.status(200).json({
          text: transcriptText,
          segments,
          words,
        });
      } catch (geminiErr) {
        console.warn('Gemini transcribe failed, attempting fallback if available:', geminiErr?.message);
        if (!groqKey) {
          throw geminiErr;
        }
      }
    }

    // 2. Fallback: Groq Whisper
    if (groqKey) {
      const form = new FormData();
      form.append('file', new Blob([audio], { type: 'audio/wav' }), 'audio.wav');
      form.append('model', process.env.GROQ_TRANSCRIPTION_MODEL || 'whisper-large-v3-turbo');
      form.append('response_format', 'verbose_json');
      form.append('timestamp_granularities[]', 'word');
      form.append('timestamp_granularities[]', 'segment');
      form.append('temperature', '0');
      if (lang) form.append('language', String(lang));

      const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${groqKey}` },
        body: form,
      });

      const text = await r.text();
      return res.status(r.status).setHeader('content-type', 'application/json').send(text);
    }

    return res.status(503).json({ error: 'No transcription service available' });
  } catch (e) {
    console.error('Error in /api/transcribe:', e);
    return res.status(500).json({ error: e?.message || 'Transcription failed' });
  }
}

