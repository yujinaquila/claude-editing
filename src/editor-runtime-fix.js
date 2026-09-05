import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';

(() => {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
  const engine = () => window.__clipForgeEditEngine;
  const toast = (m) => { const e=$('#toast'); if(!e)return; e.textContent=m; e.classList.add('show'); clearTimeout(toast.t); toast.t=setTimeout(()=>e.classList.remove('show'),4200); };
  const status = (m,k='ready') => { const e=$('#statusText'),d=$('#statusDot'); if(e)e.textContent=m; if(d)d.className=`dot ${k==='busy'?'busy':k==='error'?'error':''}`; };
  const progress = (n) => { const e=$('#progressBar'); if(e)e.style.width=`${Math.max(0,Math.min(100,n))}%`; };

  const presets = [
    ['Short-form Hook','Fast hook, remove dead air, punchy pacing, strong opening, captions, social media ready, 30 seconds'],
    ['TikTok / Reels','Vertical short-form edit, strongest moments first, fast cuts, dynamic pacing, bold captions, 30 seconds'],
    ['YouTube Short','YouTube Shorts edit, strong hook, remove pauses, clear story, energetic pacing, captions, 45 seconds'],
    ['Product Ad','Create a product-focused marketing ad, hook → benefits → proof → call to action, clean cuts, captions, 30 seconds'],
    ['UGC Ad','UGC-style paid ad, keep natural delivery, remove filler and silence, emphasize pain point and solution, captions, 30 seconds'],
    ['Talking Head','Talking-head edit, remove pauses and filler, keep the clearest statements, punchy cuts, captions, 45 seconds'],
    ['Podcast Clip','Find the most interesting podcast moment, tighten pauses, preserve context, captions, 60 seconds'],
    ['Testimonial','Customer testimonial edit, strongest claim first, problem → result → proof, emotional pacing, captions, 45 seconds'],
    ['Before / After','Before-and-after transformation edit, establish the problem quickly, reveal the result, captions, 30 seconds'],
    ['Tutorial','Step-by-step tutorial edit, remove dead air, keep instructions in logical order, captions, 60 seconds'],
    ['Cinematic Brand','Cinematic brand story, slower pacing, strongest visuals and statements, elegant transitions, captions, 45 seconds'],
    ['Fast Montage','High-energy montage, rapid connected cuts, remove silence, visual variety, captions, 30 seconds'],
    ['Instagram Story','Instagram Story ad, vertical 9:16, immediate hook, concise message, CTA, captions, 20 seconds'],
    ['Landscape YouTube','Landscape 16:9 YouTube edit, strongest story structure, clean transitions, captions, 60 seconds'],
    ['Square Social','Square 1:1 social edit, concise story, centered framing, clean captions, 30 seconds'],
    ['Minimal / Clean','Clean professional edit, natural pacing, minimal transitions, remove dead air, readable captions, 45 seconds']
  ];

  function addPresets(){
    const prompt=$('#prompt'); if(!prompt || $('#cfPromptPreset')) return;
    const wrap=document.createElement('div'); wrap.id='cfPromptPresetWrap'; wrap.style.cssText='display:flex;gap:8px;align-items:center;margin-top:7px;flex-wrap:wrap';
    const label=document.createElement('span'); label.textContent='Preset'; label.style.cssText='font-size:11px;opacity:.62;font-weight:700';
    const select=document.createElement('select'); select.id='cfPromptPreset'; select.className=prompt.className||''; select.style.cssText='min-width:210px;max-width:100%;padding:7px 9px;border-radius:8px;background:#11131a;color:inherit;border:1px solid #ffffff18';
    const first=document.createElement('option'); first.value=''; first.textContent='Choose a prompt preset…'; select.appendChild(first);
    presets.forEach(([name,text])=>{const o=document.createElement('option');o.value=text;o.textContent=name;select.appendChild(o)});
    select.onchange=()=>{if(select.value){prompt.value=select.value;prompt.dispatchEvent(new Event('input',{bubbles:true}));}};
    wrap.append(label,select); prompt.parentElement?.appendChild(wrap);
  }

  function assets(){
    return [...document.querySelectorAll('#assets .asset')].map(e=>{const v=e.querySelector('video');return{id:e.dataset.id,name:e.querySelector('.asset-name')?.textContent||'clip',url:v?.src||'',duration:parseFloat((e.querySelector('.asset-meta')?.textContent||'').split('•')[0])||v?.duration||0}}).filter(x=>x.url);
  }

  function forcePreview(){
    const en=engine(), plan=en?.plan, v=$('#previewVideo'); if(!plan?.clips?.length||!v)return;
    const c=plan.clips[Math.max(0,Math.min(en.previewIndex||0,plan.clips.length-1))];
    const a=assets().find(x=>x.id===c.assetId)||assets()[0]; if(!a)return;
    const same=v.src===a.url || v.currentSrc===a.url;
    if(!same){v.src=a.url;v.load();}
    const ready=()=>{try{v.currentTime=Math.min(Math.max(0,Number(c.start)||0),Math.max(0,(v.duration||c.end||1)-.05));}catch(_){ }v.style.display='block';v.style.visibility='visible';v.style.opacity='1';v.play().catch(()=>{});};
    if(v.readyState>=1) ready(); else v.addEventListener('loadedmetadata',ready,{once:true});
  }

  let ffmpegPromise=null;
  async function getFFmpeg(){
    const en=engine(); if(en?.ffmpegReady&&en.ffmpeg)return en.ffmpeg;
    if(ffmpegPromise)return ffmpegPromise;
    ffmpegPromise=(async()=>{
      const ff=new FFmpeg();
      ff.on('log',x=>console.debug('[FFmpeg]',x.message));
      const core='https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.js';
      const wasm='https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.wasm';
      const worker='https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.15/dist/esm/worker.js';
      status('Loading video renderer…','busy');
      const [coreURL,wasmURL,workerURL]=await Promise.all([
        toBlobURL(core,'text/javascript'),
        toBlobURL(wasm,'application/wasm'),
        toBlobURL(worker,'text/javascript')
      ]);
      await ff.load({coreURL,wasmURL,classWorkerURL:workerURL});
      if(en){en.ffmpeg=ff;en.ffmpegReady=true;}
      return ff;
    })().catch(e=>{ffmpegPromise=null;throw e});
    return ffmpegPromise;
  }

  // Warm the renderer in the background after the editor is ready. This removes
  // the FFmpeg startup download from the user's Render click in most sessions.
  function warmRenderer(){
    if(!engine()?.ffmpegReady && !ffmpegPromise){
      requestIdleCallback?.(()=>getFFmpeg().catch(e=>console.warn('FFmpeg warm-up failed; Render will retry.',e)),{timeout:2500});
    }
  }

  const assTime=t=>{t=Math.max(0,Number(t)||0);return `${Math.floor(t/3600)}:${String(Math.floor(t%3600/60)).padStart(2,'0')}:${String(Math.floor(t%60)).padStart(2,'0')}.${String(Math.floor((t-Math.floor(t))*100)).padStart(2,'0')}`};
  const assText=s=>String(s||'').replace(/\\/g,'\\\\').replace(/\{/g,'\\{').replace(/\}/g,'\\}').replace(/\n/g,' ');
  function ass(plan,w,h){
    const L=['[Script Info]','ScriptType: v4.00+','PlayResX: '+w,'PlayResY: '+h,'','[V4+ Styles]','Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',`Style: Default,Arial,${Math.max(32,Math.round(w/20))},&H00FFFFFF,&H00FFFFFF,&H00000000,&H99000000,1,0,0,0,100,100,0,0,3,3,1,2,${Math.round(w*.07)},${Math.round(w*.07)},${Math.round(h*.08)},1`,'','[Events]','Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text'];
    let t=0; for(const c of plan.clips||[]){const d=Math.max(.05,c.end-c.start),td=Math.min(d-.02,Number(c.transitionDuration)||0);if(c.text)L.push(`Dialogue: 0,${assTime(t)},${assTime(t+Math.max(.05,d-td))},Default,,0,0,0,,${assText(c.text)}`);t+=Math.max(.05,d-td)}
    return L.join('\n');
  }

  async function renderFixed(){
    const en=engine(); if(!en?.plan?.clips?.length){toast('Build Edit first.');return}
    if(en.busy)return; en.busy=true;
    const rb=$('#renderBtn'); if(rb)rb.disabled=true;
    const show=(stage,pct)=>{if(typeof window.__clipForgeRenderLoading==='function')window.__clipForgeRenderLoading(stage,pct);else {status(stage,'busy');progress(pct)}};
    try{
      show('Preparing footage',3);
      const list=assets();
      show(en.ffmpegReady?'Renderer ready':'Starting video renderer…',en.ffmpegReady?6:4);
      const ff=await getFFmpeg();
      const usedIds=[...new Set(en.plan.clips.map(c=>c.assetId))];
      const files=new Map();
      // Fetch all source blobs concurrently. This is substantially faster than
      // downloading four large local object URLs one after another.
      const loaded=await Promise.all(usedIds.map(async(id,i)=>{
        const a=list.find(x=>x.id===id); if(!a)return null;
        const ext=(a.name.match(/\.([a-z0-9]+)$/i)?.[1]||'mp4').toLowerCase().replace(/[^a-z0-9]/g,'')||'mp4';
        const file=`input_${i}.${ext}`;
        const res=await fetch(a.url); if(!res.ok)throw new Error(`Unable to read “${a.name}” (${res.status})`);
        const data=new Uint8Array(await res.arrayBuffer()); if(!data.length)throw new Error(`Video “${a.name}” is empty`);
        return {id,file,data,name:a.name};
      }));
      for(let i=0;i<loaded.length;i++){
        const x=loaded[i]; if(!x)continue;
        show(`Preparing video ${i+1}/${loaded.length}`,8+(i+1)/Math.max(1,loaded.length)*18);
        await ff.writeFile(x.file,x.data); files.set(x.id,x.file);
      }
      if(!files.size)throw new Error('No video files are available to render.');
      const [w,h]=en.plan.aspect==='9:16'?[1080,1920]:en.plan.aspect==='1:1'?[1080,1080]:[1920,1080];
      const args=[],filters=[],vl=[];
      for(const f of files.values())args.push('-i',f);
      en.plan.clips.forEach((c,i)=>{const file=files.get(c.assetId);if(!file)return;const idx=[...files.values()].indexOf(file);const s=Math.max(0,Number(c.start)||0),e=Math.max(s+.08,Number(c.end)||s+.08);filters.push(`[${idx}:v]trim=start=${s}:end=${e},setpts=PTS-STARTPTS,scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black,fps=30,format=yuv420p[v${i}]`);vl.push(`v${i}`)});
      if(!vl.length)throw new Error('No renderable clips in the edit plan.');
      let V=`[${vl[0]}]`,elapsed=Math.max(.08,en.plan.clips[0].end-en.plan.clips[0].start);
      for(let i=1;i<vl.length;i++){const c=en.plan.clips[i],td=Math.min(.8,Math.max(.12,Number(c.transitionDuration)||.35)),off=Math.max(0,elapsed-td),out=`vx${i}`,tr=['fade','fadeblack','fadewhite','wipeleft','wiperight','slideleft','slideright','smoothleft','smoothright','circleopen','circleclose'].includes(c.transition)?c.transition:'fade';filters.push(`${V}[${vl[i]}]xfade=transition=${tr}:duration=${td}:offset=${off}[${out}]`);V=`[${out}]`;elapsed+=Math.max(.08,c.end-c.start)-td}
      filters.push(`${V}null[outv]`);
      const raw='claude-ai-edit.mp4';
      show('Encoding connected edit',32);
      await ff.exec([...args,'-filter_complex',filters.join(';'),'-map','[outv]','-an','-c:v','libx264','-preset','ultrafast','-crf','25','-pix_fmt','yuv420p','-movflags','+faststart',raw]);
      let out=raw;
      if(en.plan.captions && en.plan.clips.some(c=>c.text)){
        show('Adding subtitles',78);
        await ff.writeFile('captions.ass',new TextEncoder().encode(ass(en.plan,w,h)));
        const cap='claude-ai-captioned.mp4';
        try{
          await ff.exec(['-i',raw,'-vf','subtitles=captions.ass','-c:v','libx264','-preset','ultrafast','-crf','25','-pix_fmt','yuv420p','-an','-movflags','+faststart',cap]);
          out=cap;
        }catch(captionError){
          console.warn('Caption burn-in unavailable; returning video without burned captions.',captionError);
          toast('Video rendered; subtitle burn-in was unavailable in this browser.');
        }
      }
      show('Finalizing MP4',94);
      const data=await ff.readFile(out); const url=URL.createObjectURL(new Blob([data],{type:'video/mp4'}));
      window.__clipForgeRenderedUrl=url;
      const v=$('#previewVideo'); if(v){v.src=url;v.load();v.style.display='block';v.style.visibility='visible';v.onloadedmetadata=()=>{v.currentTime=0;v.play().catch(()=>{})};}
      $('#aiDownload')?.remove();
      const dl=document.createElement('button');dl.id='aiDownload';dl.className='btn primary';dl.textContent='Download AI Edit';dl.style.cssText='margin-top:8px;width:100%';dl.onclick=()=>{const a=document.createElement('a');a.href=url;a.download=`claude-ai-${en.plan.aspect.replace(':','x')}.mp4`;a.click()};$('#renderBtn')?.parentElement?.appendChild(dl);
      // Trigger the download immediately when possible; the observer remains a fallback.
      try{dl.click()}catch(_){ }
      for(const f of files.values())await ff.deleteFile(f).catch(()=>{}); await ff.deleteFile(raw).catch(()=>{});await ff.deleteFile('captions.ass').catch(()=>{});await ff.deleteFile('claude-ai-captioned.mp4').catch(()=>{});
      show('Render complete',100);status(`Render complete • ${Math.max(0,en.plan.clips.length-1)} transitions`);toast('Render complete — connected cuts and selected aspect ratio are ready.');
      setTimeout(()=>{if(typeof window.__clipForgeRenderLoading==='function')window.__clipForgeRenderLoading('',0,false)},500);
    }catch(e){
      console.error('Fixed renderer failed',e); status('Render failed','error'); toast(`Render failed: ${e?.message||e}`); if(typeof window.__clipForgeRenderLoading==='function')window.__clipForgeRenderLoading('',0,false);
    }finally{en.busy=false;if(rb)rb.disabled=false;}
  }

  function hook(){
    addPresets();
    const style=document.createElement('style'); style.id='cfRuntimeFixCSS'; style.textContent='#previewVideo{visibility:visible!important;opacity:1!important;display:block!important}#cfPromptPresetWrap select:focus{outline:none;border-color:#ffffff35}'; document.head.appendChild(style);
    document.addEventListener('click',e=>{
      if(e.target?.closest?.('#runAI')){
        let tries=0; const timer=setInterval(()=>{tries++; if(engine()?.plan?.clips?.length){forcePreview();clearInterval(timer)} if(tries>30)clearInterval(timer)},200);
      }
      if(e.target?.closest?.('#renderBtn')){e.preventDefault();e.stopImmediatePropagation();renderFixed();}
    },true);
    window.addEventListener('clipforge:transcript',()=>{setTimeout(addPresets,50);setTimeout(warmRenderer,100)});
    setTimeout(addPresets,250);
    setTimeout(warmRenderer,800);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',hook,{once:true});else hook();
})();