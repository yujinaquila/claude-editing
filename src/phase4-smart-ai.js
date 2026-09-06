/* ClipForge Phase 4 compatibility bridge + Phase 5 loader.
 * The editor's primary Phase 4 implementation lives in index.html. This module
 * keeps the Phase 4 public API alive while loading the new Subtitle Studio.
 */
(() => {
  const api = window.ClipForgeSmartAI = window.ClipForgeSmartAI || {};
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
    .then(() => window.dispatchEvent(new CustomEvent('clipforge:phase5-ready')))
    .catch(err => console.error('[ClipForge Phase 5] Subtitle Studio failed to load', err));
})();
