/* ClipForge Phase 4 compatibility bridge + Phase 5/6 loaders. */
(() => {
  const api = window.ClipForgeSmartAI = window.ClipForgeSmartAI || {};

  // Bridge the editor's top-level lexical state into the module world.
  const bridge = (name, expression) => {
    if (Object.prototype.hasOwnProperty.call(window, name)) return;
    Object.defineProperty(window, name, {
      configurable: true,
      get() { try { return window.eval(expression); } catch { return undefined; } }
    });
  };
  bridge('media', 'media');
  bridge('timeline', 'timeline');
  bridge('seq', 'seq');

  // Phase 5 needs genuine word timestamps. The original inline helper
  // interpolated words across segment timestamps; replace that global helper
  // with the word-level response returned by the Cloud Whisper endpoint.
  function encodeWav(samples, sampleRate=16000) {
    const pcm = new Int16Array(samples.length);
    for (let i=0;i<samples.length;i++) {
      const x=Math.max(-1,Math.min(1,samples[i]));
      pcm[i]=x<0?x*32768:x*32767;
    }
    const buf=new ArrayBuffer(44+pcm.byteLength),v=new DataView(buf);
    const put=(o,t)=>{for(let i=0;i<t.length;i++)v.setUint8(o+i,t.charCodeAt(i));};
    put(0,'RIFF');v.setUint32(4,36+pcm.byteLength,true);put(8,'WAVE');put(12,'fmt ');
    v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);
    v.setUint32(24,sampleRate,true);v.setUint32(28,sampleRate*2,true);v.setUint16(32,2,true);
    v.setUint16(34,16,true);put(36,'data');v.setUint32(40,pcm.byteLength,true);new Int16Array(buf,44).set(pcm);
    return new Blob([buf],{type:'audio/wav'});
  }
  window.cloudTranscribe = async function(audio, lang, onProgress) {
    const rate=16000, chunkSec=55, size=chunkSec*rate, total=Math.ceil(audio.length/size), words=[];
    for(let i=0;i<total;i++) {
      const blob=encodeWav(audio.slice(i*size,Math.min(audio.length,(i+1)*size)),rate);
      const r=await fetch('/api/transcribe',{method:'POST',headers:{'Content-Type':'audio/wav','X-Language':lang},body:blob});
      const raw=await r.text(); if(!r.ok) throw new Error(raw||'Cloud transcription failed');
      const data=JSON.parse(raw), offset=i*chunkSec;
      if(Array.isArray(data.words) && data.words.length) {
        data.words.forEach(w=>{
          const word=String(w.word||'').trim(); if(!word) return;
          words.push({word,start:Number(w.start||0)+offset,end:Number(w.end||0)+offset});
        });
      } else {
        // Backward-compatible fallback if a provider omits word timestamps.
        for(const seg of (data.segments||[])) {
          const text=String(seg.text||'').trim(); if(!text) continue;
          const a=Number(seg.start||0)+offset,b=Number(seg.end||0)+offset;
          const parts=text.split(/\s+/).filter(Boolean),step=Math.max(.05,(b-a)/Math.max(1,parts.length));
          parts.forEach((word,j)=>words.push({word,start:a+j*step,end:Math.min(b,a+(j+1)*step)}));
        }
      }
      onProgress?.(i+1,total);
    }
    return words;
  };

  const bind = (name, fallback) => {
    if (typeof api[name] === 'function') return;
    api[name] = async (...args) => {
      if (typeof window[fallback] === 'function') return window[fallback](...args);
      return null;
    };
  };
  bind('runSmartAutoEdit', 'runAutoEditAll');
  bind('autoCut', 'runAutoCut');
  bind('autoHighlights', 'runAutoCut');
  bind('autoHook', 'runAutoHook');
  bind('bestScene', 'runSceneChoose');

  import('./phase5-subtitle-studio.js')
    .then(() => {
      window.dispatchEvent(new CustomEvent('clipforge:phase5-ready'));
      return import('./phase6-cloud-projects.js');
    })
    .then(() => window.dispatchEvent(new CustomEvent('clipforge:phase6-ready')))
    .catch(err => console.error('[ClipForge Phase 5/6] module failed to load', err));
})();
