// Reliable Auto Cut / Auto Hook controls.
// Cloud transcription is the source of truth when available. The controls
// also fall back to the rendered transcript so UI state changes cannot make a
// valid cloud transcript look missing.

(() => {
  const $ = (selector) => document.querySelector(selector);

  const parseTime = (value) => {
    const parts = String(value || '').trim().split(':').map(Number);
    if (parts.some(Number.isNaN)) return NaN;
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return NaN;
  };

  function normalizeTranscript(items) {
    return (Array.isArray(items) ? items : [])
      .map((item) => ({
        start: Number(item?.start),
        end: Number(item?.end),
        text: String(item?.text || '').trim()
      }))
      .filter((item) => item.text && Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > item.start)
      .sort((a, b) => a.start - b.start);
  }

  function readRenderedTranscript() {
    return [...document.querySelectorAll('#transcript .segment')]
      .map((el) => {
        const stamp = el.querySelector('.stamp')?.textContent || '';
        const text = el.querySelector('.txt')?.textContent?.trim() || '';
        const match = stamp.match(/([\d:]+)\s*[–-]\s*([\d:]+)/);
        if (!match || !text) return null;
        const start = parseTime(match[1]);
        const end = parseTime(match[2]);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
        return { start, end, text };
      })
      .filter(Boolean);
  }

  function readTranscript() {
    // Cloud Transcribe stores its completed result here. Prefer it because
    // main.js may re-render #transcript when selecting an asset or timeline.
    const cloud = normalizeTranscript(window.__clipForgeCloudTranscript);
    if (cloud.length) return cloud;
    return normalizeTranscript(readRenderedTranscript());
  }

  function notify(message) {
    const toast = $('#toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => toast.classList.remove('show'), 4200);
  }

  function getVideo() {
    const video = $('#previewVideo');
    return video && video.src ? video : null;
  }

  function bestHook(transcript) {
    const hookWords = [
      'why', 'how', 'secret', 'mistake', 'stop', 'best', 'you',
      'ini', 'cara', 'jangan', 'kenapa', 'rahasia', 'salah',
      'terbaik', 'ternyata', 'watch', 'lihat'
    ];
    const candidates = transcript.filter((s) => s.end - s.start <= 7 && s.text.length >= 8);
    const pool = candidates.length ? candidates : transcript;
    return [...pool].sort((a, b) => {
      const score = (s) => {
        const words = s.text.toLowerCase();
        const keywordScore = hookWords.reduce((sum, word) => sum + (words.includes(word) ? 18 : 0), 0);
        const shortness = Math.max(0, 7 - (s.end - s.start)) * 2;
        return Math.min(s.text.length, 80) + keywordScore + shortness;
      };
      return score(b) - score(a);
    })[0] || null;
  }

  function buildCuts(transcript) {
    const cuts = [];
    for (const segment of transcript) {
      const start = Math.max(0, segment.start - 0.12);
      const end = Math.max(start + 0.05, segment.end + 0.18);
      const previous = cuts[cuts.length - 1];
      if (!previous || start - previous.end > 0.65) {
        cuts.push({ start, end });
      } else {
        previous.end = Math.max(previous.end, end);
      }
    }
    return cuts;
  }

  function drawCutTimeline(cuts) {
    const lane = $('#videoTrack');
    const video = getVideo();
    if (!lane || !video || !cuts.length) return;

    // Keep the generated edit available to other editor code.
    window.__clipForgeAutoCuts = cuts.map((cut) => ({ ...cut }));

    const duration = Number(video.duration) || cuts[cuts.length - 1].end || 1;
    lane.innerHTML = cuts.map((cut, index) => {
      const left = Math.max(0, Math.min(100, cut.start / duration * 100));
      const width = Math.max(2, Math.min(100 - left, (cut.end - cut.start) / duration * 100));
      return `<div class="clip active auto-cut-clip" data-start="${cut.start}" data-end="${cut.end}" style="left:${left}%;width:${width}%">
        <b>Cut ${index + 1}</b><small>${fmt(cut.start)}–${fmt(cut.end)}</small>
      </div>`;
    }).join('');

    lane.querySelectorAll('.auto-cut-clip').forEach((clip) => {
      clip.addEventListener('click', () => {
        const start = Number(clip.dataset.start);
        if (Number.isFinite(start)) {
          video.currentTime = start;
          video.play().catch(() => {});
        }
      });
    });
  }

  function fmt(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function handleClick(event) {
    const button = event.target.closest('#autoCutBtn, #hookBtn');
    if (!button) return;

    const transcript = readTranscript();

    // A cloud transcript is valid even when main.js's private transcript was
    // reset. Consume it here before main.js can show the stale error.
    if (!transcript.length) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    const video = getVideo();
    if (!video) {
      notify('Import a video clip first.');
      return;
    }

    if (button.id === 'hookBtn') {
      const hook = bestHook(transcript);
      if (!hook) {
        notify('No suitable hook was found in the transcript.');
        return;
      }
      video.currentTime = hook.start;
      video.play().catch(() => {});
      notify(`Best hook: “${hook.text}”`);
      return;
    }

    const cuts = buildCuts(transcript);
    drawCutTimeline(cuts);
    notify(`Auto Cut found ${cuts.length} spoken regions.`);
  }

  document.addEventListener('click', handleClick, true);
})();
