/* ClipForge AI — Phase 4 compatibility + reliable AI feature bridge.
 * Fixes Auto Hook, Best Scenes and Prompt-based Edit by making the Anthropic
 * endpoint accept both text and vision content, and adds deterministic local
 * fallbacks so the buttons still work when AI is unavailable.
 */
(() => {
  'use strict';

  const api = window.ClipForgeSmartAI = window.ClipForgeSmartAI || {};
  const esc = v => String(v ?? '').replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
  const state = name => {
    try { return window[name]; } catch { return undefined; }
  };
  const setState = (name, value) => {
    try { window[name] = value; return true; } catch { return false; }
  };
  const uid = () => 't' + Date.now().toString(36) + Math.random().toString(36).slice(2,7);

  // Top-level state from index.html is exposed to modules. Keep the bridge
  // writable because Phase 3/6 replace whole arrays (timeline = [...]).
  ['media','timeline','seq'].forEach(name => {
    try {
      if (!Object.prototype.hasOwnProperty.call(window, name)) {
        Object.defineProperty(window, name, {
          configurable: true,
          get() { try { return window.eval(name); } catch { return undefined; } },
          set(v) { try { window.eval(`${name} = window.__clipforgeBridgeValue`); } catch {} finally { delete window.__clipforgeBridgeValue; } window.__clipforgeBridgeValue = v; try { window.eval(`${name} = window.__clipforgeBridgeValue`); } catch {} delete window.__clipforgeBridgeValue; }
        });
      }
    } catch {}
  });

  function toast(msg, loading=false) {
    if (typeof window.showToast === 'function') window.showToast(msg, loading);
  }
  function hideToast() {
    if (typeof window.hideToast === 'function') window.hideToast();
    else { const el=document.getElementById('toast'); if(el) el.style.display='none'; }
  }
  function lang() { return state('currentLang') || 'en'; }
  function listMedia() { return Array.isArray(state('media')) ? state('media') : []; }
  function listTimeline() { return Array.isArray(state('timeline')) ? state('timeline') : []; }
  function saveTimeline(next) {
    setState('timeline', next);
    if (typeof window.renderTimeline === 'function') window.renderTimeline();
  }
  function mediaForClip(c) {
    return listMedia().find(m => m.id === (c?.mediaId || c?.id)) || c;
  }
  function safeJson(text) {
    try { return JSON.parse(String(text).replace(/```json|```/g,'').trim()); }
    catch { return null; }
  }
  function fmt(sec) {
    sec=Math.max(0,Number(sec)||0);
    return `${String(Math.floor(sec/60)).padStart(2,'0')}:${String(Math.floor(sec%60)).padStart(2,'0')}`;
  }

  /* ---------- Real word-level transcription bridge ---------- */
  function encodeWav(samples, sampleRate=16000) {
    const pcm=new Int16Array(samples.length);
    for(let i=0;i<samples.length;i++){const x=Math.max(-1,Math.min(1,samples[i]));pcm[i]=x<0?x*32768:x*32767;}
    const buf=new ArrayBuffer(44+pcm.byteLength),v=new DataView(buf);
    const put=(o,t)=>{for(let i=0;i<t.length;i++)v.setUint8(o+i,t.charCodeAt(i));};
    put(0,'RIFF');v.setUint32(4,36+pcm.byteLength,true);put(8,'WAVE');put(12,'fmt ');
    v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,sampleRate,true);
    v.setUint32(28,sampleRate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);put(36,'data');v.setUint32(40,pcm.byteLength,true);
    new Int16Array(buf,44).set(pcm); return new Blob([buf],{type:'audio/wav'});
  }
  window.cloudTranscribe=async function(audio,language,onProgress){
    const rate=16000,chunkSec=55,size=chunkSec*rate,total=Math.ceil(audio.length/size),words=[];
    for(let i=0;i<total;i++){
      const blob=encodeWav(audio.slice(i*size,Math.min(audio.length,(i+1)*size)),rate);
      const r=await fetch('/api/transcribe',{method:'POST',headers:{'Content-Type':'audio/wav','X-Language':language},body:blob});
      const raw=await r.text(); if(!r.ok) throw new Error(raw||'Cloud transcription failed');
      const data=JSON.parse(raw),offset=i*chunkSec;
      if(Array.isArray(data.words)&&data.words.length){
        data.words.forEach(w=>{const word=String(w.word||'').trim();if(word)words.push({word,start:Number(w.start||0)+offset,end:Number(w.end||0)+offset});});
      } else {
        (data.segments||[]).forEach(seg=>{const text=String(seg.text||'').trim();if(!text)return;const a=Number(seg.start||0)+offset,b=Number(seg.end||0)+offset;const parts=text.split(/\s+/).filter(Boolean),step=Math.max(.05,(b-a)/Math.max(1,parts.length));parts.forEach((p,j)=>words.push({word:p,start:a+j*step,end:Math.min(b,a+(j+1)*step)}));});
      }
      onProgress?.(i+1,total);
    }
    return words;
  };

  /* ---------- Shared AI request ---------- */
  async function ai(content,maxTokens=1600){
    if(typeof window.callClaude==='function') return window.callClaude(content,maxTokens);
    const r=await fetch('/api/ai',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content,maxTokens,language:lang()})});
    const raw=await r.text();let data={};try{data=JSON.parse(raw);}catch{}
    if(!r.ok) throw new Error(data.error||raw||'AI service unavailable');
    return data.text||'';
  }

  /* ---------- Frame capture ---------- */
  function captureFrame(url,ratio=.35){
    return new Promise(resolve=>{
      const v=document.createElement('video');v.muted=true;v.playsInline=true;v.preload='metadata';v.src=url;
      const fail=()=>{cleanup();resolve(null);};
      const cleanup=()=>{v.removeEventListener('error',fail);try{v.pause();v.src='';}catch{}};
      v.addEventListener('loadedmetadata',()=>{try{v.currentTime=Math.max(0,Math.min((v.duration||0)*ratio,Math.max(0,(v.duration||0)-.05)));}catch{fail();}});
      v.addEventListener('seeked',()=>{try{const c=document.createElement('canvas');c.width=320;c.height=180;c.getContext('2d').drawImage(v,0,0,320,180);const b64=c.toDataURL('image/jpeg',.72).split(',')[1];cleanup();resolve(b64);}catch{fail();}},{once:true});
      setTimeout(fail,8000);
    });
  }

  function localSceneScore(m){
    const dur=Math.max(.5,Number(m.duration)||0);
    const hi=(m.highlights||[]).reduce((n,h)=>n+Math.max(0,Number(h.end||0)-Number(h.start||0)),0);
    const words=(m.transcript||[]).length;
    return Math.min(1,hi/dur)*.55+Math.min(1,words/Math.max(8,dur*2))*0.35+Math.min(1,dur/5)*.10;
  }
  function localHookScore(m){
    const dur=Math.max(.5,Number(m.duration)||0), early=(m.highlights||[]).reduce((n,h)=>{const s=Number(h.start||0);return n+(s<Math.min(4,dur)?Math.max(0,Math.min(Number(h.end||0),4)-s):0);},0);
    const speech=(m.transcript||[]).filter(w=>Number(w.start||0)<4).length;
    return Math.min(1,early/2.5)*.6+Math.min(1,speech/8)*.3+Math.min(1,dur/3)*.1;
  }

  function renderRanking(title,ranking,topPick,mode,usedAI){
    const body=document.getElementById('resultsBody'); if(!body)return;
    if(typeof window.clearEmptyRight==='function')window.clearEmptyRight();
    const card=document.createElement('div');card.className='result-card';
    card.innerHTML=`<h4>${esc(title)} ${usedAI?'<span class="badge">AI</span>':'<span class="badge">LOCAL</span>'}</h4>
      ${topPick?`<div><b>${lang()==='id'?'Pilihan teratas':'Top pick'}:</b> ${esc(topPick)}</div>`:''}
      <ol style="margin:8px 0 0 18px;padding:0">${ranking.map(r=>`<li style="margin:4px 0"><b>${esc(r.clip)}</b> — ${esc(r.reason||'')}</li>`).join('')}</ol>
      ${topPick&&listMedia().length?`<button class="apply-btn" data-ai-apply="1">${mode==='hook'?(lang()==='id'?'Jadikan pembuka':'Make opening clip'):(lang()==='id'?'Jadikan klip pertama':'Move to start of timeline')}</button>`:''}`;
    body.prepend(card);
    const b=card.querySelector('[data-ai-apply]');if(b)b.onclick=()=>moveTop(topPick);
  }
  function moveTop(name){
    const tl=listTimeline(), idx=tl.findIndex(c=>c.name===name);
    if(idx<0){
      const m=listMedia().find(x=>x.name===name); if(!m)return;
      const next={id:uid(),mediaId:m.id,name:m.name,url:m.url,duration:m.duration,trimIn:0,trimOut:Math.min(Number(m.duration)||1,3),highlights:[]};saveTimeline([next,...tl]);
    }else{const next=tl.slice();const c=next.splice(idx,1)[0];next.unshift(c);saveTimeline(next);}
    toast(lang()==='id'?'Pembuka diterapkan ke timeline':'Opening clip applied to timeline');
  }

  async function runVision(mode){
    const source=listMedia().length?listMedia():listTimeline();
    if(!source.length){toast(lang()==='id'?'Impor klip dulu':'Import clips first');return;}
    toast(lang()==='id'?'AI menganalisis klip…':'AI is analyzing your clips…',true);
    const fallback=()=>{
      const rows=source.map(m=>({clip:m.name,score:mode==='hook'?localHookScore(m):localSceneScore(m)})).sort((a,b)=>b.score-a.score);
      const ranking=rows.map((r,i)=>({clip:r.clip,reason:mode==='hook'?(i===0?'Strongest early visual/speech signal':'Weaker opening signal compared with the top clip'):(i===0?'Strongest combined highlight, speech and pacing signal':`Ranked #${i+1} by detected highlight/speech activity`)}));
      renderRanking(mode==='hook'?(lang()==='id'?'Pilihan Hook':'Hook Pick'):(lang()==='id'?'Ranking Adegan':'Scene Ranking'),ranking,ranking[0]?.clip,mode,false);
    };
    try{
      const frames=[];
      for(const c of source.slice(0,8)){const b64=await captureFrame(c.url||c.url,mode==='hook'?.18:.45);if(b64)frames.push({name:c.name,b64});}
      if(!frames.length)throw new Error('No video frames could be captured');
      const content=[{type:'text',text:`You are selecting footage for a short-form marketing edit. Mode: ${mode==='hook'?'HOOK — choose the strongest opening frame/clip':'BEST SCENES — rank all supplied clips'}.
Clip names are source-of-truth. Do not invent names. Return ONLY JSON in this exact shape: {"ranking":[{"clip":"exact clip name","reason":"short reason"}],"topPick":"exact clip name"}. Use ${lang()==='id'?'Indonesian':'English'} for reasons.`}];
      frames.forEach(f=>{content.push({type:'text',text:`Source clip: ${f.name}`});content.push({type:'image',source:{type:'base64',media_type:'image/jpeg',data:f.b64}});});
      const parsed=safeJson(await ai(content,1400));
      if(!parsed?.ranking?.length||!parsed.topPick)throw new Error('AI returned an invalid scene ranking');
      renderRanking(mode==='hook'?(lang()==='id'?'Pilihan Hook':'Hook Pick'):(lang()==='id'?'Ranking Adegan':'Scene Ranking'),parsed.ranking,parsed.topPick,mode,true);
    }catch(e){console.warn('[ClipForge vision]',e);fallback();}
    hideToast();
  }

  window.runAutoHook=()=>runVision('hook');
  window.runSceneChoose=()=>runVision('scenes');

  /* ---------- Prompt-based edit ---------- */
  function promptContext(){
    return JSON.stringify(listMedia().map((m,i)=>({
      index:i+1,name:m.name,duration:+Number(m.duration||0).toFixed(2),
      highlights:(m.highlights||[]).slice(0,8).map(h=>({start:+Number(h.start||0).toFixed(2),end:+Number(h.end||0).toFixed(2)})),
      transcript:(m.transcript||[]).slice(0,40).map(w=>({word:w.word,start:+Number(w.start||0).toFixed(2),end:+Number(w.end||0).toFixed(2)}))
    })));
  }
  function targetDuration(prompt){
    const m=String(prompt).match(/(?:^|\s)(\d+(?:\.\d+)?)\s*(?:s|sec|secs|second|seconds)\b/i);
    return m?Math.max(.8,Math.min(120,Number(m[1]))):30;
  }
  function localPromptPlan(prompt){
    const ms=listMedia();if(!ms.length)return null;
    const lower=prompt.toLowerCase(),target=targetDuration(prompt);
    const ordered=ms.slice().sort((a,b)=>localHookScore(b)-localHookScore(a));
    const named=ms.filter(m=>new RegExp(`\\b${String(m.name).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\b`,'i').test(prompt));
    const pool=named.length?named:ordered;
    const clips=[];let total=0;
    for(const m of pool){
      if(total>=target)break;
      const best=(m.highlights||[]).slice().sort((a,b)=>localSceneScore(m)-localSceneScore(m))[0];
      const start=Math.max(0,Number(best?.start||0));
      const available=Math.max(.2,(Number(best?.end||0)-start)||Math.min(Number(m.duration||3),4));
      const take=Math.min(available,target-total);
      if(take>=.2){clips.push({name:m.name,start,end:start+take,reason:'detected highlight'});total+=take;}
    }
    if(!clips.length){for(const m of pool){if(total>=target)break;const take=Math.min(Number(m.duration||3),target-total);if(take>=.2){clips.push({name:m.name,start:0,end:take,reason:'coverage'});total+=take;}}}
    return {summary:`Built a ${total.toFixed(1)}s edit from ${clips.length} source clip(s) using the strongest available moments.`,hookLine:pool[0]?.name||'',captionIdeas:[],suggestedOrder:pool.map(m=>m.name),clips,targetDuration:target};
  }
  function applyEditPlan(plan){
    const ms=listMedia();if(!ms.length||!plan)return;
    const existing=listTimeline();
    const entries=Array.isArray(plan.clips)?plan.clips:[];
    const byName=new Map(ms.map(m=>[m.name,m]));
    let next=[];
    if(entries.length){
      next=entries.map(e=>{const m=byName.get(e.name)||ms.find(x=>x.name===e.clip);if(!m)return null;const dur=Number(m.duration||1),s=Math.max(0,Math.min(dur,Number(e.start||0))),end=Math.max(s+.2,Math.min(dur,Number(e.end??Math.min(dur,s+3))));return {id:uid(),mediaId:m.id,name:m.name,url:m.url,duration:dur,trimIn:s,trimOut:end,highlights:m.highlights||[]};}).filter(Boolean);
    }
    if(!next.length){
      const names=Array.isArray(plan.suggestedOrder)?plan.suggestedOrder:ms.map(m=>m.name);
      const source=names.map(n=>byName.get(n)).filter(Boolean);
      next=source.map(m=>{const h=(m.highlights||[]).slice().sort((a,b)=>Number(a.start||0)-Number(b.start||0))[0];const s=Math.max(0,Number(h?.start||0));return {id:uid(),mediaId:m.id,name:m.name,url:m.url,duration:Number(m.duration||1),trimIn:s,trimOut:Math.min(Number(m.duration||1),s+Math.min(4,targetDuration(''))),highlights:m.highlights||[]};});
    }
    const limit=targetDuration(plan._prompt||'');
    let total=0;next=next.filter(c=>{const d=Math.max(.2,c.trimOut-c.trimIn);if(total>=limit)return false;const take=Math.min(d,limit-total);c.trimOut=c.trimIn+take;total+=take;return take>=.2;});
    if(!next.length&&existing.length)next=existing;
    saveTimeline(next);
    toast(lang()==='id'?`Edit diterapkan — ${total.toFixed(1)} detik`:`Edit applied — ${total.toFixed(1)} seconds`);
  }
  function renderPrompt(plan,prompt,usedAI){
    const body=document.getElementById('resultsBody');if(!body)return;if(typeof window.clearEmptyRight==='function')window.clearEmptyRight();
    const card=document.createElement('div');card.className='result-card';
    const order=Array.isArray(plan.suggestedOrder)?plan.suggestedOrder:[];
    card.innerHTML=`<h4>${lang()==='id'?'Rencana Edit AI':'AI Edit Plan'} ${usedAI?'<span class="badge">AI</span>':'<span class="badge">LOCAL</span>'}</h4>
      <div>${esc(plan.summary||'Edit plan ready.')}</div>
      ${plan.hookLine?`<div style="margin-top:7px"><b>Hook:</b> ${esc(plan.hookLine)}</div>`:''}
      ${order.length?`<div style="margin-top:7px"><b>${lang()==='id'?'Urutan':'Order'}:</b> ${order.map(esc).join(' → ')}</div>`:''}
      ${Array.isArray(plan.captionIdeas)&&plan.captionIdeas.length?`<div style="margin-top:7px"><b>${lang()==='id'?'Caption':'Captions'}:</b><ul style="margin:4px 0 0 16px;padding:0">${plan.captionIdeas.slice(0,5).map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div>`:''}
      <button class="apply-btn" data-apply-edit="1">${lang()==='id'?'Terapkan edit ke timeline':'Apply edit to timeline'}</button>`;
    body.prepend(card);card.querySelector('[data-apply-edit]').onclick=()=>applyEditPlan({...plan,_prompt:prompt});
    // Prompt-based edit is an edit command, so apply it once immediately.
    applyEditPlan({...plan,_prompt:prompt});
  }
  window.runPromptEdit=async()=>{
    const input=document.getElementById('promptInput'),prompt=input?.value.trim();
    if(!prompt){toast(lang()==='id'?'Tulis prompt dulu':'Write a prompt first');return;}
    const btn=document.getElementById('promptRunBtn');if(btn)btn.disabled=true;
    toast(lang()==='id'?'AI menyusun edit…':'AI is building the edit…',true);
    let plan=null,usedAI=true;
    try{
      if(!listMedia().length)throw new Error(lang()==='id'?'Impor klip dulu':'Import clips first');
      const instruction=`Create an executable short-form video edit plan for this user request: "${prompt}".
Available source clips and detected data (do not invent source names or timestamps): ${promptContext()}
Return ONLY JSON: {"summary":"one sentence","hookLine":"short hook or empty string","captionIdeas":["..."],"suggestedOrder":["exact source names"],"clips":[{"name":"exact source name","start":0,"end":2.5,"reason":"why"}]}.
Use exact real source durations. Keep total clip duration at or below the user's requested duration when one is specified. If a source has highlight windows, prefer those windows.`;
      plan=safeJson(await ai(instruction,1800));
      if(!plan||(!Array.isArray(plan.suggestedOrder)&&!Array.isArray(plan.clips)))throw new Error('Invalid AI edit plan');
    }catch(e){console.warn('[ClipForge prompt]',e);plan=localPromptPlan(prompt);usedAI=false;}
    hideToast();
    if(plan){renderPrompt(plan,prompt,usedAI);}else toast(lang()==='id'?'Tidak ada klip untuk diedit':'No clips available to edit');
    if(btn)btn.disabled=false;
  };

  // Preserve compatibility for Phase 4 consumers that call these names.
  api.runSmartAutoEdit=window.runAutoEditAll||api.runSmartAutoEdit;
  api.autoCut=window.runAutoCut||api.autoCut;
  api.autoHighlights=window.runAutoCut||api.autoHighlights;
  api.autoHook=window.runAutoHook;
  api.bestScene=window.runSceneChoose;

  import('./phase5-subtitle-studio.js')
    .then(()=>window.dispatchEvent(new CustomEvent('clipforge:phase5-ready')))
    .then(()=>import('./phase6-cloud-projects.js'))
    .then(()=>window.dispatchEvent(new CustomEvent('clipforge:phase6-ready')))
    .catch(err=>console.error('[ClipForge Phase 5/6]',err));
})();
