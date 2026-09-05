import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

function normalizeR2Config() {
  const raw = String(process.env.R2_ENDPOINT || '').trim();
  if (!raw) return { endpoint: '', inferredBucket: '' };
  try {
    const url = new URL(raw);
    const parts = url.pathname.split('/').filter(Boolean);
    return { endpoint: url.origin, inferredBucket: parts[0] || '' };
  } catch {
    return { endpoint: raw.replace(/\/+$/, ''), inferredBucket: '' };
  }
}

const r2Config = normalizeR2Config();
const bucket = process.env.R2_BUCKET || r2Config.inferredBucket;
const R2 = new S3Client({
  region: 'auto',
  endpoint: r2Config.endpoint,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || ''
  }
});
const worker = process.env.RENDER_WORKER_URL;
const workerSecret = process.env.RENDER_WORKER_SECRET;

function json(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json');
  return res.end(JSON.stringify(body));
}

function assertConfig({ requireWorker = true } = {}) {
  const missing = [];
  if (!r2Config.endpoint) missing.push('R2_ENDPOINT');
  if (!process.env.R2_ACCESS_KEY_ID) missing.push('R2_ACCESS_KEY_ID');
  if (!process.env.R2_SECRET_ACCESS_KEY) missing.push('R2_SECRET_ACCESS_KEY');
  if (!bucket) missing.push('R2_BUCKET');
  if (requireWorker && !worker) missing.push('RENDER_WORKER_URL');
  if (requireWorker && !workerSecret) missing.push('RENDER_WORKER_SECRET');
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

async function objectExists(key) {
  try {
    await R2.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}

async function workerFetch(path, init = {}) {
  if (!worker) throw new Error('RENDER_WORKER_URL is not configured in Vercel. Deploy the FFmpeg worker and add its URL first.');
  if (!workerSecret) throw new Error('RENDER_WORKER_SECRET is not configured in Vercel.');
  let response;
  try {
    response = await fetch(`${worker.replace(/\/$/, '')}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'x-render-worker-secret': workerSecret,
        ...(init.headers || {})
      }
    });
  } catch (error) {
    throw new Error(`Cannot reach the cloud FFmpeg worker. Check RENDER_WORKER_URL and make sure the worker is online. ${error?.message || ''}`.trim());
  }
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { error: text }; }
  if (!response.ok) {
    const detail = data?.error || data?.message || text || 'No error body returned by worker';
    const error = new Error(`Render worker request failed (${response.status}): ${detail}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

export default async function handler(req, res) {
  if (!['POST', 'GET'].includes(req.method)) return json(res, 405, { error: 'Method not allowed' });
  try {
    assertConfig({ requireWorker: req.method === 'GET' || req.body?.action === 'render' });

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
        if (!String(body.id).startsWith('uploads/')) return json(res, 400, { error: 'Invalid source id.' });
        const ready = await objectExists(body.id);
        if (!ready) return json(res, 404, { id: body.id, status: 'uploading' });
        const url = await signGet(body.id, 86400);
        return json(res, 200, { id: body.id, status: 'ready', url });
      }

      if (body.action === 'render') {
        if (!body.plan?.clips?.length) return json(res, 400, { error: 'The edit plan has no clips.' });
        const sources = {};
        for (const [assetId, value] of Object.entries(body.sources || {})) {
          const key = typeof value === 'string' ? value : value?.key;
          if (!key || !String(key).startsWith('uploads/')) continue;
          if (!(await objectExists(key))) return json(res, 404, { error: `Cloud source is not uploaded yet: ${key}` });
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
