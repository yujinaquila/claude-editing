/* ClipForge Google OAuth/session recovery.
 * Keeps OAuth on Supabase, but makes the browser wait for the auth callback
 * before deciding that the session is missing.
 */
(() => {
  const SUPABASE_URL = 'https://attrgssmemtipoingkpe.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_zRqpbpSxI3JDYAv4wnqajA_RJfLNcIX';
  const PROD_REDIRECT = 'https://claude-editing.vercel.app/';
  const client = window.supabase?.createClient?.(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
      storageKey: 'clipforge-auth'
    }
  });

  if (!client) return;
  window.clipforgeAuth = client;

  const app = () => document.getElementById('app');
  const login = () => document.getElementById('loginScreen');

  function showApp(user) {
    const a = app(), l = login();
    if (a) a.classList.add('active');
    if (l) l.style.display = 'none';
    window.__clipforgeUser = user || null;
    window.dispatchEvent(new CustomEvent('clipforge:auth-ready', { detail: { user } }));
    try { window.renderMediaList?.(); } catch {}
    try { window.renderTimeline?.(); } catch {}
  }

  function showLogin() {
    const a = app(), l = login();
    if (a) a.classList.remove('active');
    if (l) l.style.display = 'flex';
  }

  function clearAuthError() {
    document.querySelectorAll('[id*="error"], [class*="error"], [id*="status"], [class*="status"]').forEach(el => {
      const text = (el.textContent || '').toLowerCase();
      if (text.includes('session failed') || text.includes('refreshing') || text.includes('sign-in succeeded')) {
        el.textContent = '';
        el.classList.add('hidden');
      }
    });
  }

  async function recoverSession() {
    // Give Supabase time to exchange the OAuth callback and write the session.
    for (let attempt = 0; attempt < 12; attempt++) {
      try {
        const { data, error } = await client.auth.getSession();
        if (!error && data?.session?.user) {
          showApp(data.session.user);
          clearAuthError();
          return data.session;
        }
      } catch (e) {
        console.warn('[ClipForge Auth] getSession attempt failed', e);
      }
      await new Promise(r => setTimeout(r, 350));
    }
    // getUser forces a server-side check if the local session is available but
    // getSession was racing the OAuth callback.
    try {
      const { data, error } = await client.auth.getUser();
      if (!error && data?.user) {
        showApp(data.user);
        clearAuthError();
        return { user: data.user };
      }
    } catch (e) {
      console.warn('[ClipForge Auth] getUser failed', e);
    }
    return null;
  }

  async function googleSignIn(event) {
    event?.preventDefault?.();
    event?.stopImmediatePropagation?.();
    const redirectTo = location.hostname === 'localhost' || location.hostname === '127.0.0.1'
      ? location.origin + location.pathname
      : PROD_REDIRECT;
    try {
      const { error } = await client.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo, queryParams: { access_type: 'offline', prompt: 'select_account' } }
      });
      if (error) throw error;
    } catch (e) {
      console.error('[ClipForge Auth] Google sign-in failed', e);
      window.alert('Google sign-in failed: ' + (e?.message || e));
    }
  }

  function wireGoogleButton() {
    const buttons = [...document.querySelectorAll('button, a')];
    const button = buttons.find(el => /google/i.test((el.textContent || '') + ' ' + (el.getAttribute('aria-label') || '')));
    if (!button || button.dataset.clipforgeAuthRepair) return;
    button.dataset.clipforgeAuthRepair = '1';
    // Use a capture listener so the old inline OAuth handler cannot start a
    // second redirect with the stale callback/session logic.
    document.addEventListener('click', e => {
      if (e.target === button || button.contains(e.target)) googleSignIn(e);
    }, true);
  }

  client.auth.onAuthStateChange((event, session) => {
    if (session?.user) {
      showApp(session.user);
      clearAuthError();
    } else if (event === 'SIGNED_OUT') {
      showLogin();
    }
  });

  document.addEventListener('DOMContentLoaded', () => {
    wireGoogleButton();
    recoverSession();
  });
  if (document.readyState !== 'loading') {
    wireGoogleButton();
    recoverSession();
  }
})();
