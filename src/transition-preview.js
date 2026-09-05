(() => {
  const $ = s => document.querySelector(s);
  const getEngine = () => window.__clipForgeEditEngine;
  const names = ['fade','fadeblack','fadewhite','wipeleft','wiperight','slideleft','slideright','smoothleft','smoothright','circleopen','circleclose'];

  function setup() {
    const v = $('#previewVideo');
    if (!v || $('#cfTransitionCanvas')) return;
    const host = v.parentElement;
    if (!host) return;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    const c = document.createElement('canvas');
    c.id = 'cfTransitionCanvas';
    c.setAttribute('aria-hidden','true');
    c.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;display:none;z-index:40;pointer-events:none;background:#000;';
    host.appendChild(c);
    const style = document.createElement('style');
    style.id = 'cfTransitionPreviewCSS';
    style.textContent = `
      @keyframes cfFadeOut { from { opacity:1 } to { opacity:0 } }
      @keyframes cfSlideLeft { from { transform:translateX(0);opacity:1 } to { transform:translateX(-100%);opacity:1 } }
      @keyframes cfSlideRight { from { transform:translateX(0);opacity:1 } to { transform:translateX(100%);opacity:1 } }
      @keyframes cfWipeLeft { from { clip-path:inset(0 0 0 0) } to { clip-path:inset(0 100% 0 0) } }
      @keyframes cfWipeRight { from { clip-path:inset(0 0 0 0) } to { clip-path:inset(0 0 0 100%) } }
      @keyframes cfCircle { from { clip-path:circle(100% at 50% 50%) } to { clip-path:circle(0% at 50% 50%) } }
      #cfTransitionCanvas.cf-fade { animation:cfFadeOut var(--cf-d,.35s) ease both }
      #cfTransitionCanvas.cf-slideleft { animation:cfSlideLeft var(--cf-d,.35s) ease both }
      #cfTransitionCanvas.cf-slideright { animation:cfSlideRight var(--cf-d,.35s) ease both }
      #cfTransitionCanvas.cf-wipeleft { animation:cfWipeLeft var(--cf-d,.35s) ease both }
      #cfTransitionCanvas.cf-wiperight { animation:cfWipeRight var(--cf-d,.35s) ease both }
      #cfTransitionCanvas.cf-smoothleft,#cfTransitionCanvas.cf-smoothright { animation:cfFadeOut var(--cf-d,.35s) ease both }
      #cfTransitionCanvas.cf-circleopen,#cfTransitionCanvas.cf-circleclose { animation:cfCircle var(--cf-d,.35s) ease both }
      #cfTransitionCanvas.cf-fadeblack,#cfTransitionCanvas.cf-fadewhite { animation:cfFadeOut var(--cf-d,.35s) ease both }
    `;
    document.head.appendChild(style);
  }

  let lastIndex = -1;
  let armed = false;

  function captureAndShow(type, duration) {
    const v = $('#previewVideo'), c = $('#cfTransitionCanvas');
    if (!v || !c || !v.videoWidth || !v.videoHeight) return;
    const w = v.clientWidth || v.videoWidth, h = v.clientHeight || v.videoHeight;
    c.width = Math.max(1, w * devicePixelRatio);
    c.height = Math.max(1, h * devicePixelRatio);
    const ctx = c.getContext('2d');
    try {
      ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);
      ctx.clearRect(0,0,w,h);
      const vw=v.videoWidth,vh=v.videoHeight,scale=Math.min(w/vw,h/vh),dw=vw*scale,dh=vh*scale;
      ctx.fillStyle='#000';ctx.fillRect(0,0,w,h);
      ctx.drawImage(v,(w-dw)/2,(h-dh)/2,dw,dh);
    } catch (_) { return; }
    const classes = names.map(x=>'cf-'+x);
    c.classList.remove(...classes);
    const d = Math.max(.12, Math.min(1.0, Number(duration)||.35));
    c.style.setProperty('--cf-d', `${d}s`);
    if (type === 'fadeblack') c.style.background='#000';
    else if (type === 'fadewhite') c.style.background='#fff';
    else c.style.background='transparent';
    c.style.display='block';
    void c.offsetWidth;
    c.classList.add('cf-'+(names.includes(type)?type:'fade'));
    setTimeout(() => { c.style.display='none'; c.classList.remove(...classes); }, d*1000+80);
  }

  function tick() {
    const e=getEngine(), v=$('#previewVideo'), p=e?.plan;
    if (!e || !v || !p?.clips?.length) return;
    const i=Number(e.previewIndex)||0;
    const clip=p.clips[i];
    if (!clip || i===p.clips.length-1) { armed=false; lastIndex=i; return; }
    const td=Math.max(.12,Number(p.clips[i+1]?.transitionDuration || clip.transitionDuration)||.35);
    const remaining=Number(clip.end)-Number(v.currentTime);
    if (!armed && remaining > 0 && remaining <= td + .08) {
      armed=true;
      captureAndShow(p.clips[i+1]?.transition || clip.transition || 'fade', td);
    }
    if (i!==lastIndex) { lastIndex=i; if (remaining > td+.08) armed=false; }
    if (remaining > td+.2) armed=false;
  }

  function watch() {
    setup();
    document.addEventListener('timeupdate', e => { if(e.target?.id==='previewVideo') tick(); }, true);
    document.addEventListener('loadedmetadata', e => { if(e.target?.id==='previewVideo'){armed=false;lastIndex=-1;setTimeout(tick,40)} }, true);
    const obs=new MutationObserver(() => setup());
    obs.observe(document.body,{childList:true,subtree:true});
    setInterval(() => { setup(); tick(); }, 180);
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',watch,{once:true}); else watch();
})();
