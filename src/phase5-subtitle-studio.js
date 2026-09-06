/* ClipForge AI — Phase 5 Subtitle Studio
 * Word boxes, keyword highlighting, styles, animations, position controls,
 * and true word timestamps from the Cloud Whisper response.
 */
(() => {
  'use strict';

  const STORAGE_KEY = 'clipforge.subtitleStudio.v1';
  const defaults = {
    enabled: true, wordBoxes: true, keywordHighlight: true, keywords: '',
    style: 'karaoke', animation: 'pop', positionX: 50, positionY: 82,
    fontSize: 5.0, maxWords: 5, boxRadius: 10, boxOpacity: 0.78,
    textTransform: 'uppercase', keywordColor: '#FFD166', activeColor: '#7c5cff', textColor: '#ffffff'
  };
  let settings = loadSettings();
  let selectedWord = null, lastActiveKey = '';

  function loadSettings(){ try{return {...defaults,...JSON.parse(localStorage.getItem(STORAGE_KEY)||'{}')}}catch{return {...defaults}} }
  function saveSettings(){try{localStorage.setItem(STORAGE_KEY,JSON.stringify(settings))}catch{}}
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const currentMedia=()=>(window.media&&window.media.length)?window.media:(window.getMedia?window.getMedia():[]);
  const currentTimeline=()=>(window.timeline&&window.timeline.length)?window.timeline:(window.getTimeline?window.getTimeline():[]);
  const mediaForClip=c=>{
    const list = currentMedia();
    return list.find(m=>m.id===c?.mediaId)||list.find(m=>m.url===c?.url)||(c?.transcript?c:null);
  };
  function activeClipAt(elapsed){
    const v=document.getElementById('previewVideo');
    const tl=currentTimeline();
    // 1. Sequence playback mode
    if(window.seq && window.seq.mode==='sequence' && tl.length){
      let acc=0;
      for(const clip of tl){
        const d=Math.max(.01,(clip.trimOut??clip.duration)-(clip.trimIn??0));
        if(elapsed<=acc+d+.05){
          return {clip,sourceTime:(clip.trimIn||0)+Math.max(0,elapsed-acc)};
        }
        acc+=d;
      }
      if(tl[window.seq.index]){
        const c=tl[window.seq.index];
        return {clip:c,sourceTime:v?v.currentTime:(c.trimIn||0)};
      }
    }
    // 2. Single clip or idle preview
    if(v && v.src){
      const m=currentMedia().find(x=>x.url===v.src);
      if(m) return {clip:{id:'m_prev',mediaId:m.id,duration:m.duration,trimIn:0,trimOut:m.duration},sourceTime:v.currentTime};
    }
    // 3. Fallback to first timeline clip if video loaded
    if(tl.length && v){
      const c=tl.find(x=>x.url===v.src)||tl[0];
      return {clip:c,sourceTime:v.currentTime};
    }
    return null;
  }
  function findActiveWordIndex(words, time){
    if(!words||!words.length)return -1;
    // 1. Exact match
    const exact=words.findIndex(w=>time>=Number(w.start)&&time<Number(w.end));
    if(exact>=0)return exact;
    // 2. Small gap tolerance between words (up to 0.75s pause)
    for(let i=0;i<words.length;i++){
      const w=words[i];
      if(time>=Number(w.start)&&time<=Number(w.end)+0.75)return i;
      if(i<words.length-1&&time>Number(w.end)&&time<Number(words[i+1].start)){
        return (time-Number(w.end)<Number(words[i+1].start)-time)?i:i+1;
      }
    }
    // 3. Just before first word
    if(time>=Math.max(0,Number(words[0].start)-0.4)&&time<Number(words[0].start))return 0;
    return -1;
  }
  function keywords(){return settings.keywords.split(',').map(s=>s.trim().toLowerCase()).filter(Boolean)}
  function isKeyword(word){const w=String(word||'').toLowerCase().replace(/[^\p{L}\p{N}']/gu,'');return keywords().some(k=>w===k||w.includes(k))}
  function injectStyles(){if(document.getElementById('phase5SubtitleStyles'))return;const s=document.createElement('style');s.id='phase5SubtitleStyles';s.textContent=`
#subtitleStudioPanel{border:1px solid var(--border);background:var(--panel-2);border-radius:10px;margin-bottom:10px;overflow:hidden}.ss-head{display:flex;align-items:center;justify-content:space-between;padding:9px 10px;border-bottom:1px solid var(--border)}.ss-head strong{font-size:12px}.ss-chip{font-size:9px;color:var(--ok);background:rgba(52,211,153,.12);padding:2px 6px;border-radius:999px}.ss-body{padding:10px}.ss-row{display:flex;align-items:center;gap:8px;margin:7px 0}.ss-row label{font-size:10.5px;color:var(--muted);min-width:70px}.ss-row input[type=range]{flex:1}.ss-row select,.ss-row input[type=text]{flex:1;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:6px;font-size:11px}.ss-value{font-family:'IBM Plex Mono',monospace;font-size:9.5px;color:var(--muted-2);width:38px;text-align:right}.ss-actions{display:flex;gap:6px;margin-top:9px}.ss-actions button{flex:1}.ss-word-list{max-height:150px;overflow:auto;border-top:1px solid var(--border);margin-top:8px;padding-top:7px}.ss-word{display:inline-flex;gap:5px;align-items:center;margin:2px;padding:3px 5px;border:1px solid transparent;border-radius:5px;background:var(--bg);font-size:10px;cursor:pointer;color:var(--text)}.ss-word:hover,.ss-word.selected{border-color:var(--ai)}.ss-word time{color:var(--muted-2);font-family:'IBM Plex Mono',monospace;font-size:8px}.subtitle-overlay{transition:transform .12s ease,opacity .12s ease}.subtitle-overlay.ss-pop .word{animation:ssPop .22s ease both}.subtitle-overlay.ss-bounce .word{animation:ssBounce .36s ease both}.subtitle-overlay.ss-slide .word{animation:ssSlide .28s ease both}.subtitle-overlay.ss-fade .word{animation:ssFade .24s ease both}@keyframes ssPop{from{opacity:0;transform:scale(.7)}to{opacity:1;transform:scale(1)}}@keyframes ssBounce{0%{opacity:0;transform:translateY(12px) scale(.8)}65%{transform:translateY(-3px) scale(1.04)}100%{opacity:1;transform:none}}@keyframes ssSlide{from{opacity:0;transform:translateX(18px)}to{opacity:1;transform:none}}@keyframes ssFade{from{opacity:0}to{opacity:1}}.ss-toggle{appearance:none;width:34px;height:19px;border-radius:12px;background:#333;position:relative;outline:none;cursor:pointer}.ss-toggle:checked{background:var(--ai)}.ss-toggle:after{content:'';position:absolute;width:15px;height:15px;left:2px;top:2px;background:#fff;border-radius:50%;transition:.15s}.ss-toggle:checked:after{left:17px}`;document.head.appendChild(s)}
  function makePanel(){injectStyles();const right=document.getElementById('right');if(!right||document.getElementById('subtitleStudioPanel'))return;const panel=document.createElement('div');panel.id='subtitleStudioPanel';panel.innerHTML=`<div class="ss-head"><strong>💬 Subtitle Studio</strong><span class="ss-chip">LIVE</span></div><div class="ss-body"><div class="ss-row"><label>Subtitles</label><input class="ss-toggle" id="ssEnabled" type="checkbox"></div><div class="ss-row"><label>Word boxes</label><input class="ss-toggle" id="ssBoxes" type="checkbox"></div><div class="ss-row"><label>Keyword</label><input class="ss-toggle" id="ssKeyword" type="checkbox"></div><div class="ss-row"><label>Keywords</label><input id="ssKeywords" type="text" placeholder="hook, amazing, important"></div><div class="ss-row"><label>Style</label><select id="ssStyle"><option value="karaoke">Karaoke</option><option value="boxed">Boxed</option><option value="clean">Clean</option><option value="outline">Outline</option></select></div><div class="ss-row"><label>Animation</label><select id="ssAnimation"><option value="pop">Pop</option><option value="bounce">Bounce</option><option value="slide">Slide</option><option value="fade">Fade</option><option value="none">None</option></select></div><div class="ss-row"><label>Position X</label><input id="ssX" type="range" min="8" max="92" step="1"><span class="ss-value" id="ssXV"></span></div><div class="ss-row"><label>Position Y</label><input id="ssY" type="range" min="8" max="92" step="1"><span class="ss-value" id="ssYV"></span></div><div class="ss-row"><label>Font size</label><input id="ssFont" type="range" min="2.5" max="8" step=".1"><span class="ss-value" id="ssFontV"></span></div><div class="ss-row"><label>Max words</label><input id="ssWords" type="range" min="1" max="8" step="1"><span class="ss-value" id="ssWordsV"></span></div><div class="ss-actions"><button class="apply-btn" id="ssReset">Reset</button><button class="apply-btn" id="ssApply">Apply</button></div><div class="ss-word-list" id="ssWordList"><span style="font-size:10px;color:var(--muted-2)">Run Auto Transcript to load real word timestamps.</span></div></div>`;right.prepend(panel);bindPanel(panel);syncPanel()}
  function bindPanel(panel){const $=id=>panel.querySelector('#'+id);const bind=(id,key,transform=v=>v)=>$(id).addEventListener('input',e=>{settings[key]=transform(e.target.value);saveSettings();syncPanel();renderOverlay()});$('ssEnabled').addEventListener('change',e=>{settings.enabled=e.target.checked;saveSettings();renderOverlay()});$('ssBoxes').addEventListener('change',e=>{settings.wordBoxes=e.target.checked;saveSettings();renderOverlay()});$('ssKeyword').addEventListener('change',e=>{settings.keywordHighlight=e.target.checked;saveSettings();renderOverlay()});bind('ssKeywords','keywords');bind('ssStyle','style');bind('ssAnimation','animation');bind('ssX','positionX',Number);bind('ssY','positionY',Number);bind('ssFont','fontSize',Number);bind('ssWords','maxWords',Number);$('ssReset').addEventListener('click',()=>{settings={...defaults};saveSettings();syncPanel();renderOverlay()});$('ssApply').addEventListener('click',()=>{saveSettings();refreshWordList();renderOverlay();window.showToast?.('Subtitle style applied')})}
  function syncPanel(){const p=document.getElementById('subtitleStudioPanel');if(!p)return;const $=id=>p.querySelector('#'+id);$('ssEnabled').checked=!!settings.enabled;$('ssBoxes').checked=!!settings.wordBoxes;$('ssKeyword').checked=!!settings.keywordHighlight;$('ssKeywords').value=settings.keywords;$('ssStyle').value=settings.style;$('ssAnimation').value=settings.animation;$('ssX').value=settings.positionX;$('ssY').value=settings.positionY;$('ssFont').value=settings.fontSize;$('ssWords').value=settings.maxWords;$('ssXV').textContent=settings.positionX+'%';$('ssYV').textContent=settings.positionY+'%';$('ssFontV').textContent=settings.fontSize.toFixed(1)+'%';$('ssWordsV').textContent=settings.maxWords;refreshWordList()}
  function findCurrentWords(){const tl=currentTimeline();if(!tl.length)return [];const hit=activeClipAt(Number(window.seq?.elapsed||0));if(!hit)return [];return mediaForClip(hit.clip)?.transcript||[]}
  function refreshWordList(){const p=document.getElementById('ssWordList');if(!p)return;const words=findCurrentWords();if(!words.length){p.innerHTML='<span style="font-size:10px;color:var(--muted-2)">Run Auto Transcript to load real word timestamps.</span>';return}p.innerHTML=words.map((w,i)=>`<button class="ss-word" data-i="${i}"><time>${fmt(w.start)}</time>${esc(w.word)}</button>`).join('');p.querySelectorAll('.ss-word').forEach(b=>b.addEventListener('click',()=>{const w=words[Number(b.dataset.i)];selectedWord=w;const hit=activeClipAt(Number(window.seq?.elapsed||0));if(hit&&window.seekSequence)window.seekSequence(timelineElapsedToClip(hit.clip,w.start))}))}
  function timelineElapsedToClip(clip,sourceTime){let acc=0;for(const c of currentTimeline()){if(c===clip)return acc+Math.max(0,sourceTime-(c.trimIn||0));acc+=Math.max(.01,(c.trimOut||c.duration)-(c.trimIn||0))}return acc}
  function fmt(s){s=Math.max(0,Number(s)||0);return `${String(Math.floor(s/60)).padStart(2,'0')}:${(s%60).toFixed(2).padStart(5,'0')}`}
  function renderOverlay(){
    const overlay=document.getElementById('subtitleOverlay');
    if(!overlay)return;
    if(!settings.enabled){overlay.classList.add('hidden');return}
    const hit=activeClipAt(Number(window.seq?.elapsed||0));
    if(!hit){overlay.classList.add('hidden');return}
    const m=mediaForClip(hit.clip),words=m?.transcript||[];
    if(!words.length){overlay.classList.add('hidden');return}
    const idx=findActiveWordIndex(words, hit.sourceTime);
    if(idx<0){overlay.classList.add('hidden');return}
    const start=Math.max(0,idx-Math.floor(settings.maxWords/2)),visible=words.slice(start,start+settings.maxWords);
    overlay.className='subtitle-overlay ss-'+settings.animation;
    overlay.style.left=settings.positionX+'%';
    overlay.style.bottom=(100-settings.positionY)+'%';
    overlay.style.transform='translateX(-50%)';
    overlay.style.maxWidth='90%';
    overlay.style.gap='6px';
    overlay.innerHTML=visible.map((w,i)=>{
      const active=start+i===idx,kw=settings.keywordHighlight&&isKeyword(w.word);
      let style=`font-size:clamp(12px,${settings.fontSize}vw,72px);text-transform:${settings.textTransform};`;
      if(kw)style+=`color:${settings.keywordColor};`;
      if(settings.wordBoxes)style+=`background:${active?settings.activeColor:'rgba(0,0,0,'+settings.boxOpacity+')'};border-radius:${settings.boxRadius}px;`;
      else if(settings.style==='outline')style+='background:transparent;text-shadow:-2px -2px 0 #000,2px -2px 0 #000,-2px 2px 0 #000,2px 2px 0 #000;';
      else style+='background:transparent;';
      return `<span class="word${active?' active':''}${kw?' keyword':''}" style="${style}" data-word-index="${start+i}">${esc(w.word)}</span>`
    }).join('');
    overlay.classList.remove('hidden');
    const key=`${m.id}:${idx}:${settings.style}:${settings.animation}`;
    if(key!==lastActiveKey){lastActiveKey=key;void overlay.offsetWidth}
  }
  function hookPlayback(){const v=document.getElementById('previewVideo');if(!v)return;v.addEventListener('timeupdate',()=>{renderOverlay();refreshWordList()},{passive:true});window.addEventListener('clipforge:subtitle-refresh',renderOverlay)}
  window.drawCaptionOnCanvas=function(ctx,canvas,m,tInClip){
    if(!settings.enabled)return;
    const words=m?.transcript||[];
    if(!words.length)return;
    const idx=findActiveWordIndex(words, tInClip);
    if(idx<0)return;
    const start=Math.max(0,idx-Math.floor(settings.maxWords/2)),visible=words.slice(start,start+settings.maxWords);
    const fs=Math.round(canvas.width*(settings.fontSize/100));
    ctx.save();
    ctx.font=`800 ${fs}px Inter,sans-serif`;
    ctx.textBaseline='middle';
    ctx.textAlign='left';
    const gap=Math.round(fs*.28),padX=Math.round(fs*.34);
    const boxes=visible.map((w,i)=>({
      w,
      active:start+i===idx,
      kw:settings.keywordHighlight&&isKeyword(w.word),
      width:ctx.measureText(String(w.word).toUpperCase()).width+padX*2
    }));
    const total=boxes.reduce((n,b)=>n+b.width,0)+gap*Math.max(0,boxes.length-1);
    let x=canvas.width*(settings.positionX/100)-total/2;
    const y=canvas.height*(settings.positionY/100);
    boxes.forEach(b=>{
      const h=fs*1.35;
      if(settings.wordBoxes){
        ctx.fillStyle=b.active?settings.activeColor:`rgba(0,0,0,${settings.boxOpacity})`;
        round(ctx,x,y-h/2,b.width,h,settings.boxRadius);
        ctx.fill();
      }else if(settings.style==='outline'){
        ctx.strokeStyle='rgba(0,0,0,.85)';
        ctx.lineWidth=Math.max(3,fs*.12);
        ctx.strokeText(String(b.w.word).toUpperCase(),x+padX,y);
      }
      ctx.fillStyle=b.kw?settings.keywordColor:settings.textColor;
      ctx.fillText(String(b.w.word).toUpperCase(),x+padX,y);
      x+=b.width+gap;
    });
    ctx.restore();
  };
  window.__studioDrawCaption = window.drawCaptionOnCanvas;
  window.__subtitleSettings = settings;
  function round(ctx,x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath()}
  const oldRun=window.runAutoTranscript;window.runAutoTranscript=async function(){if(typeof oldRun==='function')await oldRun();makePanel();syncPanel();renderOverlay()};
  function boot(){makePanel();hookPlayback();setInterval(()=>{if(document.visibilityState==='visible')renderOverlay()},120)}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
