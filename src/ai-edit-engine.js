import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';

(() => {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
  const fmt = (sec) => { sec = Math.max(0, Number(sec) || 0); const m=Math.floor(sec/60); const s=Math.floor(sec%60); return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`; };
  const toast = (m) => { const e=$('#toast'); if(!e) return; e.textContent=m; e.classList.add('show'); clearTimeout(toast.t); toast.t=setTimeout(()=>e.classList.remove('show'),4200); };
  const status = (m, kind='ready') => { const e=$('#statusText'), d=$('#statusDot'); if(e)e.textContent=m; if(d)d.className=`dot ${kind==='busy'?'busy':kind==='error'?'error':''}`; };
  const progress = (n) => { const e=$('#progressBar'); if(e)e.style.width=`${Math.max(0,Math.min(100,n))}%`; };

  const engine = {
    plan: null,
    transcripts: new Map(),
    ffmpeg: null,
    ffmpegReady: false,
    busy: false
  };
  window.__clipForgeEditEngine = engine;

  function ensurePanel() {
    if ($('#editPlanPanel')) return;
    const chips=$('#chips'); if(!chips) return;
    const panel=document.createElement('div');
    panel.id='editPlanPanel';
    panel.style.cssText='margin-top:10px;padding:10px;border:1px solid rgba(255,255,255,.1);border-radius:12px;background:rgba(255,255,255,.025);font-size:12px;line-height:1.4';
    panel.innerHTML='<div style="font-weight:700;margin-bottom:5px">EDIT PLAN</div><div id="editPlanSummary" class="status">Build an edit to analyze your footage.</div><div id="editPlanClips"></div>';
    chips.after(panel);
  }

  function assetRows() {
    return [...document.querySelectorAll('#assets .asset')].map(el => {
      const v=el.querySelector('video');
      return { id:el.dataset.id, name:el.querySelector('.asset-name')?.textContent || 'clip', url:v?.src || '', duration:parseFloat((el.querySelector('.asset-meta')?.textContent||'').split('•')[0]) || 0 };
    }).filter(x=>x.url);
  }

  async function decode16k(blob) {
    const buf=await blob.arrayBuffer();
    const AC=window.AudioContext||window.webkitAudioContext;
    const OAC=window.OfflineAudioContext||window.webkitOfflineAudioContext;
    if(!AC||!OAC) throw new Error('Web Audio is unavailable in this browser.');
    const ctx=new AC(); let decoded;
    try { decoded=await ctx.decodeAudioData(buf.slice(0)); } finally { try{await ctx.close();}catch{} }
    const rate=16000, frames=Math.max(1,Math.ceil(decoded.duration*rate));
    const off=new OAC(1,frames,rate), src=off.createBufferSource();
    const mono=off.createBuffer(1,decoded.length,decoded.sampleRate), out=mono.getChannelData(0);
    for(let ch=0;ch<decoded.numberOfChannels;ch++) { const d=decoded.getChannelData(ch); for(let i=0;i<out.length;i++) out[i]+=d[i]/decoded.numberOfChannels; }
    src.buffer=mono; src.connect(off.destination); src.start(0);
    return (await off.startRendering()).getChannelData(0).slice();
  }

  function wav(samples, rate=16000) {
    const b=new ArrayBuffer(44+samples.length*2), v=new DataView(b);
    const str=(o,s)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i));};
    str(0,'RIFF');v.setUint32(4,36+samples.length*2,true);str(8,'WAVE');str(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,rate,true);v.setUint32(28,rate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,samples.length*2,true);
    let o=44;for(const x of samples){const n=Math.max(-1,Math.min(1,x));v.setInt16(o,n<0?n*32768:n*32767,true);o+=2;}return new Blob([b],{type:'audio/wav'});
  }

  async function transcribeBlob(blob, lang) {
    const samples=await decode16k(blob), max=16000*45, all=[];
    for(let off=0;off<samples.length;off+=max){
      const part=wav(samples.slice(off,Math.min(samples.length,off+max)));
      const r=await fetch('/api/transcribe',{method:'POST',headers:{'Content-Type':'audio/wav','X-Language':lang},body:part});
      if(!r.ok) throw new Error((await r.text()).slice(0,300));
      const data=await r.json();
      const base=off/16000;
      for(const s of (data.segments||[])) all.push({start:Number(s.start||0)+base,end:Number(s.end||s.start||0)+base,text:String(s.text||'').trim()});
    }
    return all.filter(x=>x.text && Number.isFinite(x.start));
  }

  async function ensureTranscripts() {
    const assets=assetRows();
    const lang=($('#langSelect')?.value || 'en');
    for(let i=0;i<assets.length;i++){
      const a=assets[i];
      if(engine.transcripts.has(a.id) && engine.transcripts.get(a.id).length) continue;
      status(`Analyzing ${i+1}/${assets.length}: ${a.name}`,'busy'); progress(Math.round((i/assets.length)*55));
      const blob=await fetch(a.url).then(r=>r.blob());
      const tr=await transcribeBlob(blob,lang);
      engine.transcripts.set(a.id,tr);
    }
    return assets;
  }

  const hookWords=['why','how','secret','mistake','stop','best','you','ini','cara','jangan','kenapa','rahasia','salah','terbaik','ternyata','pernah','before','after'];
  const roleWords={
    hook:['why','how','ini','cara','jangan','kenapa','rahasia','ternyata','watch','look','stop'],
    problem:['problem','masalah','susah','sulit','error','gagal','before','without','tanpa','issue'],
    solution:['solution','solusi','cara','fix','perbaiki','setelah','after','bisa','works','berhasil'],
    proof:['hasil','result','proof','bukti','customer','client','review','testimoni','berhasil'],
    cta:['buy','beli','order','pesan','click','klik','follow','learn','coba','hubungi','link']
  };
  function scoreText(text, words) { const t=text.toLowerCase(); return words.reduce((n,w)=>n+(t.includes(w)?1:0),0); }
  function chooseSegment(list, role, used) {
    const words=roleWords[role]||[];
    return [...list].filter(s=>!used.has(s.key) && s.end>s.start && s.end-s.start<=8).sort((a,b)=>{
      const sa=scoreText(a.text,words)*24+scoreText(a.text,hookWords)*(role==='hook'?18:5)+Math.min(a.text.length,100)*.08;
      const sb=scoreText(b.text,words)*24+scoreText(b.text,hookWords)*(role==='hook'?18:5)+Math.min(b.text.length,100)*.08;
      return sb-sa;
    })[0] || null;
  }

  function makePlan(prompt, assets) {
    const p=(prompt||'').toLowerCase();
    const duration=Math.max(5,Math.min(180,Number(p.match(/(\d+)\s*(s|sec|second|seconds|detik)/)?.[1] || $('#duration')?.value || 30)));
    const aspect=/1\s*:\s*1|square|kotak/.test(p)?'1:1':/16\s*:\s*9|landscape|youtube|horizontal/.test(p)?'16:9':'9:16';
    const captions=!/(no captions|without captions|tanpa caption)/.test(p);
    const autoCut=!/(keep pauses|no cuts|jangan potong)/.test(p);
    const hookEnabled=!/(no hook|tanpa hook)/.test(p);
    const all=[];
    for(const a of assets){
      for(const s of (engine.transcripts.get(a.id)||[])) all.push({...s,assetId:a.id,assetName:a.name,key:`${a.id}:${s.start.toFixed(3)}`});
    }
    const used=new Set(), clips=[];
    const roles=hookEnabled?['hook','problem','solution','proof','cta']:['problem','solution','proof','cta'];
    for(const role of roles){ const s=chooseSegment(all,role,used); if(s){used.add(s.key);clips.push({...s,role});} }
    const rest=all.filter(s=>!used.has(s.key)).sort((a,b)=>{
      const score=x=>x.text.length+scoreText(x.text,hookWords)*12;
      return score(b)-score(a);
    });
    for(const s of rest){
      if(clips.reduce((n,x)=>n+x.end-x.start,0)>=duration*.92) break;
      if(s.end-s.start<.35) continue;
      used.add(s.key); clips.push({...s,role:'support'});
    }
    // Put hook first, then the remaining strongest moments. Preserve prompt-friendly story roles.
    const ordered=[...clips.filter(x=>x.role==='hook'),...clips.filter(x=>x.role!=='hook')];
    let total=0; const final=[];
    for(const c of ordered){
      if(total>=duration) break;
      const max=Math.min(c.end-c.start,duration-total);
      if(max<.25) continue;
      final.push({...c,end:c.start+max}); total+=max;
    }
    return {version:1,prompt,aspect,duration,captions,autoCut,hook:hookEnabled,target:'marketing',clips:final,totalDuration:total,createdAt:Date.now()};
  }

  function drawPlan() {
    ensurePanel(); const p=engine.plan; if(!p) return;
    const sum=$('#editPlanSummary'), list=$('#editPlanClips');
    if(sum) sum.innerHTML=`<b>${p.clips.length} selected moments</b> • ${fmt(p.totalDuration)} / ${fmt(p.duration)} • ${p.aspect}`;
    if(list) list.innerHTML=p.clips.map((c,i)=>`<div style="padding:6px 0;border-top:1px solid rgba(255,255,255,.06)"><b>${i+1}. ${esc(c.role)}</b> <span style="opacity:.65">${esc(c.assetName)} · ${fmt(c.start)}–${fmt(c.end)}</span><br><span>${esc(c.text)}</span></div>`).join('');
    const track=$('#videoTrack'); if(!track) return;
    const palette={hook:'HOOK',problem:'PROBLEM',solution:'SOLUTION',proof:'PROOF',cta:'CTA',support:'CUT'};
    track.innerHTML=p.clips.map((c,i)=>`<div class="clip active auto-plan-clip" data-plan-index="${i}" style="left:${Math.min(98,i*100/Math.max(1,p.clips.length))}%;width:${Math.max(8,92/Math.max(1,p.clips.length))}%"><b>${palette[c.role]||'CUT'}</b><small>${fmt(c.end-c.start)} · ${esc(c.assetName)}</small></div>`).join('');
    track.querySelectorAll('.auto-plan-clip').forEach(el=>el.onclick=()=>previewPlanClip(Number(el.dataset.planIndex)));
    if($('#captionTrack')) $('#captionTrack').innerHTML=p.clips.map((c,i)=>`<div class="clip" style="left:${i*100/Math.max(1,p.clips.length)}%;width:${Math.max(4,92/Math.max(1,p.clips.length))}%"><b>${esc(c.text)}</b></div>`).join('');
  }

  function previewPlanClip(index) {
    const c=engine.plan?.clips?.[index]; if(!c) return;
    const asset=assetRows().find(a=>a.id===c.assetId); if(!asset) return;
    const v=$('#previewVideo'); if(!v)return;
    v.src=asset.url; v.load(); v.onloadedmetadata=()=>{v.currentTime=Math.min(c.start,Math.max(0,(v.duration||c.end)-.05));};
    v.play().catch(()=>{});
  }

  async function buildEdit() {
    if(engine.busy) return;
    const assets=assetRows(); if(!assets.length){toast('Import footage first.');return;}
    engine.busy=true; ensurePanel();
    const btn=$('#runAI'); if(btn)btn.disabled=true;
    try{
      status('AI Director: analyzing all footage…','busy'); progress(2);
      await ensureTranscripts();
      engine.plan=makePlan($('#prompt')?.value||'',assets);
      window.__clipForgeEditPlan=engine.plan;
      // Keep the existing controls synchronized with the generated plan.
      if($('#aspect')) $('#aspect').value=engine.plan.aspect;
      if($('#duration')) $('#duration').value=engine.plan.duration;
      if($('#ratioBadge')) $('#ratioBadge').textContent=engine.plan.aspect;
      if($('#planLabel')) $('#planLabel').textContent='AI Edit';
      drawPlan(); progress(100); status(`AI Edit ready • ${engine.plan.clips.length} moments`); toast(`AI Edit built from ${assets.length} video${assets.length===1?'':'s'}.`);
      if(engine.plan.clips[0]) previewPlanClip(0);
    }catch(e){console.error(e);status('AI Edit failed','error');toast(`Build Edit failed: ${e?.message||e}`);}
    finally{engine.busy=false;if(btn)btn.disabled=false;}
  }

  async function ensureFFmpeg() {
    if(engine.ffmpegReady) return engine.ffmpeg;
    status('Loading render engine…','busy');
    const ff=new FFmpeg(); ff.on('log',({message})=>console.debug('[FFmpeg]',message)); ff.on('progress',({progress:p})=>progress(Math.round(p*100)));
    const base='https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm';
    await ff.load({coreURL:`${base}/ffmpeg-core.js`,wasmURL:`${base}/ffmpeg-core.wasm`,classWorkerURL:`${location.origin}/ffmpeg/worker.js`});
    engine.ffmpeg=ff; engine.ffmpegReady=true; return ff;
  }

  async function renderPlan() {
    if(engine.busy) return;
    if(!engine.plan){ toast('Build Edit first so the AI can choose the footage.'); return; }
    engine.busy=true; const btn=$('#renderBtn'); if(btn)btn.disabled=true;
    try{
      const assets=assetRows(), ff=await ensureFFmpeg();
      const used=[...new Map(engine.plan.clips.map(c=>[c.assetId,c])).values()];
      const files=new Map();
      for(let i=0;i<used.length;i++){
        const a=assets.find(x=>x.id===used[i].assetId); if(!a)continue;
        const ext=(a.name.split('.').pop()||'mp4').toLowerCase().replace(/[^a-z0-9]/g,'')||'mp4';
        const name=`input_${i}.${ext}`; await ff.writeFile(name,await fetchFile(await fetch(a.url).then(r=>r.blob()))); files.set(a.id,name);
        progress(Math.min(20,5+i*5));
      }
      const [w,h]=engine.plan.aspect==='9:16'?[1080,1920]:engine.plan.aspect==='1:1'?[1080,1080]:[1920,1080];
      const filters=[], inputs=[];
      engine.plan.clips.forEach((c,i)=>{
        const name=files.get(c.assetId); if(!name)return;
        const idx=[...files.values()].indexOf(name);
        filters.push(`[${idx}:v]trim=start=${c.start}:end=${c.end},setpts=PTS-STARTPTS,scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},fps=30,format=yuv420p[v${i}]`);
        filters.push(`[${idx}:a]atrim=start=${c.start}:end=${c.end},asetpts=PTS-STARTPTS,aresample=async=1[a${i}]`);
        inputs.push(`[v${i}][a${i}]`);
      });
      if(!inputs.length) throw new Error('The AI plan contains no renderable clips.');
      filters.push(`${inputs.join('')}concat=n=${inputs.length}:v=1:a=1[outv][outa]`);
      const output='claude-ai-edit.mp4';
      const args=[]; for(const n of files.values()) args.push('-i',n);
      status(`Rendering ${engine.plan.clips.length} selected moments…`,'busy'); progress(25);
      await ff.exec([...args,'-filter_complex',filters.join(';'),'-map','[outv]','-map','[outa]','-c:v','libx264','-preset','veryfast','-crf','23','-c:a','aac','-b:a','128k','-movflags','+faststart','-t',String(engine.plan.duration),output]);
      const data=await ff.readFile(output), blob=new Blob([data instanceof Uint8Array?data:new Uint8Array(data)],{type:'video/mp4'});
      const url=URL.createObjectURL(blob); window.__clipForgeRenderedUrl=url;
      const v=$('#previewVideo'); if(v){v.src=url;v.load();}
      const old=$('#aiDownload'); if(old)old.remove();
      const dl=document.createElement('button'); dl.id='aiDownload'; dl.className='btn primary'; dl.textContent='Download AI Edit'; dl.style.cssText='margin-top:8px;width:100%'; dl.onclick=()=>{const a=document.createElement('a');a.href=url;a.download=`claude-ai-${engine.plan.aspect.replace(':','x')}-${engine.plan.duration}s.mp4`;a.click();};
      $('#renderBtn')?.parentElement?.appendChild(dl);
      progress(100);status('AI Render complete');toast('AI edit rendered: multi-clip cuts + framing + audio.');
      for(const n of files.values())try{await ff.deleteFile(n)}catch{} try{await ff.deleteFile(output)}catch{}
    }catch(e){console.error(e);status('Render failed','error');toast(`Render failed: ${e?.message||e}`);}
    finally{engine.busy=false;if(btn)btn.disabled=false;}
  }

  function capture(e){
    const id=e.target?.id;
    if(id==='runAI'){e.preventDefault();e.stopImmediatePropagation();buildEdit();}
    else if(id==='renderBtn'){e.preventDefault();e.stopImmediatePropagation();renderPlan();}
    else if(id==='autoCutBtn' && engine.plan){e.preventDefault();e.stopImmediatePropagation();drawPlan();toast(`AI Cut: ${engine.plan.clips.length} selected moments.`);}
    else if(id==='hookBtn' && engine.plan?.clips?.[0]){e.preventDefault();e.stopImmediatePropagation();previewPlanClip(0);toast(`AI Hook: ${engine.plan.clips[0].text}`);}
  }

  function init(){
    ensurePanel();
    document.addEventListener('click',capture,true);
    document.addEventListener('change',e=>{if(e.target?.id==='langSelect'){engine.transcripts.clear();engine.plan=null;ensurePanel();}},true);
    window.addEventListener('clipforge:transcript',e=>{
      const d=e.detail||{}; if(d.assetId&&Array.isArray(d.segments)) engine.transcripts.set(d.assetId,d.segments);
    });
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init); else init();
})();
