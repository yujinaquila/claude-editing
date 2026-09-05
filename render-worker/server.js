import http from 'node:http';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
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
const PORT = Number(process.env.PORT || 8080);
const SECRET = process.env.RENDER_WORKER_SECRET || '';
const bucket = process.env.R2_BUCKET || r2Config.inferredBucket;
const MAX_BODY = 2 * 1024 * 1024;
const MAX_SOURCE_BYTES = Number(process.env.MAX_SOURCE_BYTES || 4 * 1024 * 1024 * 1024);
const JOB_TTL_MS = 60 * 60 * 1000;
const MAX_CONCURRENT_JOBS = Math.max(1, Number(process.env.MAX_CONCURRENT_JOBS || 1));
const s3 = new S3Client({
  region: 'auto',
  endpoint: r2Config.endpoint,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID || '', secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '' }
});
const jobs = new Map();
let activeJobs = 0;

const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};
const readBody = req => new Promise((resolve, reject) => {
  let b = '';
  req.on('data', c => {
    b += c;
    if (b.length > MAX_BODY) {
      reject(new Error('Request too large'));
      req.destroy();
    }
  });
  req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch (e) { reject(e); } });
  req.on('error', reject);
});
const safe = s => String(s || '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);

function auth(req) { return Boolean(SECRET) && req.headers['x-render-worker-secret'] === SECRET; }
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
      const text = chunk.toString();
      stderr += text;
      if (stderr.length > 12000) stderr = stderr.slice(-12000);
      const m = text.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (m && onProgress) onProgress(Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]));
    });
    p.on('error', reject);
    p.on('close', code => code === 0 ? resolve() : reject(new Error(`FFmpeg exited with code ${code}: ${stderr.slice(-3000)}`)));
  });
}
async function runCapture(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', c => { stdout += c.toString(); });
    p.stderr.on('data', c => { stderr += c.toString(); });
    p.on('error', reject);
    p.on('close', code => code === 0 ? resolve(stdout.trim()) : reject(new Error(`ffprobe exited with code ${code}: ${stderr.slice(-1500)}`)));
  });
}
async function hasAudio(file) {
  try {
    const out = await runCapture('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=index', '-of', 'csv=p=0', file]);
    return Boolean(out);
  } catch {
    return false;
  }
}
async function download(url, file) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20 * 60 * 1000);
  try {
    const r = await fetch(url, { signal: controller.signal, redirect: 'follow' });
    if (!r.ok) throw new Error(`Source download failed (${r.status})`);
    const length = Number(r.headers.get('content-length') || 0);
    if (length > MAX_SOURCE_BYTES) throw new Error(`Source is too large (${Math.round(length / 1024 / 1024)} MB).`);
    if (!r.body) throw new Error('Source download returned no body.');
    const out = fsSync.createWriteStream(file);
    let bytes = 0;
    try {
      for await (const chunk of r.body) {
        bytes += chunk.length;
        if (bytes > MAX_SOURCE_BYTES) throw new Error('Source exceeds the configured size limit.');
        if (!out.write(chunk)) await new Promise(resolve => out.once('drain', resolve));
      }
      await new Promise((resolve, reject) => out.end(err => err ? reject(err) : resolve()));
    } catch (error) {
      out.destroy();
      throw error;
    }
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('Source download timed out after 20 minutes.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
async function upload(file, key) {
  const stat = await fs.stat(file);
  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: fsSync.createReadStream(file),
    ContentLength: stat.size,
    ContentType: 'video/mp4'
  }));
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 86400 });
}
function transitionName(value) {
  const v = String(value || '').toLowerCase();
  if (v === 'wipeleft') return 'wipeleft';
  if (v === 'wiperight') return 'wiperight';
  if (v === 'slideleft' || v === 'smoothleft') return 'slideleft';
  if (v === 'slideright' || v === 'smoothright') return 'slideright';
  if (v === 'fadeblack') return 'fadeblack';
  if (v === 'fadewhite') return 'fadewhite';
  return 'fade';
}
function clipTiming(plan, i) {
  const c = plan.clips[i];
  const start = Math.max(0, Number(c.start) || 0);
  const end = Math.max(start + 0.05, Number(c.end) || start + 0.05);
  return { start, end, dur: end - start };
}
function buildFilter(plan, audioFlags, width, height) {
  const parts = [];
  const count = plan.clips.length;
  for (let i = 0; i < count; i++) {
    const { start, end } = clipTiming(plan, i);
    parts.push(`[${i}:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS,fps=30,scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,format=yuv420p,settb=AVTB[v${i}]`);
    if (audioFlags[i]) {
      parts.push(`[${i}:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS,aresample=48000:async=1:first_pts=0[a${i}]`);
    } else {
      parts.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${clipTiming(plan, i).dur.toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`);
    }
  }

  let lastV = 'v0';
  let lastA = 'a0';
  let cursor = clipTiming(plan, 0).dur;
  for (let i = 1; i < count; i++) {
    const { dur } = clipTiming(plan, i);
    const d = Math.min(0.5, Math.max(0.05, Number(plan.clips[i].transitionDuration) || 0.35), dur, cursor);
    const offset = Math.max(0, cursor - d);
    parts.push(`[${lastV}][v${i}]xfade=transition=${transitionName(plan.clips[i].transition)}:duration=${d}:offset=${offset.toFixed(3)}[xv${i}]`);
    parts.push(`[${lastA}][a${i}]acrossfade=d=${d.toFixed(3)}:c1=tri:c2=tri[xa${i}]`);
    lastV = `xv${i}`;
    lastA = `xa${i}`;
    cursor = cursor + dur - d;
  }

  if (plan.captions) {
    const captionLines = [];
    let timeline = 0;
    for (let i = 0; i < count; i++) {
      const { dur } = clipTiming(plan, i);
      const text = escDraw(plan.clips[i].text || '');
      if (text) {
        captionLines.push(`drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:text='${text}':fontcolor=white:fontsize=${Math.max(28, Math.round(height * 0.045))}:borderw=8:bordercolor=black@0.75:x=(w-text_w)/2:y=h-text_h-${Math.round(height * 0.09)}:enable='between(t,${timeline.toFixed(3)},${(timeline + dur).toFixed(3)})'`);
      }
      if (i < count - 1) {
        const next = clipTiming(plan, i + 1);
        const d = Math.min(0.5, Math.max(0.05, Number(plan.clips[i + 1].transitionDuration) || 0.35), next.dur, cursor);
        timeline += dur - d;
      } else timeline += dur;
    }
    if (captionLines.length) parts.push(`[${lastV}]${captionLines.join(',')}[vout]`);
    else parts.push(`[${lastV}]null[vout]`);
  } else parts.push(`[${lastV}]null[vout]`);

  parts.push(`[${lastA}]aresample=48000:async=1:first_pts=0[aout]`);
  return { filter: parts.join(';'), cursor };
}

async function processJob(job) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipforge-'));
  try {
    job.status = 'downloading';
    job.progress = 2;
    const files = [];
    const audioFlags = [];
    const uniqueIds = [...new Set(job.plan.clips.map(c => c.assetId))];

    for (let i = 0; i < uniqueIds.length; i++) {
      const id = uniqueIds[i];
      const source = job.sources[id];
      if (!source?.url) throw new Error(`Missing source for asset ${id}`);
      const file = path.join(dir, `${i}-${safe(id)}.mp4`);
      await download(source.url, file);
      files.push(file);
      audioFlags.push(await hasAudio(file));
      job.progress = 5 + ((i + 1) / uniqueIds.length) * 25;
    }

    const indexByAsset = new Map(uniqueIds.map((id, i) => [id, i]));
    const orderedFiles = job.plan.clips.map(c => files[indexByAsset.get(c.assetId)]);
    const orderedAudio = job.plan.clips.map(c => audioFlags[indexByAsset.get(c.assetId)]);
    const [width, height] = sizeFor(job.plan.aspect);
    const { filter } = buildFilter(job.plan, orderedAudio, width, height);
    const output = path.join(dir, 'output.mp4');

    job.status = 'rendering';
    job.progress = 35;
    const args = [];
    for (const file of orderedFiles) args.push('-i', file);
    args.push(
      '-filter_complex', filter,
      '-map', '[vout]',
      '-map', '[aout]',
      '-c:v', 'libx264',
      '-preset', process.env.FFMPEG_PRESET || 'veryfast',
      '-crf', process.env.FFMPEG_CRF || '22',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '160k',
      '-ar', '48000',
      '-ac', '2',
      '-movflags', '+faststart',
      '-shortest',
      '-y', output
    );
    await run('ffmpeg', args, seconds => { job.progress = Math.min(94, 35 + seconds); });

    job.status = 'uploading';
    job.progress = 96;
    const key = `renders/${job.id}.mp4`;
    job.url = await upload(output, key);
    job.status = 'done';
    job.progress = 100;
  } catch (e) {
    job.status = 'failed';
    job.error = e?.message || 'Unknown render error';
  } finally {
    activeJobs = Math.max(0, activeJobs - 1);
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
function startJob(job) {
  activeJobs += 1;
  processJob(job).catch(error => {
    job.status = 'failed';
    job.error = error?.message || 'Worker job failed';
    activeJobs = Math.max(0, activeJobs - 1);
  });
}
setInterval(() => {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [id, job] of jobs) {
    if (job.createdAt < cutoff && ['done', 'failed'].includes(job.status)) jobs.delete(id);
  }
}, 10 * 60 * 1000).unref();

const server = http.createServer(async (req, res) => {
  if (req.url === '/health') {
    return json(res, 200, {
      ok: true,
      service: 'clipforge-render-worker',
      ffmpeg: true,
      configured: Boolean(r2Config.endpoint && bucket && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && SECRET),
      activeJobs,
      maxConcurrentJobs: MAX_CONCURRENT_JOBS
    });
  }
  if (!auth(req)) return json(res, 401, { error: 'Unauthorized' });
  try {
    if (req.method === 'POST' && req.url === '/render') {
      const body = await readBody(req);
      if (!body.plan?.clips?.length) return json(res, 400, { error: 'The edit plan has no clips.' });
      if (!body.sources || typeof body.sources !== 'object') return json(res, 400, { error: 'No render sources were supplied.' });
      if (activeJobs >= MAX_CONCURRENT_JOBS) return json(res, 429, { error: 'Render worker is busy. Please retry in a moment.' });
      const id = `${Date.now()}-${crypto.randomUUID()}`;
      const job = { id, status: 'queued', progress: 0, plan: body.plan, sources: body.sources, createdAt: Date.now() };
      jobs.set(id, job);
      startJob(job);
      return json(res, 202, { id, status: job.status, progress: 0 });
    }
    const m = req.url?.match(/^\/render\/([^?]+)$/);
    if (req.method === 'GET' && m) {
      const job = jobs.get(decodeURIComponent(m[1]));
      if (!job) return json(res, 404, { error: 'Render job not found. The worker may have restarted.' });
      return json(res, 200, { id: job.id, status: job.status, progress: job.progress, url: job.url || null, error: job.error || null });
    }
    return json(res, 404, { error: 'Not found' });
  } catch (e) {
    return json(res, 500, { error: e?.message || 'Worker error' });
  }
});
server.listen(PORT, () => console.log(`ClipForge cloud render worker listening on ${PORT}`));
