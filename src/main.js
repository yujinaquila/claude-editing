
import './styles.css';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

// Transformers.js is loaded only in the browser. Keeping it out of the npm
// dependency tree prevents Vercel from trying to install onnxruntime-node,
// which is not needed for this browser-only ASR implementation.
const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0/+esm';
let transformersModule = null;

const MODEL = 'onnx-community/whisper-small';

const state = {
  lang: 'en',
  assets: [],
  selectedAsset: null,
  transcript: [],
  plan: {
    aspect: '9:16',
    duration: 30,
    captions: true,
    autoCut: true,
    hook: true,
    target: 'marketing'
  },
  ffmpeg: null,
  ffmpegReady: false,
  transcriber: null,
  outputUrl: null,
  playing: false,
  renderBusy: false
};

const $ = (s) => document.querySelector(s);
const app = $('#app');

app.innerHTML = `
<div class="app">
  <header class="topbar">
    <div class="brand">
      <div class="logo">✦</div>
      <div>CLAUDE EDITING <small>AI MARKETING VIDEO EDITOR</small></div>
    </div>
    <div class="top-actions">
      <select class="select" id="langSelect">
        <option value="en">EN</option>
        <option value="id">ID</option>
      </select>
      <button class="btn hide-mobile" id="newBtn">New</button>
      <button class="btn" id="importBtn">Import</button>
      <button class="btn primary" id="renderBtn" disabled>Render / Export</button>
      <input id="fileInput" type="file" accept="video/*,audio/*" multiple hidden>
    </div>
  </header>

  <div class="workspace">
    <aside class="panel left">
      <div class="panel-head">MEDIA <span id="assetCount">0 clips</span></div>
      <div class="media-body">
        <div class="media-actions">
          <button class="btn primary" id="addMedia">+ Media</button>
          <button class="btn" id="pickBest">AI Pick</button>
        </div>
        <div id="assets"></div>
      </div>
    </aside>

    <main class="center">
      <section class="preview">
        <div class="preview-badge" id="engineBadge">LOCAL AI • READY</div>
        <div class="preview-ratio" id="ratioBadge">9:16</div>
        <div class="preview-empty" id="previewEmpty">
          <div>
            <strong>Prompt → Edit</strong>
            Import your footage, then tell the editor what you want.
            <br><br>
            Try: “Make a 25s TikTok ad with a strong Indonesian hook, fast cuts and bold captions.”
          </div>
        </div>
        <video id="previewVideo" playsinline></video>
      </section>

      <div class="transport">
        <button class="btn icon" id="playBtn">▶</button>
        <button class="btn icon" id="backBtn">−5</button>
        <button class="btn icon" id="fwdBtn">+5</button>
        <input class="seek" id="seek" type="range" min="0" max="100" value="0" step=".01">
        <span class="time" id="time">00:00 / 00:00</span>
      </div>
    </main>

    <aside class="panel right">
      <div class="panel-head">AI INSPECTOR <span id="planLabel">Marketing</span></div>
      <div class="inspector">
        <div class="ai">
          <div class="ai-row">
            <textarea id="prompt" placeholder="Describe your edit... / Jelaskan edit yang kamu mau..."></textarea>
          </div>
          <div class="ai-actions">
            <select class="select" id="template"></select>
            <button class="btn primary" id="runAI">Build Edit</button>
          </div>
          <div class="chips" id="chips"></div>
        </div>

        <div class="inspector-section">
          <div class="label">Format</div>
          <div class="grid2">
            <div class="field">
              <label>Aspect</label>
              <select id="aspect">
                <option value="9:16">9:16 Vertical</option>
                <option value="1:1">1:1 Square</option>
                <option value="16:9">16:9 Landscape</option>
              </select>
            </div>
            <div class="field">
              <label>Target sec</label>
              <input id="duration" type="number" min="5" max="180" value="30">
            </div>
          </div>
          <div class="toggle">Auto captions <span class="switch on" id="captionSwitch"></span></div>
          <div class="toggle">Auto cut silence <span class="switch on" id="cutSwitch"></span></div>
          <div class="toggle">Auto hook <span class="switch on" id="hookSwitch"></span></div>
        </div>

        <div class="inspector-section">
          <div class="label">Transcript / Subtitles</div>
          <div class="transcript" id="transcript">
            <div class="status"><span class="dot"></span>No transcript yet.</div>
          </div>
          <button class="btn" id="transcribeBtn" style="width:100%;margin-top:8px" disabled>Transcribe selected clip</button>
        </div>

        <div class="inspector-section">
          <div class="label">AI status</div>
          <div class="status"><span class="dot" id="statusDot"></span><span id="statusText">Ready</span></div>
          <div class="progress"><div id="progressBar"></div></div>
        </div>
      </div>
    </aside>
  </div>

  <section class="timeline">
    <div class="timeline-tools">
      <span class="label">TIMELINE</span>
      <button class="btn" id="autoCutBtn">Auto Cut</button>
      <button class="btn" id="hookBtn">Auto Hook</button>
      <button class="btn" id="subtitleBtn">SRT</button>
      <span style="flex:1"></span>
      <span class="status"><span class="dot"></span> Browser render</span>
    </div>
    <div class="tracks">
      <div class="track">
        <div class="track-name">VIDEO</div>
        <div class="track-lane" id="videoTrack"></div>
      </div>
      <div class="track caption-track">
        <div class="track-name">CAPTION</div>
        <div class="track-lane" id="captionTrack"></div>
      </div>
    </div>
  </section>
</div>
<div class="toast" id="toast"></div>
<div class="drop-overlay" id="dropOverlay">Drop video clips to import</div>
`;

const templates = {
  en: [
    ['viral', 'Viral TikTok Hook', 'Make a 20–30s TikTok with a hard hook in the first 2 seconds, remove dead air, fast cuts, bold captions, and end with a CTA.'],
    ['ugc', 'UGC Product Ad', 'Turn this footage into a 25s UGC-style product ad. Keep the strongest problem → solution → proof → CTA moments.'],
    ['reels', 'Instagram Reels', 'Create a punchy 30s Reel. Pick the best scenes, remove silence, add readable captions and a clean CTA.'],
    ['talking', 'Talking Head', 'Turn this talking-head footage into a concise vertical video. Remove pauses, filler words and weak sentences while keeping the speaker natural.'],
    ['promo', 'Product Promo', 'Create a premium short marketing video with the strongest product visuals, a clear hook, captions and a direct CTA.']
  ],
  id: [
    ['viral', 'TikTok Viral', 'Buat TikTok 20–30 detik dengan hook kuat dalam 2 detik pertama, hapus jeda, potongan cepat, caption tebal, dan CTA di akhir.'],
    ['ugc', 'Iklan Produk UGC', 'Ubah footage menjadi iklan UGC 25 detik. Pilih momen problem → solusi → bukti → CTA yang paling kuat.'],
    ['reels', 'Instagram Reels', 'Buat Reel 30 detik yang padat. Pilih scene terbaik, hapus jeda, tambahkan caption mudah dibaca dan CTA.'],
    ['talking', 'Talking Head', 'Ubah footage talking-head menjadi video vertikal singkat. Hapus jeda, filler word, dan kalimat lemah tanpa membuat pembicara terasa kaku.'],
    ['promo', 'Promo Produk', 'Buat video marketing pendek yang premium dengan visual produk terbaik, hook jelas, caption, dan CTA langsung.']
  ]
};

function fillTemplates() {
  const lang = state.lang;
  $('#template').innerHTML = templates[lang].map(t => `<option value="${t[0]}">${t[1]}</option>`).join('');
  $('#chips').innerHTML = templates[lang].map(t => `<button class="chip" data-template="${t[0]}">${t[1]}</button>`).join('');
  $('#chips').querySelectorAll('.chip').forEach(b => b.onclick = () => {
    const t = templates[lang].find(x => x[0] === b.dataset.template);
    $('#prompt').value = t[2];
  });
}
fillTemplates();

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 4200);
}

function status(text, kind='ready') {
  $('#statusText').textContent = text;
  $('#statusDot').className = `dot ${kind === 'busy' ? 'busy' : kind === 'error' ? 'error' : ''}`;
}

function progress(n) {
  $('#progressBar').style.width = `${Math.max(0, Math.min(100, n))}%`;
}

function fmt(sec) {
  sec = Math.max(0, Number(sec) || 0);
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function getAspectSize(aspect) {
  if (aspect === '9:16') return [1080,1920];
  if (aspect === '1:1') return [1080,1080];
  return [1920,1080];
}

function escapeHtml(s) {
  return String(s).replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
}

function renderAssets() {
  $('#assetCount').textContent = `${state.assets.length} clip${state.assets.length === 1 ? '' : 's'}`;
  $('#assets').innerHTML = state.assets.length ? state.assets.map((a,i) => `
    <div class="asset" data-id="${a.id}">
      <video class="thumb" src="${a.url}" muted></video>
      <div>
        <div class="asset-name">${escapeHtml(a.file.name)}</div>
        <div class="asset-meta">${fmt(a.duration)} • ${formatBytes(a.file.size)}</div>
      </div>
    </div>
  `).join('') : `<div class="status" style="padding:18px 4px">No footage imported.</div>`;
  $('#assets').querySelectorAll('.asset').forEach(el => {
    el.onclick = () => selectAsset(el.dataset.id);
  });
}

function formatBytes(n) {
  if (!n) return '0 B';
  const u=['B','KB','MB','GB'];
  const i=Math.min(3,Math.floor(Math.log(n)/Math.log(1024)));
  return `${(n/1024**i).toFixed(1)} ${u[i]}`;
}

async function addFiles(files) {
  const arr = [...files].filter(f => f.type.startsWith('video/'));
  if (!arr.length) return;
  for (const file of arr) {
    const url = URL.createObjectURL(file);
    const duration = await new Promise(resolve => {
      const v = document.createElement('video');
      v.preload='metadata';
      v.onloadedmetadata=()=>{ URL.revokeObjectURL(v.src); resolve(v.duration || 0); };
      v.onerror=()=>{ URL.revokeObjectURL(v.src); resolve(0); };
      v.src=url;
    });
    const asset = { id: crypto.randomUUID(), file, url, duration, transcript: [] };
    state.assets.push(asset);
  }
  renderAssets();
  if (!state.selectedAsset) selectAsset(state.assets[0].id);
  $('#renderBtn').disabled = false;
  toast(`${arr.length} clip${arr.length>1?'s':''} imported.`);
}

function selectAsset(id) {
  const a = state.assets.find(x => x.id === id);
  if (!a) return;
  state.selectedAsset = a;
  const v = $('#previewVideo');
  v.src = a.url;
  v.style.display='block';
  $('#previewEmpty').style.display='none';
  v.load();
  $('#transcribeBtn').disabled=false;
  if (a.transcript?.length) {
    state.transcript=a.transcript;
    renderTranscript();
  } else {
    state.transcript=[];
    renderTranscript();
  }
  renderTimeline();
}

function renderTimeline() {
  const track = $('#videoTrack');
  const max = Math.max(1, ...state.assets.map(a=>a.duration||0));
  track.innerHTML = state.assets.map((a,i) => {
    const left = state.assets.slice(0,i).reduce((s,x)=>s+(x.duration||0),0);
    const width = Math.max(4,(a.duration/max)*100);
    const l = (left/max)*100;
    return `<div class="clip ${state.selectedAsset?.id===a.id?'active':''}" style="left:${l}%;width:${width}%" data-id="${a.id}">
      <b>${escapeHtml(a.file.name)}</b><small>${fmt(a.duration)}</small>
    </div>`;
  }).join('');
  track.querySelectorAll('.clip').forEach(c=>c.onclick=()=>selectAsset(c.dataset.id));
  const cap = $('#captionTrack');
  cap.innerHTML = state.transcript.slice(0,80).map(seg => {
    const maxT = state.selectedAsset?.duration || 1;
    const l = (seg.start/maxT)*100;
    const w = Math.max(2,((seg.end-seg.start)/maxT)*100);
    return `<div class="clip" style="left:${l}%;width:${w}%"><b>${escapeHtml(seg.text)}</b></div>`;
  }).join('');
}

function renderTranscript() {
  const box = $('#transcript');
  if (!state.transcript.length) {
    box.innerHTML='<div class="status"><span class="dot"></span>No transcript yet.</div>';
    renderTimeline();
    return;
  }
  box.innerHTML = state.transcript.map((s,i)=>`
    <div class="segment" data-i="${i}">
      <span class="stamp">${fmt(s.start)}–${fmt(s.end)}</span>
      <span class="txt">${escapeHtml(s.text)}</span>
    </div>`).join('');
  box.querySelectorAll('.segment').forEach(el => el.onclick=()=>{
    if(state.selectedAsset) $('#previewVideo').currentTime=state.transcript[Number(el.dataset.i)].start;
  });
  renderTimeline();
}

async function ensureFFmpeg() {
  if (state.ffmpegReady) return state.ffmpeg;
  status('Loading render engine…','busy');
  const ff = new FFmpeg();
  ff.on('log', ({ message }) => console.debug('[FFmpeg]', message));
  ff.on('progress', ({ progress:p }) => progress(Math.round(p*100)));
  state.ffmpeg = ff;
  try {
    const coreBase = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm';
    await ff.load({
      coreURL: `${coreBase}/ffmpeg-core.js`,
      wasmURL: `${coreBase}/ffmpeg-core.wasm`,
      classWorkerURL: `${location.origin}/ffmpeg/worker.js`
    });
  } catch (e) {
    console.error(e);
    state.ffmpeg = null;
    state.ffmpegReady = false;
    status('Render engine failed','error');
    throw new Error(`FFmpeg could not start. Make sure /public/ffmpeg/worker.js is deployed. ${e?.message || e}`);
  }
  state.ffmpegReady=true;
  status('Render engine ready');
  return ff;
}

async function ensureTranscriber() {
  if (state.transcriber) return state.transcriber;
  status('Loading local Whisper AI…','busy');
  toast('First transcription downloads the free multilingual Whisper model and may take a while.');
  try {
    if (!transformersModule) {
      transformersModule = await import(/* @vite-ignore */ TRANSFORMERS_URL);
      transformersModule.env.allowLocalModels = false;
      transformersModule.env.useBrowserCache = true;
    }
    const { pipeline } = transformersModule;
    const device = navigator.gpu ? 'webgpu' : 'wasm';
    state.transcriber = await pipeline('automatic-speech-recognition', MODEL, {
      device,
      dtype: device === 'webgpu' ? 'q4' : 'q8',
      progress_callback: (x) => {
        if (typeof x?.progress === 'number') progress(Math.round(x.progress));
      }
    });
  } catch (e) {
    console.warn('WebGPU Whisper failed, retrying WASM', e);
    if (!transformersModule) {
      transformersModule = await import(/* @vite-ignore */ TRANSFORMERS_URL);
      transformersModule.env.allowLocalModels = false;
      transformersModule.env.useBrowserCache = true;
    }
    state.transcriber = await transformersModule.pipeline('automatic-speech-recognition', MODEL, { device:'wasm', dtype:'q8' });
  }
  status('Whisper AI ready');
  return state.transcriber;
}

async function extractAudioData(asset) {
  const buffer = await asset.file.arrayBuffer();
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!AudioCtx || !OfflineCtx) throw new Error('This browser does not support Web Audio decoding.');

  const ctx = new AudioCtx();
  let decoded;
  try {
    decoded = await ctx.decodeAudioData(buffer.slice(0));
  } finally {
    try { await ctx.close(); } catch {}
  }

  const targetRate = 16000;
  const frames = Math.max(1, Math.ceil(decoded.duration * targetRate));
  const offline = new OfflineCtx(1, frames, targetRate);
  const source = offline.createBufferSource();
  const mono = offline.createBuffer(1, decoded.length, decoded.sampleRate);
  const out = mono.getChannelData(0);
  if (decoded.numberOfChannels === 1) {
    out.set(decoded.getChannelData(0));
  } else {
    for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
      const data = decoded.getChannelData(ch);
      for (let i = 0; i < out.length; i++) out[i] += data[i] / decoded.numberOfChannels;
    }
  }
  source.buffer = mono;
  source.connect(offline.destination);
  source.start(0);
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0).slice();
}

async function transcribeSelected() {
  if (!state.selectedAsset) return;
  const asset=state.selectedAsset;
  $('#transcribeBtn').disabled=true;
  try {
    status('Decoding audio…','busy'); progress(5);
    const audio=await extractAudioData(asset);
    progress(25);
    status('Loading local Whisper AI…','busy');
    const pipe=await ensureTranscriber();
    status('Transcribing with local Whisper…','busy'); progress(35);
    const result=await pipe(audio,{
      chunk_length_s:30,
      stride_length_s:5,
      return_timestamps:true,
      language: state.lang === 'id' ? 'indonesian' : 'english',
      task: 'transcribe'
    });
    const chunks=result.chunks||[];
    state.transcript=chunks.map(c=>({
      start:Number(c.timestamp?.[0] ?? 0),
      end:Number(c.timestamp?.[1] ?? 0),
      text:String(c.text||'').trim()
    })).filter(x=>x.text && Number.isFinite(x.start));
    asset.transcript=state.transcript;
    progress(100);
    renderTranscript();
    status(`Transcript ready • ${state.transcript.length} segments`);
    toast(state.lang==='id'?'Transkrip selesai.':'Transcript complete.');
  } catch(e) {
    console.error(e);
    status('Transcription failed','error');
    toast(`Transcription failed: ${e?.message||e}`);
  } finally {
    $('#transcribeBtn').disabled=!state.selectedAsset;
  }
}

function buildPlan(prompt) {
  const p=(prompt||'').toLowerCase();
  const id = /buat|bikin|bahasa indonesia|indonesia|detik|iklan|jualan|reels|tiktok|vertikal/.test(p);
  let duration=state.plan.duration;
  const m=p.match(/(\d+)\s*(s|sec|second|seconds|detik)/);
  if(m) duration=Math.max(5,Math.min(180,Number(m[1])));
  let aspect=state.plan.aspect;
  if (/9\s*:\s*16|vertical|tiktok|reels|shorts|vertikal/.test(p)) aspect='9:16';
  if (/1\s*:\s*1|square|kotak/.test(p)) aspect='1:1';
  if (/16\s*:\s*9|landscape|youtube|horizontal/.test(p)) aspect='16:9';
  const captions=!/(no captions|without captions|tanpa caption)/.test(p);
  const autoCut=!/(keep pauses|no cuts|jangan potong)/.test(p);
  const hook=!/(no hook|tanpa hook)/.test(p);
  let target='marketing';
  if(/ugc/.test(p)) target='ugc';
  if(/talking|talking head|podcast|wawancara/.test(p)) target='talking-head';
  if(/product|produk|jualan|ad|iklan/.test(p)) target='product-ad';
  return {aspect,duration,captions,autoCut,hook,target,language:id?'id':'en'};
}

function applyPlan(plan) {
  state.plan=plan;
  $('#aspect').value=plan.aspect;
  $('#duration').value=plan.duration;
  $('#ratioBadge').textContent=plan.aspect;
  $('#planLabel').textContent=plan.target;
  $('#captionSwitch').classList.toggle('on',plan.captions);
  $('#cutSwitch').classList.toggle('on',plan.autoCut);
  $('#hookSwitch').classList.toggle('on',plan.hook);
}

function bestHook() {
  if (!state.transcript.length) return null;
  const candidates=state.transcript.filter(s=>s.end-s.start<=7 && s.text.length>=15);
  const words=['why','how','secret','mistake','stop','best','you','ini','cara','jangan','kenapa','rahasia','salah','terbaik','ternyata'];
  return [...(candidates.length?candidates:state.transcript)].sort((a,b)=>{
    const score=x=>x.text.length + words.reduce((n,w)=>n+(x.text.toLowerCase().includes(w)?18:0),0);
    return score(b)-score(a);
  })[0] || null;
}

function autoCutSegments() {
  if (!state.transcript.length) return [];
  const out=[];
  for(const s of state.transcript){
    if(!s.text) continue;
    const start=Math.max(0,s.start-.12);
    const end=Math.min(state.selectedAsset?.duration||s.end,s.end+.18);
    if(!out.length || start-out[out.length-1].end>.65) out.push({start,end});
    else out[out.length-1].end=Math.max(out[out.length-1].end,end);
  }
  return out;
}

function pickBestAssets() {
  if(!state.assets.length) return;
  const useful=['product','result','before','after','how','why','cara','produk','hasil','masalah','solution','solusi','buy','beli'];
  const ranked=state.assets.map(a=>{
    const text=(a.transcript||[]).map(s=>s.text).join(' ').toLowerCase();
    const density=text.length/Math.max(1,a.duration);
    const keyword=useful.reduce((n,k)=>n+(text.includes(k)?1:0),0);
    const durationScore=(a.duration>=3&&a.duration<=60)?1:0;
    return {a,score:density*.65+keyword*.12+durationScore*.23};
  }).sort((x,y)=>y.score-x.score);
  const winner=ranked[0].a;
  selectAsset(winner.id);
  toast(`AI Pick: ${winner.file.name}`);
}

function autoHook() {
  const hook=bestHook();
  if(!hook){toast(state.lang==='id'?'Transkrip dulu untuk membuat hook.':'Transcribe first to generate a hook.');return;}
  $('#previewVideo').currentTime=hook.start;
  toast(`${state.lang==='id'?'Hook terbaik':'Best hook'}: “${hook.text}”`);
}

function exportSRT() {
  if(!state.transcript.length){toast('No transcript to export.');return;}
  const stamp=t=>{
    const ms=Math.floor((t%1)*1000);
    const whole=Math.floor(t);
    const s=whole%60,m=Math.floor(whole/60);
    return `00:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(ms).padStart(3,'0')}`;
  };
  const srt=state.transcript.map((s,i)=>`${i+1}\n${stamp(s.start)} --> ${stamp(s.end)}\n${s.text}\n`).join('\n');
  const blob=new Blob([srt],{type:'text/plain'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='captions.srt';a.click();
}

async function renderVideo() {
  if(!state.selectedAsset || state.renderBusy) return;
  state.renderBusy=true;
  $('#renderBtn').disabled=true;
  try {
    const ff=await ensureFFmpeg();
    const asset=state.selectedAsset;
    const ext=(asset.file.name.split('.').pop()||'mp4').toLowerCase();
    const input=`source.${ext}`;
    const output='claude-edit.mp4';
    await ff.writeFile(input,await fetchFile(asset.file));
    const [w,h]=getAspectSize(state.plan.aspect);
    const cuts=state.plan.autoCut?autoCutSegments():[{start:0,end:Math.min(asset.duration,state.plan.duration)}];
    let start=cuts.length?cuts[0].start:0;
    let end=cuts.length?cuts[Math.min(cuts.length-1,Math.max(0,Math.floor(state.plan.duration/5)))].end:Math.min(asset.duration,state.plan.duration);
    if(end<=start) end=Math.min(asset.duration,start+state.plan.duration);
    const duration=Math.min(state.plan.duration,end-start);
    status('Rendering marketing video…','busy');progress(5);
    await ff.exec([
      '-ss',String(start),
      '-i',input,
      '-t',String(duration),
      '-vf',`scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},fps=30`,
      '-c:v','libx264','-preset','veryfast','-crf','23',
      '-c:a','aac','-b:a','128k',
      '-movflags','+faststart',
      output
    ]);
    const data=await ff.readFile(output);
    const blob=new Blob([data instanceof Uint8Array ? data : new Uint8Array(data)],{type:'video/mp4'});
    if(state.outputUrl)URL.revokeObjectURL(state.outputUrl);
    state.outputUrl=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=state.outputUrl;a.download=`claude-${state.plan.aspect.replace(':','x')}-marketing.mp4`;a.click();
    try{await ff.deleteFile(input);await ff.deleteFile(output)}catch{}
    progress(100);status('Render complete');toast('MP4 rendered and exported.');
  }catch(e){
    console.error(e);status('Render failed','error');toast(`Render failed: ${e.message||e}`);
  }finally{
    state.renderBusy=false;$('#renderBtn').disabled=!state.assets.length;
  }
}

$('#importBtn').onclick=()=>$('#fileInput').click();
$('#addMedia').onclick=()=>$('#fileInput').click();
$('#fileInput').onchange=e=>addFiles(e.target.files);
$('#pickBest').onclick=pickBestAssets;
$('#transcribeBtn').onclick=transcribeSelected;
$('#subtitleBtn').onclick=exportSRT;
$('#hookBtn').onclick=autoHook;
$('#autoCutBtn').onclick=()=>{
  if(!state.transcript.length){toast('Transcribe a clip first.');return;}
  const cuts=autoCutSegments();
  toast(`Auto Cut found ${cuts.length} spoken regions.`);
};
$('#renderBtn').onclick=renderVideo;

$('#runAI').onclick=()=>{
  const plan=buildPlan($('#prompt').value);
  applyPlan(plan);
  toast(state.lang==='id'?'Rencana edit AI dibuat.':'AI edit plan created.');
};

$('#template').onchange=e=>{
  const t=templates[state.lang].find(x=>x[0]===e.target.value);
  if(t)$('#prompt').value=t[2];
};

$('#aspect').onchange=e=>{state.plan.aspect=e.target.value;$('#ratioBadge').textContent=e.target.value};
$('#duration').onchange=e=>state.plan.duration=Number(e.target.value)||30;

$('#captionSwitch').onclick=()=>{$('#captionSwitch').classList.toggle('on');state.plan.captions=$('#captionSwitch').classList.contains('on')};
$('#cutSwitch').onclick=()=>{$('#cutSwitch').classList.toggle('on');state.plan.autoCut=$('#cutSwitch').classList.contains('on')};
$('#hookSwitch').onclick=()=>{$('#hookSwitch').classList.toggle('on');state.plan.hook=$('#hookSwitch').classList.contains('on')};

$('#langSelect').onchange=e=>{
  state.lang=e.target.value;fillTemplates();
  toast(state.lang==='id'?'Bahasa Indonesia aktif.':'English mode active.');
};

$('#newBtn').onclick=()=>{
  state.assets.forEach(a=>URL.revokeObjectURL(a.url));
  state.assets=[];state.selectedAsset=null;state.transcript=[];
  $('#previewVideo').removeAttribute('src');$('#previewVideo').style.display='none';$('#previewEmpty').style.display='grid';
  $('#renderBtn').disabled=true;renderAssets();renderTranscript();renderTimeline();
};

$('#playBtn').onclick=()=>{
  const v=$('#previewVideo');
  if(!v.src)return;
  if(v.paused)v.play();else v.pause();
};
$('#backBtn').onclick=()=>{$('#previewVideo').currentTime=Math.max(0,$('#previewVideo').currentTime-5)};
$('#fwdBtn').onclick=()=>{$('#previewVideo').currentTime=Math.min($('#previewVideo').duration||0,$('#previewVideo').currentTime+5)};
$('#previewVideo').ontimeupdate=()=>{
  const v=$('#previewVideo');const d=v.duration||0;
  $('#seek').max=d;$('#seek').value=v.currentTime;$('#time').textContent=`${fmt(v.currentTime)} / ${fmt(d)}`;
};
$('#seek').oninput=e=>$('#previewVideo').currentTime=Number(e.target.value);

['dragenter','dragover'].forEach(ev=>document.addEventListener(ev,e=>{
  if([...e.dataTransfer?.types||[]].includes('Files')){$('#dropOverlay').classList.add('show');e.preventDefault();}
}));
['dragleave','drop'].forEach(ev=>document.addEventListener(ev,e=>{
  if(ev==='drop') {e.preventDefault();addFiles(e.dataTransfer.files);}
  $('#dropOverlay').classList.remove('show');
}));

renderAssets();renderTranscript();renderTimeline();
