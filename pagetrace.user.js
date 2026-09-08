// ==UserScript==
// @name         PageTrace - Web Memo & Cloud Capture
// @namespace    https://pagetrace.web.app/
// @version      1.9.9
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
    get authAppUrl() {
      if (typeof window !== 'undefined' && window.location && window.location.hostname === 'localhost') {
        return `${window.location.origin}/auth.html`;
      }
      return 'https://page-trace-app.web.app/auth.html';
    },
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

  // 规范化笔记段落（两段之间始终保持一个空行）
  function formatNoteWithBlankLines(text) {
    if (!text) return '';
    const lines = text.trim().split(/\r?\n/);
    const nonEmptyLines = lines.map(l => l.trimEnd()).filter(l => l.trim() !== '');
    return nonEmptyLines.join('\n\n');
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
      throw new Error('尚未登录');
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
  // 5. Auth 桥接：接收来自 Web Auth 页面与看板的双向认证同步
  // ==========================================
  function setupAuthBridgeListener() {
    window.addEventListener('message', (event) => {
      const data = event.data;
      if (!data) return;

      if (data.source === 'PAGETRACE_AUTH_SUCCESS') {
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
          // 仅在独立授权弹窗页面 (auth.html) 执行自动关闭，切勿关闭看板页面 (index.html)
          if (window.location.pathname.includes('auth.html')) {
            setTimeout(() => {
              try { window.close(); } catch (_) {}
            }, 800);
          }
        }
      } else if (data.source === 'PAGETRACE_AUTH_LOGOUT') {
        GM_deleteValue('pt_id_token');
        GM_deleteValue('pt_refresh_token');
        GM_deleteValue('pt_uid');
        GM_deleteValue('pt_token_expiry');
      }
    });

    // 主动向宿主页面握手（若用户已在看板页面登录，立刻静默获取同步凭据）
    try {
      window.postMessage({ source: 'PAGETRACE_PING' }, '*');
    } catch (_) {}
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
        max-height: calc(100vh - 80px);
        box-sizing: border-box;
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

      .pt-input-wrap {
        position: relative;
        width: 100%;
      }
      .pt-textarea {
        width: 100%;
        box-sizing: border-box;
        border: 1px solid #cbd5e1;
        border-radius: 8px;
        padding: 8px 36px 8px 10px;
        font-size: 13px;
        line-height: 1.5;
        resize: none;
        min-height: 90px;
        max-height: 240px;
        height: 90px;
        outline: none;
        background: #ffffff;
        color: #1e293b;
        font-family: inherit;
        transition: border-color 150ms ease, box-shadow 150ms ease;
        display: block;
        overflow-y: hidden;
      }
      .pt-textarea::-webkit-scrollbar {
        width: 5px;
      }
      .pt-textarea::-webkit-scrollbar-track {
        background: transparent;
      }
      .pt-textarea::-webkit-scrollbar-thumb {
        background: #cbd5e1;
        border-radius: 3px;
      }
      .pt-textarea::-webkit-scrollbar-thumb:hover {
        background: #94a3b8;
      }
      .pt-textarea:focus {
        border-color: #3b82f6;
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
      }
      .pt-send-btn {
        position: absolute;
        right: 8px;
        bottom: 8px;
        width: 26px;
        height: 26px;
        border-radius: 50%;
        border: none;
        background: #2563eb;
        color: #ffffff;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: all 150ms ease;
        padding: 0;
      }
      .pt-send-btn:hover {
        background: #1d4ed8;
        transform: scale(1.05);
      }
      .pt-send-btn:active {
        transform: scale(0.95);
      }
      .pt-send-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      /* 底部主浮动胶囊条 */
      .pt-bar {
        position: relative;
        pointer-events: auto;
        display: flex;
        align-items: center;
        gap: 8px;
      }

      /* 悬停快捷操作提示框 (Tooltip - 默认浅色模式) */
      .pt-tooltip {
        position: absolute;
        right: 56px;
        bottom: 0;
        pointer-events: none;
        padding: 10px 14px;
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.96);
        color: #1e293b;
        box-shadow: 0 12px 32px rgba(15, 23, 42, 0.14), 0 2px 8px rgba(15, 23, 42, 0.05);
        backdrop-filter: blur(16px) saturate(180%);
        -webkit-backdrop-filter: blur(16px) saturate(180%);
        border: 1px solid rgba(0, 0, 0, 0.08);
        opacity: 0;
        transform: translateX(8px) scale(0.96);
        transition: opacity 180ms cubic-bezier(0.16, 1, 0.3, 1), transform 180ms cubic-bezier(0.16, 1, 0.3, 1);
        z-index: 20;
        display: flex;
        flex-direction: column;
        gap: 6px;
        white-space: nowrap;
      }
      .pt-tooltip.show {
        opacity: 1;
        transform: translateX(0) scale(1);
      }
      .pt-tip-row {
        display: flex;
        align-items: center;
        gap: 10px;
        font-size: 12px;
        line-height: 1.4;
      }
      .pt-tip-key {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 88px;
        flex-shrink: 0;
        padding: 2.5px 6px;
        font-size: 11px;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "PingFang SC", "Microsoft YaHei", monospace;
        font-weight: 600;
        border-radius: 6px;
        background: #f1f5f9;
        color: #2563eb;
        border: 1px solid #cbd5e1;
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
        box-sizing: border-box;
      }
      .pt-tip-desc {
        color: #334155;
        font-size: 12.5px;
        font-weight: 500;
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
      .pt-pill-btn.success {
        opacity: 1;
        border-color: #93c5fd;
        background: rgba(255, 255, 255, 0.96);
        box-shadow: 0 4px 16px rgba(37, 99, 235, 0.2);
      }
      .pt-pill-btn.warning {
        opacity: 1;
        border-color: #fcd34d;
        background: rgba(255, 255, 255, 0.96);
        box-shadow: 0 4px 16px rgba(245, 158, 11, 0.25);
      }
      .pt-pill-btn.error {
        opacity: 1;
        border-color: #fca5a5;
        background: rgba(255, 255, 255, 0.96);
        box-shadow: 0 4px 16px rgba(239, 68, 68, 0.25);
      }
      .pt-status-icon {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        height: 100%;
        opacity: 0;
        transform: scale(0.6);
        transition: opacity 180ms cubic-bezier(0.16, 1, 0.3, 1), transform 180ms cubic-bezier(0.16, 1, 0.3, 1);
        pointer-events: none;
      }
      .pt-status-icon.show {
        opacity: 1;
        transform: scale(1);
      }
      .pt-status-icon.success {
        color: #2563eb;
      }
      .pt-status-icon.warning {
        color: #f59e0b;
      }
      .pt-status-icon.error {
        color: #ef4444;
      }

      /* 暗色模式适配 */
      @media (prefers-color-scheme: dark) {
        .pt-card {
          background: rgba(30, 41, 59, 0.94);
          border-color: rgba(255, 255, 255, 0.1);
          color: #f8fafc;
        }
        .pt-close-btn {
          color: #94a3b8;
        }
        .pt-close-btn:hover {
          background: rgba(255, 255, 255, 0.1);
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
        .pt-textarea::-webkit-scrollbar-thumb {
          background: #334155;
        }
        .pt-textarea::-webkit-scrollbar-thumb:hover {
          background: #475569;
        }
        .pt-textarea:focus {
          border-color: #60a5fa;
        }
        .pt-pill-btn {
          background: #1e293b;
          border-color: #334155;
          color: #94a3b8;
          box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
          opacity: 0.9;
        }
        .pt-pill-btn:hover {
          opacity: 1;
          background: #0f172a;
          border-color: rgba(96, 165, 250, 0.6);
          color: #93c5fd;
          box-shadow: 0 6px 18px rgba(0, 0, 0, 0.5);
        }
        .pt-pill-btn:active {
          background: #0f172a;
          transform: scale(0.95);
        }
        .pt-pill-btn.recording {
          opacity: 1;
          background: #0f172a;
          border-color: #3b82f6;
          color: #60a5fa;
          box-shadow: 0 4px 16px rgba(59, 130, 246, 0.25);
        }
        .pt-pill-btn.success {
          opacity: 1;
          border-color: #3b82f6;
          background: #0f172a;
          box-shadow: 0 4px 16px rgba(59, 130, 246, 0.25);
        }
        .pt-pill-btn.warning {
          opacity: 1;
          border-color: #f59e0b;
          background: #0f172a;
          box-shadow: 0 4px 16px rgba(245, 158, 11, 0.25);
        }
        .pt-pill-btn.error {
          opacity: 1;
          border-color: #ef4444;
          background: #0f172a;
          box-shadow: 0 4px 16px rgba(239, 68, 68, 0.25);
        }
        .pt-status-icon.success {
          color: #3b82f6;
        }
        .pt-status-icon.warning {
          color: #fbbf24;
        }
        .pt-status-icon.error {
          color: #f87171;
        }
        .pt-send-btn {
          background: #3b82f6;
          color: #ffffff;
        }
        .pt-send-btn:hover {
          background: #60a5fa;
        }
        .pt-tooltip {
          background: rgba(30, 41, 59, 0.95);
          border-color: rgba(255, 255, 255, 0.1);
          color: #f8fafc;
          box-shadow: 0 12px 32px rgba(0, 0, 0, 0.36);
        }
        .pt-tip-key {
          background: rgba(255, 255, 255, 0.08);
          color: #93c5fd;
          border-color: rgba(255, 255, 255, 0.15);
          box-shadow: none;
        }
        .pt-tip-desc {
          color: #e2e8f0;
        }
      }

      /* 宿主页面显式暗色模式适配 */
      .pt-wrap.dark .pt-card {
        background: rgba(30, 41, 59, 0.94);
        border-color: rgba(255, 255, 255, 0.1);
        color: #f8fafc;
      }
      .pt-wrap.dark .pt-close-btn {
        color: #94a3b8;
      }
      .pt-wrap.dark .pt-close-btn:hover {
        background: rgba(255, 255, 255, 0.1);
        color: #f8fafc;
      }
      .pt-wrap.dark .pt-input-title {
        background: #0f172a;
        color: #94a3b8;
        border-color: #334155;
      }
      .pt-wrap.dark .pt-textarea {
        background: #0f172a;
        color: #f8fafc;
        border-color: #334155;
      }
      .pt-wrap.dark .pt-textarea::-webkit-scrollbar-thumb {
        background: #334155;
      }
      .pt-wrap.dark .pt-textarea::-webkit-scrollbar-thumb:hover {
        background: #475569;
      }
      .pt-wrap.dark .pt-textarea:focus {
        border-color: #60a5fa;
      }
      .pt-wrap.dark .pt-pill-btn {
        background: #1e293b;
        border-color: #334155;
        color: #94a3b8;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
        opacity: 0.9;
      }
      .pt-wrap.dark .pt-pill-btn:hover {
        opacity: 1;
        background: #0f172a;
        border-color: rgba(96, 165, 250, 0.6);
        color: #93c5fd;
        box-shadow: 0 6px 18px rgba(0, 0, 0, 0.5);
      }
      .pt-wrap.dark .pt-pill-btn:active {
        background: #0f172a;
        transform: scale(0.95);
      }
      .pt-wrap.dark .pt-pill-btn.recording {
        opacity: 1;
        background: #0f172a;
        border-color: #3b82f6;
        color: #60a5fa;
        box-shadow: 0 4px 16px rgba(59, 130, 246, 0.25);
      }
      .pt-wrap.dark .pt-pill-btn.success {
        opacity: 1;
        border-color: #3b82f6;
        background: #0f172a;
        box-shadow: 0 4px 16px rgba(59, 130, 246, 0.25);
      }
      .pt-wrap.dark .pt-pill-btn.warning {
        opacity: 1;
        border-color: #f59e0b;
        background: #0f172a;
        box-shadow: 0 4px 16px rgba(245, 158, 11, 0.25);
      }
      .pt-wrap.dark .pt-pill-btn.error {
        opacity: 1;
        border-color: #ef4444;
        background: #0f172a;
        box-shadow: 0 4px 16px rgba(239, 68, 68, 0.25);
      }
      .pt-wrap.dark .pt-status-icon.success {
        color: #3b82f6;
      }
      .pt-wrap.dark .pt-status-icon.warning {
        color: #fbbf24;
      }
      .pt-wrap.dark .pt-status-icon.error {
        color: #f87171;
      }
      .pt-wrap.dark .pt-send-btn {
        background: #3b82f6;
        color: #ffffff;
      }
      .pt-wrap.dark .pt-send-btn:hover {
        background: #60a5fa;
      }
      .pt-wrap.dark .pt-tooltip {
        background: rgba(30, 41, 59, 0.95);
        border-color: rgba(255, 255, 255, 0.1);
        color: #f8fafc;
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.36);
      }
      .pt-wrap.dark .pt-tip-key {
        background: rgba(255, 255, 255, 0.08);
        color: #93c5fd;
        border-color: rgba(255, 255, 255, 0.15);
        box-shadow: none;
      }
      .pt-wrap.dark .pt-tip-desc {
        color: #e2e8f0;
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

    const inputWrap = document.createElement('div');
    inputWrap.className = 'pt-input-wrap';

    const textarea = document.createElement('textarea');
    textarea.className = 'pt-textarea';
    textarea.placeholder = '输入随手笔记 / 摘要 / 标签...';
    textarea.rows = 4;

    const saveBtn = document.createElement('button');
    saveBtn.className = 'pt-send-btn';
    saveBtn.type = 'button';
    saveBtn.title = '保存 (Shift+Enter / Ctrl+Enter)';
    saveBtn.innerHTML = `
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 19V5M5 12l7-7 7 7"/>
      </svg>
    `;

    inputWrap.append(textarea, saveBtn);
    card.append(cardHeader, inputWrap);

    // 2. 底部浮动按钮 + 提示框
    const bar = document.createElement('div');
    bar.className = 'pt-bar';

    const tooltip = document.createElement('div');
    tooltip.className = 'pt-tooltip';
    tooltip.setAttribute('role', 'tooltip');
    tooltip.innerHTML = `
      <div class="pt-tip-row"><span class="pt-tip-key">鼠标左键</span><span class="pt-tip-desc">快速复制 Title + URL 到剪贴板</span></div>
      <div class="pt-tip-row"><span class="pt-tip-key">鼠标右键</span><span class="pt-tip-desc">直接保存 Title + URL 至云端</span></div>
      <div class="pt-tip-row"><span class="pt-tip-key">Ctrl + 左键</span><span class="pt-tip-desc">在前台新标签页打开云端看板</span></div>
      <div class="pt-tip-row"><span class="pt-tip-key">Ctrl + 右键</span><span class="pt-tip-desc">展开速记卡片并备注</span></div>
      <div class="pt-tip-row"><span class="pt-tip-key">Shift + H</span><span class="pt-tip-desc">隐藏浮动按钮</span></div>
    `;

    const mainBtn = document.createElement('button');
    mainBtn.className = 'pt-pill-btn';
    mainBtn.type = 'button';
    mainBtn.setAttribute('aria-label', 'PageTrace 速记浮动按钮');

    const statusIcon = document.createElement('span');
    statusIcon.className = 'pt-status-icon';
    mainBtn.appendChild(statusIcon);

    bar.append(tooltip, mainBtn);
    wrap.append(card, bar);
    shadow.append(style, wrap);
    (document.body || document.documentElement).appendChild(host);

    const SVG_ICONS = {
      success: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`,
      warning: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="4" x2="12" y2="14"></line><line x1="12" y1="19" x2="12.01" y2="19"></line></svg>`,
      error: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`
    };

    let statusTimer;
    function showButtonStatus(type, duration = 1800) {
      clearTimeout(statusTimer);
      statusIcon.innerHTML = SVG_ICONS[type] || '';
      statusIcon.className = `pt-status-icon ${type} show`;
      mainBtn.className = `pt-pill-btn ${type}`;
      statusTimer = setTimeout(() => {
        statusIcon.className = 'pt-status-icon';
        statusIcon.innerHTML = '';
        mainBtn.className = 'pt-pill-btn' + (card.classList.contains('active') ? ' recording' : '');
      }, duration);
    }

    function openLoginPopup() {
      window.open(CONFIG.authAppUrl, 'PageTraceAuth', 'width=480,height=620');
    }

    function autoResizeTextarea(el, minH = 90, maxH = 240) {
      if (!el) return;
      const currentScrollTop = el.scrollTop;
      const isAtBottom = (el.scrollHeight - el.scrollTop - el.clientHeight) <= 5;
      el.style.height = 'auto';
      const borderOffset = (el.offsetHeight - el.clientHeight) || 2;
      const targetH = el.scrollHeight + borderOffset;
      const finalH = Math.min(Math.max(targetH, minH), maxH);
      el.style.height = finalH + 'px';
      el.style.overflowY = targetH > maxH ? 'auto' : 'hidden';
      if (targetH > maxH) {
        if (isAtBottom) {
          el.scrollTop = el.scrollHeight;
        } else {
          el.scrollTop = currentScrollTop;
        }
      }
    }

    let tooltipTimer = null;
    function startTooltipTimer() {
      clearTimeout(tooltipTimer);
      if (card.classList.contains('active')) return;
      tooltipTimer = setTimeout(() => {
        if (!card.classList.contains('active')) {
          tooltip.classList.add('show');
        }
      }, 1800);
    }

    function hideTooltip() {
      clearTimeout(tooltipTimer);
      tooltip.classList.remove('show');
    }

    function toggleCard(show) {
      const isCurrentlyOpen = card.classList.contains('active');
      const targetState = show !== undefined ? show : !isCurrentlyOpen;
      hideTooltip();
      if (targetState) {
        titlePreview.textContent = processTitle(document.title);
        titlePreview.href = window.location.href;
        titlePreview.title = document.title;
        card.classList.add('active');
        mainBtn.classList.add('recording');
        autoResizeTextarea(textarea, 90, 240);
        setTimeout(() => {
          textarea.focus();
          autoResizeTextarea(textarea, 90, 240);
        }, 60);
      } else {
        card.classList.remove('active');
        mainBtn.classList.remove('recording');
      }
    }

    async function submitNote() {
      const title = processTitle(document.title);
      const url = window.location.href;
      const rawNote = textarea.value.trim();
      const note = formatNoteWithBlankLines(rawNote);

      if (!CONFIG.uid || !CONFIG.apiKey || !CONFIG.projectId) {
        showButtonStatus('warning');
        openLoginPopup();
        return;
      }

      saveBtn.disabled = true;
      saveBtn.style.opacity = '0.5';

      try {
        await saveToFirestore({ title, url, note });
        const copyPayload = note ? `${title}\n${url}\n笔记: ${note}` : `${title}\n${url}`;
        copyText(copyPayload).catch(() => {});

        showButtonStatus('success');
        textarea.value = '';
        autoResizeTextarea(textarea, 90, 240);
        toggleCard(false);
      } catch (err) {
        console.error('[PageTrace] 保存失败:', err);
        showButtonStatus('error');
      } finally {
        saveBtn.disabled = false;
        saveBtn.style.opacity = '1';
      }
    }

    async function handleCopyOnly() {
      const title = processTitle(document.title);
      const url = window.location.href;
      const rawNote = textarea.value.trim();
      const note = formatNoteWithBlankLines(rawNote);
      const text = note ? `${title}\n${url}\n笔记: ${note}` : `${title}\n${url}`;
      try {
        await copyText(text);
        showButtonStatus('success');
        if (textarea.value) {
          textarea.value = '';
          autoResizeTextarea(textarea, 90, 240);
        }
        toggleCard(false);
      } catch (e) {
        console.error('[PageTrace] 复制失败:', e);
        showButtonStatus('error');
      }
    }

    async function handleDirectSave() {
      const title = processTitle(document.title);
      const url = window.location.href;

      if (!CONFIG.uid || !CONFIG.apiKey || !CONFIG.projectId) {
        showButtonStatus('warning');
        openLoginPopup();
        return;
      }

      try {
        await saveToFirestore({ title, url, note: '' });
        const copyPayload = `${title}\n${url}`;
        copyText(copyPayload).catch(() => {});
        showButtonStatus('success');
      } catch (err) {
        console.error('[PageTrace] 保存失败:', err);
        showButtonStatus('error');
      }
    }

    // 鼠标悬停提示框事件（悬停 1.8 秒后显示）
    mainBtn.addEventListener('mouseenter', startTooltipTimer);
    mainBtn.addEventListener('mouseleave', hideTooltip);

    // 主按钮点击事件：
    // 鼠标左键：快速复制当前网页标题与网址 (Title + URL) 到剪贴板
    // Ctrl + 左键：在前台新标签页中打开云端速记看板
    mainBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      hideTooltip();

      if (e.ctrlKey || e.metaKey) {
        if (typeof GM_openInTab === 'function') {
          GM_openInTab('https://page-trace-app.web.app', { active: true, insert: true, setParent: true });
        } else {
          window.open('https://page-trace-app.web.app', '_blank', 'noopener,noreferrer');
        }
        return;
      }

      handleCopyOnly();
    });

    // 主按钮右键事件：
    // 鼠标右键：直接保存当前网页标题与网址 (Title + URL) 至云端
    // Ctrl + 右键：展开速记卡片，可输入备注并保存同步至云端
    mainBtn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      hideTooltip();

      if (e.ctrlKey || e.metaKey) {
        toggleCard();
        return;
      }

      handleDirectSave();
    });

    // 全局快捷键 Shift + H：隐藏/恢复浮动按钮
    const onGlobalKeyDown = (e) => {
      if (e.shiftKey && (e.key === 'H' || e.key === 'h' || e.code === 'KeyH') && !e.ctrlKey && !e.altKey && !e.metaKey) {
        const target = (e.composedPath && e.composedPath()[0]) || e.target;
        const targetTag = target?.tagName?.toLowerCase();
        const isEditing = target?.isContentEditable || targetTag === 'input' || targetTag === 'textarea' || targetTag === 'select';
        if (isEditing) return;

        if (!host.isConnected) {
          window.removeEventListener('keydown', onGlobalKeyDown);
          return;
        }

        e.preventDefault();
        if (wrap.style.display === 'none') {
          wrap.style.display = '';
        } else {
          wrap.style.display = 'none';
          toggleCard(false);
          hideTooltip();
        }
      }
    };
    window.addEventListener('keydown', onGlobalKeyDown);

    closeBtn.addEventListener('click', () => toggleCard(false));
    saveBtn.addEventListener('click', submitNote);

    textarea.addEventListener('input', () => autoResizeTextarea(textarea, 90, 240));
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.shiftKey || e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        submitNote();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        toggleCard(false);
      }
    });

    // 主题深浅色自适应与同步
    function updateTheme() {
      const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      const htmlEl = document.documentElement;
      const bodyEl = document.body;
      const htmlTheme = htmlEl ? htmlEl.getAttribute('data-theme') : null;
      const bodyTheme = bodyEl ? bodyEl.getAttribute('data-theme') : null;
      const hasDarkClass = (htmlEl && htmlEl.classList.contains('dark')) || (bodyEl && bodyEl.classList.contains('dark'));
      const isExplicitDark = htmlTheme === 'dark' || bodyTheme === 'dark' || hasDarkClass;
      const isExplicitLight = htmlTheme === 'light' || bodyTheme === 'light';

      if (isExplicitDark || (!isExplicitLight && prefersDark)) {
        wrap.classList.add('dark');
      } else {
        wrap.classList.remove('dark');
      }
    }

    updateTheme();

    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', updateTheme);
    }

    if (window.MutationObserver) {
      const themeObserver = new MutationObserver(() => {
        if (!host.isConnected) {
          themeObserver.disconnect();
          return;
        }
        updateTheme();
      });
      if (document.documentElement) {
        themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
      }
      if (document.body) {
        themeObserver.observe(document.body, { attributes: true, attributeFilter: ['data-theme', 'class'] });
      }
    }

    const onThemeMessage = (event) => {
      if (!host.isConnected) {
        window.removeEventListener('message', onThemeMessage);
        return;
      }
      if (event.data && event.data.source === 'PAGETRACE_THEME_CHANGE') {
        if (event.data.theme === 'dark') {
          wrap.classList.add('dark');
        } else if (event.data.theme === 'light') {
          wrap.classList.remove('dark');
        } else {
          updateTheme();
        }
      }
    };
    window.addEventListener('message', onThemeMessage);
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
