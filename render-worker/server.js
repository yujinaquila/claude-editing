import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const PORT = Number(process.env.PORT || 8080);
const SECRET = process.env.RENDER_WORKER_SECRET || '';
const bucket = process.env.R2_BUCKET;
const s3 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID || '', secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '' }
});
const jobs = new Map();

const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
const readBody = req => new Promise((resolve, reject) => { let b=''; req.on('data', c => { b += c; if (b.length > 25 * 1024 * 1024) reject(new Error('Request too large')); }); req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch (e) { reject(e); } }); req.on('error', reject); });
const safe = s => String(s || '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);

function auth(req) {
  return SECRET && req.headers['x-render-worker-secret'] === SECRET;
}
function sizeFor(aspect) {
  if (aspect === '9:16') return [1080, 1920];
  if (aspect === '1:1') return [1080, 1080];
  return [1920, 1080];
}
function escDraw(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'").replace(/%/g, '\\%').replace(/,/g, '\\,').replace(/\n/g, ' ');
}
function run(cmd, args, onProgress) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    p.stderr.on('data', chunk => {
      const text = chunk.toString(); stderr += text;
      const m = text.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (m && onProgress) onProgress((Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])));
    });
    p.on('error', reject);
    p.on('close', code => code === 0 ? resolve() : reject(new Error(`FFmpeg exited with code ${code}: ${stderr.slice(-1800)}`)));
  });
}
async function download(url, file) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Source download failed (${r.status})`);
  const data = new Uint8Array(await r.arrayBuffer());
  await fs.writeFile(file, data);
}
async function upload(file, key) {
  const body = await fs.readFile(file);
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: 'video/mp4' }));
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 86400 });
}
function transitionName(value) {
  const v = String(value || '').toLowerCase();
  if (v === 'wipeleft') return 'wipeleft';
  if (v === 'wiperight') return 'wiperight';
  if (v === 'slideleft' || v === 'smoothleft') return 'slideleft';
  if (v === 'slideright' || v === 'smoothright') return 'slideright';
  return 'fade';
}
function buildFilter(plan, count, width, height) {
  const parts = [];
  for (let i = 0; i < count; i++) {
    const c = plan.clips[i];
    const start = Math.max(0, Number(c.start) || 0);
    const end = Math.max(start + 0.05, Number(c.end) || start + 0.05);
    parts.push(`[${i}:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS,scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1[v${i}]`);
  }
  let last = 'v0';
  let cursor = Math.max(0.05, (Number(plan.clips[0].end) || 0) - (Number(plan.clips[0].start) || 0));
  for (let i = 1; i < count; i++) {
    const c = plan.clips[i];
    const dur = Math.max(0.05, (Number(c.end) || 0) - (Number(c.start) || 0));
    const d = Math.min(0.5, Math.max(0.05, Number(c.transitionDuration) || 0.35), dur, cursor);
    const offset = Math.max(0, cursor - d);
    parts.push(`[${last}][v${i}]xfade=transition=${transitionName(c.transition)}:duration=${d}:offset=${offset}[x${i}]`);
    last = `x${i}`;
    cursor = cursor + dur - d;
  }
  if (plan.captions) {
    const captionLines = [];
    for (let i = 0; i < count; i++) {
      const c = plan.clips[i];
      const text = escDraw(c.text || '');
      if (!text) continue;
      const st = i === 0 ? 0 : plan.clips.slice(0, i).reduce((sum, q, j) => sum + Math.max(0.05, (Number(q.end)||0)-(Number(q.start)||0)) - Math.min(0.5, Number(plan.clips[j+1]?.transitionDuration)||0.35), 0);
      const dur = Math.max(0.05, (Number(c.end)||0)-(Number(c.start)||0));
      captionLines.push(`drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:text='${text}':fontcolor=white:fontsize=${Math.max(28, Math.round(height*0.045))}:borderw=8:bordercolor=black@0.75:x=(w-text_w)/2:y=h-text_h-${Math.round(height*0.09)}:enable='between(t,${Math.max(0,st).toFixed(3)},${Math.max(0.05,st+dur).toFixed(3)})'`);
    }
    if (captionLines.length) parts.push(`[${last}]${captionLines.join(',')}[vout]`); else parts.push(`[${last}]null[vout]`);
  } else parts.push(`[${last}]null[vout]`);
  return { filter: parts.join(';'), cursor };
}

async function processJob(job) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipforge-'));
  try {
    job.status = 'downloading'; job.progress = 2;
    const files = [];
    for (let i = 0; i < job.plan.clips.length; i++) {
      const id = job.plan.clips[i].assetId;
      const source = job.sources[id];
      if (!source?.url) throw new Error(`Missing source for asset ${id}`);
      const file = path.join(dir, `${i}-${safe(id)}.mp4`);
      await download(source.url, file); files.push(file); job.progress = 5 + ((i + 1) / job.plan.clips.length) * 25;
    }
    const [width, height] = sizeFor(job.plan.aspect);
    const { filter } = buildFilter(job.plan, files.length, width, height);
    const output = path.join(dir, 'output.mp4');
    job.status = 'rendering'; job.progress = 35;
    const args = [];
    for (const file of files) args.push('-i', file);
    args.push('-filter_complex', filter, '-map', '[vout]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', '-y', output);
    await run('ffmpeg', args, seconds => { job.progress = Math.min(94, 35 + seconds); });
    job.status = 'uploading'; job.progress = 96;
    const key = `renders/${job.id}.mp4`;
    job.url = await upload(output, key);
    job.status = 'done'; job.progress = 100;
  } catch (e) { job.status = 'failed'; job.error = e.message; }
  finally { await fs.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}

const server = http.createServer(async (req, res) => {
  if (req.url === '/health') return json(res, 200, { ok: true, service: 'clipforge-render-worker' });
  if (!auth(req)) return json(res, 401, { error: 'Unauthorized' });
  try {
    if (req.method === 'POST' && req.url === '/render') {
      const body = await readBody(req);
      if (!body.plan?.clips?.length) return json(res, 400, { error: 'The edit plan has no clips.' });
      const id = `${Date.now()}-${crypto.randomUUID()}`;
      const job = { id, status: 'queued', progress: 0, plan: body.plan, sources: body.sources || {}, createdAt: Date.now() };
      jobs.set(id, job); processJob(job);
      return json(res, 202, { id, status: job.status, progress: 0 });
    }
    const m = req.url?.match(/^\/render\/([^?]+)$/);
    if (req.method === 'GET' && m) {
      const job = jobs.get(decodeURIComponent(m[1]));
      if (!job) return json(res, 404, { error: 'Render job not found. The worker may have restarted.' });
      return json(res, 200, { id: job.id, status: job.status, progress: job.progress, url: job.url || null, error: job.error || null });
    }
    return json(res, 404, { error: 'Not found' });
  } catch (e) { return json(res, 500, { error: e.message || 'Worker error' }); }
});
server.listen(PORT, () => console.log(`ClipForge cloud render worker listening on ${PORT}`));
