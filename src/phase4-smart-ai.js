/**
 * ClipForge Phase 4 — Smart AI Editing Engine
 * Provider-agnostic, deterministic-first editing pipeline.
 *
 * Features:
 * - Auto Cut: silence + low-energy removal with speech protection
 * - Auto Highlight: ranks energetic and content-rich moments
 * - Auto Hook: selects strongest opening moment
 * - Best Scene: scores visual/audio/transcript candidates
 * - Auto Edit All: combines multiple source videos into one EDL
 *
 * The engine works without a paid AI provider. If /api/ai is configured,
 * it can optionally refine the deterministic Edit Decision List.
 */
(() => {
  const state = window.ClipForgeSmartAI = window.ClipForgeSmartAI || {
    analyses: new Map(),
    lastEdit: null,
    busy: false
  };

  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const median = arr => {
    if (!arr.length) return 0;
    const a = [...arr].sort((x,y)=>x-y);
    const m = Math.floor(a.length/2);
    return a.length % 2 ? a[m] : (a[m-1]+a[m])/2;
  };
  const normalize = values => {
    const max = Math.max(...values, 0.00001);
    return values.map(v => clamp(v / max, 0, 1));
  };
  const uid = () => `ai_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;

  function getEditor() {
    return window.editorState || window.appState || window.state || null;
  }

  function toast(msg) {
    const t = document.querySelector('#toast');
    if (t) {
      t.textContent = msg;
      t.classList.add('show');
      clearTimeout(toast._timer);
      toast._timer = setTimeout(()=>t.classList.remove('show'), 4000);
    } else console.log('[ClipForge AI]', msg);
  }

  function setStatus(msg) {
    const e = document.querySelector('#statusText');
    if (e) e.textContent = msg;
  }

  function getFiles() {
    // Support several existing editor data shapes.
    const candidates = [
      window.mediaFiles,
      window.importedFiles,
      window.filesByName ? [...window.filesByName.values()] : null,
      getEditor()?.media,
      getEditor()?.assets
    ].filter(Boolean);
    const first = candidates.find(x => Array.isArray(x) ? x.length : x.size);
    if (!first) return [];
    return Array.isArray(first) ? first : [...first.values()];
  }

  async function decodeAudio(file) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) throw new Error('Web Audio is not supported.');
    const ctx = new Ctx();
    try {
      const buf = await file.arrayBuffer();
      return await ctx.decodeAudioData(buf.slice(0));
    } finally {
      try { await ctx.close(); } catch {}
    }
  }

  function audioWindows(buffer, windowSeconds = 0.5) {
    const sr = buffer.sampleRate;
    const size = Math.max(1, Math.floor(sr * windowSeconds));
    const channels = Array.from({length: buffer.numberOfChannels}, (_,i)=>buffer.getChannelData(i));
    const out = [];
    for (let start=0; start<buffer.length; start += size) {
      const end = Math.min(buffer.length, start + size);
      let sum = 0, count = 0, peak = 0;
      for (const data of channels) {
        for (let i=start;i<end;i++) {
          const x = data[i] || 0;
          sum += x*x;
          peak = Math.max(peak, Math.abs(x));
          count++;
        }
      }
      const rms = Math.sqrt(sum / Math.max(1,count));
      out.push({start:start/sr, end:end/sr, rms, peak});
    }
    return out;
  }

  function detectSilence(windows) {
    const energies = windows.map(w=>w.rms);
    const floor = median(energies);
    const threshold = Math.max(0.004, floor * 0.55);
    return windows.map(w => ({...w, silent:w.rms < threshold, threshold}));
  }

  function buildMoments(windows, transcripts=[]) {
    const values = normalize(windows.map(w => w.rms));
    return windows.map((w,i)=>{
      const speech = transcripts.some(s => Number(s.start) < w.end && Number(s.end) > w.start) ? 1 : 0;
      const localPeak = Math.max(values[i]||0, values[i-1]||0, values[i+1]||0);
      const energy = values[i] || 0;
      const highlight = clamp(energy*0.60 + localPeak*0.20 + speech*0.20, 0, 1);
      return {
        id: uid(),
        start:w.start, end:w.end,
        energy, speech,
        highlight,
        silent: !!w.silent
      };
    });
  }

  function mergeRanges(ranges, gap=0.18) {
    const sorted = [...ranges].sort((a,b)=>a.start-b.start);
    const out = [];
    for (const r of sorted) {
      if (!out.length || r.start > out[out.length-1].end + gap) out.push({...r});
      else {
        const prev = out[out.length-1];
        prev.end = Math.max(prev.end, r.end);
        prev.score = Math.max(prev.score||0, r.score||0);
      }
    }
    return out;
  }

  function transcriptScore(transcripts, start, end) {
    const words = transcripts
      .filter(s => Number(s.start) < end && Number(s.end) > start)
      .map(s => String(s.text || '').toLowerCase())
      .join(' ');
    if (!words) return 0;
    let score = Math.min(1, words.length / 120);
    const hookWords = ['how','why','secret','best','stop','wait','look','imagine','never','must','free','easy','fast','new'];
    if (hookWords.some(w => words.includes(w))) score += 0.25;
    if (/[!?]/.test(words)) score += 0.1;
    return clamp(score,0,1);
  }

  function makeCandidates(analysis) {
    const windows = analysis.moments;
    const candidates = [];
    const span = 3; // 3 seconds candidate windows
    for (let i=0;i<windows.length;i+=2) {
      const first = windows[i];
      const start = first.start;
      const end = Math.min(analysis.duration, start + span);
      const slice = windows.filter(w=>w.start < end && w.end > start);
      if (!slice.length) continue;
      const energy = slice.reduce((a,w)=>a+w.energy,0)/slice.length;
      const speech = slice.reduce((a,w)=>a+w.speech,0)/slice.length;
      const silentRatio = slice.filter(w=>w.silent).length/slice.length;
      const text = transcriptScore(analysis.transcript,start,end);
      const score = clamp(
        energy*0.40 +
        speech*0.20 +
        text*0.30 +
        (1-silentRatio)*0.10,
        0,1
      );
      candidates.push({
        id:uid(), fileId:analysis.fileId, fileName:analysis.fileName,
        start,end,energy,speech,text,silentRatio,score
      });
    }
    return candidates.sort((a,b)=>b.score-a.score);
  }

  async function analyzeFile(file, index=0) {
    setStatus(`Analyzing ${file.name || `clip ${index+1}`}…`);
    const transcript =
      window.__clipForgeCloudTranscriptByFile?.[file.name] ||
      window.__clipForgeCloudTranscript ||
      window.transcriptSegments ||
      [];

    const audio = await decodeAudio(file);
    const raw = audioWindows(audio, 0.5);
    const silenced = detectSilence(raw);
    const moments = buildMoments(silenced, transcript);
    const analysis = {
      fileId: file.id || file.name || `file_${index}`,
      fileName: file.name || `Clip ${index+1}`,
      duration: audio.duration,
      transcript,
      moments,
      candidates: null
    };
    analysis.candidates = makeCandidates(analysis);
    state.analyses.set(analysis.fileId, analysis);
    return analysis;
  }

  async function analyzeAll(files=getFiles()) {
    if (!files.length) throw new Error('Import videos before running Smart AI Edit.');
    const analyses = [];
    for (let i=0;i<files.length;i++) analyses.push(await analyzeFile(files[i],i));
    return analyses;
  }

  function autoCut(analysis) {
    // Keep speech and meaningful audio, trim long silent runs.
    const keep = [];
    let run = null;
    for (const m of analysis.moments) {
      const meaningful = !m.silent || m.speech || m.energy > 0.16;
      if (meaningful) {
        if (!run) run = {start:m.start, end:m.end, score:m.highlight};
        else { run.end=m.end; run.score=Math.max(run.score,m.highlight); }
      } else if (run) {
        keep.push(run); run=null;
      }
    }
    if (run) keep.push(run);
    const merged = mergeRanges(keep,0.22)
      .filter(r=>r.end-r.start >= 0.35)
      .map(r=>({...r, start:Math.max(0,r.start-0.08), end:Math.min(analysis.duration,r.end+0.08)}));
    return merged;
  }

  function autoHighlights(analysis, count=8) {
    return analysis.candidates
      .filter(c=>c.silentRatio < 0.45)
      .slice(0,count);
  }

  function bestScene(analyses) {
    const all = analyses.flatMap(a=>a.candidates.map(c=>({...c, analysis:a})));
    return all.sort((a,b)=>b.score-a.score)[0] || null;
  }

  function autoHook(analyses) {
    const candidates = analyses.flatMap(a=>a.candidates);
    // Hook favors first 35% of each source but can use a later exceptional moment.
    const scored = candidates.map(c=>{
      const a = analyses.find(x=>x.fileId===c.fileId);
      const early = a ? 1 - clamp(c.start/(a.duration*0.35||1),0,1)*0.35 : 0;
      return {...c, hookScore:clamp(c.score*0.78 + early*0.22,0,1)};
    }).sort((a,b)=>b.hookScore-a.hookScore);
    return scored[0] || null;
  }

  function diversify(candidates, maxPerFile=3) {
    const counts = new Map();
    const out=[];
    for (const c of candidates) {
      const n=counts.get(c.fileId)||0;
      if (n>=maxPerFile) continue;
      if (out.some(x=>x.fileId===c.fileId && Math.abs(x.start-c.start)<1.8)) continue;
      out.push(c); counts.set(c.fileId,n+1);
    }
    return out;
  }

  function buildEDL(analyses, {targetSeconds=30}={}) {
    const hook = autoHook(analyses);
    const pool = analyses.flatMap(a=>a.candidates)
      .filter(c=>c.silentRatio<0.5)
      .sort((a,b)=>b.score-a.score);

    const selected = hook ? [hook] : [];
    let total = hook ? hook.end-hook.start : 0;

    for (const c of diversify(pool,4)) {
      if (selected.some(x=>x.id===c.id)) continue;
      if (total >= targetSeconds) break;
      const duration = clamp(c.end-c.start,1.5,4.5);
      selected.push({...c,end:c.start+duration});
      total += duration;
    }

    // Narrative order: hook → high value speech → visual/energy variety.
    const rest = selected.slice(hook?1:0).sort((a,b)=>{
      const av = a.text*0.55+a.energy*0.45;
      const bv = b.text*0.55+b.energy*0.45;
      return bv-av;
    });

    const ordered = hook ? [hook,...rest] : rest;
    return ordered.map((c,i)=>({
      id:uid(),
      sourceFileId:c.fileId,
      sourceFileName:c.fileName,
      sourceStart:Number(c.start.toFixed(2)),
      sourceEnd:Number(c.end.toFixed(2)),
      score:Number(c.score.toFixed(3)),
      role:i===0?'hook': i===1?'value':'highlight',
      timelineStart:0,
      timelineEnd:0
    })).map((clip,i,arr)=>{
      const start=i===0?0:arr.slice(0,i).reduce((s,x)=>s+(x.sourceEnd-x.sourceStart),0);
      clip.timelineStart=start;
      clip.timelineEnd=start+(clip.sourceEnd-clip.sourceStart);
      return clip;
    });
  }

  async function refineWithAI(edl, analyses) {
    // Optional endpoint. Never required for functionality.
    try {
      const payload = {
        task:'refine_video_edit',
        clips:edl,
        sources:analyses.map(a=>({
          fileId:a.fileId,fileName:a.fileName,duration:a.duration,
          topCandidates:a.candidates.slice(0,5)
        }))
      };
      const res = await fetch('/api/ai',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify(payload)
      });
      if (!res.ok) return edl;
      const data = await res.json();
      if (Array.isArray(data?.clips) && data.clips.length) return data.clips;
    } catch {}
    return edl;
  }

  function applyToTimeline(edl) {
    // Adapter layer: supports common editor APIs, otherwise exposes EDL globally.
    window.__clipForgeSmartEditEDL = edl;
    const editor = getEditor();

    if (typeof window.applyEditDecisionList === 'function') {
      window.applyEditDecisionList(edl);
    } else if (editor && typeof editor.applyEDL === 'function') {
      editor.applyEDL(edl);
    } else {
      // Best-effort DOM timeline rendering for existing Phase 3 UI.
      const track = document.querySelector('#videoTrack, .video-track, [data-track="video"]');
      if (track) {
        track.innerHTML='';
        const total=Math.max(...edl.map(c=>c.timelineEnd),1);
        edl.forEach((clip,i)=>{
          const el=document.createElement('div');
          el.className='clip ai-generated';
          el.dataset.clipId=clip.id;
          el.style.position='absolute';
          el.style.left=`${clip.timelineStart/total*100}%`;
          el.style.width=`${Math.max(2,(clip.timelineEnd-clip.timelineStart)/total*100)}%`;
          el.textContent=`${i+1}. ${clip.sourceFileName} • ${clip.role}`;
          track.appendChild(el);
        });
      }
    }
    window.dispatchEvent(new CustomEvent('clipforge:smart-edit-applied',{detail:{edl}}));
  }

  async function runSmartAutoEdit(options={}) {
    if (state.busy) return;
    state.busy=true;
    try {
      setStatus('Smart AI analyzing videos…');
      toast('Analyzing audio, speech, silence, and highlights…');
      const analyses=await analyzeAll();
      setStatus('Building intelligent edit…');
      let edl=buildEDL(analyses,options);
      edl=await refineWithAI(edl,analyses);
      state.lastEdit={analyses,edl,createdAt:Date.now()};
      applyToTimeline(edl);
      setStatus(`Smart edit ready • ${edl.length} selected moments`);
      toast(`Smart Auto Edit complete: ${analyses.length} videos → 1 timeline`);
      return state.lastEdit;
    } catch(err) {
      console.error(err);
      setStatus('Smart edit failed');
      toast(err.message || 'Smart Auto Edit failed.');
      throw err;
    } finally { state.busy=false; }
  }

  async function runAutoCut() {
    const analyses=await analyzeAll();
    const result=analyses.map(a=>({fileId:a.fileId,fileName:a.fileName,keep:autoCut(a)}));
    window.__clipForgeAutoCut=result;
    window.dispatchEvent(new CustomEvent('clipforge:auto-cut',{detail:result}));
    toast(`Auto Cut found usable sections in ${result.length} video(s).`);
    return result;
  }

  async function runHighlights() {
    const analyses=await analyzeAll();
    const result=analyses.map(a=>({fileId:a.fileId,fileName:a.fileName,highlights:autoHighlights(a)}));
    window.__clipForgeHighlights=result;
    window.dispatchEvent(new CustomEvent('clipforge:auto-highlights',{detail:result}));
    toast('Auto Highlights generated.');
    return result;
  }

  async function runAutoHook() {
    const analyses=await analyzeAll();
    const hook=autoHook(analyses);
    window.__clipForgeAutoHook=hook;
    window.dispatchEvent(new CustomEvent('clipforge:auto-hook',{detail:hook}));
    toast(hook ? `Auto Hook: ${hook.fileName}` : 'No strong hook found.');
    return hook;
  }

  async function runBestScene() {
    const analyses=await analyzeAll();
    const scene=bestScene(analyses);
    window.__clipForgeBestScene=scene;
    window.dispatchEvent(new CustomEvent('clipforge:best-scene',{detail:scene}));
    toast(scene ? `Best Scene: ${scene.fileName}` : 'No scene found.');
    return scene;
  }

  window.ClipForgeSmartAI.runSmartAutoEdit=runSmartAutoEdit;
  window.ClipForgeSmartAI.autoCut=runAutoCut;
  window.ClipForgeSmartAI.autoHighlights=runHighlights;
  window.ClipForgeSmartAI.autoHook=runAutoHook;
  window.ClipForgeSmartAI.bestScene=runBestScene;

  function bindButtons() {
    const bindings = [
      ['#autoEditBtn', runSmartAutoEdit],
      ['#autoCutBtn', runAutoCut],
      ['#autoHighlightBtn', runHighlights],
      ['#autoHookBtn', runAutoHook],
      ['#bestSceneBtn', runBestScene],
      ['[data-action="auto-edit"]', runSmartAutoEdit],
      ['[data-action="auto-cut"]', runAutoCut],
      ['[data-action="auto-highlight"]', runHighlights],
      ['[data-action="auto-hook"]', runAutoHook],
      ['[data-action="best-scene"]', runBestScene],
    ];
    for (const [sel,fn] of bindings) {
      document.querySelectorAll(sel).forEach(btn=>{
        if (btn.dataset.phase4Bound) return;
        btn.dataset.phase4Bound='1';
        btn.addEventListener('click',e=>{e.preventDefault();fn();});
      });
    }
  }

  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',bindButtons);
  else bindButtons();

  // Rebind after dynamic UI renders.
  const observer=new MutationObserver(()=>bindButtons());
  observer.observe(document.documentElement,{childList:true,subtree:true});
})();
