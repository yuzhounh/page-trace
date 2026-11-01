// Lightweight bilingual (Simplified Chinese / English) runtime for PageTrace.
// Loaded as a classic script after the app markup. Default language is
// Simplified Chinese; the choice is stored in localStorage and switched from
// the site's settings drawer or the top-bar selector.
(function () {
  const STORAGE_KEY = "pagetrace_lang";
  const SUPPORTED = ["zh", "en"];

  const EN = {
    "，方便编写多行备注或分段": ", for writing multi-line notes or paragraphs",
    "🗑️ 回收站": "🗑️ Trash",
    "0 条": "0 items",
    "10月": "Oct",
    "2026年": "2026",
    "按键": "Key",
    "按键组合": "Shortcut",
    "保存": "Save",
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
    "切换外观主题": "Toggle theme",
    "上一个月": "Previous month",
    "使用说明 (?)": "Help (?)",
    "输入关键词，实时搜索笔记内容、标签或链接...": "Type keywords to search note content, tags or links in real time…",
    "输入随手笔记 / 摘要 / 标签...&#10;支持 Markdown；行内公式 $x^2$，独立公式 $$x^2$$":
      "Write a quick note / summary / tag…&#10;Supports Markdown; inline math $x^2$, display math $$x^2$$",
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

  const LABELS = {};

  const MESSAGES = {};

  const DOC = {
    title: { zh: "PageTrace - 云端速记看板", en: "PageTrace — Cloud Note Board" },
    description: null,
  };

  const originalText = new WeakMap();
  const originalAttrs = new WeakMap();

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
    if (originalText.has(node)) {
      const original = originalText.get(node);
      if (en) {
        const key = original.trim();
        node.nodeValue = Object.prototype.hasOwnProperty.call(EN, key) ? pad(original, EN[key]) : original;
      } else {
        node.nodeValue = original;
        originalText.delete(node);
      }
      return;
    }
    if (!en) return;
    const current = node.nodeValue;
    const key = current.trim();
    if (!key || !Object.prototype.hasOwnProperty.call(EN, key)) return;
    originalText.set(node, current);
    node.nodeValue = pad(current, EN[key]);
  }
  function applyAttr(el, attr, en) {
    if (!el.hasAttribute(attr)) return;
    let map = originalAttrs.get(el);
    if (!map) {
      map = new Map();
      originalAttrs.set(el, map);
    }
    if (!map.has(attr)) map.set(attr, el.getAttribute(attr));
    const original = map.get(attr);
    const key = (original || "").trim();
    if (en && Object.prototype.hasOwnProperty.call(ATTR, key)) el.setAttribute(attr, ATTR[key]);
    else el.setAttribute(attr, original);
  }
  function applyStatic() {
    const en = isEn();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const tag = node.parentNode && node.parentNode.nodeName;
        if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT") return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let node;
    while ((node = walker.nextNode())) applyTextNode(node, en);
    document.querySelectorAll("[placeholder],[title],[aria-label],[alt]").forEach(function (el) {
      ["placeholder", "title", "aria-label", "alt"].forEach(function (attr) {
        applyAttr(el, attr, en);
      });
    });
    document.documentElement.lang = en ? "en" : "zh-CN";
    if (DOC.title) document.title = DOC.title[en ? "en" : "zh"];
    const meta = DOC.description ? document.querySelector('meta[name="description"]') : null;
    if (meta) meta.setAttribute("content", DOC.description[en ? "en" : "zh"]);
  }
  function t(key, vars) {
    const entry = MESSAGES[key];
    let text = entry ? entry[isEn() ? "en" : "zh"] : key;
    if (vars) {
      Object.keys(vars).forEach(function (name) {
        text = text.split("{" + name + "}").join(String(vars[name]));
      });
    }
    return text;
  }
  function tLabel(text) {
    if (!isEn() || text == null) return text;
    return Object.prototype.hasOwnProperty.call(LABELS, text) ? LABELS[text] : text;
  }
  function syncSelects() {
    const lang = getLang();
    const a = document.getElementById("lang-select");
    const b = document.getElementById("lang-select-drawer");
    if (a) a.value = lang;
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
  function init() {
    applyStatic();
    syncSelects();
    const a = document.getElementById("lang-select");
    const b = document.getElementById("lang-select-drawer");
    if (a) a.addEventListener("change", function (e) { setLang(e.target.value); });
    if (b) b.addEventListener("change", function (e) { setLang(e.target.value); });
  }

  window.I18N = { getLang, isEn, t, tLabel, applyStatic, setLang, changeLang: setLang };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
