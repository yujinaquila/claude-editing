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

  function userInfo(su) {
    const meta = su?.user_metadata || {};
    return {
      name: meta.full_name || meta.name || su?.email || 'User',
      email: su?.email || '',
      picture: meta.avatar_url || meta.picture || null
    };
  }

  async function showApp(su) {
    const info = userInfo(su);
    // Reuse the editor's existing login handoff so IndexedDB, avatar, user
    // state and the rest of the editor initialize exactly like email login.
    if (typeof window.completeLogin === 'function') {
      try { await window.completeLogin(info.name, info.email, info.picture); }
      catch (e) { console.warn('[ClipForge Auth] completeLogin failed', e); }
    }
    const a = app(), l = login();
    if (a) a.classList.add('active');
    if (l) l.style.display = 'none';
    window.__clipforgeUser = su || null;
    window.dispatchEvent(new CustomEvent('clipforge:auth-ready', { detail: { user: su } }));
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
    const toast = document.getElementById('toast');
    if (toast && /session failed|sign-in succeeded|coba refresh/i.test(toast.textContent || '')) {
      toast.style.display = 'none';
    }
  }

  function cleanAuthParams() {
    if (location.hash.includes('access_token') || location.search.includes('code=') || location.search.includes('error=')) {
      history.replaceState(null, '', location.origin + location.pathname);
    }
  }

  async function recoverSession() {
    // Give Supabase time to exchange the OAuth callback and write the session.
    for (let attempt = 0; attempt < 12; attempt++) {
      try {
        const { data, error } = await client.auth.getSession();
        if (!error && data?.session?.user) {
          await showApp(data.session.user);
          clearAuthError();
          cleanAuthParams();
          return data.session;
        }
      } catch (e) {
        console.warn('[ClipForge Auth] getSession attempt failed', e);
      }
      await new Promise(r => setTimeout(r, 350));
    }
    try {
      const { data, error } = await client.auth.getUser();
      if (!error && data?.user) {
        await showApp(data.user);
        clearAuthError();
        cleanAuthParams();
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
    document.addEventListener('click', e => {
      if (e.target === button || button.contains(e.target)) googleSignIn(e);
    }, true);
  }

  client.auth.onAuthStateChange((event, session) => {
    if (session?.user) {
      showApp(session.user);
      clearAuthError();
      cleanAuthParams();
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
