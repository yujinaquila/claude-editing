(() => {
  const $ = s => document.querySelector(s);
  const engine = () => window.__clipForgeEditEngine;
  const capturedFiles = new Map();
  let busy = false;
  let pollTimer = null;

  function toast(message) {
    const el = $('#toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => el.classList.remove('show'), 4500);
  }

  function status(message, kind = 'busy') {
    const text = $('#statusText'), dot = $('#statusDot');
    if (text) text.textContent = message;
    if (dot) dot.className = `dot ${kind === 'error' ? 'error' : kind === 'busy' ? 'busy' : ''}`;
  }

  function progress(n) {
    const bar = $('#progressBar');
    if (bar) bar.style.width = `${Math.max(0, Math.min(100, n))}%`;
    if (typeof window.__clipForgeRenderLoading === 'function') window.__clipForgeRenderLoading('', n);
  }

  function loading(show, stage = 'Preparing cloud render', pct = 0) {
    if (typeof window.__clipForgeRenderLoading === 'function') {
      window.__clipForgeRenderLoading(stage, pct, show);
    }
    status(stage, show ? 'busy' : 'ready');
  }

  function captureFiles(files) {
    for (const file of [...(files || [])]) {
      if (file?.type?.startsWith('video/')) capturedFiles.set(file.name, file);
    }
  }

  function assetFiles() {
    const result = new Map();
    const domAssets = [...document.querySelectorAll('#assets .asset')];
    for (const el of domAssets) {
      const name = el.querySelector('.asset-name')?.textContent?.trim();
      const id = el.dataset.id;
      if (name && id && capturedFiles.has(name)) result.set(id, capturedFiles.get(name));
    }
    return result;
  }

  async function api(body) {
    const res = await fetch('/api/cloud-render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Cloud render request failed (${res.status})`);
    return data;
  }

  async function uploadSource(file, index, total) {
    loading(true, `Uploading video ${index}/${total} to cloud…`, 5 + ((index - 1) / total) * 30);
    const ticket = await api({ action: 'upload-url', filename: file.name });
    if (!ticket.id || !ticket.url) throw new Error(`Could not create a cloud upload for “${file.name}”.`);
    const put = await fetch(ticket.url, {
      method: 'PUT',
      headers: file.type ? { 'Content-Type': file.type } : undefined,
      body: file
    });
    if (!put.ok) throw new Error(`Cloud upload failed for “${file.name}” (${put.status}).`);

    for (let attempt = 0; attempt < 90; attempt++) {
      const state = await api({ action: 'source-status', id: ticket.id });
      if (state.status === 'ready' && state.url) return state.url;
      if (state.status === 'failed') throw new Error(`Cloud could not process “${file.name}”.`);
      await new Promise(resolve => setTimeout(resolve, Math.min(2500, 800 + attempt * 30)));
    }
    throw new Error(`Cloud upload timed out for “${file.name}”.`);
  }

  function buildCloudPlan(plan, sourceUrls) {
    return {
      ...plan,
      clips: (plan.clips || []).filter(c => sourceUrls[c.assetId])
    };
  }

  async function renderCloud() {
    if (busy) return;
    const en = engine();
    if (!en?.plan?.clips?.length) {
      toast('Build Edit first.');
      return;
    }
    busy = true;
    const button = $('#renderBtn');
    if (button) button.disabled = true;
    try {
      const files = assetFiles();
      const needed = [...new Set(en.plan.clips.map(c => c.assetId))];
      const missing = needed.filter(id => !files.has(id));
      if (missing.length) throw new Error('The original video file is no longer available. Please re-import the footage before rendering.');

      loading(true, 'Preparing cloud render…', 3);
      const sourceUrls = {};
      for (let i = 0; i < needed.length; i++) {
        sourceUrls[needed[i]] = await uploadSource(files.get(needed[i]), i + 1, needed.length);
      }

      const plan = buildCloudPlan(en.plan, sourceUrls);
      loading(true, 'Queueing render on cloud GPU workers…', 40);
      const queued = await api({ action: 'render', plan, sources: sourceUrls });
      if (!queued.id) throw new Error('Cloud renderer did not return a render ID.');

      toast('Render queued in the cloud. You can keep this tab open while it finishes.');
      await poll(queued.id, plan);
    } catch (error) {
      console.error('[cloud-render]', error);
      loading(false, 'Cloud render failed', 0);
      status('Cloud render failed', 'error');
      toast(`Cloud render failed: ${error?.message || error}`);
    } finally {
      busy = false;
      if (button) button.disabled = false;
    }
  }

  async function poll(id, plan) {
    clearTimeout(pollTimer);
    for (;;) {
      const r = await fetch(`/api/cloud-render?id=${encodeURIComponent(id)}`);
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `Could not check cloud render (${r.status})`);
      const p = Number(data.progress);
      const pct = Number.isFinite(p) && p > 0 ? Math.min(99, 45 + p * 0.5) : 50;
      const stage = ({ queued: 'Cloud queue…', fetching: 'Cloud renderer fetching footage…', preprocessing: 'Cloud renderer preparing footage…', rendering: 'Cloud rendering your edit…', saving: 'Cloud render finishing MP4…' })[data.status] || 'Cloud renderer working…';
      loading(true, stage, pct);

      if (data.status === 'done') {
        if (!data.url) throw new Error('Cloud render finished but returned no video URL.');
        window.__clipForgeRenderedUrl = data.url;
        const v = $('#previewVideo');
        if (v) {
          v.src = data.url;
          v.load();
          v.style.display = 'block';
          v.style.visibility = 'visible';
          v.style.opacity = '1';
          v.onloadedmetadata = () => { v.currentTime = 0; v.play().catch(() => {}); };
        }
        $('#aiDownload')?.remove();
        const dl = document.createElement('button');
        dl.id = 'aiDownload';
        dl.className = 'btn primary';
        dl.textContent = 'Download Cloud Render';
        dl.style.cssText = 'margin-top:8px;width:100%';
        dl.onclick = () => {
          const a = document.createElement('a');
          a.href = data.url;
          a.target = '_blank';
          a.rel = 'noopener';
          a.download = `claude-ai-${String(plan.aspect || '16:9').replace(':', 'x')}.mp4`;
          a.click();
        };
        $('#renderBtn')?.parentElement?.appendChild(dl);
        loading(true, 'Cloud render complete', 100);
        status(`Cloud render complete • ${Math.max(0, plan.clips.length - 1)} transitions`);
        toast('Cloud render complete — your MP4 is ready.');
        setTimeout(() => loading(false, '', 0), 700);
        return;
      }
      if (data.status === 'failed') throw new Error(data.error || 'Shotstack reported a render failure.');
      await new Promise(resolve => { pollTimer = setTimeout(resolve, 1800); });
    }
  }

  function install() {
    window.__clipForgeCloudRenderEnabled = true;
    const input = $('#fileInput');
    input?.addEventListener('change', e => captureFiles(e.target.files), true);
    document.addEventListener('drop', e => captureFiles(e.dataTransfer?.files), true);
    document.addEventListener('click', e => {
      if (!e.target?.closest?.('#renderBtn')) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      renderCloud();
    }, true);
    const badge = $('#engineBadge');
    if (badge) { badge.textContent = 'CLOUD RENDER • READY'; badge.title = 'Video rendering runs in the cloud'; }
    const browserLabel = [...document.querySelectorAll('.status')].find(x => /Browser render/i.test(x.textContent || ''));
    if (browserLabel) browserLabel.innerHTML = '<span class="dot"></span> Cloud render';
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
