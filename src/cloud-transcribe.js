(() => {
  const filesByName = new Map();
  const rememberFiles = files => { for (const file of files || []) filesByName.set(file.name, file); };

  document.addEventListener('change', event => {
    const input = event.target;
    if (input instanceof HTMLInputElement && input.type === 'file') rememberFiles(input.files);
  }, true);
  document.addEventListener('drop', event => rememberFiles(event.dataTransfer?.files), true);

  const $ = selector => document.querySelector(selector);
  const fmt = seconds => {
    seconds = Math.max(0, Number(seconds) || 0);
    const m = Math.floor(seconds / 60), s = Math.floor(seconds % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };
  const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const status = (text, kind = 'ready') => {
    const label = $('#statusText'), dot = $('#statusDot');
    if (label) label.textContent = text;
    if (dot) dot.className = `dot ${kind === 'busy' ? 'busy' : kind === 'error' ? 'error' : ''}`;
  };
  const progress = value => { const bar = $('#progressBar'); if (bar) bar.style.width = `${Math.max(0, Math.min(100, value))}%`; };
  const toast = message => {
    const el = $('#toast'); if (!el) return;
    el.textContent = message; el.classList.add('show');
    clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 4500);
  };

  function selectedFile() {
    const active = $('.asset.active');
    const name = active?.querySelector('.asset-name')?.textContent?.trim();
    if (name && filesByName.has(name)) return filesByName.get(name);
    const preview = $('#previewVideo');
    const source = preview?.currentSrc || preview?.src || '';
    for (const file of filesByName.values()) {
      if (source && file.name === name) return file;
    }
    return filesByName.values().next().value || null;
  }

  async function decodeAudio(file) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!AudioCtx || !OfflineCtx) throw new Error('This browser does not support Web Audio decoding.');
    const ctx = new AudioCtx();
    let decoded;
    try {
      decoded = await ctx.decodeAudioData((await file.arrayBuffer()).slice(0));
    } finally { try { await ctx.close(); } catch {} }

    const sampleRate = 16000;
    const frames = Math.max(1, Math.ceil(decoded.duration * sampleRate));
    const offline = new OfflineCtx(1, frames, sampleRate);
    const source = offline.createBufferSource();
    const mono = offline.createBuffer(1, decoded.length, decoded.sampleRate);
    const output = mono.getChannelData(0);
    for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
      const data = decoded.getChannelData(channel);
      for (let i = 0; i < output.length; i++) output[i] += data[i] / decoded.numberOfChannels;
    }
    source.buffer = mono;
    source.connect(offline.destination);
    source.start(0);
    const rendered = await offline.startRendering();
    return { samples: rendered.getChannelData(0).slice(), duration: decoded.duration };
  }

  function wavBlob(samples, sampleRate = 16000) {
    const pcm = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      const x = Math.max(-1, Math.min(1, samples[i]));
      pcm[i] = x < 0 ? x * 0x8000 : x * 0x7fff;
    }
    const buffer = new ArrayBuffer(44 + pcm.byteLength);
    const view = new DataView(buffer);
    const write = (offset, text) => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)); };
    write(0, 'RIFF'); view.setUint32(4, 36 + pcm.byteLength, true); write(8, 'WAVE');
    write(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    write(36, 'data'); view.setUint32(40, pcm.byteLength, true); new Int16Array(buffer, 44).set(pcm);
    return new Blob([buffer], { type: 'audio/wav' });
  }

  async function transcribe() {
    const file = selectedFile();
    if (!file) return toast('Select an imported clip first.');
    const button = $('#transcribeBtn');
    if (button) button.disabled = true;
    try {
      status('Preparing fast cloud transcription…', 'busy'); progress(2);
      const decoded = await decodeAudio(file);
      progress(12);
      const chunkSeconds = 45;
      const chunkSamples = chunkSeconds * 16000;
      const total = Math.ceil(decoded.samples.length / chunkSamples);
      const segments = [];
      const language = $('#langSelect')?.value === 'id' ? 'id' : 'en';

      for (let index = 0; index < total; index++) {
        const start = index * chunkSamples;
        const end = Math.min(decoded.samples.length, start + chunkSamples);
        const audio = wavBlob(decoded.samples.slice(start, end));
        const response = await fetch('/api/transcribe', {
          method: 'POST',
          headers: { 'Content-Type': 'audio/wav', 'X-Language': language },
          body: audio
        });
        const text = await response.text();
        if (!response.ok) throw new Error(text || `Cloud transcription failed (${response.status}).`);
        const data = JSON.parse(text);
        const offset = index * chunkSeconds;
        for (const segment of data.segments || []) {
          const startTime = Number(segment.start) + offset;
          const endTime = Math.min(Number(segment.end) + offset, decoded.duration);
          const clean = String(segment.text || '').trim();
          if (clean && Number.isFinite(startTime) && Number.isFinite(endTime)) segments.push({ start: startTime, end: endTime, text: clean });
        }
        progress(12 + Math.round(((index + 1) / total) * 83));
        status(`Cloud transcription ${index + 1}/${total}…`, 'busy');
      }

      segments.sort((a, b) => a.start - b.start);
      window.__clipForgeCloudTranscript = segments;
      renderTranscript(segments);
      progress(100); status(`Transcript ready • ${segments.length} segments`);
      toast('Fast cloud transcript complete.');
    } catch (error) {
      console.error('[cloud-transcribe]', error);
      status('Cloud transcription unavailable', 'error');
      toast(error?.message || 'Cloud transcription failed. Local Whisper remains available if cloud mode is not configured.');
    } finally {
      if (button) button.disabled = !document.querySelector('.asset');
    }
  }

  function renderTranscript(segments) {
    const box = $('#transcript');
    if (box) {
      box.innerHTML = segments.length
        ? segments.map((s, i) => `<div class="segment" data-cloud-i="${i}"><span class="stamp">${fmt(s.start)}–${fmt(s.end)}</span><span class="txt">${esc(s.text)}</span></div>`).join('')
        : '<div class="status"><span class="dot"></span>No speech detected.</div>';
      box.querySelectorAll('.segment').forEach(el => el.onclick = () => { $('#previewVideo').currentTime = segments[Number(el.dataset.cloudI)].start; });
    }
    const cap = $('#captionTrack');
    const max = $('#previewVideo')?.duration || segments.at(-1)?.end || 1;
    if (cap) cap.innerHTML = segments.slice(0, 80).map(s => `<div class="clip" style="left:${s.start / max * 100}%;width:${Math.max(2, (s.end - s.start) / max * 100)}%"><b>${esc(s.text)}</b></div>`).join('');
  }

  const transcribeButton = $('#transcribeBtn');
  if (transcribeButton) transcribeButton.addEventListener('click', event => {
    event.preventDefault(); event.stopImmediatePropagation(); transcribe();
  }, true);

  const srtButton = $('#subtitleBtn');
  if (srtButton) srtButton.addEventListener('click', event => {
    const transcript = window.__clipForgeCloudTranscript;
    if (!transcript?.length) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const stamp = value => { const ms = Math.floor((value % 1) * 1000), whole = Math.floor(value), s = whole % 60, m = Math.floor(whole / 60); return `00:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(ms).padStart(3,'0')}`; };
    const srt = transcript.map((s, i) => `${i + 1}\n${stamp(s.start)} --> ${stamp(s.end)}\n${s.text}\n`).join('\n');
    const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([srt], { type: 'text/plain' })); link.download = 'captions.srt'; link.click();
  }, true);
})();
