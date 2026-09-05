import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const R2 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || ''
  }
});

const bucket = process.env.R2_BUCKET;
const worker = process.env.RENDER_WORKER_URL;
const workerSecret = process.env.RENDER_WORKER_SECRET;

function json(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json');
  return res.end(JSON.stringify(body));
}

function assertConfig() {
  const missing = [];
  if (!process.env.R2_ENDPOINT) missing.push('R2_ENDPOINT');
  if (!process.env.R2_ACCESS_KEY_ID) missing.push('R2_ACCESS_KEY_ID');
  if (!process.env.R2_SECRET_ACCESS_KEY) missing.push('R2_SECRET_ACCESS_KEY');
  if (!bucket) missing.push('R2_BUCKET');
  if (!worker) missing.push('RENDER_WORKER_URL');
  if (!workerSecret) missing.push('RENDER_WORKER_SECRET');
  if (missing.length) throw new Error(`Cloud rendering is not configured. Missing: ${missing.join(', ')}`);
}

function cleanName(name) {
  return String(name || 'video').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120);
}

async function signPut(key, contentType) {
  return getSignedUrl(R2, new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType || 'application/octet-stream'
  }), { expiresIn: 3600 });
}

async function signGet(key, expiresIn = 86400) {
  return getSignedUrl(R2, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn });
}

async function workerFetch(path, init = {}) {
  const response = await fetch(`${worker.replace(/\/$/, '')}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'x-render-worker-secret': workerSecret,
      ...(init.headers || {})
    }
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { error: text }; }
  if (!response.ok) {
    const error = new Error(data?.error || `Render worker request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return data;
}

export default async function handler(req, res) {
  if (!['POST', 'GET'].includes(req.method)) return json(res, 405, { error: 'Method not allowed' });
  try {
    assertConfig();

    if (req.method === 'POST') {
      const body = req.body || {};

      if (body.action === 'upload-url') {
        const id = `${Date.now()}-${crypto.randomUUID()}`;
        const key = `uploads/${id}-${cleanName(body.filename)}`;
        const url = await signPut(key, body.contentType || 'video/mp4');
        return json(res, 200, { id: key, url, expires: 3600 });
      }

      if (body.action === 'source-status') {
        if (!body.id) return json(res, 400, { error: 'Missing source id.' });
        const url = await signGet(body.id, 86400);
        return json(res, 200, { id: body.id, status: 'ready', url });
      }

      if (body.action === 'render') {
        if (!body.plan?.clips?.length) return json(res, 400, { error: 'The edit plan has no clips.' });
        const sources = {};
        for (const [assetId, value] of Object.entries(body.sources || {})) {
          const key = typeof value === 'string' && value.startsWith('uploads/') ? value : null;
          if (!key) continue;
          sources[assetId] = { key, url: await signGet(key, 86400) };
        }
        if (!Object.keys(sources).length) return json(res, 400, { error: 'No cloud source files were supplied.' });
        const queued = await workerFetch('/render', {
          method: 'POST',
          body: JSON.stringify({ plan: body.plan, sources })
        });
        return json(res, 201, queued);
      }

      return json(res, 400, { error: 'Unknown cloud render action.' });
    }

    const id = req.query?.id;
    if (!id) return json(res, 400, { error: 'Missing render id.' });
    return json(res, 200, await workerFetch(`/render/${encodeURIComponent(id)}`));
  } catch (error) {
    console.error('[cloud-render]', error);
    return json(res, error.status || 500, { error: error.message || 'Cloud render request failed.' });
  }
}
