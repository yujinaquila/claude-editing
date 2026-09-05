(() => {
  const $ = s => document.querySelector(s);
  const engine = () => window.__clipForgeEditEngine;
  const capturedFiles = new Map();
  let busy = false;
  let pollTimer = null;

  function toast(message) {
    const el = $('#toast'); if (!el) return;
    el.textContent = message; el.classList.add('show'); clearTimeout(toast.t);
    toast.t = setTimeout(() => el.classList.remove('show'), 6000);
  }
  function status(message, kind = 'busy') {
    const text = $('#statusText'), dot = $('#statusDot');
    if (text) text.textContent = message;
    if (dot) dot.className = `dot ${kind === 'error' ? 'error' : kind === 'busy' ? 'busy' : ''}`;
  }
  function loading(show, stage = 'Preparing cloud render', pct = 0) {
    if (typeof window.__clipForgeRenderLoading === 'function') window.__clipForgeRenderLoading(stage, pct, show);
    status(stage, show ? 'busy' : 'ready');
  }
  function captureFiles(files) {
    for (const file of [...(files || [])]) if (file?.type?.startsWith('video/')) capturedFiles.set(file.name, file);
  }
  function assetFiles() {
    const result = new Map();
    for (const el of [...document.querySelectorAll('#assets .asset')]) {
      const name = el.querySelector('.asset-name')?.textContent?.trim();
      const id = el.dataset.id;
      if (name && id && capturedFiles.has(name)) result.set(id, capturedFiles.get(name));
    }
    return result;
  }
  async function api(body) {
    let res;
    try {
      res = await fetch('/api/cloud-render', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } catch (error) {
      throw new Error(`Cannot reach the cloud render API. Check the deployed Vercel site and network connection. ${error?.message || 'Network error'}`);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Cloud render request failed (${res.status})`);
    return data;
  }
  async function uploadSource(file, index, total) {
    loading(true, `Uploading video ${index}/${total} to cloud…`, 5 + ((index - 1) / total) * 30);
    const ticket = await api({ action: 'upload-url', filename: file.name, contentType: file.type || 'video/mp4' });
    if (!ticket.id || !ticket.url) throw new Error(`Could not create a cloud upload for “${file.name}”.`);
    let put;
    try {
      put = await fetch(ticket.url, { method: 'PUT', headers: { 'Content-Type': file.type || 'video/mp4' }, body: file });
    } catch (error) {
      throw new Error(`Cannot reach Cloudflare R2 for “${file.name}”. Check the R2 bucket CORS policy. ${error?.message || 'Network error'}`);
    }
    if (!put.ok) throw new Error(`Cloud upload failed for “${file.name}” (${put.status}). Check R2 CORS and API token permissions.`);
    for (let attempt = 0; attempt < 10; attempt++) {
      const state = await api({ action: 'source-status', id: ticket.id });
      if (state.status === 'ready') return ticket.id;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error(`Cloud could not verify the upload for “${file.name}”.`);
  }
  async function renderCloud() {
    if (busy) return;
    const en = engine();
    if (!en?.plan?.clips?.length) { toast('Build Edit first.'); return; }
    busy = true;
    const button = $('#renderBtn'); if (button) button.disabled = true;
    try {
      const files = assetFiles();
      const needed = [...new Set(en.plan.clips.map(c => c.assetId))];
      const missing = needed.filter(id => !files.has(id));
      if (missing.length) throw new Error('The original video file is no longer available. Please re-import the footage before rendering.');
      loading(true, 'Preparing cloud render…', 3);
      const sources = {};
      for (let i = 0; i < needed.length; i++) sources[needed[i]] = await uploadSource(files.get(needed[i]), i + 1, needed.length);
      loading(true, 'Queueing render on your cloud FFmpeg worker…', 40);
      const queued = await api({ action: 'render', plan: en.plan, sources });
      if (!queued.id) throw new Error('Cloud renderer did not return a render ID.');
      toast('Render queued in the cloud.');
      await poll(queued.id, en.plan);
    } catch (error) {
      console.error('[cloud-render]', error);
      loading(false, 'Cloud render failed', 0); status('Cloud render failed', 'error');
      toast(`Cloud render failed: ${error?.message || error}`);
    } finally { busy = false; if (button) button.disabled = false; }
  }
  async function poll(id, plan) {
    clearTimeout(pollTimer);
    for (;;) {
      let r;
      try { r = await fetch(`/api/cloud-render?id=${encodeURIComponent(id)}`); }
      catch (error) { throw new Error(`Lost connection while checking the cloud render. ${error?.message || 'Network error'}`); }
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `Could not check cloud render (${r.status})`);
      const p = Number(data.progress);
      const pct = Number.isFinite(p) ? Math.min(99, 45 + p * 0.5) : 50;
      const stage = ({ queued: 'Cloud queue…', downloading: 'Cloud renderer fetching footage…', preprocessing: 'Cloud renderer preparing footage…', rendering: 'Cloud rendering your edit…', uploading: 'Cloud render uploading MP4…' })[data.status] || 'Cloud renderer working…';
      loading(true, stage, pct);
      if (data.status === 'done') {
        if (!data.url) throw new Error('Cloud render finished but returned no video URL.');
        window.__clipForgeRenderedUrl = data.url;
        const v = $('#previewVideo');
        if (v) { v.src = data.url; v.load(); v.style.display = 'block'; v.style.visibility = 'visible'; v.style.opacity = '1'; v.onloadedmetadata = () => { v.currentTime = 0; v.play().catch(() => {}); }; }
        $('#aiDownload')?.remove();
        const dl = document.createElement('button'); dl.id = 'aiDownload'; dl.className = 'btn primary'; dl.textContent = 'Download Cloud Render'; dl.style.cssText = 'margin-top:8px;width:100%';
        dl.onclick = () => { const a = document.createElement('a'); a.href = data.url; a.target = '_blank'; a.rel = 'noopener'; a.download = `claude-ai-${String(plan.aspect || '16:9').replace(':', 'x')}.mp4`; a.click(); };
        $('#renderBtn')?.parentElement?.appendChild(dl);
        loading(true, 'Cloud render complete', 100); status(`Cloud render complete • ${Math.max(0, plan.clips.length - 1)} transitions`); toast('Cloud render complete — your MP4 is ready.');
        setTimeout(() => loading(false, '', 0), 700); return;
      }
      if (data.status === 'failed') throw new Error(data.error || 'Cloud FFmpeg worker reported a render failure.');
      await new Promise(resolve => { pollTimer = setTimeout(resolve, 1800); });
    }
  }
  function install() {
    window.__clipForgeCloudRenderEnabled = true;
    $('#fileInput')?.addEventListener('change', e => captureFiles(e.target.files), true);
    document.addEventListener('drop', e => captureFiles(e.dataTransfer?.files), true);
    document.addEventListener('click', e => { if (!e.target?.closest?.('#renderBtn')) return; e.preventDefault(); e.stopImmediatePropagation(); renderCloud(); }, true);
    const badge = $('#engineBadge'); if (badge) { badge.textContent = 'CLOUD FFMPEG • READY'; badge.title = 'Final video rendering runs on a cloud FFmpeg worker'; }
    const label = [...document.querySelectorAll('.status')].find(x => /Browser render|Cloud render/i.test(x.textContent || '')); if (label) label.innerHTML = '<span class="dot"></span> Cloud FFmpeg';
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true }); else install();
})();
