(() => {
  const $ = (s) => document.querySelector(s);
  let timer = null;

  function ensureLoading() {
    if ($('#cfExportLoading')) return $('#cfExportLoading');
    const style = document.createElement('style');
    style.id = 'cfExportLoadingCSS';
    style.textContent = `
      #cfExportLoading{position:fixed;inset:0;z-index:2147483647;display:none;align-items:center;justify-content:center;background:rgba(4,5,8,.78);backdrop-filter:blur(10px)}
      #cfExportLoading.show{display:flex}
      .cf-export-card{width:min(430px,calc(100vw - 32px));padding:24px;border:1px solid rgba(255,255,255,.14);border-radius:18px;background:#11131a;box-shadow:0 24px 90px rgba(0,0,0,.55)}
      .cf-export-spinner{width:34px;height:34px;border:3px solid rgba(255,255,255,.18);border-top-color:#fff;border-radius:50%;animation:cfExportSpin .75s linear infinite;margin-bottom:15px}
      @keyframes cfExportSpin{to{transform:rotate(360deg)}}
      .cf-export-title{font-size:18px;font-weight:800}.cf-export-stage{margin-top:6px;font-size:13px;color:rgba(255,255,255,.65)}
      .cf-export-track{height:7px;margin-top:18px;border-radius:99px;overflow:hidden;background:rgba(255,255,255,.1)}
      .cf-export-fill{height:100%;width:4%;border-radius:99px;background:#fff;transition:width .25s ease}
      .cf-export-pct{margin-top:8px;text-align:right;font-size:12px;color:rgba(255,255,255,.5)}
    `;
    document.head.appendChild(style);
    const d = document.createElement('div');
    d.id = 'cfExportLoading';
    d.innerHTML = '<div class="cf-export-card"><div class="cf-export-spinner"></div><div class="cf-export-title">Rendering your video…</div><div id="cfExportStage" class="cf-export-stage">Preparing footage</div><div class="cf-export-track"><div id="cfExportFill" class="cf-export-fill"></div></div><div id="cfExportPct" class="cf-export-pct">4%</div></div>';
    document.body.appendChild(d);
    return d;
  }

  function show(stage = 'Preparing footage', pct = 4) {
    const d = ensureLoading();
    d.classList.add('show');
    const s = $('#cfExportStage'), f = $('#cfExportFill'), p = $('#cfExportPct');
    if (s) s.textContent = stage;
    if (f) f.style.width = `${Math.max(3, Math.min(100, pct))}%`;
    if (p) p.textContent = `${Math.round(pct)}%`;
  }

  function hide() {
    $('#cfExportLoading')?.classList.remove('show');
  }

  // Shared hook for the renderer: its existing progress UI can update this overlay too.
  window.__clipForgeRenderLoading = (stage, pct, visible = true) => {
    if (visible === false) return hide();
    show(stage || 'Rendering your video…', Number.isFinite(Number(pct)) ? Number(pct) : 4);
  };

  // Render/Export must show feedback immediately, before FFmpeg starts loading.
  document.addEventListener('click', (event) => {
    const render = event.target?.closest?.('#renderBtn');
    if (!render) return;
    show('Starting video renderer…', 3);
    render.setAttribute('aria-busy', 'true');
  }, true);

  // Automatically download the finished export as soon as the renderer creates it.
  const observer = new MutationObserver(() => {
    const button = $('#aiDownload');
    if (!button || button.dataset.autoDownloaded === '1') return;
    button.dataset.autoDownloaded = '1';
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        button.click();
        show('Download started', 100);
        setTimeout(hide, 900);
      } catch (error) {
        console.warn('Automatic download failed; Download AI Edit remains available.', error);
        hide();
      }
    }, 350);
  });

  function boot() {
    ensureLoading();
    observer.observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
