import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';

(() => {
  const $ = s => document.querySelector(s);
  const engine = () => window.__clipForgeEditEngine;
  let ffmpegPromise = null;
  let busy = false;

  const toast = message => { const e = $('#toast'); if (!e) return; e.textContent = message; e.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => e.classList.remove('show'), 5000); };
  const show = (stage, pct) => {
    if (typeof window.__clipForgeRenderLoading === 'function') window.__clipForgeRenderLoading(stage, pct, true);
    const e = $('#statusText'); if (e) e.textContent = stage;
  };

  function assets() {
    return [...document.querySelectorAll('#assets .asset')].map(e => {
      const v = e.querySelector('video');
      return { id: e.dataset.id, name: e.querySelector('.asset-name')?.textContent?.trim() || 'clip', url: v?.src || '' };
    }).filter(x => x.id && x.url);
  }

  async function getFFmpeg() {
    const en = engine();
    if (en?.ffmpegReady && en.ffmpeg) return en.ffmpeg;
    if (ffmpegPromise) return ffmpegPromise;
    ffmpegPromise = (async () => {
      const ff = new FFmpeg();
      ff.on('log', x => console.debug('[FFmpeg]', x.message));
      const core = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.js';
      const wasm = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.wasm';
      const worker = 'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.15/dist/esm/worker.js';
      show('Loading browser video renderer…', 4);
      const [coreURL, wasmURL, workerURL] = await Promise.all([
        toBlobURL(core, 'text/javascript'), toBlobURL(wasm, 'application/wasm'), toBlobURL(worker, 'text/javascript')
      ]);
      await ff.load({ coreURL, wasmURL, classWorkerURL: workerURL });
      if (en) { en.ffmpeg = ff; en.ffmpegReady = true; }
      return ff;
    })().catch(e => { ffmpegPromise = null; throw e; });
    return ffmpegPromise;
  }

  const assTime = t => { t = Math.max(0, Number(t) || 0); return `${Math.floor(t / 3600)}:${String(Math.floor(t % 3600 / 60)).padStart(2,'0')}:${String(Math.floor(t % 60)).padStart(2,'0')}.${String(Math.floor((t - Math.floor(t)) * 100)).padStart(2,'0')}`; };
  const assText = s => String(s || '').replace(/\\/g,'\\\\').replace(/\{/g,'\\{').replace(/\}/g,'\\}').replace(/\n/g,' ');
  function makeAss(plan, w, h) {
    const lines = ['[Script Info]','ScriptType: v4.00+','PlayResX: '+w,'PlayResY: '+h,'','[V4+ Styles]','Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',`Style: Default,Arial,${Math.max(32,Math.round(w/20))},&H00FFFFFF,&H00FFFFFF,&H00000000,&H99000000,1,0,0,0,100,100,0,0,3,3,1,2,${Math.round(w*.07)},${Math.round(w*.07)},${Math.round(h*.08)},1`,'','[Events]','Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text'];
    let t = 0;
    for (const c of plan.clips || []) { const d = Math.max(.05, Number(c.end)-Number(c.start)); const td = Math.min(d-.02, Number(c.transitionDuration)||0); if (c.text) lines.push(`Dialogue: 0,${assTime(t)},${assTime(t+Math.max(.05,d-td))},Default,,0,0,0,,${assText(c.text)}`); t += Math.max(.05,d-td); }
    return lines.join('\n');
  }

  async function bucketUpload(blob, plan) {
    show('Uploading finished MP4 to bucket…', 96);
    const filename = `claude-ai-${String(plan.aspect || '16:9').replace(':','x')}-${Date.now()}.mp4`;
    const ticketRes = await fetch('/api/cloud-render', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ action:'render-upload-url', filename, contentType:'video/mp4' }) });
    const ticket = await ticketRes.json().catch(() => ({}));
    if (!ticketRes.ok || !ticket.url || !ticket.key) throw new Error(ticket.error || `Could not create bucket upload URL (${ticketRes.status})`);
    let put;
    try { put = await fetch(ticket.url, { method:'PUT', headers:{'Content-Type':'video/mp4'}, body:blob }); }
    catch (e) { throw new Error(`Could not upload the rendered MP4 to the bucket. Check bucket CORS. ${e?.message || 'Network error'}`); }
    if (!put.ok) throw new Error(`Bucket upload failed (${put.status}). Check bucket CORS and write permissions.`);
    const finalRes = await fetch('/api/cloud-render', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ action:'render-final-url', key:ticket.key }) });
    const final = await finalRes.json().catch(() => ({}));
    if (!finalRes.ok || !final.url) throw new Error(final.error || `Could not finalize bucket video (${finalRes.status})`);
    return final.url;
  }

  async function render() {
    const en = engine();
    if (!en?.plan?.clips?.length) { toast('Build Edit first.'); return; }
    if (busy || en.busy) return;
    busy = true; en.busy = true;
    const button = $('#renderBtn'); if (button) button.disabled = true;
    const files = new Map();
    try {
      show('Preparing footage', 3);
      const list = assets();
      const ids = [...new Set(en.plan.clips.map(c => c.assetId))];
      const loaded = await Promise.all(ids.map(async (id, i) => {
        const a = list.find(x => x.id === id); if (!a) return null;
        const ext = (a.name.match(/\.([a-z0-9]+)$/i)?.[1] || 'mp4').replace(/[^a-z0-9]/gi,'').toLowerCase() || 'mp4';
        const file = `bucket_input_${i}.${ext}`;
        const res = await fetch(a.url); if (!res.ok) throw new Error(`Unable to read “${a.name}” (${res.status})`);
        const data = new Uint8Array(await res.arrayBuffer()); if (!data.length) throw new Error(`Video “${a.name}” is empty.`);
        return { id, file, data };
      }));
      const ff = await getFFmpeg();
      for (let i=0;i<loaded.length;i++) { const x=loaded[i]; if(!x)continue; show(`Preparing video ${i+1}/${loaded.length}`,8+(i+1)/Math.max(1,loaded.length)*18); await ff.writeFile(x.file,x.data); files.set(x.id,x.file); }
      if (!files.size) throw new Error('No video files are available to render.');

      const [w,h] = en.plan.aspect === '9:16' ? [1080,1920] : en.plan.aspect === '1:1' ? [1080,1080] : [1920,1080];
      const args=[], filters=[], videoLabels=[];
      for (const f of files.values()) args.push('-i', f);
      en.plan.clips.forEach((c,i) => {
        const file=files.get(c.assetId); if(!file)return;
        const idx=[...files.values()].indexOf(file);
        const s=Math.max(0,Number(c.start)||0), e=Math.max(s+.08,Number(c.end)||s+.08);
        filters.push(`[${idx}:v]trim=start=${s}:end=${e},setpts=PTS-STARTPTS,scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black,fps=30,format=yuv420p[v${i}]`);
        videoLabels.push(`v${i}`);
      });
      if(!videoLabels.length)throw new Error('No renderable clips in the edit plan.');
      let V=`[${videoLabels[0]}]`, elapsed=Math.max(.08,Number(en.plan.clips[0].end)-Number(en.plan.clips[0].start));
      for(let i=1;i<videoLabels.length;i++){
        const c=en.plan.clips[i], td=Math.min(.8,Math.max(.12,Number(c.transitionDuration)||.35)), off=Math.max(0,elapsed-td), out=`bucket_vx${i}`;
        const tr=['fade','fadeblack','fadewhite','wipeleft','wiperight','slideleft','slideright','smoothleft','smoothright','circleopen','circleclose'].includes(c.transition)?c.transition:'fade';
        filters.push(`${V}[${videoLabels[i]}]xfade=transition=${tr}:duration=${td}:offset=${off}[${out}]`); V=`[${out}]`; elapsed += Math.max(.08,Number(c.end)-Number(c.start))-td;
      }
      filters.push(`${V}null[outv]`);
      const raw='bucket-edit.mp4';
      show('Rendering connected edit in browser', 32);
      await ff.exec([...args,'-filter_complex',filters.join(';'),'-map','[outv]','-an','-c:v','libx264','-preset','ultrafast','-crf','25','-pix_fmt','yuv420p','-movflags','+faststart',raw]);
      let out=raw;
      if(en.plan.captions && en.plan.clips.some(c=>c.text)){
        show('Adding subtitles',78);
        await ff.writeFile('bucket-captions.ass',new TextEncoder().encode(makeAss(en.plan,w,h)));
        try { await ff.exec(['-i',raw,'-vf','subtitles=bucket-captions.ass','-c:v','libx264','-preset','ultrafast','-crf','25','-pix_fmt','yuv420p','-an','-movflags','+faststart','bucket-captioned.mp4']); out='bucket-captioned.mp4'; }
        catch(e){ console.warn('Subtitle burn-in unavailable',e); toast('Video rendered; subtitle burn-in was unavailable in this browser.'); }
      }
      show('Preparing final MP4', 92);
      const data=await ff.readFile(out);
      const blob=new Blob([data],{type:'video/mp4'});
      const objectUrl=URL.createObjectURL(blob);
      const finalUrl=await bucketUpload(blob,en.plan);
      window.__clipForgeRenderedUrl=finalUrl;
      const v=$('#previewVideo'); if(v){v.src=finalUrl;v.load();v.style.display='block';v.style.visibility='visible';v.style.opacity='1';v.onloadedmetadata=()=>{v.currentTime=0;v.play().catch(()=>{});};}
      $('#aiDownload')?.remove();
      const dl=document.createElement('button'); dl.id='aiDownload'; dl.className='btn primary'; dl.textContent='Download AI Edit'; dl.style.cssText='margin-top:8px;width:100%';
      dl.onclick=()=>{const a=document.createElement('a');a.href=finalUrl;a.target='_blank';a.rel='noopener';a.download=`claude-ai-${String(en.plan.aspect||'16:9').replace(':','x')}.mp4`;a.click();};
      $('#renderBtn')?.parentElement?.appendChild(dl);
      show('Render complete • saved to bucket',100);
      const status=$('#statusText'); if(status)status.textContent=`Render complete • ${Math.max(0,en.plan.clips.length-1)} transitions • saved to bucket`;
      toast('Render complete — MP4 uploaded to your bucket.');
      try { dl.click(); } catch (_) {}
      URL.revokeObjectURL(objectUrl);
      for(const f of files.values())await ff.deleteFile(f).catch(()=>{});
      await ff.deleteFile(raw).catch(()=>{}); await ff.deleteFile('bucket-captions.ass').catch(()=>{}); await ff.deleteFile('bucket-captioned.mp4').catch(()=>{});
      setTimeout(()=>window.__clipForgeRenderLoading?.('',0,false),700);
    } catch(e) {
      console.error('[render-to-bucket]',e); toast(`Render failed: ${e?.message||e}`); const status=$('#statusText'); if(status)status.textContent='Render failed'; window.__clipForgeRenderLoading?.('',0,false);
    } finally { busy=false; en.busy=false; if(button)button.disabled=false; }
  }

  function install() {
    document.addEventListener('click', e => {
      if (!e.target?.closest?.('#renderBtn')) return;
      e.preventDefault(); e.stopImmediatePropagation(); render();
    }, true);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true}); else install();
})();
