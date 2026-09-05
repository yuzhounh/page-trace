// ==UserScript==
// @name         PageTrace - Web Memo & Cloud Capture
// @namespace    https://pagetrace.web.app/
// @version      1.8.8
// @description  优雅捕获网页标题、网址与速记笔记，并无缝同步到 Firebase Cloud Firestore。支持快捷键与本地认证桥接。
// @author       Jing Wang
// @license      GPL-3.0
// @match        *://*/*
// @exclude      https://fanfou.com/sharer/image*
// @exclude      https://co.gocheck.cn/*
// @exclude      http://mail.xynu.edu.cn/*
// @exclude      http://127.0.0.1:3080/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_openInTab
// @connect      firestore.googleapis.com
// @connect      securetoken.googleapis.com
// @connect      identitytoolkit.googleapis.com
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ==========================================
  // 1. 配置项（统一指向中心后端，用户零配置）
  // ==========================================
  const CONFIG = {
    HOST_ID: 'pagetrace-floating-widget',
    apiKey: 'AIzaSyA91weJPSAeO58tB0cYS38-q-XpXJTbjLc',
    projectId: 'page-trace-app',
    authAppUrl: 'https://page-trace-app.web.app/auth.html',
    get idToken() { return GM_getValue('pt_id_token', ''); },
    get refreshToken() { return GM_getValue('pt_refresh_token', ''); },
    get uid() { return GM_getValue('pt_uid', ''); },
    get tokenExpiry() { return GM_getValue('pt_token_expiry', 0); },
  };

  // ==========================================
  // 2. 标题清洗与剪贴板工具
  // ==========================================
  function processTitle(title) {
    return (title || '')
      .replace('- cnBeta.COM 移动版(WAP)', '- cnBeta')
      .replace(/\((\d+\+?)\s*封私信\s*\/\s*(\d+\+?)\s*条消息\)/g, '')
      .replace(/\((\d+\+?)\s*封私信\)/g, '')
      .trim();
  }

  function fallbackCopy(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    Object.assign(textarea.style, { position: 'fixed', left: '-9999px', opacity: '0' });
    document.body.appendChild(textarea);
    textarea.select();
    try {
      return document.execCommand('copy');
    } finally {
      textarea.remove();
    }
  }

  async function copyText(text) {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }
    if (!fallbackCopy(text)) {
      throw new Error('浏览器拒绝了复制命令');
    }
  }

  // ==========================================
  // 3. 认证状态与 Token 自动静默刷新
  // ==========================================
  async function refreshIdTokenIfNeeded() {
    const now = Date.now();
    const expiry = Number(CONFIG.tokenExpiry) || 0;
    const currentIdToken = CONFIG.idToken;
    const refreshToken = CONFIG.refreshToken;
    const apiKey = CONFIG.apiKey;

    // 若当前 token 距到期还有 3 分钟以上，可直接使用
    if (currentIdToken && expiry > now + 3 * 60 * 1000) {
      return currentIdToken;
    }

    if (!refreshToken || !apiKey) {
      return currentIdToken || null;
    }

    // 调用 Google SecureToken REST API 静默换领新 ID Token
    return new Promise((resolve) => {
      GM_xmlhttpRequest({
        method: 'POST',
        url: `https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(apiKey)}`,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        data: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`,
        onload: function (res) {
          if (res.status >= 200 && res.status < 300) {
            try {
              const data = JSON.parse(res.responseText);
              const newIdToken = data.id_token;
              const newRefreshToken = data.refresh_token;
              const expiresIn = Number(data.expires_in) || 3600;

              GM_setValue('pt_id_token', newIdToken);
              if (newRefreshToken) GM_setValue('pt_refresh_token', newRefreshToken);
              GM_setValue('pt_token_expiry', Date.now() + expiresIn * 1000);
              if (data.user_id) GM_setValue('pt_uid', data.user_id);

              resolve(newIdToken);
            } catch (e) {
              console.error('[PageTrace] 解析刷新响应失败:', e);
              resolve(currentIdToken);
            }
          } else {
            console.warn('[PageTrace] 刷新 Token 失败:', res.responseText);
            resolve(currentIdToken);
          }
        },
        onerror: function (err) {
          console.error('[PageTrace] 刷新 Token 网络错误:', err);
          resolve(currentIdToken);
        }
      });
    });
  }

  // ==========================================
  // 4. Firestore REST API 写入单条 Document
  // 路径: users/{uid}/notes/{id}
  // ==========================================
  async function saveToFirestore({ title, url, note }) {
    const apiKey = CONFIG.apiKey;
    const projectId = CONFIG.projectId;
    const uid = CONFIG.uid;

    if (!apiKey || !projectId || !uid) {
      throw new Error('未配置 Firebase 参数或尚未登录');
    }

    const token = await refreshIdTokenIfNeeded();
    if (!token) {
      throw new Error('认证凭证失效，请重新登录');
    }

    const endpoint = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/users/${encodeURIComponent(uid)}/notes?key=${encodeURIComponent(apiKey)}`;

    const docBody = {
      fields: {
        title: { stringValue: title },
        url: { stringValue: url },
        note: { stringValue: note || '' },
        status: { stringValue: 'inbox' },
        createdAt: { timestampValue: new Date().toISOString() },
        source: { stringValue: 'userscript' }
      }
    };

    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'POST',
        url: endpoint,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        data: JSON.stringify(docBody),
        onload: function (res) {
          if (res.status >= 200 && res.status < 300) {
            try {
              const data = JSON.parse(res.responseText);
              resolve(data);
            } catch (e) {
              resolve({});
            }
          } else {
            let errorMsg = `HTTP ${res.status}`;
            try {
              const errObj = JSON.parse(res.responseText);
              if (errObj.error?.message) errorMsg += `: ${errObj.error.message}`;
            } catch (_) {}
            reject(new Error(errorMsg));
          }
        },
        onerror: function (err) {
          reject(new Error('网络连接异常'));
        }
      });
    });
  }

  // ==========================================
  // 5. Auth 桥接：接收来自 Web Auth 页面的认证同步
  // ==========================================
  function setupAuthBridgeListener() {
    window.addEventListener('message', (event) => {
      const data = event.data;
      if (!data || data.source !== 'PAGETRACE_AUTH_SUCCESS') return;

      const { idToken, refreshToken, uid, expiresIn, apiKey, projectId } = data.payload || {};
      if (idToken && uid) {
        GM_setValue('pt_id_token', idToken);
        GM_setValue('pt_uid', uid);
        if (refreshToken) GM_setValue('pt_refresh_token', refreshToken);
        if (apiKey) GM_setValue('pt_api_key', apiKey);
        if (projectId) GM_setValue('pt_project_id', projectId);
        GM_setValue('pt_token_expiry', Date.now() + (Number(expiresIn) || 3600) * 1000);

        if (window.opener) {
          try {
            window.opener.postMessage({ source: 'PAGETRACE_AUTH_CONFIRMED' }, '*');
          } catch (_) {}
        }
        alert('🎉 PageTrace 认证授权已同步至油猴脚本！您可以关闭此页面并开始使用。');
      }
    });
  }

  // ==========================================
  // 6. UI 交互组件 (Shadow DOM 防宿主污染)
  // ==========================================
  function mount() {
    if (!document.body && !document.documentElement) return;
    if (document.getElementById(CONFIG.HOST_ID)) return;

    const host = document.createElement('div');
    host.id = CONFIG.HOST_ID;
    host.style.cssText = 'position: absolute; top: 0; left: 0; width: 0; height: 0; overflow: visible; z-index: 2147483647; pointer-events: none;';
    const shadow = host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = `
      :host {
        all: initial;
      }
      .pt-wrap {
        position: fixed;
        right: 28px;
        bottom: 28px;
        z-index: 2147483647;
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 8px;
        pointer-events: none;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
        font-size: 13px;
        user-select: none;
        -webkit-user-select: none;
      }

      /* 展开式浮动速记卡片 */
      .pt-card {
        pointer-events: auto;
        width: 320px;
        background: rgba(255, 255, 255, 0.95);
        border: 1px solid rgba(0, 0, 0, 0.08);
        border-radius: 14px;
        padding: 12px 14px;
        box-shadow: 0 12px 32px rgba(15, 23, 42, 0.16), 0 2px 6px rgba(15, 23, 42, 0.06);
        backdrop-filter: blur(16px) saturate(180%);
        -webkit-backdrop-filter: blur(16px) saturate(180%);
        display: none;
        flex-direction: column;
        gap: 10px;
        transform: translateY(6px) scale(0.97);
        opacity: 0;
        transition: opacity 180ms cubic-bezier(0.16, 1, 0.3, 1), transform 180ms cubic-bezier(0.16, 1, 0.3, 1);
      }
      .pt-card.active {
        display: flex;
        transform: translateY(0) scale(1);
        opacity: 1;
      }

      .pt-card-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 2px;
      }
      .pt-close-btn {
        background: none;
        border: none;
        color: #94a3b8;
        font-size: 16px;
        cursor: pointer;
        padding: 0 4px;
        line-height: 1;
        margin-left: auto;
      }
      .pt-close-btn:hover {
        color: #475569;
      }

      .pt-input-title {
        flex: 1;
        font-size: 13px;
        font-weight: 600;
        color: #0f172a;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        text-decoration: none;
        display: block;
        padding: 0 2px;
        transition: color 150ms ease;
      }
      .pt-input-title:hover {
        color: #2563eb;
        text-decoration: underline;
      }

      .pt-textarea {
        width: 100%;
        box-sizing: border-box;
        border: 1px solid #cbd5e1;
        border-radius: 8px;
        padding: 8px 10px;
        font-size: 13px;
        line-height: 1.5;
        resize: none;
        height: 90px;
        outline: none;
        background: #ffffff;
        color: #1e293b;
        font-family: inherit;
        transition: border-color 150ms ease, box-shadow 150ms ease;
        display: block;
      }
      .pt-textarea:focus {
        border-color: #3b82f6;
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
      }
      .pt-card-footer {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        margin-top: 2px;
      }
      .pt-save-btn {
        padding: 5px 14px;
        border-radius: 7px;
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        border: 1px solid #cbd5e1;
        background: #ffffff;
        color: #334155;
        transition: all 140ms ease;
        outline: none;
      }
      .pt-save-btn:hover {
        background: #f1f5f9;
        border-color: #94a3b8;
        color: #0f172a;
      }
      .pt-save-btn:active {
        transform: scale(0.97);
      }
      .pt-save-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      /* 底部主浮动胶囊条 */
      .pt-bar {
        pointer-events: auto;
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .pt-toast {
        pointer-events: none;
        max-width: min(280px, calc(100vw - 120px));
        padding: 8px 14px;
        border-radius: 10px;
        background: rgba(15, 23, 42, 0.88);
        color: #ffffff;
        font-size: 12px;
        font-weight: 500;
        line-height: 1.35;
        box-shadow: 0 8px 24px rgba(15, 23, 42, 0.2);
        backdrop-filter: blur(10px);
        opacity: 0;
        transform: translateX(8px) scale(0.96);
        transition: opacity 160ms ease, transform 160ms ease;
      }
      .pt-toast.show {
        opacity: 1;
        transform: translateX(0) scale(1);
      }

      .pt-pill-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 46px;
        height: 46px;
        padding: 0;
        border: 1px solid rgba(0, 0, 0, 0.08);
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.8);
        color: #334155;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
        backdrop-filter: blur(8px) saturate(130%);
        -webkit-backdrop-filter: blur(8px) saturate(130%);
        cursor: pointer;
        opacity: 0.8;
        transition: all 220ms cubic-bezier(0.16, 1, 0.3, 1);
        outline: none;
      }
      .pt-pill-btn:hover {
        opacity: 1;
        background: rgba(255, 255, 255, 0.96);
        border-color: #3b82f6;
        color: #2563eb;
        box-shadow: 0 6px 20px rgba(37, 99, 235, 0.22);
        transform: scale(1.06);
      }
      .pt-pill-btn:active {
        transform: scale(0.95);
      }
      .pt-pill-btn.recording {
        opacity: 1;
        background: #eff6ff;
        color: #2563eb;
        border-color: #93c5fd;
        box-shadow: 0 4px 16px rgba(37, 99, 235, 0.15);
      }

      /* 暗色模式适配 */
      @media (prefers-color-scheme: dark) {
        .pt-card {
          background: rgba(30, 41, 59, 0.94);
          border-color: rgba(255, 255, 255, 0.1);
          color: #f8fafc;
        }
        .pt-input-title {
          background: #0f172a;
          color: #94a3b8;
          border-color: #334155;
        }
        .pt-textarea {
          background: #0f172a;
          color: #f8fafc;
          border-color: #334155;
        }
        .pt-textarea:focus {
          border-color: #60a5fa;
        }
        .pt-pill-btn {
          background: rgba(255, 255, 255, 0.06);
          border-color: rgba(255, 255, 255, 0.04);
          color: #cbd5e1;
        }
        .pt-pill-btn:hover {
          background: #1e293b;
          border-color: #60a5fa;
          color: #93c5fd;
          box-shadow: 0 6px 20px rgba(96, 165, 250, 0.25);
        }
        .pt-save-btn {
          background: #334155;
          border-color: #475569;
          color: #f1f5f9;
        }
        .pt-save-btn:hover {
          background: #475569;
          border-color: #64748b;
          color: #ffffff;
        }
      }
    `;

    const wrap = document.createElement('div');
    wrap.className = 'pt-wrap';

    // 1. 卡片
    const card = document.createElement('div');
    card.className = 'pt-card';

    const cardHeader = document.createElement('div');
    cardHeader.className = 'pt-card-header';

    const titlePreview = document.createElement('a');
    titlePreview.className = 'pt-input-title';
    titlePreview.href = window.location.href;
    titlePreview.target = '_blank';
    titlePreview.rel = 'noopener noreferrer';
    titlePreview.title = document.title;
    titlePreview.textContent = processTitle(document.title);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'pt-close-btn';
    closeBtn.innerHTML = '&times;';
    closeBtn.title = '收起 (Esc)';
    cardHeader.append(titlePreview, closeBtn);

    const textarea = document.createElement('textarea');
    textarea.className = 'pt-textarea';
    textarea.placeholder = '';
    textarea.rows = 4;

    const cardFooter = document.createElement('div');
    cardFooter.className = 'pt-card-footer';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'pt-save-btn';
    saveBtn.type = 'button';
    saveBtn.textContent = '保存';
    saveBtn.title = '保存 (Shift+Enter)';

    cardFooter.append(saveBtn);
    card.append(cardHeader, textarea, cardFooter);

    // 2. 底部浮动按钮 + Toast
    const bar = document.createElement('div');
    bar.className = 'pt-bar';

    const toast = document.createElement('div');
    toast.className = 'pt-toast';
    toast.setAttribute('role', 'status');

    const mainBtn = document.createElement('button');
    mainBtn.className = 'pt-pill-btn';
    mainBtn.type = 'button';
    mainBtn.title = '左键：复制 / 右键：速记 / Ctrl+左键：直接保存 / Ctrl+右键：打开看板 / Shift+左键：隐藏';

    bar.append(toast, mainBtn);
    wrap.append(card, bar);
    shadow.append(style, wrap);
    (document.body || document.documentElement).appendChild(host);

    let toastTimer;
    function showToast(msg, duration = 1800) {
      clearTimeout(toastTimer);
      toast.textContent = msg;
      toast.classList.add('show');
      toastTimer = setTimeout(() => toast.classList.remove('show'), duration);
    }

    function toggleCard(show) {
      const isCurrentlyOpen = card.classList.contains('active');
      const targetState = show !== undefined ? show : !isCurrentlyOpen;
      if (targetState) {
        titlePreview.textContent = processTitle(document.title);
        titlePreview.href = window.location.href;
        titlePreview.title = document.title;
        card.classList.add('active');
        mainBtn.classList.add('recording');
        setTimeout(() => textarea.focus(), 60);
      } else {
        card.classList.remove('active');
        mainBtn.classList.remove('recording');
      }
    }

    async function submitNote() {
      const title = processTitle(document.title);
      const url = window.location.href;
      const note = textarea.value.trim();

      if (!CONFIG.uid || !CONFIG.apiKey || !CONFIG.projectId) {
        showToast('⚠️ 请先配置 Firebase 或完成登录');
        openSettingsModal();
        return;
      }

      saveBtn.disabled = true;
      saveBtn.textContent = '保存中...';

      try {
        await saveToFirestore({ title, url, note });
        const copyPayload = note ? `${title}\n${url}\n笔记: ${note}` : `${title}\n${url}`;
        copyText(copyPayload).catch(() => {});

        showToast('✓ 已保存到 Firestore');
        textarea.value = '';
        toggleCard(false);
      } catch (err) {
        console.error('[PageTrace] 保存失败:', err);
        showToast(`❌ 保存失败: ${err.message || '网络错误'}`);
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = '保存';
      }
    }

    async function handleCopyOnly() {
      const title = processTitle(document.title);
      const url = window.location.href;
      const note = textarea.value.trim();
      const text = note ? `${title}\n${url}\n笔记: ${note}` : `${title}\n${url}`;
      try {
        await copyText(text);
        showToast('已复制');
        toggleCard(false);
      } catch (e) {
        showToast('❌ 复制失败');
      }
    }

    async function handleDirectSave() {
      const title = processTitle(document.title);
      const url = window.location.href;

      if (!CONFIG.uid || !CONFIG.apiKey || !CONFIG.projectId) {
        showToast('⚠️ 请先配置 Firebase 或完成登录');
        openSettingsModal();
        return;
      }

      showToast('正在保存...');

      try {
        await saveToFirestore({ title, url, note: '' });
        const copyPayload = `${title}\n${url}`;
        copyText(copyPayload).catch(() => {});
        showToast('✓ 已保存 Title & URL');
      } catch (err) {
        console.error('[PageTrace] 保存失败:', err);
        showToast(`❌ 保存失败: ${err.message || '网络错误'}`);
      }
    }

    // 主按钮点击与快捷键事件：
    // 左键：复制
    // Ctrl + 左键：直接保存
    // Shift + 左键：隐藏按钮
    mainBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.shiftKey) {
        wrap.style.display = 'none';
        return;
      }

      if (e.ctrlKey || e.metaKey) {
        handleDirectSave();
        return;
      }

      handleCopyOnly();
    });

    // 右键：速记
    // Ctrl + 右键：在新标签页中打开看板
    mainBtn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.ctrlKey || e.metaKey) {
        if (typeof GM_openInTab === 'function') {
          GM_openInTab('https://page-trace-app.web.app', { active: true, insert: true, setParent: true });
        } else {
          window.open('https://page-trace-app.web.app', '_blank', 'noopener,noreferrer');
        }
        return;
      }
      toggleCard();
    });

    closeBtn.addEventListener('click', () => toggleCard(false));
    saveBtn.addEventListener('click', submitNote);

    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.shiftKey) {
        e.preventDefault();
        submitNote();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        toggleCard(false);
      }
    });
  }

  // ==========================================
  // 7. 账号授权与状态弹窗
  // ==========================================
  function openSettingsModal() {
    const currentUid = CONFIG.uid;

    const modal = document.createElement('div');
    modal.style.cssText = `
      position: fixed; inset: 0; z-index: 2147483647;
      background: rgba(15, 23, 42, 0.6); backdrop-filter: blur(4px);
      display: flex; align-items: center; justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    `;

    const box = document.createElement('div');
    box.style.cssText = `
      width: 380px; max-width: 90vw; background: #ffffff; border-radius: 16px;
      padding: 24px; box-shadow: 0 20px 40px rgba(0,0,0,0.25); color: #1e293b;
    `;

    box.innerHTML = `
      <h3 style="margin: 0 0 10px 0; font-size: 16px; font-weight: 600; color: #0f172a; display: flex; align-items: center; gap: 8px;">
        🔐 PageTrace 账号授权
      </h3>
      <div style="font-size: 13px; color: #64748b; line-height: 1.5; margin-bottom: 16px;">
        只需登录您的 Google 账号，所有速记笔记将自动无缝同步到您的专属个人云端空间。
      </div>

      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px; margin-bottom: 16px; font-size: 12px; color: #475569;">
        <div>当前状态: <strong style="color: ${currentUid ? '#16a34a' : '#ea580c'};">${currentUid ? '✓ 已授权登录' : '⚠️ 未登录'}</strong></div>
        ${currentUid ? `<div style="margin-top: 6px; font-size: 11px; color: #94a3b8; word-break: break-all;">用户 ID: ${currentUid}</div>` : ''}
      </div>

      <div style="display: flex; flex-direction: column; gap: 10px;">
        <button id="pt-go-login" style="width: 100%; padding: 10px 14px; background: #2563eb; color: #fff; border: none; border-radius: 9px; font-size: 13px; font-weight: 500; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px;">
          <span>🚀</span>
          <span>${currentUid ? '重新授权 / 切换 Google 账号' : '使用 Google 账号登录授权'}</span>
        </button>
      </div>

      <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px;">
        ${currentUid ? `
          <button id="pt-logout" style="padding: 6px 12px; background: #fee2e2; color: #dc2626; border: 1px solid #fecaca; border-radius: 7px; font-size: 12px; cursor: pointer; margin-right: auto;">
            退出登录
          </button>
        ` : ''}
        <button id="pt-cancel" style="padding: 6px 16px; background: #f1f5f9; color: #475569; border: 1px solid #cbd5e1; border-radius: 7px; font-size: 12px; cursor: pointer;">
          关闭
        </button>
      </div>
    `;

    modal.appendChild(box);
    document.body.appendChild(modal);

    modal.querySelector('#pt-cancel').addEventListener('click', () => modal.remove());

    modal.querySelector('#pt-go-login').addEventListener('click', () => {
      window.open(CONFIG.authAppUrl, 'PageTraceAuth', 'width=480,height=620');
      modal.remove();
    });

    const logoutBtn = modal.querySelector('#pt-logout');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => {
        GM_deleteValue('pt_id_token');
        GM_deleteValue('pt_refresh_token');
        GM_deleteValue('pt_uid');
        GM_deleteValue('pt_token_expiry');
        alert('已退出登录');
        modal.remove();
      });
    }
  }

  setupAuthBridgeListener();
  
  function initMount() {
    mount();
    // 监听 DOM 树变动：防止 SPA (如 Google AI Studio) 在路由切换或组件销毁时误删宿主节点
    if (window.MutationObserver) {
      const observer = new MutationObserver(() => {
        if (!document.getElementById(CONFIG.HOST_ID)) {
          mount();
        }
      });
      observer.observe(document.documentElement || document.body, {
        childList: true,
        subtree: false
      });
    }
    // 兜底定时检查
    setInterval(() => {
      if (!document.getElementById(CONFIG.HOST_ID)) {
        mount();
      }
    }, 2000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMount, { once: true });
  } else {
    initMount();
  }
})();
