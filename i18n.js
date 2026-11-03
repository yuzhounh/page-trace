// Lightweight bilingual (Simplified Chinese / English) runtime for PageTrace.
// Loaded as a classic script after the app markup. Default language is
// Simplified Chinese; the choice is stored in localStorage and switched from
// the site's settings drawer, avatar menu or the L shortcut.
(function () {
  const STORAGE_KEY = "pagetrace_lang";
  const SUPPORTED = ["zh", "en"];

  const EN = {
    "，方便编写多行备注或分段": ", for writing multi-line notes or paragraphs",
    "🗑️ 回收站": "🗑️ Trash",
    "按键": "Key",
    "按键组合": "Shortcut",
    "保存": "Save",
    "保存更改": "Save changes",
    "备注、同步与回收站": "Notes, sync & trash",
    "备注支持 Markdown 和数学公式。登录同一账号并联网后同步；历史尚未加载不代表没有笔记。":
      "Notes support Markdown and math formulas. Sync after signing in with the same account and going online; history not yet loaded does not mean there are no notes.",
    "本月": "This month",
    "编辑速记": "Edit note",
    "标题（可选）": "Title (optional)",
    "操作方式": "How to use",
    "撤销": "Undo",
    "从菜单登录 Google 账号，点右下角“＋”新建速记。也可在其他应用中选择文字或网页，使用系统“分享”发送到 PageTrace，确认内容后保存。":
      "Sign in with Google from the menu, then tap “+” at the bottom-right to create a note. You can also select text or a web page in another app and use the system “Share” to send it to PageTrace, then confirm and save.",
    "从右上角登录 Google 账号；点击“速记”填写标题、链接和备注，三项可按需留空。按年份、月份浏览，搜索可查找全部历史笔记；鼠标移到记录上可复制、编辑或打开更多操作。":
      "Sign in with Google from the top-right; click “Note” to fill in a title, link and memo — any of them can be left blank. Browse by year and month; search finds all past notes. Hover a record to copy, edit or open more actions.",
    "打开看板": "Open board",
    "打开速记卡片，填写备注后保存": "Open the note card, add a memo and save",
    "单选笔记后可通过工具栏分享。系统返回键先关闭当前窗口或退出多选，关闭说明后回到菜单。":
      "Select a single note to share via the toolbar. The system Back key first closes the current window or exits multi-select; closing help returns to the menu.",
    "当前速记弹窗": "Current note dialog",
    "登录": "Sign in",
    "已登录": "Signed in",
    "✓ 检测到已登录账号": "✓ Signed-in account detected",
    "点备注展开或收起，点链接打开原网页。长按记录可多选，底部工具栏提供复制、删除及更多操作；单选还可编辑和选择文字。":
      "Tap a memo to expand or collapse it; tap a link to open the original page. Long-press a record to multi-select; the bottom toolbar offers copy, delete and more. A single selection can also be edited or have its text selected.",
    "点右上角菜单登录 Google 账号，点右下角“＋”新建速记。支持横竖屏浏览，标题、链接或备注可按需填写。":
      "Tap the top-right menu to sign in with Google, and “+” at the bottom-right to create a note. Works in landscape and portrait; title, link or memo can be filled as needed.",
    "点右上角菜单登录 Google 账号。点右下角“＋”新建速记，填写标题、链接或备注后保存。网页版直接在浏览器中使用。":
      "Tap the top-right menu to sign in with Google. Tap “+” at the bottom-right to create a note, fill in a title, link or memo, then save. The web version runs directly in your browser.",
    "动作": "Action",
    "复制": "Copy",
    "复制笔记": "Copy note",
    "复制标题与链接 / 直接保存云端": "Copy title & link / save straight to cloud",
    "功能": "Feature",
    "功能导航": "Navigation",
    "功能描述": "Description",
    "换行": "New line",
    "回收站": "Trash",
    "回收站 / 切换明暗主题": "Trash / toggle theme",
    "看板操作": "Board actions",
    "看板快捷键（输入框外）": "Board shortcuts (outside input)",
    "链接（可选）": "Link (optional)",
    "浏览器支持时，可分享选中的笔记。退出多选使用左上角关闭按钮；关闭说明使用右上角“×”。":
      "When the browser supports it, you can share selected notes. Exit multi-select with the top-left close button; close help with the top-right “×”.",
    "浏览与操作": "Browse & operate",
    "平板浏览器中使用": "On a tablet browser",
    "清空回收站": "Empty trash",
    "取消/收起": "Cancel / collapse",
    "删除后先进入回收站，可还原；永久删除和清空回收站不可撤销。":
      "Deleted notes go to the trash first and can be restored; permanent deletion and emptying the trash cannot be undone.",
    "深色模式": "Dark mode",
    "使用说明": "Help",
    "使用说明 / 关闭当前窗口或搜索": "Help / close current window or search",
    "使用外接键盘时，也可按“/”搜索、“N”新建速记、“Esc”关闭窗口。":
      "With an external keyboard, press “/” to search, “N” to create a note and “Esc” to close a window.",
    "手机浏览器中使用": "On a phone browser",
    "搜索": "Search",
    "搜索笔记": "Search notes",
    "搜索全部笔记 / 新建速记": "Search all notes / create note",
    "速记": "Note",
    "速记备注": "Note memo",
    "速记到云端并关闭窗口": "Save note to cloud and close",
    "速记输入框": "Note input",
    "退出登录": "Sign out",
    "外观主题": "Theme",
    "未登录": "Not signed in",
    "文本": "Text",
    "新建速记": "New note",
    "已移至回收站": "Moved to trash",
    "隐藏或恢复浮动按钮；悬停可查看操作提示": "Hide or restore the floating button; hover for action tips",
    "油猴脚本浮动按钮（安装脚本后）": "Tampermonkey floating button (after installing the script)",
    "在菜单中选择年份、月份、“本月”或“全部笔记”。顶部搜索框查找全部历史笔记，清空搜索后回到原浏览范围。":
      "In the menu, choose a year, month, “This month” or “All notes”. The top search box searches all past notes; clearing the search returns to the previous browsing range.",
    "左键 / 右键": "Left / Right click",
    "Android App 中使用": "In the Android app",
    "Ctrl + 右键": "Ctrl + right click",
    "Ctrl + 左键": "Ctrl + left click",
    "PageTrace - 云端速记看板": "PageTrace — Cloud Note Board",
    "语言 / Language": "Language",
    "切换中英文": "Switch between Chinese and English",
    "编辑": "Edit",
    "删除": "Delete",
    "更多选项": "More options",
    "更多": "More",
    "展开": "Expand",
    "收起": "Collapse",
    "浅色": "Light",
    "深色": "Dark",
    "浅色模式": "Light mode",
    "全部年份": "All years",
    "全部月份": "All months",
    "全年": "Full year",
    "全部笔记": "All notes",
    "历史记录": "History",
    "未加载": "Not loaded",
    "加载失败": "Loading failed",
    "正在加载笔记…": "Loading notes…",
    "正在加载历史笔记，结果尚未完整…": "Loading note history; results are incomplete…",
    "同步中…": "Syncing…",
    "云端连接暂不可用，当前显示本地缓存": "Cloud connection unavailable; showing cached notes",
    "云端连接暂不可用，暂无本地缓存": "Cloud connection unavailable; no cached notes",
    "加载失败，请切换月份或重新打开重试。": "Could not load notes. Switch months or reopen the page to retry.",
    "未找到匹配的笔记": "No matching notes",
    "该月份暂无笔记": "No notes this month",
    "当前暂无笔记可复制": "No notes to copy",
    "空白速记": "Empty note",
    "无标题页面": "Untitled page",
    "未设置昵称": "No display name",
    "Google 用户": "Google user",
    "欢迎使用 PageTrace": "Welcome to PageTrace",
    "轻量网页速记 · 浏览足迹 · 云端多端同步": "Quick web notes · Reading history · Cloud sync across devices",
    "⚡ 速记": "⚡ Notes",
    "🌐 痕迹": "🌐 History",
    "☁️ 同步": "☁️ Sync",
    "快捷键": "Press",
    "或油猴右下角气泡，随时沉淀碎片灵感": "or use the userscript bubble at the bottom-right to capture ideas anytime",
    "自动抓取网页标题与来源，建立专属阅读足迹": "Capture page titles and sources to build your reading history",
    "基于 Google Firebase 云端多端加密实时同步": "Real-time sync across devices via Google Firebase with encrypted connections",
    "立即登录": "Sign in now",
    "电脑网页版使用说明": "Desktop web help",
    "手机网页版使用说明": "Phone web help",
    "平板网页版使用说明": "Tablet web help",
    "Android App使用说明": "Android app help",
    "回收站加载失败，请关闭后重试。": "Could not load trash. Close it and try again.",
    "正在加载回收站…": "Loading trash…",
    "回收站为空": "Trash is empty",
    "正在检索全部月份的删除记录": "Finding deleted notes across all months",
    "删除的笔记会暂存在这里，可以随时还原或彻底清空": "Deleted notes stay here until you restore or permanently delete them",
    "还原": "Restore",
    "还原至看板": "Restore to board",
    "彻底删除": "Delete permanently",
    "确定彻底删除该条笔记吗？此操作将永久抹除，无法找回。": "Permanently delete this note? This cannot be undone.",
    "确定": "Confirm",
    "取消": "Cancel",
    "完成": "Done",
    "已复制": "Copied",
    "复制失败": "Copy failed",
    "当前没有可复制的笔记": "No notes to copy",
    "当前笔记内容为空": "The notes are empty",
    "笔记尚未加载完整，请稍后再复制全部结果": "Notes are still loading. Wait before copying all results.",
    "当前离线，速记草稿已保留。请联网后再保存到云端。": "You are offline. Your draft is kept here; reconnect to save it to the cloud.",
    "请先登录账号以保存速记": "Sign in to save a note",
    "标题、链接和速记备注不能同时为空": "Enter a title, link or memo",
    "账号已切换，请重新保存": "The account changed. Save again.",
    "账号或笔记已切换，请重新保存": "The account or note changed. Save again.",
    "正在获取网页标题...": "Fetching page title…",
    "保存失败": "Save failed",
    "修改失败": "Update failed",
    "删除失败": "Delete failed",
    "还原失败": "Restore failed",
    "彻底删除失败": "Permanent deletion failed",
    "清空失败": "Could not empty trash",
    "拉取笔记失败": "Could not load notes",
    "登录失败": "Sign-in failed",
    "已保存到云端收件箱": "Saved to cloud inbox",
    "菜单": "Menu",
    "笔记": "Notes",
    "搜索结果": "Search results",
    "搜索全部笔记": "Search all notes",
    "清除搜索": "Clear search",
    "笔记与设置": "Notes & settings",
    "全选": "Select all",
    "选择文字": "Select text",
    "分享": "Share",
    "笔记详情": "Note details",
    "长按笔记可多选、复制、删除": "Long-press a note to select, copy or delete notes",
  };

  const ATTR = {
    "保存 (Shift+Enter / Ctrl+Enter)": "Save (Shift+Enter / Ctrl+Enter)",
    "保存更改 (Shift+Enter / Ctrl+Enter)": "Save changes (Shift+Enter / Ctrl+Enter)",
    "纯笔记可留空": "Optional for notes",
    "打开导航与设置菜单": "Open navigation and settings menu",
    "打开回收站 (T)": "Open trash (T)",
    "点击选择年份": "Click to choose year",
    "点击选择月份": "Click to choose month",
    "返回首页": "Back to home",
    "复制当前筛选的所有笔记": "Copy all notes in the current filter",
    "个人信息与设置": "Profile & settings",
    "关闭": "Close",
    "关闭编辑窗口": "Close editor",
    "关闭菜单": "Close menu",
    "关闭回收站": "Close trash",
    "关闭使用说明": "Close help",
    "关闭速记窗口": "Close note window",
    "回到本月": "Back to this month",
    "快捷设置与导航": "Quick settings and navigation",
    "切换深色/浅色模式 (D)": "Toggle dark/light mode (D)",
    "切换中英文 (L)": "Toggle Chinese/English (L)",
    "切换外观主题": "Toggle theme",
    "上一个月": "Previous month",
    "使用说明 (?)": "Help (?)",
    "输入关键词，实时搜索笔记内容、标签或链接...": "Type keywords to search note content, tags or links in real time…",
    "输入随手笔记 / 摘要 / 标签...\n支持 Markdown；行内公式 $x^2$，独立公式 $$x^2$$":
      "Write a quick note / summary / tag…\nSupports Markdown; inline math $x^2$, display math $$x^2$$",
    "搜索笔记": "Search notes",
    "退出搜索": "Exit search",
    "退出搜索 (Esc)": "Exit search (Esc)",
    "下一个月": "Next month",
    "新建速记": "New note",
    "移动端功能导航": "Mobile navigation",
    "永久清空回收站中所有笔记": "Permanently empty all notes in trash",
    "PageTrace 首页": "PageTrace home",
    "语言 / Language": "Language",
  };

  const MESSAGES = {};

  const DOC = {
    title: { zh: "PageTrace - 云端速记看板", en: "PageTrace — Cloud Note Board" },
    description: null,
  };

  const originalText = new WeakMap();
  const originalAttrs = new WeakMap();
  const translations = { ...EN, ...ATTR };
  const reverse = new Map(Object.entries(translations).map(([zh, en]) => [en, zh]));
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  // User text must never enter the UI dictionary, even when it equals a UI label.
  const ignored = 'script, style, noscript, [translate="no"], [data-i18n-ignore], ' +
    '.note-title, .note-body, .note-meta-domain, .trash-item-url, .trash-item-note, ' +
    '.trash-item-title:not([data-i18n-fallback]), #dropdownName:not([data-i18n-fallback]), ' +
    '#dropdownEmail, #avatarFallback, .mobile-user-avatar, ' +
    '.mobile-user-name:not([data-i18n-fallback]), .mobile-user-email, ' +
    '.pt-account-name:not([data-i18n-fallback]), .pt-account-mail, #menuLanguageLabel, option';
  const attributes = ['placeholder', 'title', 'aria-label', 'alt'];
  let observer;
  const observation = { childList: true, characterData: true, subtree: true,
    attributes: true, attributeFilter: attributes };
  const notes = n => `${n} ${Number(n) === 1 ? 'note' : 'notes'}`;
  const patterns = [
    [/^(\d{4})\s*年\s*(\d{1,2})\s*月$/, (_, y, m) => `${months[Number(m) - 1]} ${y}`],
    [/^(\d{4})\s*年$/, (_, y) => y],
    [/^(\d{1,2})\s*月$/, (_, m) => months[Number(m) - 1]],
    [/^(\d{1,2})\s*月 · 全部年份$/, (_, m) => `${months[Number(m) - 1]} · All years`],
    [/^共 (\d+) 条$/, (_, n) => notes(n)],
    [/^(\d+) 条$/, (_, n) => notes(n)],
    [/^已选择 (\d+) 项$/, (_, n) => `${n} selected`],
    [/^加载中 · (\d+) 条$/, (_, n) => `Loading · ${notes(n)}`],
    [/^(加载失败|检索中) · 已找到 (\d+) 条$/, (_, state, n) => `${state === '加载失败' ? 'Loading failed' : 'Searching'} · ${notes(n)} found`],
    [/^复制当前筛选的 (\d+) 条笔记$/, (_, n) => `Copy ${n} filtered notes`],
    [/^已成功复制当前 (\d+) 条笔记$/, (_, n) => `Copied ${notes(n)}`],
    [/^已复制 (\d+) 条$/, (_, n) => `Copied ${notes(n)}`],
    [/^已移至回收站 (\d+) 条$/, (_, n) => `Moved ${notes(n)} to trash`],
    [/^往下滚动加载更多 \(已显示 (\d+) \/ 共 (\d+) 条\)$/, (_, shown, total) => `Scroll for more (${shown} of ${notes(total)} shown)`],
    [/^✓ 已加载全部 (\d+) 条笔记$/, (_, n) => `✓ All ${notes(n)} loaded`],
    [/^确定彻底清空回收站中的 (\d+) 条笔记吗？此操作无法撤销。$/, (_, n) => `Permanently delete all ${notes(n)} in trash? This cannot be undone.`],
    [/^(创建于|编辑于|删除于) (.+)$/, (_, action, date) => `${({ 创建于: 'Created on', 编辑于: 'Edited on', 删除于: 'Deleted on' })[action]} ${date}`],
    [/^链接 : (.*)$/, (_, url) => `Link: ${url}`],
    [/^(保存失败|修改失败|删除失败|还原失败|彻底删除失败|清空失败|拉取笔记失败|登录失败)[:：] ?([\s\S]*)$/, (_, action, detail) => `${translations[action]}: ${translateUI(detail)}`],
  ];

  function canonical(text) {
    if (reverse.has(text)) return reverse.get(text);
    // Previously rendered tooltips/HTML may be restored by an action's timer.
    const copy = /^Copy (\d+) filtered notes$/.exec(text);
    if (copy) return `复制当前筛选的 ${copy[1]} 条笔记`;
    const copied = /^Copied (\d+) notes?$/.exec(text);
    if (copied) return `已复制 ${copied[1]} 条`;
    const date = /^(Created on|Edited on|Deleted on) (.+)$/.exec(text);
    if (date) return `${({ 'Created on': '创建于', 'Edited on': '编辑于', 'Deleted on': '删除于' })[date[1]]} ${date[2]}`;
    return text;
  }
  function translateUI(text, en = isEn()) {
    if (text == null) return text;
    const key = canonical(String(text).trim());
    let result = key;
    if (en) {
      if (Object.prototype.hasOwnProperty.call(translations, key)) result = translations[key];
      else for (const [pattern, replacement] of patterns) {
        if (pattern.test(key)) { result = key.replace(pattern, replacement); break; }
      }
    }
    return pad(String(text), result);
  }

  function normalize(lang) {
    return SUPPORTED.includes(lang) ? lang : "zh";
  }
  function getLang() {
    try {
      return normalize(localStorage.getItem(STORAGE_KEY) || "zh");
    } catch (e) {
      return "zh";
    }
  }
  function isEn() {
    return getLang() === "en";
  }
  function pad(original, replacement) {
    const lead = (original.match(/^\s*/) || [""])[0];
    const trail = (original.match(/\s*$/) || [""])[0];
    return lead + replacement + trail;
  }
  function applyTextNode(node, en) {
    if (!node.parentElement || node.parentElement.closest(ignored + ', input, textarea')) return;
    const current = node.nodeValue;
    const previous = originalText.get(node);
    const source = previous && previous.rendered === current ? previous.source : current;
    const rendered = translateUI(source, en);
    originalText.set(node, { source, rendered });
    if (current !== rendered) node.nodeValue = rendered;
  }
  function applyAttr(el, attr, en) {
    if (!el.hasAttribute(attr) || el.closest(ignored)) return;
    let map = originalAttrs.get(el);
    if (!map) {
      map = new Map();
      originalAttrs.set(el, map);
    }
    const current = el.getAttribute(attr);
    const previous = map.get(attr);
    const source = previous && previous.rendered === current ? previous.source : current;
    const rendered = translateUI(source, en);
    map.set(attr, { source, rendered });
    if (current !== rendered) el.setAttribute(attr, rendered);
  }
  function translateTree(root) {
    if (!root.isConnected) return;
    const en = isEn();
    if (root.nodeType === Node.TEXT_NODE) { applyTextNode(root, en); return; }
    if (root.nodeType !== Node.ELEMENT_NODE || root.closest(ignored)) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode(node) {
        if (node.nodeType === Node.ELEMENT_NODE && node.matches(ignored)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let node = root;
    do {
      if (node.nodeType === Node.TEXT_NODE) applyTextNode(node, en);
      else attributes.forEach(attr => applyAttr(node, attr, en));
    } while ((node = walker.nextNode()));
  }
  function paused(callback) {
    observer?.disconnect();
    try { callback(); }
    finally { observer?.observe(document.body, observation); }
  }
  function applyStatic() {
    paused(() => translateTree(document.body));
    const en = isEn();
    document.documentElement.lang = en ? "en" : "zh-CN";
    if (DOC.title) document.title = DOC.title[en ? "en" : "zh"];
    const meta = DOC.description ? document.querySelector('meta[name="description"]') : null;
    if (meta) meta.setAttribute("content", DOC.description[en ? "en" : "zh"]);
  }
  function t(key, vars) {
    const entry = MESSAGES[key];
    let text = entry ? entry[isEn() ? "en" : "zh"] : translateUI(key);
    if (vars) {
      Object.keys(vars).forEach(function (name) {
        text = text.split("{" + name + "}").join(String(vars[name]));
      });
    }
    return text;
  }
  function tLabel(text) {
    return translateUI(text);
  }
  function syncSelects() {
    const lang = getLang();
    const label = document.getElementById("menuLanguageLabel");
    const b = document.getElementById("lang-select-drawer");
    if (label) label.textContent = lang === "en" ? "简体中文" : "English";
    if (b) b.value = lang;
  }
  function setLang(lang) {
    const next = normalize(lang);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch (e) {
      /* ignore */
    }
    applyStatic();
    syncSelects();
    document.dispatchEvent(new CustomEvent("i18n:change", { detail: next }));
    return next;
  }
  function toggleLang() {
    return setLang(isEn() ? "zh" : "en");
  }
  function init() {
    if (observer) return;
    observer = new MutationObserver(records => paused(() => {
      for (const record of records) {
        if (record.type === 'attributes') applyAttr(record.target, record.attributeName, isEn());
        else if (record.type === 'characterData') applyTextNode(record.target, isEn());
        else for (const node of record.addedNodes) translateTree(node);
      }
    }));
    applyStatic();
    syncSelects();
    const button = document.getElementById("menuLanguageBtn");
    const b = document.getElementById("lang-select-drawer");
    if (button) button.addEventListener("click", function () {
      toggleLang();
      button.closest(".user-dropdown")?.classList.remove("show");
    });
    if (b) b.addEventListener("change", function (e) { setLang(e.target.value); });
    window.addEventListener('pagehide', () => observer.disconnect());
    window.addEventListener('pageshow', applyStatic);
  }

  window.I18N = { getLang, isEn, t, tLabel, applyStatic, setLang, toggleLang, changeLang: setLang };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
