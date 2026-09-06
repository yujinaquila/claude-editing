/* ClipForge AI — Phase 6: Cloud Projects
 * Supabase-backed project metadata, autosave, cross-device project state sync,
 * video asset storage, and revision recovery. This file is intentionally a
 * small progressive enhancement over the existing static editor.
 */
(() => {
  'use strict';

  const SUPABASE_URL = 'https://attrgssmemtipoingkpe.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_zRqpbpSxI3JDYAv4wnqajA_RJfLNcIX';
  const cloud = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const BUCKET = 'project-assets';
  const SAVE_DELAY = 1400;
  const REVISION_KEEP = 25;

  let cloudUser = null;
  let project = null;
  let saveTimer = null;
  let saving = false;
  let saveAgain = false;
  let lastSnapshot = '';
  let assetUploads = new Map();
  let syncTimer = null;
  let modal = null;

  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
  const fmt = sec => {
    sec = Math.max(0, Number(sec) || 0);
    return `${String(Math.floor(sec / 60)).padStart(2,'0')}:${String(Math.floor(sec % 60)).padStart(2,'0')}`;
  };

  function toast(message, loading = false) {
    if (typeof window.showToast === 'function') window.showToast(message, loading);
  }

  function editorSnapshot() {
    const safeMedia = (window.media || []).map(m => ({
      id: m.id,
      name: m.name,
      duration: Number(m.duration || 0),
      thumb: m.thumb || '',
      cloudAssetId: m.cloudAssetId || null,
      storagePath: m.storagePath || null,
      mimeType: m.file?.type || m.mimeType || 'video/mp4',
      sizeBytes: Number(m.file?.size || m.sizeBytes || 0),
      transcript: Array.isArray(m.transcript) ? m.transcript : [],
      highlights: Array.isArray(m.highlights) ? m.highlights : [],
      silences: Array.isArray(m.silences) ? m.silences : []
    }));
    const safeTimeline = (window.timeline || []).map(c => ({
      id: c.id,
      mediaId: c.mediaId,
      name: c.name,
      duration: Number(c.duration || 0),
      trimIn: Number(c.trimIn || 0),
      trimOut: Number(c.trimOut ?? c.duration ?? 0),
      highlights: Array.isArray(c.highlights) ? c.highlights : []
    }));
    return {
      schema: 1,
      timeline: safeTimeline,
      media: safeMedia,
      savedFrom: location.origin,
      savedAt: new Date().toISOString()
    };
  }

  function projectMeta() {
    const timeline = window.timeline || [];
    return {
      clipCount: (window.media || []).length,
      timelineCount: timeline.length,
      duration: timeline.reduce((n, c) => n + Math.max(.2, Number(c.trimOut || 0) - Number(c.trimIn || 0)), 0),
      language: window.currentLang || 'en',
      editorVersion: 'phase-6',
      hasTranscript: (window.media || []).some(m => Array.isArray(m.transcript) && m.transcript.length > 0)
    };
  }

  function cloudStatus(text, state = 'saved') {
    const el = $('cloudSaveStatus');
    if (!el) return;
    el.dataset.state = state;
    el.innerHTML = `<span class="cloud-dot"></span>${esc(text)}`;
  }

  function installStyles() {
    if ($('phase6CloudStyles')) return;
    const s = document.createElement('style');
    s.id = 'phase6CloudStyles';
    s.textContent = `
      .cloud-project-btn{display:flex;align-items:center;gap:7px;background:var(--panel-2);border:1px solid var(--border);color:var(--text);border-radius:7px;padding:7px 10px;font-size:12px;max-width:250px}
      .cloud-project-btn:hover{border-color:var(--ai)} .cloud-project-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .cloud-save-status{display:flex;align-items:center;gap:6px;font-size:10.5px;color:var(--muted);white-space:nowrap}
      .cloud-dot{width:7px;height:7px;border-radius:50%;background:var(--ok);display:inline-block}.cloud-save-status[data-state="saving"] .cloud-dot{background:var(--warn)}.cloud-save-status[data-state="offline"] .cloud-dot{background:var(--muted-2)}.cloud-save-status[data-state="error"] .cloud-dot{background:var(--render)}
      .cloud-modal-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:3000;display:flex;align-items:center;justify-content:center;padding:20px}
      .cloud-modal{width:min(720px,96vw);max-height:86vh;overflow:hidden;background:var(--panel);border:1px solid var(--border);border-radius:14px;box-shadow:0 30px 90px rgba(0,0,0,.65)}
      .cloud-modal-head{display:flex;align-items:center;justify-content:space-between;padding:16px 18px;border-bottom:1px solid var(--border)}
      .cloud-modal-title{font-size:15px;font-weight:750}.cloud-modal-sub{font-size:11px;color:var(--muted);margin-top:3px}
      .cloud-modal-body{padding:14px;overflow:auto;max-height:58vh}.cloud-actions{display:flex;gap:8px}.cloud-input{background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:7px;padding:9px 10px;font-size:12px;width:100%;outline:none}.cloud-input:focus{border-color:var(--ai)}
      .cloud-project-row{display:flex;align-items:center;gap:12px;padding:12px;border:1px solid var(--border);background:var(--panel-2);border-radius:9px;margin-bottom:8px}.cloud-project-row.active{border-color:var(--ai);box-shadow:0 0 0 1px var(--ai-dim) inset}.cloud-project-row-main{flex:1;min-width:0}.cloud-project-row-title{font-weight:700;font-size:12.5px}.cloud-project-row-meta{font-size:10.5px;color:var(--muted);margin-top:4px}.cloud-project-row button{background:transparent;border:1px solid var(--border);color:var(--text);border-radius:6px;padding:6px 9px;font-size:10.5px}.cloud-project-row button:hover{border-color:var(--ai)}
      .cloud-recovery{margin-top:14px;padding-top:12px;border-top:1px solid var(--border)}.cloud-revision{display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);font-size:11px}.cloud-revision:last-child{border-bottom:0}.cloud-revision button{background:transparent;border:1px solid var(--border);color:var(--text);border-radius:6px;padding:5px 8px;font-size:10px}
    `;
    document.head.appendChild(s);
  }

  function installHeaderUI() {
    const right = document.querySelector('.tb-right');
    if (!right || $('cloudProjectBtn')) return;
    const wrap = document.createElement('div');
    wrap.style.display = 'flex'; wrap.style.alignItems = 'center'; wrap.style.gap = '10px';
    wrap.innerHTML = `<button id="cloudProjectBtn" class="cloud-project-btn" title="Cloud Projects"><span>☁</span><span class="cloud-project-name" id="cloudProjectName">Cloud Projects</span><span>⌄</span></button><span id="cloudSaveStatus" class="cloud-save-status" data-state="offline"><span class="cloud-dot"></span>Connecting…</span>`;
    right.insertBefore(wrap, right.firstChild);
    $('cloudProjectBtn').addEventListener('click', openProjectModal);
  }

  function openProjectModal() {
    if (!$('cloudProjectBtn')) return;
    if (modal) modal.remove();
    modal = document.createElement('div');
    modal.className = 'cloud-modal-backdrop';
    modal.innerHTML = `<div class="cloud-modal"><div class="cloud-modal-head"><div><div class="cloud-modal-title">☁ Cloud Projects</div><div class="cloud-modal-sub">Projects are saved to Supabase and available on your other devices.</div></div><button id="cloudClose" class="btn-ghost">Close</button></div><div class="cloud-modal-body"><div class="cloud-actions"><input id="newProjectName" class="cloud-input" placeholder="New project name…"><button id="newProjectBtn" class="btn-primary" style="width:auto;margin:0;padding:9px 14px">New Project</button></div><div id="cloudProjectList" style="margin-top:14px"></div><div id="cloudRecovery" class="cloud-recovery"></div></div></div>`;
    document.body.appendChild(modal);
    $('cloudClose').onclick = () => modal.remove();
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
    $('newProjectBtn').onclick = createProjectFromUI;
    loadProjectListUI();
  }

  async function loadProjectListUI() {
    const list = $('cloudProjectList');
    if (!list || !cloudUser) return;
    list.innerHTML = `<div style="color:var(--muted);font-size:11px">Loading projects…</div>`;
    const { data, error } = await cloud.from('projects').select('id,name,description,version,updated_at,metadata').is('deleted_at', null).order('updated_at', {ascending:false}).limit(50);
    if (error) { list.innerHTML = `<div style="color:var(--render);font-size:11px">${esc(error.message)}</div>`; return; }
    if (!data?.length) { list.innerHTML = `<div style="color:var(--muted);font-size:11px;padding:10px 2px">No cloud projects yet. Create one above.</div>`; return; }
    list.innerHTML = data.map(p => {
      const meta = p.metadata || {};
      const active = project?.id === p.id ? ' active' : '';
      return `<div class="cloud-project-row${active}"><div class="cloud-project-row-main"><div class="cloud-project-row-title">${esc(p.name || 'Untitled project')}</div><div class="cloud-project-row-meta">${Number(meta.clipCount||0)} clips · ${fmt(meta.duration||0)} · v${p.version||1} · ${new Date(p.updated_at).toLocaleString()}</div></div><button data-open="${p.id}">Open</button><button data-recover="${p.id}">Recovery</button></div>`;
    }).join('');
    list.querySelectorAll('[data-open]').forEach(b => b.onclick = async () => { await switchProject(b.dataset.open); if (modal) modal.remove(); });
    list.querySelectorAll('[data-recover]').forEach(b => b.onclick = () => loadRecoveryUI(b.dataset.recover));
  }

  async function createProjectFromUI() {
    const input = $('newProjectName');
    const name = input?.value.trim() || 'Untitled marketing project';
    const { data, error } = await cloud.from('projects').insert({user_id:cloudUser.id,name,description:'',timeline:[],metadata:{clipCount:0,timelineCount:0,duration:0,editorVersion:'phase-6'},version:1,last_saved_at:new Date().toISOString()}).select().single();
    if (error) { toast(error.message); return; }
    project = data;
    lastSnapshot = '';
    updateProjectUI();
    toast(`Created “${name}”`);
    if (modal) { await loadProjectListUI(); }
  }

  async function loadOrCreateProject() {
    const { data, error } = await cloud.from('projects').select('*').is('deleted_at', null).order('updated_at',{ascending:false}).limit(1);
    if (error) { cloudStatus('Cloud unavailable','error'); console.error(error); return; }
    if (data?.length) {
      project = data[0];
      updateProjectUI();
      await restoreProject(project);
    } else {
      const { data: created, error: createError } = await cloud.from('projects').insert({user_id:cloudUser.id,name:'Untitled marketing project',timeline:[],metadata:{clipCount:0,timelineCount:0,duration:0,editorVersion:'phase-6'},version:1,last_saved_at:new Date().toISOString()}).select().single();
      if (createError) { cloudStatus('Cloud error','error'); console.error(createError); return; }
      project = created;
      updateProjectUI();
    }
    startRemoteSync();
  }

  function updateProjectUI() {
    const name = $('cloudProjectName');
    if (name) name.textContent = project?.name || 'Cloud Projects';
    const topName = document.querySelector('.tb-project');
    if (topName && project?.name) topName.textContent = project.name;
    cloudStatus(project ? 'Saved to cloud' : 'Connecting…', project ? 'saved' : 'offline');
  }

  async function uploadAsset(mediaItem) {
    if (!project || !cloudUser || !mediaItem?.file) return null;
    if (mediaItem.cloudAssetId && mediaItem.storagePath) return mediaItem;
    if (assetUploads.has(mediaItem.id)) return assetUploads.get(mediaItem.id);
    const promise = (async () => {
      const safeName = String(mediaItem.name || 'clip').replace(/[^a-zA-Z0-9._-]+/g,'_').slice(-100);
      const path = `${cloudUser.id}/${project.id}/${mediaItem.id}-${safeName}`;
      cloudStatus('Uploading clip…','saving');
      const { error: uploadError } = await cloud.storage.from(BUCKET).upload(path, mediaItem.file, {upsert:true,contentType:mediaItem.file.type || 'video/mp4'});
      if (uploadError) throw uploadError;
      const { data, error } = await cloud.from('project_assets').upsert({project_id:project.id,user_id:cloudUser.id,storage_path:path,name:mediaItem.name,mime_type:mediaItem.file.type||'video/mp4',size_bytes:mediaItem.file.size,duration:Number(mediaItem.duration||0),thumb:mediaItem.thumb||'',metadata:{local_media_id:mediaItem.id}}, {onConflict:'project_id,storage_path'}).select().single();
      if (error) throw error;
      mediaItem.cloudAssetId = data.id;
      mediaItem.storagePath = path;
      return mediaItem;
    })();
    assetUploads.set(mediaItem.id, promise);
    try { return await promise; } finally { assetUploads.delete(mediaItem.id); }
  }

  async function uploadAllAssets() {
    const items = (window.media || []).filter(m => m.file && !m.cloudAssetId);
    for (const item of items) {
      try { await uploadAsset(item); } catch (e) { console.error('Cloud asset upload failed', item.name, e); }
    }
  }

  async function saveProject(force = false) {
    if (!project || !cloudUser || saving) { if (saving) saveAgain = true; return; }
    const snapshot = editorSnapshot();
    const signature = JSON.stringify({...snapshot, savedAt:undefined});
    if (!force && signature === lastSnapshot) return;
    saving = true; saveAgain = false;
    cloudStatus('Saving…','saving');
    try {
      await uploadAllAssets();
      const fresh = editorSnapshot();
      const nextVersion = Number(project.version || 0) + 1;
      const { data: updated, error } = await cloud.from('projects').update({
        name: project.name,
        timeline: fresh.timeline,
        metadata: projectMeta(),
        version: nextVersion,
        last_saved_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }).eq('id',project.id).eq('user_id',cloudUser.id).select().single();
      if (error) throw error;
      const revisionSnapshot = {...fresh, projectName:project.name};
      await cloud.from('project_revisions').insert({project_id:project.id,user_id:cloudUser.id,version:nextVersion,snapshot:revisionSnapshot});
      project = updated;
      lastSnapshot = JSON.stringify({...fresh, savedAt:undefined});
      cloudStatus('Saved to cloud','saved');
      pruneRevisions().catch(()=>{});
    } catch (e) {
      console.error('Cloud save failed', e);
      cloudStatus('Save failed — local copy kept','error');
      toast('Cloud save failed; your local editor state is still intact');
    } finally {
      saving = false;
      if (saveAgain) scheduleSave();
    }
  }

  function scheduleSave() {
    if (!project) return;
    clearTimeout(saveTimer);
    cloudStatus('Changes pending…','saving');
    saveTimer = setTimeout(() => saveProject(false), SAVE_DELAY);
  }

  async function pruneRevisions() {
    if (!project || !cloudUser) return;
    const { data } = await cloud.from('project_revisions').select('id,version,created_at').eq('project_id',project.id).order('created_at',{ascending:false}).range(REVISION_KEEP, REVISION_KEEP + 100);
    if (data?.length) await cloud.from('project_revisions').delete().in('id', data.map(r=>r.id));
  }

  async function restoreProject(p) {
    const snapshot = {
      schema: 1,
      timeline: Array.isArray(p.timeline) ? p.timeline : [],
      media: []
    };
    const { data: assets, error } = await cloud.from('project_assets').select('*').eq('project_id',p.id).order('created_at',{ascending:true});
    if (error) { console.error(error); }
    for (const a of assets || []) {
      try {
        const { data: signed, error: signedError } = await cloud.storage.from(BUCKET).createSignedUrl(a.storage_path, 3600);
        if (signedError) throw signedError;
        const blobResp = await fetch(signed.signedUrl);
        if (!blobResp.ok) throw new Error(`Asset download failed (${blobResp.status})`);
        const blob = await blobResp.blob();
        const localId = a.metadata?.local_media_id || `m${Date.now()}${Math.random().toString(36).slice(2,6)}`;
        snapshot.media.push({id:localId,name:a.name,duration:a.duration||0,thumb:a.thumb||'',cloudAssetId:a.id,storagePath:a.storage_path,mimeType:a.mime_type,file:blob,blob});
      } catch (e) { console.error('Asset restore failed', a.name, e); }
    }
    const currentMedia = window.media || [];
    currentMedia.forEach(m => { try { if(m.url?.startsWith('blob:')) URL.revokeObjectURL(m.url); } catch(e){} });
    window.media = snapshot.media.map(m => ({...m,url:URL.createObjectURL(m.blob),file:m.blob}));
    const rebuiltTimeline = snapshot.timeline.map(c => {
      const m = window.media.find(x => x.id === c.mediaId);
      return m ? {...c,url:m.url,duration:m.duration,name:m.name,trimOut:Math.min(Number(c.trimOut ?? m.duration),m.duration)} : null;
    }).filter(Boolean);
    window.timeline = rebuiltTimeline;
    lastSnapshot = JSON.stringify(editorSnapshot());
    if (typeof window.renderMediaList === 'function') window.renderMediaList();
    if (typeof window.renderTimeline === 'function') window.renderTimeline();
    updateProjectUI();
    if (window.media.length) toast(`Restored “${p.name}” from cloud`);
  }

  async function switchProject(id) {
    if (!cloudUser) return;
    await saveProject(true);
    const { data, error } = await cloud.from('projects').select('*').eq('id',id).eq('user_id',cloudUser.id).single();
    if (error) { toast(error.message); return; }
    project = data;
    lastSnapshot = '';
    await restoreProject(project);
    updateProjectUI();
  }

  async function loadRecoveryUI(projectId) {
    const box = $('cloudRecovery');
    if (!box) return;
    box.innerHTML = `<div style="font-size:12px;font-weight:700;margin-bottom:6px">Recovery</div><div style="font-size:10.5px;color:var(--muted)">Loading saved versions…</div>`;
    const { data, error } = await cloud.from('project_revisions').select('id,version,created_at,snapshot').eq('project_id',projectId).order('created_at',{ascending:false}).limit(25);
    if (error) { box.innerHTML += `<div style="color:var(--render);font-size:11px">${esc(error.message)}</div>`; return; }
    if (!data?.length) { box.innerHTML = `<div style="font-size:12px;font-weight:700">Recovery</div><div style="font-size:10.5px;color:var(--muted);margin-top:6px">No recovery points yet.</div>`; return; }
    box.innerHTML = `<div style="font-size:12px;font-weight:700;margin-bottom:6px">Recovery</div>` + data.map(r => `<div class="cloud-revision"><span>Version ${r.version} · ${new Date(r.created_at).toLocaleString()}</span><button data-revision="${r.id}">Restore</button></div>`).join('');
    box.querySelectorAll('[data-revision]').forEach(b => b.onclick = async () => restoreRevision(b.dataset.revision));
  }

  async function restoreRevision(id) {
    const { data: rev, error } = await cloud.from('project_revisions').select('*').eq('id',id).single();
    if (error || !rev) { toast(error?.message || 'Recovery point not found'); return; }
    const snap = rev.snapshot || {};
    if (!confirm(`Restore version ${rev.version}? Your current cloud version will remain available as a recovery point.`)) return;
    if (project?.id !== rev.project_id) {
      const { data:p } = await cloud.from('projects').select('*').eq('id',rev.project_id).single();
      if (p) project = p;
    }
    window.timeline = Array.isArray(snap.timeline) ? snap.timeline : [];
    const assetMap = new Map();
    const { data: assets } = await cloud.from('project_assets').select('*').eq('project_id',project.id);
    for (const a of assets || []) assetMap.set(a.id,a);
    const rebuilt=[];
    for (const m of (snap.media || [])) {
      const a = assetMap.get(m.cloudAssetId);
      if (!a) continue;
      try {
        const {data:signed,error:e}=await cloud.storage.from(BUCKET).createSignedUrl(a.storage_path,3600); if(e) throw e;
        const res=await fetch(signed.signedUrl); const blob=await res.blob();
        rebuilt.push({...m,file:blob,url:URL.createObjectURL(blob),storagePath:a.storage_path,cloudAssetId:a.id});
      } catch(e){ console.error(e); }
    }
    window.media=rebuilt;
    window.timeline=window.timeline.map(c=>{const m=window.media.find(x=>x.id===c.mediaId);return m?{...c,url:m.url,name:m.name,duration:m.duration}:null}).filter(Boolean);
    if(typeof window.renderMediaList==='function') window.renderMediaList();
    if(typeof window.renderTimeline==='function') window.renderTimeline();
    lastSnapshot=''; scheduleSave();
    toast(`Restored version ${rev.version}`);
    if(modal) await loadProjectListUI();
  }

  function startRemoteSync() {
    clearInterval(syncTimer);
    syncTimer = setInterval(async () => {
      if (!project || saving || document.hidden) return;
      const { data } = await cloud.from('projects').select('id,name,version,updated_at,last_saved_at,timeline,metadata').eq('id',project.id).single();
      if (!data) return;
      const remoteVersion = Number(data.version || 0);
      const localVersion = Number(project.version || 0);
      if (remoteVersion > localVersion) {
        project = {...project,...data};
        const localSignature = JSON.stringify(editorSnapshot().timeline);
        const remoteSignature = JSON.stringify(data.timeline || []);
        if (localSignature !== remoteSignature) {
          cloudStatus('New cloud version available','saving');
          const shouldRestore = confirm(`Project “${data.name}” changed on another device. Load the newer cloud version now?`);
          if (shouldRestore) await restoreProject(project); else cloudStatus('Local version kept','saved');
        }
      }
    }, 12000);
  }

  function hookEditorChanges() {
    if (window.__phase6Hooked) return;
    window.__phase6Hooked = true;
    const oldRender = window.renderTimeline;
    if (typeof oldRender === 'function') {
      window.renderTimeline = function(...args) {
        const out = oldRender.apply(this,args);
        if (project && !window.__phase6Restoring) scheduleSave();
        return out;
      };
    }
    const oldAdd = window.addMediaFile;
    if (typeof oldAdd === 'function') {
      window.addMediaFile = async function(file) {
        const item = await oldAdd.call(this,file);
        if (project && item) { try { await uploadAsset(item); } catch(e) { console.error(e); } scheduleSave(); }
        return item;
      };
    }
    document.addEventListener('visibilitychange', () => { if (document.hidden) saveProject(true); });
    window.addEventListener('beforeunload', () => {
      if (project && navigator.onLine) {
        // sendBeacon cannot carry Supabase auth reliably, so this is only a final scheduled save.
        clearTimeout(saveTimer); saveProject(true).catch(()=>{});
      }
    });
  }

  async function init() {
    installStyles();
    installHeaderUI();
    hookEditorChanges();
    cloudStatus('Connecting…','saving');
    try {
      const { data, error } = await cloud.auth.getUser();
      if (error || !data?.user) { cloudStatus('Sign in to save','offline'); return; }
      cloudUser = data.user;
      await loadOrCreateProject();
      // Catch changes made by Phase 4/5 code paths that do not call renderTimeline.
      let previous = JSON.stringify(editorSnapshot());
      setInterval(() => {
        if (!project || saving) return;
        const now = JSON.stringify(editorSnapshot());
        if (now !== previous) { previous = now; scheduleSave(); }
      }, 1800);
    } catch (e) {
      console.error('Phase 6 init failed', e);
      cloudStatus('Cloud unavailable','error');
    }
  }

  // The app's Supabase auth listener may finish after this script loads.
  cloud.auth.onAuthStateChange((event, session) => {
    if (session?.user && !cloudUser) init();
    if (event === 'SIGNED_OUT') { cloudUser=null; project=null; cloudStatus('Sign in to save','offline'); }
  });

  setTimeout(init, 0);
})();
