const STAGE = process.env.SHOTSTACK_ENV === 'stage';
const BASE = STAGE ? 'https://api.shotstack.io' : 'https://api.shotstack.io';
const VERSION = STAGE ? 'stage' : 'v1';

function json(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json');
  return res.end(JSON.stringify(body));
}

async function shotstack(path, init = {}) {
  const key = process.env.SHOTSTACK_API_KEY;
  if (!key) throw new Error('SHOTSTACK_API_KEY is not configured in Vercel.');
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      'x-api-key': key,
      ...(init.headers || {})
    }
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!response.ok) {
    const message = data?.error || data?.message || data?.response?.error || `Shotstack request failed (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    error.details = data;
    throw error;
  }
  return data;
}

function sourceUrl(source) {
  return source?.data?.attributes?.source || source?.data?.attributes?.url || source?.response?.url || null;
}

function mapTransition(value) {
  const map = {
    fade: 'fade',
    fadeblack: 'fade',
    fadewhite: 'fade',
    wipeleft: 'wipeLeft',
    wiperight: 'wipeRight',
    slideleft: 'slideLeft',
    slideright: 'slideRight',
    smoothleft: 'slideLeft',
    smoothright: 'slideRight',
    circleopen: 'fade',
    circleclose: 'fade'
  };
  return map[String(value || '').toLowerCase()] || 'fade';
}

function sizeFor(aspect) {
  if (aspect === '9:16') return { width: 1080, height: 1920 };
  if (aspect === '1:1') return { width: 1080, height: 1080 };
  return { width: 1920, height: 1080 };
}

function buildEdit(plan, sources) {
  const size = sizeFor(plan.aspect);
  let cursor = 0;
  const videoClips = [];
  const captionClips = [];

  for (let i = 0; i < (plan.clips || []).length; i++) {
    const clip = plan.clips[i];
    const src = sources[clip.assetId];
    if (!src) continue;
    const length = Math.max(0.12, Number(clip.end) - Number(clip.start));
    const transitionLength = i > 0 ? Math.min(0.5, Number(clip.transitionDuration) || 0.35) : 0;
    const start = i === 0 ? 0 : Math.max(0, cursor - transitionLength);
    const alias = `clip_${i}`;
    const video = {
      alias,
      asset: {
        type: 'video',
        src,
        trim: Math.max(0, Number(clip.start) || 0),
        transcode: true
      },
      start,
      length,
      fit: 'contain',
      position: 'center'
    };
    if (i > 0) video.transition = { in: mapTransition(clip.transition) };
    videoClips.push(video);

    if (plan.captions) {
      captionClips.push({
        asset: {
          type: 'rich-caption',
          src: `alias://${alias}`,
          font: { family: 'Montserrat ExtraBold', size: 52, color: '#ffffff' },
          active: { font: { color: '#FFD84D' }, background: { color: '#111111', opacity: 0.92 } },
          background: { color: '#000000', opacity: 0.72, padding: 14, borderRadius: 12 },
          animation: { style: 'highlight' },
          align: { vertical: 'bottom', horizontal: 'center' }
        },
        start,
        length: Math.max(0.12, length - transitionLength * 0.15),
        width: size.width * 0.86,
        height: size.height * 0.24,
        position: 'center',
        offset: { x: 0, y: -0.08 }
      });
    }
    cursor = start + length;
  }

  return {
    timeline: {
      background: '#000000',
      tracks: [
        ...(plan.captions && captionClips.length ? [{ clips: captionClips }] : []),
        ...videoClips.map(clip => ({ clips: [clip] }))
      ],
      cache: true
    },
    output: {
      format: 'mp4',
      size,
      fps: 30,
      quality: 'medium',
      mute: false,
      destinations: [{ provider: 'shotstack', exclude: false }]
    }
  };
}

export default async function handler(req, res) {
  if (!['POST', 'GET'].includes(req.method)) return json(res, 405, { error: 'Method not allowed' });
  if (!process.env.SHOTSTACK_API_KEY) return json(res, 503, { error: 'Cloud rendering is not configured. Add SHOTSTACK_API_KEY to Vercel Environment Variables.' });

  try {
    if (req.method === 'POST') {
      const body = req.body || {};
      if (body.action === 'upload-url') {
        const data = await shotstack(`/ingest/${VERSION}/upload`, {
          method: 'POST',
          body: JSON.stringify(body.filename ? { filename: body.filename } : {})
        });
        return json(res, 200, {
          id: data?.data?.id,
          url: data?.data?.attributes?.url,
          expires: data?.data?.attributes?.expires
        });
      }

      if (body.action === 'source-status') {
        if (!body.id) return json(res, 400, { error: 'Missing source id.' });
        const data = await shotstack(`/ingest/${VERSION}/sources/${encodeURIComponent(body.id)}`);
        return json(res, 200, {
          id: body.id,
          status: data?.data?.attributes?.status,
          url: sourceUrl(data),
          duration: data?.data?.attributes?.duration
        });
      }

      if (body.action === 'render') {
        if (!body.plan?.clips?.length) return json(res, 400, { error: 'The edit plan has no clips.' });
        const edit = buildEdit(body.plan, body.sources || {});
        const data = await shotstack(`/edit/${VERSION}/render`, {
          method: 'POST',
          body: JSON.stringify(edit)
        });
        return json(res, 201, { id: data?.response?.id, status: 'queued' });
      }

      return json(res, 400, { error: 'Unknown cloud render action.' });
    }

    const id = req.query?.id;
    if (!id) return json(res, 400, { error: 'Missing render id.' });
    const data = await shotstack(`/edit/${VERSION}/render/${encodeURIComponent(id)}`);
    const r = data?.response || {};
    return json(res, 200, {
      id: r.id,
      status: r.status,
      progress: r.progress,
      url: r.url || null,
      error: r.error || null,
      duration: r.duration || null,
      renderTime: r.renderTime || null
    });
  } catch (error) {
    console.error('[cloud-render]', error);
    return json(res, error.status || 500, { error: error.message || 'Cloud render request failed.', details: error.details || null });
  }
}
