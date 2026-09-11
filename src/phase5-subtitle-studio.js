/* ClipForge AI — Phase 5 Subtitle Studio
 * Real-time word-level captions, kinetic animations, keyword highlights,
 * custom styling, and perfect synchronization with edited timeline cuts.
 */
(() => {
  'use strict';

  const STORAGE_KEY = 'clipforge.subtitleStudio.v2';
  const defaults = {
    enabled: true,
    wordBoxes: true,
    keywordHighlight: true,
    keywords: 'hook, secret, viral, amazing, profit, subscribe, listen, watch, stop, must, now',
    style: 'karaoke', // karaoke | boxed | clean | outline
    animation: 'pop', // pop | bounce | slide | fade | none
    positionX: 50,
    positionY: 82,
    fontSize: 5.2,
    maxWords: 5,
    boxRadius: 8,
    boxOpacity: 0.82,
    textTransform: 'uppercase',
    keywordColor: '#ffd166',
    activeColor: '#7c5cff',
    textColor: '#ffffff'
  };

  let settings = loadSettings();
  let lastActiveClipId = null;
  let lastActiveWordIndex = -1;

  function loadSettings(){
    try{
      return { ...defaults, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') };
    }catch{
      return { ...defaults };
    }
  }
  function saveSettings(){
    try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); }catch(_){}
  }

  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[c]));

  function getActiveTimelineClip(){
    const tl = (window.timeline && window.timeline.length) ? window.timeline : (window.getTimeline ? window.getTimeline() : []);
    if(!tl.length) return null;
    const seq = window.seq || (window.getSeq ? window.getSeq() : null);
    if(seq && seq.mode === 'sequence' && tl[seq.index]){
      return tl[seq.index];
    }
    const v = document.getElementById('previewVideo');
    if(v && v.src){
      const found = tl.find(c => c.url === v.src);
      if(found) return found;
    }
    return tl[0];
  }

  function getMediaForClip(c){
    if(!c) return null;
    const list = (window.media && window.media.length) ? window.media : (window.getMedia ? window.getMedia() : []);
    return list.find(m => m.id === c.mediaId) || list.find(m => m.url === c.url) || (c.transcript ? c : null);
  }

  function keywords(){
    return (settings.keywords || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  }
  function isKeyword(word){
    const w = String(word || '').toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');
    return keywords().some(k => w === k || w.includes(k) || k.includes(w));
  }

  function findActiveWordIndex(words, time){
    if(!words || !words.length) return -1;
    // 1. Exact match within start and end
    for(let i = 0; i < words.length; i++){
      const s = Number(words[i].start || 0);
      const e = Number(words[i].end || s + 0.4);
      if(time >= s && time <= e){
        return i;
      }
    }
    // 2. Pause/gap tolerance between words (up to 0.65s)
    for(let i = 0; i < words.length; i++){
      const s = Number(words[i].start || 0);
      const e = Number(words[i].end || s + 0.4);
      if(time >= s && time <= e + 0.65){
        return i;
      }
      if(i < words.length - 1){
        const nextS = Number(words[i + 1].start || 0);
        if(time > e && time < nextS){
          return (time - e < nextS - time) ? i : i + 1;
        }
      }
    }
    // 3. Right before first word
    if(words.length && time >= Math.max(0, Number(words[0].start || 0) - 0.4) && time < Number(words[0].start || 0)){
      return 0;
    }
    return -1;
  }

  function injectStyles(){
    if(document.getElementById('phase5SubtitleStyles')) return;
    const s = document.createElement('style');
    s.id = 'phase5SubtitleStyles';
    s.textContent = `
#subtitleStudioPanel{
  border:1px solid var(--border);
  background:var(--panel);
  border-radius:10px;
  margin-bottom:12px;
  overflow:hidden;
  box-shadow:0 4px 16px rgba(0,0,0,.25);
}
.ss-head{
  display:flex;align-items:center;justify-content:space-between;
  padding:10px 12px;border-bottom:1px solid var(--border);background:var(--panel-2);
}
.ss-head-left{display:flex;align-items:center;gap:7px;}
.ss-head-title{font-size:12px;font-weight:700;color:var(--text);}
.ss-chip{font-size:9px;font-weight:700;color:var(--ok);background:rgba(52,211,153,.15);padding:2px 7px;border-radius:999px;}
.ss-body{padding:12px;}
.ss-row{display:flex;align-items:center;gap:8px;margin:8px 0;}
.ss-row label{font-size:11px;color:var(--muted);min-width:76px;flex:none;}
.ss-row input[type=range]{flex:1;accent-color:var(--ai);}
.ss-row select, .ss-row input[type=text]{
  flex:1;background:var(--bg);border:1px solid var(--border);color:var(--text);
  border-radius:6px;padding:6px 8px;font-size:11px;outline:none;
}
.ss-row select:focus, .ss-row input[type=text]:focus{border-color:var(--ai);}
.ss-value{font-family:ui-monospace,monospace;font-size:10px;color:var(--muted-2);width:42px;text-align:right;}
.ss-actions{display:flex;gap:6px;margin-top:10px;}
.ss-actions button{flex:1;}
.ss-word-list-wrap{
  margin-top:12px;padding-top:10px;border-top:1px solid var(--border);
}
.ss-word-list-header{
  display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;
  font-size:10.5px;color:var(--muted);font-weight:600;
}
.ss-word-list{
  max-height:160px;overflow-y:auto;background:var(--bg);border:1px solid var(--border);
  border-radius:6px;padding:6px;display:flex;flex-wrap:wrap;gap:4px;
}
.ss-word{
  display:inline-flex;align-items:center;gap:4px;padding:3px 6px;border-radius:5px;
  background:var(--panel-2);border:1px solid var(--border);font-size:10.5px;color:var(--text);
  cursor:pointer;transition:all .15s;line-height:1.2;
}
.ss-word:hover{border-color:var(--ai);background:var(--ai-dim);}
.ss-word.is-active{
  border-color:var(--ai);background:var(--ai);color:#fff;font-weight:700;
  box-shadow:0 0 8px rgba(124,92,255,.5);
}
.ss-word.is-trimmed{opacity:.45;text-decoration:line-through;}
.ss-word time{font-family:ui-monospace,monospace;font-size:8.5px;opacity:.7;}

/* Subtitle overlay styling */
.subtitle-overlay{
  position:absolute;pointer-events:none;z-index:60;display:flex;flex-wrap:wrap;
  justify-content:center;align-items:center;text-align:center;
  transition:left .1s ease, bottom .1s ease;
}
.subtitle-overlay .word{
  display:inline-block;padding:3px 8px;margin:2px 3px;font-weight:800;
  letter-spacing:.3px;line-height:1.2;transition:transform .12s cubic-bezier(.2,1,.3,1), background-color .15s;
}
.subtitle-overlay .word.active{
  transform:scale(1.08);
}
.subtitle-overlay.ss-pop .word.active{
  animation:ssPop .24s cubic-bezier(0.175, 0.885, 0.32, 1.275) both;
}
.subtitle-overlay.ss-bounce .word.active{
  animation:ssBounce .35s cubic-bezier(.2,.8,.3,1.3) both;
}
.subtitle-overlay.ss-slide .word.active{
  animation:ssSlide .22s ease-out both;
}
.subtitle-overlay.ss-fade .word.active{
  animation:ssFade .2s ease-out both;
}
@keyframes ssPop{
  0%{transform:scale(.75);opacity:.6;}
  70%{transform:scale(1.15);}
  100%{transform:scale(1.08);opacity:1;}
}
@keyframes ssBounce{
  0%{transform:translateY(10px) scale(.8);opacity:0;}
  60%{transform:translateY(-4px) scale(1.12);}
  100%{transform:translateY(0) scale(1.08);opacity:1;}
}
@keyframes ssSlide{
  0%{transform:translateX(15px);opacity:0;}
  100%{transform:translateX(0) scale(1.08);opacity:1;}
}
@keyframes ssFade{
  0%{opacity:0;}
  100%{opacity:1;}
}
.ss-toggle{
  appearance:none;width:34px;height:18px;border-radius:12px;background:#333;
  position:relative;outline:none;cursor:pointer;transition:background .2s;flex:none;
}
.ss-toggle:checked{background:var(--ai);}
.ss-toggle:after{
  content:'';position:absolute;width:14px;height:14px;left:2px;top:2px;
  background:#fff;border-radius:50%;transition:.15s;
}
.ss-toggle:checked:after{left:18px;}
`;
    document.head.appendChild(s);
  }

  function makePanel(){
    injectStyles();
    // Check if container in #tabSubtitlesBody or #right exists
    let container = document.getElementById('tabSubtitlesBody');
    if(!container) container = document.getElementById('right');
    if(!container || document.getElementById('subtitleStudioPanel')) return;

    const panel = document.createElement('div');
    panel.id = 'subtitleStudioPanel';
    panel.innerHTML = `
      <div class="ss-head">
        <div class="ss-head-left">
          <span>💬</span>
          <span class="ss-head-title">Subtitle Studio</span>
          <span class="ss-chip">AUTO-SYNC</span>
        </div>
        <div style="display:flex;align-items:center;gap:6px">
          <label style="font-size:10px;color:var(--muted)">Active</label>
          <input class="ss-toggle" id="ssEnabled" type="checkbox" title="Toggle Subtitles">
        </div>
      </div>
      <div class="ss-body">
        <div class="ss-row">
          <label>Style Preset</label>
          <select id="ssStyle">
            <option value="karaoke">✨ Karaoke Highlight</option>
            <option value="boxed">📦 Word Boxes</option>
            <option value="clean">🪶 Minimal Clean</option>
            <option value="outline">🔲 High-Contrast Outline</option>
          </select>
        </div>
        <div class="ss-row">
          <label>Animation</label>
          <select id="ssAnimation">
            <option value="pop">⚡ Pop Pulse</option>
            <option value="bounce">🎈 Bounce</option>
            <option value="slide">💨 Slide In</option>
            <option value="fade">✨ Smooth Fade</option>
            <option value="none">⏹ None (Static)</option>
          </select>
        </div>
        <div class="ss-row">
          <label>Word Boxes</label>
          <input class="ss-toggle" id="ssBoxes" type="checkbox">
          <label style="min-width:65px;margin-left:8px">Keywords</label>
          <input class="ss-toggle" id="ssKeyword" type="checkbox">
        </div>
        <div class="ss-row">
          <label>Keywords</label>
          <input id="ssKeywords" type="text" placeholder="hook, secret, viral, best">
        </div>
        <div class="ss-row">
          <label>Position Y</label>
          <input id="ssY" type="range" min="15" max="92" step="1">
          <span class="ss-value" id="ssYV">82%</span>
        </div>
        <div class="ss-row">
          <label>Font Size</label>
          <input id="ssFont" type="range" min="2.5" max="8.0" step="0.1">
          <span class="ss-value" id="ssFontV">5.2vw</span>
        </div>
        <div class="ss-row">
          <label>Max Words</label>
          <input id="ssWords" type="range" min="1" max="8" step="1">
          <span class="ss-value" id="ssWordsV">5</span>
        </div>
        <div class="ss-actions">
          <button type="button" class="btn-ghost" id="ssReset" style="font-size:11px;padding:6px">↺ Reset</button>
          <button type="button" class="btn-primary" id="ssApply" style="font-size:11px;padding:6px">✓ Save Style</button>
        </div>
        <div class="ss-word-list-wrap">
          <div class="ss-word-list-header">
            <span>Clip Spoken Words (<span id="ssWordCount">0</span>)</span>
            <span style="font-size:9.5px;color:var(--muted-2)">Click word to jump</span>
          </div>
          <div class="ss-word-list" id="ssWordList">
            <span style="font-size:10px;color:var(--muted-2);padding:4px">
              Import clips and run Auto Transcript or Auto-Edit to view live word timestamps.
            </span>
          </div>
        </div>
      </div>
    `;

    container.prepend(panel);
    bindPanel(panel);
    syncPanel();
  }

  function bindPanel(panel){
    const $ = id => panel.querySelector('#' + id);
    const bind = (id, key, transform = v => v) => {
      const el = $(id);
      if(!el) return;
      el.addEventListener('input', e => {
        settings[key] = transform(e.target.value);
        saveSettings();
        syncPanel(false);
        renderCurrentOverlay();
      });
    };

    $('ssEnabled').addEventListener('change', e => {
      settings.enabled = e.target.checked;
      saveSettings();
      renderCurrentOverlay();
    });
    $('ssBoxes').addEventListener('change', e => {
      settings.wordBoxes = e.target.checked;
      saveSettings();
      renderCurrentOverlay();
    });
    $('ssKeyword').addEventListener('change', e => {
      settings.keywordHighlight = e.target.checked;
      saveSettings();
      renderCurrentOverlay();
    });

    bind('ssKeywords', 'keywords');
    bind('ssStyle', 'style');
    bind('ssAnimation', 'animation');
    bind('ssY', 'positionY', Number);
    bind('ssFont', 'fontSize', Number);
    bind('ssWords', 'maxWords', Number);

    $('ssReset').addEventListener('click', () => {
      settings = { ...defaults };
      saveSettings();
      syncPanel();
      renderCurrentOverlay();
      window.showToast?.('Subtitle settings reset');
    });

    $('ssApply').addEventListener('click', () => {
      saveSettings();
      renderCurrentOverlay();
      window.showToast?.('Subtitle style applied to preview & export');
    });
  }

  function syncPanel(updateInputs = true){
    const p = document.getElementById('subtitleStudioPanel');
    if(!p) return;
    const $ = id => p.querySelector('#' + id);
    if(updateInputs){
      $('ssEnabled').checked = !!settings.enabled;
      $('ssBoxes').checked = !!settings.wordBoxes;
      $('ssKeyword').checked = !!settings.keywordHighlight;
      $('ssKeywords').value = settings.keywords || '';
      $('ssStyle').value = settings.style;
      $('ssAnimation').value = settings.animation;
      $('ssY').value = settings.positionY;
      $('ssFont').value = settings.fontSize;
      $('ssWords').value = settings.maxWords;
    }
    $('ssYV').textContent = settings.positionY + '%';
    $('ssFontV').textContent = settings.fontSize.toFixed(1) + 'vw';
    $('ssWordsV').textContent = settings.maxWords;
  }

  function refreshWordList(clip, currentTime){
    const listEl = document.getElementById('ssWordList');
    if(!listEl) return;
    const activeClip = clip || getActiveTimelineClip();
    if(!activeClip){
      listEl.innerHTML = '<span style="font-size:10px;color:var(--muted-2);padding:4px">No active clip in timeline.</span>';
      return;
    }

    const m = getMediaForClip(activeClip);
    const words = m?.transcript || activeClip.transcript || [];
    const countEl = document.getElementById('ssWordCount');
    if(countEl) countEl.textContent = words.length;

    if(!words.length){
      listEl.innerHTML = '<span style="font-size:10px;color:var(--muted-2);padding:4px">Run Auto Transcript to extract words for this clip.</span>';
      return;
    }

    const clipId = activeClip.id || activeClip.mediaId;
    // Re-render word list DOM only if clip changed or transcript length changed
    if(lastActiveClipId !== clipId || listEl.querySelectorAll('.ss-word').length !== words.length){
      lastActiveClipId = clipId;
      listEl.innerHTML = words.map((w, i) => {
        const isTrimmed = (w.start < (activeClip.trimIn || 0) || w.end > (activeClip.trimOut || activeClip.duration || Infinity));
        return `<button type="button" class="ss-word ${isTrimmed ? 'is-trimmed' : ''}" data-idx="${i}" title="${isTrimmed ? 'Trimmed out of final video' : 'Click to jump to ' + fmt(w.start)}">
          <time>${fmt(w.start)}</time>
          <span class="w-text" contenteditable="true" spellcheck="false">${esc(w.word)}</span>
        </button>`;
      }).join('');

      // Bind word click to seek
      listEl.querySelectorAll('.ss-word').forEach(btn => {
        btn.addEventListener('click', (e) => {
          if(e.target.classList.contains('w-text') && e.target.isContentEditable && document.activeElement === e.target){
            return; // let user edit text
          }
          const idx = Number(btn.dataset.idx);
          const word = words[idx];
          if(!word) return;
          const tl = (window.timeline && window.timeline.length) ? window.timeline : [];
          let acc = 0;
          for(let k = 0; k < tl.length; k++){
            const c = tl[k];
            if(c.id === activeClip.id || c === activeClip){
              const dur = Math.max(0.2, c.trimOut - c.trimIn);
              const offsetInClip = Math.max(0, Math.min(dur, word.start - c.trimIn));
              if(window.seekSequence) window.seekSequence(acc + offsetInClip);
              return;
            }
            acc += Math.max(0.2, c.trimOut - c.trimIn);
          }
        });

        // Bind live text editing
        const textSpan = btn.querySelector('.w-text');
        if(textSpan){
          textSpan.addEventListener('blur', () => {
            const idx = Number(btn.dataset.idx);
            if(words[idx]){
              words[idx].word = textSpan.textContent.trim();
              renderCurrentOverlay();
            }
          });
        }
      });
    }

    // Update active highlight on time
    const t = currentTime != null ? currentTime : (document.getElementById('previewVideo')?.currentTime || 0);
    const activeIdx = findActiveWordIndex(words, t);
    if(activeIdx !== lastActiveWordIndex){
      lastActiveWordIndex = activeIdx;
      const allButtons = listEl.querySelectorAll('.ss-word');
      allButtons.forEach((b, i) => {
        const isAct = (i === activeIdx);
        b.classList.toggle('is-active', isAct);
        if(isAct){
          b.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
        }
      });
    }
  }

  function fmt(s){
    s = Math.max(0, Number(s) || 0);
    const m = Math.floor(s / 60);
    const sec = (s % 60).toFixed(1);
    return `${String(m).padStart(2, '0')}:${sec.padStart(4, '0')}`;
  }

  // Core render function called directly by editor
  function renderOverlayDirect(overlay, words, tInSourceClip, timelineClip){
    if(!overlay) return;
    if(!settings.enabled || !words || !words.length){
      overlay.classList.add('hidden');
      return;
    }

    // Check trim bounds: if video is outside [trimIn, trimOut], hide subtitles
    if(timelineClip){
      const tIn = timelineClip.trimIn || 0;
      const tOut = timelineClip.trimOut || timelineClip.duration || Infinity;
      if(tInSourceClip < tIn - 0.15 || tInSourceClip > tOut + 0.15){
        overlay.classList.add('hidden');
        return;
      }
    }

    const idx = findActiveWordIndex(words, tInSourceClip);
    if(idx < 0){
      overlay.classList.add('hidden');
      return;
    }

    const windowWords = Math.max(1, settings.maxWords || 5);
    const half = Math.floor(windowWords / 2);
    const start = Math.max(0, idx - half);
    const visible = words.slice(start, start + windowWords);

    overlay.className = `subtitle-overlay ss-${settings.animation || 'pop'}`;
    overlay.style.left = (settings.positionX || 50) + '%';
    overlay.style.bottom = (100 - (settings.positionY || 82)) + '%';
    overlay.style.transform = 'translateX(-50%)';
    overlay.style.maxWidth = '92%';

    overlay.innerHTML = visible.map((w, i) => {
      const active = (start + i === idx);
      const kw = settings.keywordHighlight && isKeyword(w.word);

      let style = `font-size:clamp(14px, ${settings.fontSize || 5.2}vw, 56px);text-transform:${settings.textTransform || 'uppercase'};`;
      if(kw){
        style += `color:${settings.keywordColor || '#ffd166'};`;
      } else {
        style += `color:${settings.textColor || '#ffffff'};`;
      }

      if(settings.wordBoxes){
        const bg = active ? (settings.activeColor || '#7c5cff') : `rgba(10, 10, 15, ${settings.boxOpacity || 0.82})`;
        style += `background:${bg};border-radius:${settings.boxRadius || 8}px;`;
      } else if(settings.style === 'outline'){
        style += 'background:transparent;text-shadow:-2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 2px 2px 0 #000, 0 3px 12px rgba(0,0,0,.8);';
      } else if(settings.style === 'karaoke'){
        const bg = active ? (settings.activeColor || '#7c5cff') : 'transparent';
        style += `background:${bg};border-radius:6px;${active ? 'color:#fff;' : ''}`;
      } else {
        style += 'background:transparent;text-shadow:0 2px 8px rgba(0,0,0,.9);';
      }

      return `<span class="word ${active ? 'active' : ''} ${kw ? 'keyword' : ''}" style="${style}">${esc(w.word)}</span>`;
    }).join('');

    overlay.classList.remove('hidden');
  }

  function renderCurrentOverlay(){
    const overlay = document.getElementById('subtitleOverlay');
    if(!overlay) return;
    const activeClip = getActiveTimelineClip();
    if(!activeClip){
      overlay.classList.add('hidden');
      return;
    }
    const m = getMediaForClip(activeClip);
    const words = m?.transcript || activeClip.transcript || [];
    const v = document.getElementById('previewVideo');
    const t = v ? v.currentTime : (activeClip.trimIn || 0);
    renderOverlayDirect(overlay, words, t, activeClip);
    refreshWordList(activeClip, t);
  }

  // Canvas drawing for high-resolution export
  function drawCaptionOnCanvas(ctx, canvas, mediaItem, tInClip){
    if(!settings.enabled || !mediaItem) return;
    const words = mediaItem.transcript || (mediaItem.highlights && mediaItem.highlights.transcript) || [];
    if(!words || !words.length) return;

    const idx = findActiveWordIndex(words, tInClip);
    if(idx < 0) return;

    const windowWords = Math.max(1, settings.maxWords || 5);
    const start = Math.max(0, idx - Math.floor(windowWords / 2));
    const visible = words.slice(start, start + windowWords);

    const isPortrait = canvas.height >= canvas.width;
    const fs = Math.round(canvas.width * ((settings.fontSize || 5.2) / 100));

    ctx.save();
    ctx.font = `800 ${fs}px Inter, -apple-system, BlinkMacSystemFont, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';

    const gap = Math.round(fs * 0.28);
    const padX = Math.round(fs * 0.38);

    const boxes = visible.map((w, i) => {
      const active = (start + i === idx);
      const kw = settings.keywordHighlight && isKeyword(w.word);
      const text = String(w.word || '').toUpperCase();
      return {
        w,
        text,
        active,
        kw,
        width: ctx.measureText(text).width + padX * 2
      };
    });

    const total = boxes.reduce((a, b) => a + b.width, 0) + gap * Math.max(0, boxes.length - 1);
    let x = Math.round(canvas.width * ((settings.positionX || 50) / 100) - total / 2);
    const y = Math.round(canvas.height * ((settings.positionY || 82) / 100));

    boxes.forEach(b => {
      const h = Math.round(fs * 1.4);
      if(settings.wordBoxes){
        ctx.fillStyle = b.active ? (settings.activeColor || '#7c5cff') : `rgba(10, 10, 15, ${settings.boxOpacity || 0.82})`;
        ctx.shadowColor = 'rgba(0,0,0,0.6)';
        ctx.shadowBlur = 10;
        round(ctx, x, y - h / 2, b.width, h, settings.boxRadius || 8);
        ctx.fill();
        ctx.shadowBlur = 0;
      } else if(settings.style === 'outline'){
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)';
        ctx.lineWidth = Math.max(3, Math.round(fs * 0.12));
        ctx.strokeText(b.text, x + padX, y);
      } else if(settings.style === 'karaoke' && b.active){
        ctx.fillStyle = settings.activeColor || '#7c5cff';
        round(ctx, x, y - h / 2, b.width, h, 6);
        ctx.fill();
      }

      ctx.fillStyle = b.kw ? (settings.keywordColor || '#ffd166') : (settings.textColor || '#ffffff');
      ctx.fillText(b.text, x + padX, y);
      x += b.width + gap;
    });

    ctx.restore();
  }

  function round(ctx, x, y, w, h, r){
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // Expose global interface
  window.__subtitleStudio = {
    renderOverlay: renderOverlayDirect,
    drawCaptionOnCanvas,
    getSettings: () => ({ ...settings }),
    setSettings: (s) => { settings = { ...settings, ...s }; saveSettings(); syncPanel(); renderCurrentOverlay(); },
    refreshWordList,
    renderCurrentOverlay,
    openPanel: () => {
      makePanel();
      syncPanel();
      const p = document.getElementById('subtitleStudioPanel');
      if(p) p.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  window.drawCaptionOnCanvas = drawCaptionOnCanvas;

  function boot(){
    makePanel();
    const v = document.getElementById('previewVideo');
    if(v){
      v.addEventListener('timeupdate', () => {
        renderCurrentOverlay();
      }, { passive: true });
    }
    window.addEventListener('clipforge:subtitle-refresh', renderCurrentOverlay);
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
