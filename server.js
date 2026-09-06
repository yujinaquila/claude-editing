import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import aiHandler from './api/ai.js';
import transcribeHandler from './api/transcribe.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Route: /api/ai
app.post('/api/ai', express.json({ limit: '10mb' }), async (req, res) => {
  try {
    await aiHandler(req, res);
  } catch (err) {
    console.error('Error in /api/ai:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: err?.message || 'Internal server error' });
    }
  }
});

// Route: /api/transcribe
app.post('/api/transcribe', async (req, res) => {
  try {
    await transcribeHandler(req, res);
  } catch (err) {
    console.error('Error in /api/transcribe:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: err?.message || 'Internal server error' });
    }
  }
});

// Serve static assets from project root
app.use(express.static(__dirname));

// Fallback for SPA routing to index.html
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`ClipForge AI server running on http://0.0.0.0:${PORT}`);
});
