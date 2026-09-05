(() => {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
  const state = { busy:false, lastAsset:null };

  function assets() {
    return [...document.querySelectorAll('#assets .asset')].map(el => {
      const v = el.querySelector('video');
      return {
        id: el.dataset.id,
        name: el.querySelector('.asset-name')?.textContent?.trim() || 'clip',
        url: v?.src || '',
        duration: Number((el.querySelector('.asset-meta')?.textContent || '').split('•')[0]) || v?.duration || 0
      };
    }).filter(x => x.url);
  }

  function activeAsset() {
    const el = document.querySelector('#assets .asset.active') || document.querySelector('#assets .asset');
    return assets().find(a => a.id === el?.dataset.id) || assets()[0] || null;
  }

  function syncTranscript(assetId, segments) {
    if (!segments?.length) return;
    window.__clipForgeCloudTranscriptByAsset ||= {};
    if (assetId) window.__clipForgeCloudTranscriptByAsset[assetId] = segments;
    window.__clipForgeCloudTranscript = segments;
    const engine = window.__clipForgeEditEngine;
    if (engine && assetId) engine.transcripts.set(assetId, segments);
  }

  window.addEventListener('clipforge:transcript', e => {
    const d = e.detail || {};
    syncTranscript(d.assetId, d.segments || []);
    refreshSubtitleOverlay();
  });

  function getTranscript(id) {
    const engine = window.__clipForgeEditEngine;
    return engine?.transcripts?.get(id)?.length
      ? engine.transcripts.get(id)
      : window.__clipForgeCloudTranscriptByAsset?.[id]?.length
        ? window.__clipForgeCloudTranscriptByAsset[id]
        : window.__clipForgeCloudTranscript || [];
  }

  // Repair the common case where the cloud transcript was created before the AI engine
  // had its asset map populated. Keep the engine map synchronized continuously.
  setInterval(() => {
    const a = activeAsset();
    if (!a) return;
    const tr = getTranscript(a.id);
    if (tr.length) syncTranscript(a.id, tr);
  }, 700);

  function subtitleHost() {
    const v = $('#previewVideo');
    if (!v) return null;
    return v.closest('.preview') || v.parentElement;
  }

  function ensureOverlay() {
    const host = subtitleHost();
    if (!host) return null;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    let o = $('#cfLiveSubtitles');
    if (!o) {
      o = document.createElement('div');
      o.id = 'cfLiveSubtitles';
      o.innerHTML = '<span id="cfLiveSubtitleText"></span>';
      host.appendChild(o);
      const style = document.createElement('style');
      style.id = 'cfLiveSubtitleCSS';
      style.textContent = `
        #cfLiveSubtitles{position:absolute;left:6%;right:6%;bottom:6%;z-index:2147483000;display:none;text-align:center;pointer-events:none;font-family:inherit;font-weight:850;line-height:1.08;text-shadow:0 3px 12px #000;}
        #cfLiveSubtitleText{display:inline-block;max-width:94%;padding:8px 14px;border-radius:10px;background:rgba(0,0,0,.78);color:#fff;font-size:clamp(16px,2.6vw,32px);white-space:pre-wrap;box-decoration-break:clone;-webkit-box-decoration-break:clone;}
      `;
      document.head.appendChild(style);
    } else if (o.parentElement !== host) host.appendChild(o);
    return o;
  }

  function refreshSubtitleOverlay() {
    const v = $('#previewVideo');
    const o = ensureOverlay();
    if (!v || !o) return;
    const engine = window.__clipForgeEditEngine;
    let text = '';
    const p = engine?.plan;
    const clip = p?.clips?.[engine.previewIndex];
    if (p?.captions && clip?.text) {
      // Only show plan text while the preview is on that plan clip.
      if (v.currentTime >= Number(clip.start || 0) - .15 && v.currentTime <= Number(clip.end || 0) + .15) text = clip.text;
    }
    if (!text) {
      const a = activeAsset();
      const tr = a ? getTranscript(a.id) : [];
      const t = Number(v.currentTime || 0);
      text = tr.find(s => t >= Number(s.start) - .03 && t <= Number(s.end) + .03)?.text || '';
    }
    const span = $('#cfLiveSubtitleText');
    if (span) span.textContent = text;
    o.style.display = text ? 'block' : 'none';
  }

  document.addEventListener('timeupdate', e => {
    if (e.target?.id === 'previewVideo') refreshSubtitleOverlay();
  }, true);
  document.addEventListener('loadedmetadata', e => {
    if (e.target?.id === 'previewVideo') setTimeout(refreshSubtitleOverlay, 50);
  }, true);
  document.addEventListener('seeked', e => {
    if (e.target?.id === 'previewVideo') refreshSubtitleOverlay();
  }, true);

  // Build Edit used to reject already-transcribed footage when the cloud transcript
  // lived only in the global variable. Before the engine sees the click, hydrate its map.
  document.addEventListener('click', async e => {
    const button = e.target?.closest?.('#runAI');
    if (!button || state.busy) return;
    const list = assets();
    if (!list.length) return;
    const engine = window.__clipForgeEditEngine;
    if (!engine) return;
    const missing = list.filter(a => !getTranscript(a.id).length);
    if (!missing.length) {
      list.forEach(a => { const tr = getTranscript(a.id); if (tr.length) syncTranscript(a.id, tr); });
      return;
    }

    // One imported clip: the transcript currently shown in the Transcript panel is
    // unambiguously its transcript, even if its asset id was not captured.
    const active = activeAsset();
    const globalTr = window.__clipForgeCloudTranscript || [];
    if (list.length === 1 && globalTr.length) {
      e.preventDefault();
      e.stopImmediatePropagation();
      syncTranscript(list[0].id, globalTr);
      // Let the normal AI engine run now that its transcript map is hydrated.
      setTimeout(() => button.click(), 0);
      return;
    }

    // Multiple clips: if the selected clip has a transcript, hydrate it and allow the
    // engine to proceed. Missing clips will receive a clear message instead of the
    // misleading "transcribe first" state.
    if (active && globalTr.length) syncTranscript(active.id, globalTr);
  }, true);

  // Re-run overlay creation after main.js creates the editor DOM.
  const boot = () => setTimeout(() => { ensureOverlay(); refreshSubtitleOverlay(); }, 250);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true }); else boot();
})();
