/* ClipForge Phase 4 bootstrap.
 * Keep the already-tested Phase 4 implementation intact while adding the
 * Google OAuth session recovery module. The previous production deployment
 * is used as the Phase 4 implementation source so this small bootstrap avoids
 * rewriting the large static editor module.
 */
(async () => {
  try {
    const legacyUrl = 'https://claude-editing-hp4htdvdf-ai-clip-studio.vercel.app/src/phase4-smart-ai.js';
    const source = await fetch(legacyUrl, { cache: 'no-store' }).then(r => {
      if (!r.ok) throw new Error(`Phase 4 source unavailable (${r.status})`);
      return r.text();
    });
    // The legacy file is an IIFE module. Evaluating it here preserves its
    // existing Phase 4/5/6 behavior and dynamic imports.
    const run = new Function(source);
    run();
  } catch (err) {
    console.error('[ClipForge Phase 4 bootstrap]', err);
  }

  try {
    await import('./auth-session-repair.js');
  } catch (err) {
    console.error('[ClipForge Auth repair]', err);
  }
})();
