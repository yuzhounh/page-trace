/* Android-only adapter; the ordinary website continues to use its existing login. */
(() => {
  if (!window.PageTraceNative) return;
  const key = 'pagetrace_android_draft_v1';
  const fields = [createTitle, createUrl, createNoteInput];
  const persist = () => {
    localStorage.setItem(key, JSON.stringify({ title: createTitle.value, url: createUrl.value, note: createNoteInput.value }));
  };
  function fill(draft) {
    createTitle.value = draft.title || '';
    createUrl.value = draft.url || '';
    createNoteInput.value = draft.note || '';
    persist();
    showCreateModal();
  }
  window.PageTraceAndroid = {
    receive(payload) {
      if (btnSubmitCreate.disabled) return false;
      const message = '当前还有未保存的速记，是否用新分享的内容替换？';
      const dirty = fields.some(field => field.value.trim());
      if (dirty && window.PageTraceAndroid.confirm) {
        window.PageTraceAndroid.confirm(message, '替换').then(ok => { if (ok) window.PageTraceAndroid.apply(payload); });
        return true;
      }
      if (dirty && !confirm(message)) return true;
      window.PageTraceAndroid.apply(payload);
      return true;
    },
    apply(payload) {
      const text = String(payload.text || '');
      const match = text.match(/https?:\/\/[^\s<>"\u3000]+/i);
      const url = match ? match[0].replace(/[，。！？、；：）】》」』,.!?;:)\]]+$/u, '') : '';
      const note = url ? text.replace(url, '').trim() : text;
      const title = String(payload.title || '').trim();
      fill({ title: title === url ? '' : title, url, note });
    },
    signIn() { persist(); window.PageTraceNative.postMessage('signIn'); },
    async signedIn(token) {
      try {
        await auth.signInWithCredential(firebase.auth.GoogleAuthProvider.credential(token));
        if (fields.some(field => field.value.trim())) showCreateModal();
      } catch (error) { showUndoToast('登录失败：' + error.message, null, 4000, '⚠️'); }
    },
    saved() {
      localStorage.removeItem(key);
      showUndoToast('已保存到云端收件箱', null, 3000);
    },
    idle() { window.PageTraceNative.postMessage('ready'); },
    back() {
      persist();
      if (window.PageTraceTouchUI && window.PageTraceTouchUI.back()) return true;
      if (!createModal.classList.contains('show')) return false;
      hideCreateModal();
      return true;
    }
  };
  fields.forEach(field => field.addEventListener('input', persist));
  document.addEventListener('visibilitychange', persist);
  try {
    const draft = JSON.parse(localStorage.getItem(key) || 'null');
    if (draft && (draft.title || draft.url || draft.note)) fill(draft);
  } catch (_) { localStorage.removeItem(key); }
  window.PageTraceNative.postMessage('ready');
})();
