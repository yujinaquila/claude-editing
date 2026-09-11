/* ClipForge AI — Phase 5 Subtitle Studio
 * Real-time word-level captions, kinetic animations, keyword highlights,
 * advanced color & style customizations, and perfect synchronization with edited timeline cuts.
 */
(() => {
  'use strict';

  const STORAGE_KEY = 'clipforge.subtitleStudio.v3';
  const defaults = {
    enabled: true,
    wordBoxes: true,
    keywordHighlight: true,
    keywords: 'hook, secret, viral, amazing, profit, subscribe, listen, watch, stop, must, now, best, money',
    style: 'boxed', // boxed | karaoke | outline | clean
    preset: 'mrbeast', // mrbeast | violet | neon | outline | sunset | red | clean | karaoke
    animation: 'pop', // pop | bounce | slide | glow-pulse | fade | none
    positionX: 50,
    positionY: 82,
    fontSize: 5.2,
    maxWords: 5,
    boxRadius: 8,
    boxOpacity: 0.9,
    boxBgColor: '#000000',
    strokeColor: '#000000',
    strokeWidth: 0,
    glowEffect: 'shadow', // none | shadow | neon | heavy-outline
    fontFamily: 'Impact, sans-serif',
    fontWeight: '800',
    textTransform: 'uppercase', // uppercase | capitalize | none
    activeColor: '#ffea00',
    textColor: '#ffffff',
    keywordColor: '#00f5d4'
  };

  const STYLE_PRESETS = {
    mrbeast: {
      name: '👑 MrBeast Viral',
      style: 'boxed',
      fontFamily: 'Impact, sans-serif',
      fontWeight: '800',
      textTransform: 'uppercase',
      activeColor: '#ffea00',
      textColor: '#ffffff',
      keywordColor: '#00f5d4',
      boxBgColor: '#000000',
      boxOpacity: 0.92,
      boxRadius: 8,
      strokeWidth: 0,
      strokeColor: '#000000',
      glowEffect: 'shadow',
      animation: 'pop',
      wordBoxes: true
    },
    violet: {
      name: '💜 Hyper Violet',
      style: 'karaoke',
      fontFamily: 'Montserrat, sans-serif',
      fontWeight: '800',
      textTransform: 'uppercase',
      activeColor: '#7c5cff',
      textColor: '#ffffff',
      keywordColor: '#f43f5e',
      boxBgColor: '#1e1b4b',
      boxOpacity: 0.82,
      boxRadius: 8,
      strokeWidth: 0,
      strokeColor: '#000000',
      glowEffect: 'neon',
      animation: 'bounce',
      wordBoxes: true
    },
    neon: {
      name: '💚 Cyber Neon',
      style: 'karaoke',
      fontFamily: 'Inter, sans-serif',
      fontWeight: '800',
      textTransform: 'uppercase',
      activeColor: '#10b981',
      textColor: '#ecfdf5',
      keywordColor: '#06b6d4',
      boxBgColor: '#022c22',
      boxOpacity: 0.78,
      boxRadius: 6,
      strokeWidth: 0,
      strokeColor: '#000000',
      glowEffect: 'neon',
      animation: 'glow-pulse',
      wordBoxes: true
    },
    outline: {
      name: '🔲 Bold Outline',
      style: 'outline',
      fontFamily: 'Impact, sans-serif',
      fontWeight: '800',
      textTransform: 'uppercase',
      activeColor: '#ffd166',
      textColor: '#ffffff',
      keywordColor: '#ff0055',
      boxBgColor: '#000000',
      boxOpacity: 0,
      boxRadius: 6,
      strokeWidth: 4,
      strokeColor: '#000000',
      glowEffect: 'none',
      animation: 'pop',
      wordBoxes: false
    },
    sunset: {
      name: '🧡 YouTube Sunset',
      style: 'boxed',
      fontFamily: 'Montserrat, sans-serif',
      fontWeight: '800',
      textTransform: 'uppercase',
      activeColor: '#f97316',
      textColor: '#ffffff',
      keywordColor: '#fbbf24',
      boxBgColor: '#1c1917',
      boxOpacity: 0.88,
      boxRadius: 8,
      strokeWidth: 0,
      strokeColor: '#000000',
      glowEffect: 'shadow',
      animation: 'slide',
      wordBoxes: true
    },
    red: {
      name: '🔴 Action Red',
      style: 'boxed',
      fontFamily: 'Impact, sans-serif',
      fontWeight: '800',
      textTransform: 'uppercase',
      activeColor: '#ef4444',
      textColor: '#ffffff',
      keywordColor: '#f59e0b',
      boxBgColor: '#000000',
      boxOpacity: 0.94,
      boxRadius: 8,
      strokeWidth: 0,
      strokeColor: '#000000',
      glowEffect: 'shadow',
      animation: 'pop',
      wordBoxes: true
    },
    clean: {
      name: '🪶 Minimal Clean',
      style: 'clean',
      fontFamily: 'Inter, sans-serif',
      fontWeight: '700',
      textTransform: 'capitalize',
      activeColor: '#38bdf8',
      textColor: '#f8fafc',
      keywordColor: '#a855f7',
      boxBgColor: '#0f172a',
      boxOpacity: 0.65,
      boxRadius: 6,
      strokeWidth: 0,
      strokeColor: '#000000',
      glowEffect: 'shadow',
      animation: 'fade',
      wordBoxes: false
    }
  };

  let settings = loadSettings();
  let lastActiveClipId = null;
  let lastActiveWordIndex = -1;
  let sampleActiveWordIndex = 4; // index 4 is "VIDEOS" in the sample card

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

  function hexToRgba(hex, alpha = 1){
    hex = String(hex || '').replace('#', '');
    if(hex.length === 3) hex = hex.split('').map(c => c+c).join('');
    const num = parseInt(hex, 16);
    if(isNaN(num)) return `rgba(10, 10, 15, ${alpha})`;
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function getContrastColor(hex){
    hex = String(hex || '').replace('#', '');
    if(hex.length === 3) hex = hex.split('').map(c => c+c).join('');
    const num = parseInt(hex, 16);
    if(isNaN(num)) return '#ffffff';
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return lum > 0.6 ? '#000000' : '#ffffff';
  }

  function transformWordText(txt, transformMode){
    txt = String(txt || '');
    if(transformMode === 'uppercase') return txt.toUpperCase();
    if(transformMode === 'lowercase') return txt.toLowerCase();
    if(transformMode === 'capitalize'){
      return txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase();
    }
    return txt;
  }

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
    for(let i = 0; i < words.length; i++){
      const s = Number(words[i].start || 0);
      const e = Number(words[i].end || s + 0.4);
      if(time >= s && time <= e){
        return i;
      }
    }
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

/* Live Subtitle Sample Card */
.ss-preview-card{
  background:radial-gradient(ellipse at center, rgba(30,30,40,.9) 0%, rgba(10,10,14,.98) 100%);
  border:1px solid var(--border);
  border-radius:8px;
  padding:14px 10px;
  margin-bottom:12px;
  display:flex;
  flex-direction:column;
  align-items:center;
  justify-content:center;
  text-align:center;
  min-height:76px;
  position:relative;
  box-shadow:inset 0 1px 8px rgba(0,0,0,.5);
}
.ss-preview-card-header{
  position:absolute;
  top:4px;
  left:8px;
  right:8px;
  display:flex;
  justify-content:space-between;
  align-items:center;
  font-size:9px;
  color:var(--muted-2);
  text-transform:uppercase;
  letter-spacing:.5px;
  pointer-events:none;
}
.ss-sample-words{
  display:flex;
  flex-wrap:wrap;
  justify-content:center;
  align-items:center;
  gap:4px;
  margin-top:12px;
}
.ss-sample-word{
  display:inline-block;
  padding:4px 8px;
  border-radius:6px;
  cursor:pointer;
  transition:transform .12s ease, background-color .15s ease, color .15s ease;
  user-select:none;
}
.ss-sample-word:hover{
  transform:scale(1.05);
}

/* Preset Cards */
.ss-section-title{
  font-size:11px;font-weight:700;color:var(--text);margin:10px 0 6px;
  display:flex;align-items:center;justify-content:space-between;
}
.ss-presets-grid{
  display:grid;grid-template-columns:repeat(2, 1fr);gap:6px;margin-bottom:12px;
}
.ss-preset-btn{
  background:var(--bg);border:1px solid var(--border);border-radius:6px;
  padding:6px 8px;font-size:11px;font-weight:600;color:var(--text);
  cursor:pointer;display:flex;align-items:center;gap:6px;text-align:left;
  transition:all .15s ease;
}
.ss-preset-btn:hover{
  background:var(--panel-2);border-color:var(--ai);
}
.ss-preset-btn.active{
  background:rgba(124,92,255,.15);border-color:var(--ai);color:#fff;
  box-shadow:0 0 8px rgba(124,92,255,.3);
}

/* Color rows and pickers */
.ss-color-grid{
  display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;
}
.ss-color-box{
  background:var(--bg);border:1px solid var(--border);border-radius:6px;
  padding:7px 8px;display:flex;flex-direction:column;gap:5px;
}
.ss-color-box-head{
  display:flex;align-items:center;justify-content:space-between;
  font-size:10.5px;color:var(--muted);font-weight:600;
}
.ss-color-picker-row{
  display:flex;align-items:center;gap:6px;
}
.ss-color-input{
  width:26px;height:24px;border:none;border-radius:4px;cursor:pointer;
  padding:0;background:transparent;outline:none;
}
.ss-hex-input{
  flex:1;background:var(--panel);border:1px solid var(--border);color:var(--text);
  border-radius:4px;padding:3px 6px;font-size:10px;font-family:ui-monospace,monospace;outline:none;
}
.ss-hex-input:focus{border-color:var(--ai);}
.ss-swatches{
  display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin-top:2px;
}
.ss-swatch{
  width:14px;height:14px;border-radius:3px;border:1px solid rgba(255,255,255,.2);
  cursor:pointer;transition:transform .12s ease;
}
.ss-swatch:hover{transform:scale(1.25);border-color:#fff;}

/* Form rows */
.ss-row{display:flex;align-items:center;gap:8px;margin:8px 0;}
.ss-row label{font-size:11px;color:var(--muted);min-width:82px;flex:none;}
.ss-row input[type=range]{flex:1;accent-color:var(--ai);}
.ss-row select, .ss-row input[type=text]{
  flex:1;background:var(--bg);border:1px solid var(--border);color:var(--text);
  border-radius:6px;padding:6px 8px;font-size:11px;outline:none;
}
.ss-row select:focus, .ss-row input[type=text]:focus{border-color:var(--ai);}
.ss-value{font-family:ui-monospace,monospace;font-size:10px;color:var(--muted-2);width:42px;text-align:right;}
.ss-actions{display:flex;gap:6px;margin-top:12px;}
.ss-actions button{flex:1;}
.ss-word-list-wrap{
  margin-top:12px;padding-top:10px;border-top:1px solid var(--border);
}
.ss-word-list-header{
  display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;
  font-size:10.5px;color:var(--muted);font-weight:600;
}
.ss-word-list{
  max-height:150px;overflow-y:auto;background:var(--bg);border:1px solid var(--border);
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
.subtitle-overlay.ss-glow-pulse .word.active{
  animation:ssGlowPulse .45s ease-in-out infinite alternate both;
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
  60%{transform:translateY(-5px) scale(1.12);}
  100%{transform:translateY(0) scale(1.08);opacity:1;}
}
@keyframes ssSlide{
  0%{transform:translateX(15px);opacity:0;}
  100%{transform:translateX(0) scale(1.08);opacity:1;}
}
@keyframes ssGlowPulse{
  0%{transform:scale(1.04);filter:drop-shadow(0 0 6px currentColor);}
  100%{transform:scale(1.10);filter:drop-shadow(0 0 16px currentColor);}
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

        <!-- Live Subtitle Sample Card -->
        <div class="ss-preview-card" id="ssSampleCard">
          <div class="ss-preview-card-header">
            <span>Live Style Preview</span>
            <span style="font-size:8px">Click word to test</span>
          </div>
          <div class="ss-sample-words" id="ssSampleWords">
            <!-- Rendered by renderSampleCard() -->
          </div>
        </div>

        <!-- 1-Click Style Presets -->
        <div class="ss-section-title">
          <span>🎨 Style Presets</span>
          <span style="font-size:9.5px;color:var(--muted);font-weight:normal">1-click viral themes</span>
        </div>
        <div class="ss-presets-grid" id="ssPresetsGrid">
          <button type="button" class="ss-preset-btn" data-preset="mrbeast">👑 MrBeast Viral</button>
          <button type="button" class="ss-preset-btn" data-preset="violet">💜 Hyper Violet</button>
          <button type="button" class="ss-preset-btn" data-preset="neon">💚 Cyber Neon</button>
          <button type="button" class="ss-preset-btn" data-preset="outline">🔲 Bold Outline</button>
          <button type="button" class="ss-preset-btn" data-preset="sunset">🧡 YouTube Sunset</button>
          <button type="button" class="ss-preset-btn" data-preset="red">🔴 Action Red</button>
          <button type="button" class="ss-preset-btn" data-preset="clean">🪶 Minimal Clean</button>
        </div>

        <!-- Color Customization -->
        <div class="ss-section-title">
          <span>🎨 Color Customization</span>
        </div>
        <div class="ss-color-grid">
          <!-- Active Highlight Color -->
          <div class="ss-color-box">
            <div class="ss-color-box-head">
              <span>Active Word</span>
              <span id="ssActiveColorVal">#ffea00</span>
            </div>
            <div class="ss-color-picker-row">
              <input type="color" class="ss-color-input" id="ssActiveColor">
              <input type="text" class="ss-hex-input" id="ssActiveColorHex" maxlength="7">
            </div>
            <div class="ss-swatches">
              <span class="ss-swatch" style="background:#ffea00" data-color="#ffea00" data-target="activeColor"></span>
              <span class="ss-swatch" style="background:#7c5cff" data-color="#7c5cff" data-target="activeColor"></span>
              <span class="ss-swatch" style="background:#10b981" data-color="#10b981" data-target="activeColor"></span>
              <span class="ss-swatch" style="background:#00f5d4" data-color="#00f5d4" data-target="activeColor"></span>
              <span class="ss-swatch" style="background:#ef4444" data-color="#ef4444" data-target="activeColor"></span>
              <span class="ss-swatch" style="background:#f97316" data-color="#f97316" data-target="activeColor"></span>
              <span class="ss-swatch" style="background:#ec4899" data-color="#ec4899" data-target="activeColor"></span>
            </div>
          </div>

          <!-- Base Text Color -->
          <div class="ss-color-box">
            <div class="ss-color-box-head">
              <span>Text Color</span>
              <span id="ssTextColorVal">#ffffff</span>
            </div>
            <div class="ss-color-picker-row">
              <input type="color" class="ss-color-input" id="ssTextColor">
              <input type="text" class="ss-hex-input" id="ssTextColorHex" maxlength="7">
            </div>
            <div class="ss-swatches">
              <span class="ss-swatch" style="background:#ffffff" data-color="#ffffff" data-target="textColor"></span>
              <span class="ss-swatch" style="background:#f8fafc" data-color="#f8fafc" data-target="textColor"></span>
              <span class="ss-swatch" style="background:#fef08a" data-color="#fef08a" data-target="textColor"></span>
              <span class="ss-swatch" style="background:#cbd5e1" data-color="#cbd5e1" data-target="textColor"></span>
              <span class="ss-swatch" style="background:#18181b" data-color="#18181b" data-target="textColor"></span>
            </div>
          </div>

          <!-- Keyword Color -->
          <div class="ss-color-box">
            <div class="ss-color-box-head">
              <span>Keywords</span>
              <span id="ssKeywordColorVal">#00f5d4</span>
            </div>
            <div class="ss-color-picker-row">
              <input type="color" class="ss-color-input" id="ssKeywordColor">
              <input type="text" class="ss-hex-input" id="ssKeywordColorHex" maxlength="7">
            </div>
            <div class="ss-swatches">
              <span class="ss-swatch" style="background:#00f5d4" data-color="#00f5d4" data-target="keywordColor"></span>
              <span class="ss-swatch" style="background:#ffd166" data-color="#ffd166" data-target="keywordColor"></span>
              <span class="ss-swatch" style="background:#ff0055" data-color="#ff0055" data-target="keywordColor"></span>
              <span class="ss-swatch" style="background:#a855f7" data-color="#a855f7" data-target="keywordColor"></span>
              <span class="ss-swatch" style="background:#fbbf24" data-color="#fbbf24" data-target="keywordColor"></span>
            </div>
          </div>

          <!-- Box Background Color -->
          <div class="ss-color-box">
            <div class="ss-color-box-head">
              <span>Box Background</span>
              <span id="ssBoxColorVal">#000000</span>
            </div>
            <div class="ss-color-picker-row">
              <input type="color" class="ss-color-input" id="ssBoxColor">
              <input type="text" class="ss-hex-input" id="ssBoxColorHex" maxlength="7">
            </div>
            <div class="ss-swatches">
              <span class="ss-swatch" style="background:#000000" data-color="#000000" data-target="boxBgColor"></span>
              <span class="ss-swatch" style="background:#0f172a" data-color="#0f172a" data-target="boxBgColor"></span>
              <span class="ss-swatch" style="background:#1e1b4b" data-color="#1e1b4b" data-target="boxBgColor"></span>
              <span class="ss-swatch" style="background:#18181b" data-color="#18181b" data-target="boxBgColor"></span>
              <span class="ss-swatch" style="background:#7f1d1d" data-color="#7f1d1d" data-target="boxBgColor"></span>
            </div>
          </div>
        </div>

        <!-- Typography & Appearance -->
        <div class="ss-section-title">
          <span>🔤 Typography & Effects</span>
        </div>
        <div class="ss-row">
          <label>Font Family</label>
          <select id="ssFontFamily">
            <option value="Impact, sans-serif">Impact (Viral Punch)</option>
            <option value="Montserrat, sans-serif">Montserrat (Modern Heavy)</option>
            <option value="Inter, sans-serif">Inter (Clean Sans)</option>
            <option value="'Arial Black', sans-serif">Arial Black (Block Heavy)</option>
            <option value="'Trebuchet MS', sans-serif">Trebuchet MS (Dynamic)</option>
            <option value="Georgia, serif">Georgia (Cinematic Serif)</option>
          </select>
        </div>
        <div class="ss-row">
          <label>Letter Casing</label>
          <select id="ssCasing">
            <option value="uppercase">ALL CAPS (VIRAL)</option>
            <option value="capitalize">Title Case (Polished)</option>
            <option value="none">As Spoken (Natural)</option>
          </select>
        </div>
        <div class="ss-row">
          <label>Glow & Shadow</label>
          <select id="ssGlowEffect">
            <option value="shadow">Deep Drop Shadow</option>
            <option value="neon">Luminous Neon Glow</option>
            <option value="heavy-outline">Contrast Outline Stroke</option>
            <option value="none">Clean Flat (None)</option>
          </select>
        </div>
        <div class="ss-row">
          <label>Animation</label>
          <select id="ssAnimation">
            <option value="pop">⚡ Pop Pulse</option>
            <option value="bounce">🎈 Elastic Bounce</option>
            <option value="slide">💨 Slide In</option>
            <option value="glow-pulse">🌟 Neon Pulse</option>
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
          <label>Box Opacity</label>
          <input id="ssBoxOpacity" type="range" min="0" max="100" step="5">
          <span class="ss-value" id="ssBoxOpacityV">90%</span>
        </div>
        <div class="ss-row">
          <label>Corner Radius</label>
          <input id="ssBoxRadius" type="range" min="0" max="20" step="1">
          <span class="ss-value" id="ssBoxRadiusV">8px</span>
        </div>
        <div class="ss-row">
          <label>Outline Width</label>
          <input id="ssStrokeWidth" type="range" min="0" max="8" step="1">
          <span class="ss-value" id="ssStrokeWidthV">0px</span>
        </div>
        <div class="ss-row">
          <label>Outline Color</label>
          <input type="color" class="ss-color-input" id="ssStrokeColor" style="margin-right:6px">
          <input type="text" class="ss-hex-input" id="ssStrokeColorHex" maxlength="7" style="max-width:90px">
        </div>
        <div class="ss-row">
          <label>Trigger Words</label>
          <input id="ssKeywords" type="text" placeholder="hook, secret, viral, best, now">
        </div>

        <!-- Position & Sizing -->
        <div class="ss-section-title">
          <span>📐 Layout & Size</span>
        </div>
        <div class="ss-row">
          <label>Position Y</label>
          <input id="ssY" type="range" min="15" max="92" step="1">
          <span class="ss-value" id="ssYV">82%</span>
        </div>
        <div class="ss-row">
          <label>Font Size</label>
          <input id="ssFont" type="range" min="2.5" max="8.5" step="0.1">
          <span class="ss-value" id="ssFontV">5.2vw</span>
        </div>
        <div class="ss-row">
          <label>Max Words</label>
          <input id="ssWords" type="range" min="1" max="8" step="1">
          <span class="ss-value" id="ssWordsV">5</span>
        </div>

        <div class="ss-actions">
          <button type="button" class="btn-ghost" id="ssReset" style="font-size:11px;padding:7px">↺ Reset to Default</button>
          <button type="button" class="btn-primary" id="ssApply" style="font-size:11px;padding:7px">✓ Save & Apply</button>
        </div>

        <!-- Word timestamps jump list -->
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
    renderSampleCard();
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
        renderSampleCard();
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
      renderSampleCard();
      renderCurrentOverlay();
    });
    $('ssKeyword').addEventListener('change', e => {
      settings.keywordHighlight = e.target.checked;
      saveSettings();
      renderSampleCard();
      renderCurrentOverlay();
    });

    // Preset buttons
    panel.querySelectorAll('.ss-preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const pKey = btn.dataset.preset;
        if(STYLE_PRESETS[pKey]){
          settings = { ...settings, ...STYLE_PRESETS[pKey], preset: pKey };
          saveSettings();
          syncPanel();
          renderSampleCard();
          renderCurrentOverlay();
          window.showToast?.(`Applied ${STYLE_PRESETS[pKey].name}`);
        }
      });
    });

    // Color pickers with synced hex inputs
    const bindColorPicker = (colorInputId, hexInputId, key) => {
      const cEl = $(colorInputId);
      const hEl = $(hexInputId);
      if(!cEl || !hEl) return;

      cEl.addEventListener('input', e => {
        settings[key] = e.target.value;
        hEl.value = e.target.value;
        saveSettings();
        syncPanel(false);
        renderSampleCard();
        renderCurrentOverlay();
      });

      hEl.addEventListener('input', e => {
        let val = e.target.value.trim();
        if(val && !val.startsWith('#')) val = '#' + val;
        if(/^#[0-9A-Fa-f]{6}$/.test(val)){
          settings[key] = val;
          cEl.value = val;
          saveSettings();
          syncPanel(false);
          renderSampleCard();
          renderCurrentOverlay();
        }
      });
    };

    bindColorPicker('ssActiveColor', 'ssActiveColorHex', 'activeColor');
    bindColorPicker('ssTextColor', 'ssTextColorHex', 'textColor');
    bindColorPicker('ssKeywordColor', 'ssKeywordColorHex', 'keywordColor');
    bindColorPicker('ssBoxColor', 'ssBoxColorHex', 'boxBgColor');
    bindColorPicker('ssStrokeColor', 'ssStrokeColorHex', 'strokeColor');

    // Quick Swatches
    panel.querySelectorAll('.ss-swatch').forEach(sw => {
      sw.addEventListener('click', () => {
        const color = sw.dataset.color;
        const target = sw.dataset.target;
        if(color && target){
          settings[target] = color;
          saveSettings();
          syncPanel();
          renderSampleCard();
          renderCurrentOverlay();
        }
      });
    });

    bind('ssFontFamily', 'fontFamily');
    bind('ssCasing', 'textTransform');
    bind('ssGlowEffect', 'glowEffect');
    bind('ssAnimation', 'animation');
    bind('ssBoxOpacity', 'boxOpacity', v => Number(v) / 100);
    bind('ssBoxRadius', 'boxRadius', Number);
    bind('ssStrokeWidth', 'strokeWidth', Number);
    bind('ssKeywords', 'keywords');
    bind('ssY', 'positionY', Number);
    bind('ssFont', 'fontSize', Number);
    bind('ssWords', 'maxWords', Number);

    $('ssReset').addEventListener('click', () => {
      settings = { ...defaults };
      saveSettings();
      syncPanel();
      renderSampleCard();
      renderCurrentOverlay();
      window.showToast?.('Subtitle settings reset to default');
    });

    $('ssApply').addEventListener('click', () => {
      saveSettings();
      renderSampleCard();
      renderCurrentOverlay();
      window.showToast?.('Subtitle color & style saved for preview & export');
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
      $('ssFontFamily').value = settings.fontFamily || 'Impact, sans-serif';
      $('ssCasing').value = settings.textTransform || 'uppercase';
      $('ssGlowEffect').value = settings.glowEffect || 'shadow';
      $('ssAnimation').value = settings.animation || 'pop';
      $('ssBoxOpacity').value = Math.round((settings.boxOpacity ?? 0.9) * 100);
      $('ssBoxRadius').value = settings.boxRadius ?? 8;
      $('ssStrokeWidth').value = settings.strokeWidth ?? 0;
      $('ssY').value = settings.positionY;
      $('ssFont').value = settings.fontSize;
      $('ssWords').value = settings.maxWords;

      // Color pickers
      $('ssActiveColor').value = settings.activeColor || '#ffea00';
      $('ssActiveColorHex').value = settings.activeColor || '#ffea00';
      $('ssTextColor').value = settings.textColor || '#ffffff';
      $('ssTextColorHex').value = settings.textColor || '#ffffff';
      $('ssKeywordColor').value = settings.keywordColor || '#00f5d4';
      $('ssKeywordColorHex').value = settings.keywordColor || '#00f5d4';
      $('ssBoxColor').value = settings.boxBgColor || '#000000';
      $('ssBoxColorHex').value = settings.boxBgColor || '#000000';
      $('ssStrokeColor').value = settings.strokeColor || '#000000';
      $('ssStrokeColorHex').value = settings.strokeColor || '#000000';
    }

    $('ssActiveColorVal').textContent = settings.activeColor || '#ffea00';
    $('ssTextColorVal').textContent = settings.textColor || '#ffffff';
    $('ssKeywordColorVal').textContent = settings.keywordColor || '#00f5d4';
    $('ssBoxColorVal').textContent = settings.boxBgColor || '#000000';
    $('ssBoxOpacityV').textContent = Math.round((settings.boxOpacity ?? 0.9) * 100) + '%';
    $('ssBoxRadiusV').textContent = (settings.boxRadius ?? 8) + 'px';
    $('ssStrokeWidthV').textContent = (settings.strokeWidth ?? 0) + 'px';
    $('ssYV').textContent = settings.positionY + '%';
    $('ssFontV').textContent = settings.fontSize.toFixed(1) + 'vw';
    $('ssWordsV').textContent = settings.maxWords;

    // Highlight active preset button if matched
    p.querySelectorAll('.ss-preset-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.preset === settings.preset);
    });
  }

  function renderSampleCard(){
    const wordsContainer = document.getElementById('ssSampleWords');
    if(!wordsContainer) return;

    const sampleWords = [
      { text: 'HOW', kw: false },
      { text: 'TO', kw: false },
      { text: 'CREATE', kw: false },
      { text: 'VIRAL', kw: true },
      { text: 'VIDEOS', kw: false },
      { text: 'TODAY', kw: false }
    ];

    wordsContainer.innerHTML = sampleWords.map((item, idx) => {
      const active = (idx === sampleActiveWordIndex);
      const kw = settings.keywordHighlight && item.kw;
      const displayText = transformWordText(item.text, settings.textTransform);

      let style = `font-family:${settings.fontFamily || 'Impact, sans-serif'};font-weight:${settings.fontWeight || '800'};font-size:14px;`;

      // Stroke
      const strokeW = settings.style === 'outline' ? Math.max(2, settings.strokeWidth || 3) : (settings.strokeWidth || 0);
      if(strokeW > 0){
        style += `-webkit-text-stroke:${strokeW}px ${settings.strokeColor || '#000000'};`;
      }

      // Glow & Shadow
      if(settings.glowEffect === 'neon'){
        const glowColor = active ? (settings.activeColor || '#ffea00') : (kw ? (settings.keywordColor || '#00f5d4') : 'rgba(255,255,255,.6)');
        style += `text-shadow:0 0 10px ${glowColor}, 0 2px 4px rgba(0,0,0,.9);`;
      } else if(settings.glowEffect === 'shadow'){
        style += 'text-shadow:0 2px 6px rgba(0,0,0,.9), 0 1px 2px rgba(0,0,0,.8);';
      } else if(settings.glowEffect === 'heavy-outline'){
        style += `text-shadow:-1.5px -1.5px 0 #000, 1.5px -1.5px 0 #000, -1.5px 1.5px 0 #000, 1.5px 1.5px 0 #000;`;
      }

      // Word Box Background & Text Color
      if(settings.wordBoxes){
        if(active){
          style += `background:${settings.activeColor || '#ffea00'};color:${getContrastColor(settings.activeColor || '#ffea00')};`;
        } else {
          const bg = hexToRgba(settings.boxBgColor || '#000000', settings.boxOpacity ?? 0.9);
          style += `background:${bg};color:${kw ? (settings.keywordColor || '#00f5d4') : (settings.textColor || '#ffffff')};`;
        }
        style += `border-radius:${settings.boxRadius ?? 8}px;`;
      } else if(settings.style === 'karaoke'){
        if(active){
          style += `background:${settings.activeColor || '#7c5cff'};color:${getContrastColor(settings.activeColor || '#7c5cff')};border-radius:6px;`;
        } else {
          style += `background:transparent;color:${kw ? (settings.keywordColor || '#00f5d4') : (settings.textColor || '#ffffff')};`;
        }
      } else if(settings.style === 'outline'){
        style += `background:transparent;color:${active ? (settings.activeColor || '#ffd166') : (kw ? (settings.keywordColor || '#ff0055') : (settings.textColor || '#ffffff'))};`;
      } else {
        style += `background:transparent;color:${active ? (settings.activeColor || '#38bdf8') : (kw ? (settings.keywordColor || '#a855f7') : (settings.textColor || '#ffffff'))};`;
      }

      if(active){
        style += 'transform:scale(1.08);';
      }

      return `<span class="ss-sample-word ${active ? 'active' : ''}" style="${style}" data-sample-idx="${idx}">${esc(displayText)}</span>`;
    }).join('');

    // Bind click to test active word
    wordsContainer.querySelectorAll('.ss-sample-word').forEach(el => {
      el.addEventListener('click', () => {
        sampleActiveWordIndex = Number(el.dataset.sampleIdx);
        renderSampleCard();
      });
    });
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
            return;
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
      const displayText = transformWordText(w.word, settings.textTransform);

      let style = `font-family:${settings.fontFamily || 'Impact, sans-serif'};font-weight:${settings.fontWeight || '800'};font-size:clamp(14px, ${settings.fontSize || 5.2}vw, 56px);`;

      // Stroke
      const strokeW = settings.style === 'outline' ? Math.max(2, settings.strokeWidth || 3) : (settings.strokeWidth || 0);
      if(strokeW > 0){
        style += `-webkit-text-stroke:${strokeW}px ${settings.strokeColor || '#000000'};`;
      }

      // Glow & Shadow
      if(settings.glowEffect === 'neon'){
        const glowColor = active ? (settings.activeColor || '#ffea00') : (kw ? (settings.keywordColor || '#00f5d4') : 'rgba(255,255,255,.6)');
        style += `text-shadow:0 0 12px ${glowColor}, 0 2px 4px rgba(0,0,0,.9);`;
      } else if(settings.glowEffect === 'shadow'){
        style += 'text-shadow:0 3px 8px rgba(0,0,0,.9), 0 1px 2px rgba(0,0,0,.8);';
      } else if(settings.glowEffect === 'heavy-outline'){
        style += `text-shadow:-2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 2px 2px 0 #000;`;
      }

      // Box & text color
      if(settings.wordBoxes){
        if(active){
          style += `background:${settings.activeColor || '#ffea00'};color:${getContrastColor(settings.activeColor || '#ffea00')};`;
        } else {
          const bg = hexToRgba(settings.boxBgColor || '#000000', settings.boxOpacity ?? 0.9);
          style += `background:${bg};color:${kw ? (settings.keywordColor || '#00f5d4') : (settings.textColor || '#ffffff')};`;
        }
        style += `border-radius:${settings.boxRadius ?? 8}px;`;
      } else if(settings.style === 'karaoke'){
        if(active){
          style += `background:${settings.activeColor || '#7c5cff'};color:${getContrastColor(settings.activeColor || '#7c5cff')};border-radius:6px;`;
        } else {
          style += `background:transparent;color:${kw ? (settings.keywordColor || '#00f5d4') : (settings.textColor || '#ffffff')};`;
        }
      } else if(settings.style === 'outline'){
        style += `background:transparent;color:${active ? (settings.activeColor || '#ffd166') : (kw ? (settings.keywordColor || '#ff0055') : (settings.textColor || '#ffffff'))};`;
      } else {
        style += `background:transparent;color:${active ? (settings.activeColor || '#38bdf8') : (kw ? (settings.keywordColor || '#a855f7') : (settings.textColor || '#ffffff'))};`;
      }

      return `<span class="word ${active ? 'active' : ''} ${kw ? 'keyword' : ''}" style="${style}">${esc(displayText)}</span>`;
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
    const family = settings.fontFamily || 'Impact, sans-serif';
    const weight = settings.fontWeight || '800';
    ctx.font = `${weight} ${fs}px ${family}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';

    const gap = Math.round(fs * 0.28);
    const padX = Math.round(fs * 0.38);

    const boxes = visible.map((w, i) => {
      const active = (start + i === idx);
      const kw = settings.keywordHighlight && isKeyword(w.word);
      const text = transformWordText(w.word, settings.textTransform);
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
      const h = Math.round(fs * 1.38);
      const boxY = y - h / 2;

      // Draw word box if enabled
      if(settings.wordBoxes){
        if(b.active){
          ctx.fillStyle = settings.activeColor || '#ffea00';
        } else {
          ctx.fillStyle = hexToRgba(settings.boxBgColor || '#000000', settings.boxOpacity ?? 0.9);
        }
        if(settings.glowEffect === 'neon' && b.active){
          ctx.shadowColor = settings.activeColor || '#ffea00';
          ctx.shadowBlur = Math.round(fs * 0.45);
        } else if(settings.glowEffect === 'shadow'){
          ctx.shadowColor = 'rgba(0,0,0,0.7)';
          ctx.shadowBlur = Math.round(fs * 0.22);
        } else {
          ctx.shadowBlur = 0;
        }
        round(ctx, x, boxY, b.width, h, settings.boxRadius ?? 8);
        ctx.fill();
        ctx.shadowBlur = 0;
      } else if(settings.style === 'karaoke' && b.active){
        ctx.fillStyle = settings.activeColor || '#7c5cff';
        if(settings.glowEffect === 'neon'){
          ctx.shadowColor = settings.activeColor;
          ctx.shadowBlur = Math.round(fs * 0.4);
        }
        round(ctx, x, boxY, b.width, h, settings.boxRadius ?? 6);
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      // Draw text stroke if outline or strokeWidth > 0
      const strokeW = settings.style === 'outline' 
        ? Math.max(3, settings.strokeWidth || Math.round(fs * 0.12))
        : (settings.strokeWidth || 0);

      if(strokeW > 0){
        ctx.save();
        ctx.strokeStyle = settings.strokeColor || '#000000';
        ctx.lineWidth = strokeW;
        ctx.lineJoin = 'round';
        ctx.strokeText(b.text, x + padX, y);
        ctx.restore();
      }

      // Fill text color
      if(settings.wordBoxes && b.active){
        ctx.fillStyle = getContrastColor(settings.activeColor || '#ffea00');
      } else if(settings.style === 'karaoke' && b.active){
        ctx.fillStyle = getContrastColor(settings.activeColor || '#7c5cff');
      } else if(b.kw){
        ctx.fillStyle = settings.keywordColor || '#00f5d4';
      } else {
        ctx.fillStyle = settings.textColor || '#ffffff';
      }

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
    setSettings: (s) => {
      settings = { ...settings, ...s };
      saveSettings();
      syncPanel();
      renderSampleCard();
      renderCurrentOverlay();
    },
    refreshWordList,
    renderCurrentOverlay,
    openPanel: () => {
      makePanel();
      syncPanel();
      renderSampleCard();
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
