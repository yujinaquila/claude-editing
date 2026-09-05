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

function json(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json');
  return res.end(JSON.stringify(body));
}

function assertConfig() {
  const missing = [];
  if (!r2Config.endpoint) missing.push('R2_ENDPOINT');
  if (!process.env.R2_ACCESS_KEY_ID) missing.push('R2_ACCESS_KEY_ID');
  if (!process.env.R2_SECRET_ACCESS_KEY) missing.push('R2_SECRET_ACCESS_KEY');
  if (!bucket) missing.push('R2_BUCKET');
  if (missing.length) throw new Error(`Bucket storage is not configured. Missing: ${missing.join(', ')}`);
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

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  try {
    assertConfig();
    const body = req.body || {};

    if (body.action === 'upload-url' || body.action === 'render-upload-url') {
      if (body.action === 'render-upload-url' && !body.filename) return json(res, 400, { error: 'Missing render filename.' });
      const id = `${Date.now()}-${crypto.randomUUID()}`;
      const prefix = body.action === 'render-upload-url' ? 'renders' : 'uploads';
      const key = `${prefix}/${id}-${cleanName(body.filename || 'video.mp4')}`;
      const url = await signPut(key, body.contentType || 'video/mp4');
      return json(res, 200, { id: key, key, url, expires: 3600 });
    }

    if (body.action === 'source-status') {
      if (!body.id) return json(res, 400, { error: 'Missing source id.' });
      if (!String(body.id).startsWith('uploads/')) return json(res, 400, { error: 'Invalid source id.' });
      const ready = await objectExists(body.id);
      if (!ready) return json(res, 404, { id: body.id, status: 'uploading' });
      return json(res, 200, { id: body.id, status: 'ready', url: await signGet(body.id) });
    }

    if (body.action === 'render-final-url') {
      const key = String(body.key || '');
      if (!key.startsWith('renders/')) return json(res, 400, { error: 'Invalid render key.' });
      if (!(await objectExists(key))) return json(res, 404, { error: 'Rendered video has not finished uploading yet.' });
      return json(res, 200, { key, url: await signGet(key, 86400) });
    }

    return json(res, 400, { error: 'Unknown bucket action.' });
  } catch (error) {
    console.error('[bucket-storage]', error);
    return json(res, 500, { error: error.message || 'Bucket storage request failed.' });
  }
}
