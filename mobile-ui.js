/* Phone layout (touch devices, web and Android app): title bar with always-on search, full-screen menu for views and
   settings, multi-select with a bottom action bar. It drives the existing page logic and adds no data logic of its own.
   Design rules: review/mobile_design_system.md in the maintenance hub. */
(() => {
  const root = document.documentElement;
  const touchUI = window.PageTraceTouchUI;
  if (!root.classList.contains('is-touch') || !touchUI) return;
  const $ = id => document.getElementById(id);
  const measuredPreviews = new WeakMap();
  let textMeasure = null;
  function layoutPreviewDomains() {
    for (const preview of document.querySelectorAll('.note-body.is-collapsed .note-preview')) {
      const domain = preview.querySelector('.note-preview-domain');
      const text = preview.querySelector('.note-preview-text');
      if (!domain || !text || !domain.getBoundingClientRect().width) continue;
      const style = getComputedStyle(preview), width = preview.clientWidth;
      const font = style.font || `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const domainWidth = domain.getBoundingClientRect().width;
      const previous = measuredPreviews.get(preview);
      if (previous?.width === width && previous.font === font && previous.domainWidth === domainWidth) continue;
      if (!textMeasure) {
        textMeasure = document.createElement('span');
        textMeasure.setAttribute('aria-hidden', 'true');
        textMeasure.style.cssText = 'position:fixed;left:-100000px;top:0;visibility:hidden;white-space:pre;pointer-events:none;';
        document.body.append(textMeasure);
      }
      textMeasure.style.font = font;
      textMeasure.style.letterSpacing = style.letterSpacing;
      textMeasure.textContent = text.textContent;
      const gap = parseFloat(getComputedStyle(domain).marginLeft) || 0;
      const second = textMeasure.getBoundingClientRect().width + domainWidth + gap > width + 0.5;
      preview.style.setProperty('--pt-note-line', style.lineHeight);
      preview.classList.toggle('domain-second', second);
      measuredPreviews.set(preview, { width, font, domainWidth });
    }
    if (textMeasure) textMeasure.textContent = '';
  }

  const ICONS = {
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    calendar: '<rect x="4" y="5" width="16" height="15" rx="3"/><path d="M4 10h16M9 3v4M15 3v4"/>',
    stack: '<path d="M12 4l9 5-9 5-9-5z"/><path d="M3 14l9 5 9-5"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
    book: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11"/>',
    moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6L7 7M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"/>',
    left: '<path d="M15 6l-6 6 6 6"/>',
    right: '<path d="M9 6l6 6-6 6"/>',
    more: '<circle cx="12" cy="5.5" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="12" cy="18.5" r="1.3"/>',
    login: '<path d="M15 4h4v16h-4M4 12h11M11 8l4 4-4 4"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 20a8 8 0 0 1 16 0"/>',
    chevron: '<path d="M6 9l6 6 6-6"/>',
    logout: '<path d="M9 4H5v16h4M10 12h11M17 8l4 4-4 4"/>'
  };
  const svg = (name, size = 22) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  const LOGO = `<svg width="40" height="40" viewBox="0 0 48 48" aria-hidden="true"><defs><linearGradient id="ptMenuLogo" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#06b6d4"/><stop offset="50%" stop-color="#0ea5e9"/><stop offset="100%" stop-color="#10b981"/></linearGradient></defs><rect width="48" height="48" rx="12" fill="url(#ptMenuLogo)"/><g stroke="#fff" stroke-width="3.2" stroke-linecap="round"><line x1="13" y1="17" x2="35" y2="17"/><line x1="13" y1="24" x2="35" y2="24"/><line x1="13" y1="31" x2="25" y2="31"/></g></svg>`;

  // The page keeps its state in top-level lets of the main script; read them defensively.
  const state = () => ({
    user: typeof currentUser !== 'undefined' ? currentUser : null,
    year: typeof selectedYear !== 'undefined' ? selectedYear : 'all',
    month: typeof selectedMonth !== 'undefined' ? selectedMonth : 'all',
    keyword: typeof currentSearchKeyword !== 'undefined' ? String(currentSearchKeyword || '') : ''
  });
  const now = () => new Date();
  const monthKey = n => String(n).padStart(2, '0');
  const sel = { on: false, ids: new Set(), since: 0, owner: null, context: null };
  const selectionContext = () => { const s = state(); return JSON.stringify([s.user?.uid, s.year, s.month, s.keyword.trim()]); };
  const isOwner = uid => !!uid && state().user?.uid === uid;
  function validSelection() {
    if (sel.on && isOwner(sel.owner) && sel.context === selectionContext()) return true;
    exitSelect(); return false;
  }

  // ---- Title bar + search ----
  const top = document.createElement('div');
  top.id = 'ptTop';
  top.className = 'pt-top';
  top.innerHTML = `<div class="pt-bar"><div class="pt-titlewrap"><div class="pt-title" id="ptTitle"></div><div class="pt-status" id="ptStatus"></div></div>` +
    `<button type="button" class="pt-iconbtn" id="ptMenuBtn" aria-label="菜单">${svg('menu')}</button></div>` +
    `<label class="pt-search">${svg('search', 20)}<input id="ptSearch" type="text" inputmode="search" enterkeyhint="search" placeholder="搜索全部笔记" autocomplete="off" aria-label="搜索笔记">` +
    `<button type="button" class="pt-clear" id="ptSearchClear" aria-label="清除搜索">${svg('close', 18)}</button></label>`;
  document.body.prepend(top);
  const ptTitle = $('ptTitle'), ptStatus = $('ptStatus'), ptMenuBtn = $('ptMenuBtn'), ptSearch = $('ptSearch');

  function titleText() {
    if (sel.on) return `已选择 ${sel.ids.size} 项`;
    const s = state();
    if (!s.user) return '笔记';
    if (s.keyword.trim()) return '搜索结果';
    if (s.year === 'all' && s.month === 'all') return '全部笔记';
    if (s.month === 'all') return `${s.year} 年`;
    if (s.year === 'all') return `${Number(s.month)} 月 · 全部年份`;
    return `${s.year} 年 ${Number(s.month)} 月`;
  }
  // 单月视图：标题后紧跟“共 N 条”，列表里的月份悬浮头随之隐藏
  function singleMonth() {
    const s = state();
    return !!s.user && !s.keyword.trim() && !sel.on && s.year !== 'all' && s.month !== 'all';
  }
  function countText() {
    if (!singleMonth()) return '';
    const el = document.querySelector('.month-date-count');
    return el ? el.textContent.trim() : '';
  }
  function statusText() {
    if (sel.on) return '';
    const load = $('notesLoadStatus');
    if (load && load.style.display !== 'none' && load.textContent) return load.textContent;
    const badge = $('searchCountBadge');
    if (state().keyword.trim() && badge && badge.style.display !== 'none') return badge.textContent;
    return '';
  }
  let queued = false;
  function refresh() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      if (sel.on && !validSelection()) exitSelect();
      ptTitle.textContent = titleText();
      const total = countText();
      if (total) { const span = document.createElement('span'); span.className = 'pt-title-count'; span.textContent = ' ' + total; ptTitle.append(span); }
      root.classList.toggle('pt-single-month', singleMonth());
      const status = statusText();
      ptStatus.textContent = status;
      ptStatus.hidden = !status;
      const inline = $('inlineSearchInput');
      if (inline && document.activeElement !== ptSearch && ptSearch.value !== inline.value) ptSearch.value = inline.value;
      top.classList.toggle('has-text', !!ptSearch.value);
      root.classList.toggle('pt-signed-out', !state().user);
      markRows();
      layoutPreviewDomains();
      if (menu.classList.contains('show')) renderMenu();
    });
  }
  function setSearch(value) {
    const inline = $('inlineSearchInput');
    if (!inline) return;
    inline.value = value;
    inline.dispatchEvent(new Event('input', { bubbles: true }));
  }
  ptSearch.addEventListener('input', () => { top.classList.toggle('has-text', !!ptSearch.value); setSearch(ptSearch.value); });
  ptSearch.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); ptSearch.blur(); } });
  $('ptSearchClear').addEventListener('click', () => { ptSearch.value = ''; setSearch(''); top.classList.remove('has-text'); ptSearch.focus(); });

  // Scrolling down folds the bar to 48dp and hides the search box; scrolling up unfolds it.
  let lastY = window.scrollY;
  window.addEventListener('scroll', () => {
    const y = window.scrollY, dy = y - lastY;
    if (document.activeElement === ptSearch) { lastY = y; return; }
    if (y < 12 || dy < -6) { root.classList.remove('pt-collapsed'); lastY = y; }
    else if (dy > 8 && y > 80) { root.classList.add('pt-collapsed'); lastY = y; }
  }, { passive: true });

  // ---- Full-screen menu ----
  const menu = document.createElement('div');
  menu.id = 'ptMenu';
  menu.className = 'pt-menu';
  menu.setAttribute('role', 'dialog');
  menu.setAttribute('aria-label', '笔记与设置');
  document.body.append(menu);

  const countOf = el => {
    const badge = el && el.querySelector('.nav-count-badge');
    const m = badge && badge.textContent.match(/\d+/);
    return m ? Number(m[0]) : null;
  };
  const rowHtml = (action, icon, label, { on = false, count = null, data = '' } = {}) =>
    `<button type="button" class="pt-row${on ? ' on' : ''}" data-action="${action}" ${data}>${svg(icon)}<span class="pt-row-label">${label}</span>` +
    `${count !== null ? `<span class="pt-row-count">${count}</span>` : ''}</button>`;
  let versionText = '';
  let menuScrollTop = 0;
  let pickData = { year: [], month: [] };
  function renderMenu() {
    const s = state();
    const cur = now();
    const thisYear = String(cur.getFullYear()), thisMonth = monthKey(cur.getMonth() + 1);
    const yearItems = [...($('yearDropdownMenu')?.querySelectorAll('.nav-dropdown-item') || [])];
    const monthItems = [...($('monthDropdownMenu')?.querySelectorAll('.nav-dropdown-item[data-month]') || [])]
      .filter(el => el.dataset.month !== 'all');
    const allCount = countOf(yearItems.find(el => el.dataset.year === 'all'));
    const monthCount = key => countOf(monthItems.find(el => el.dataset.month === key));
    const thisMonthCount = s.year === thisYear ? monthCount(thisMonth) : null;
    let html = `<div class="pt-menu-head"><div class="pt-title">笔记与设置</div><button type="button" class="pt-iconbtn" data-action="close" aria-label="关闭菜单">${svg('close')}</button></div><div class="pt-menu-body">`;
    if (s.user) {
      const yearsAll = yearItems.filter(el => el.dataset.year !== 'all' && countOf(el) !== 0).map(el => Number(el.dataset.year)).filter(Number.isFinite);
      const pickYear = s.year === 'all' ? Number(thisYear) : Number(s.year);
      if (!yearsAll.includes(pickYear)) yearsAll.push(pickYear);
      yearsAll.sort((x, y) => y - x);
      const monthSelect = s.year === 'all' ? 'all' : s.month;
      pickData = {
        year: yearsAll.map(y => ({ value: String(y), label: `${y} 年`, n: countOf(yearItems.find(el => el.dataset.year === String(y))), on: y === pickYear })),
        month: [{ value: 'all', label: '全年', n: countOf(yearItems.find(el => el.dataset.year === String(pickYear))), on: monthSelect === 'all' }].concat(
          Array.from({ length: 12 }, (_, i) => i + 1).map(m => ({ value: monthKey(m), n: monthCount(monthKey(m)) }))
            .filter(o => o.n !== 0 || o.value === monthSelect)
            .map(o => ({ value: o.value, label: `${Number(o.value)} 月`, n: o.n, on: o.value === monthSelect })))
      };
      const yearLabel = `${pickYear} 年`, monthLabel = monthSelect === 'all' ? '全年' : `${Number(monthSelect)} 月`;
      html += `<div class="pt-group"><div class="pt-picker">` +
        `<button type="button" class="pt-select" data-action="pick" data-pick="year" aria-haspopup="listbox"><span>${yearLabel}</span>${svg('chevron', 18)}</button>` +
        `<button type="button" class="pt-select" data-action="pick" data-pick="month" aria-haspopup="listbox"><span>${monthLabel}</span>${svg('chevron', 18)}</button></div></div>`;
      html += `<div class="pt-group">` +
        rowHtml('this-month', 'calendar', '本月', { on: !s.keyword.trim() && s.year === thisYear && s.month === thisMonth, count: thisMonthCount }) +
        rowHtml('all-notes', 'stack', '全部笔记', { on: !s.keyword.trim() && s.year === 'all' && s.month === 'all', count: allCount }) +
        rowHtml('trash', 'trash', '回收站') + `</div>`;
    }
    const dark = root.getAttribute('data-theme') === 'dark';
    html += `<div class="pt-group">` +
      (s.user ? rowHtml('copy-all', 'copy', '复制笔记') : '') +
      rowHtml('doc', 'book', '使用说明') +
      rowHtml('theme', dark ? 'sun' : 'moon', dark ? '浅色模式' : '深色模式') + `</div>`;
    if (s.user) {
      const name = s.user.displayName || s.user.email || 'Google 用户';
      html += `<div class="pt-group"><div class="pt-account">${svg('user')}<span class="pt-account-name" id="ptAccName"></span><span class="pt-account-mail" id="ptAccMail"></span>` +
        `<button type="button" class="pt-iconbtn" data-action="logout" aria-label="退出登录">${svg('logout')}</button></div></div>`;
    } else {
      html += `<div class="pt-group">${rowHtml('login', 'login', '登录')}</div>`;
    }
    html += `</div><div class="pt-footer">${LOGO}<div class="pt-footer-text">PageTrace${versionText ? ' ' + versionText : ''}</div></div>`;
    const keepScroll = menu.classList.contains('show') ? menu.querySelector('.pt-menu-body')?.scrollTop || 0 : menuScrollTop;
    menuScrollTop = keepScroll;
    menu.innerHTML = html;
    menu.querySelector('.pt-menu-body').scrollTop = keepScroll;
    if (s.user) {
      const name = s.user.displayName || s.user.email || 'Google 用户';
      $('ptAccName').textContent = name;
      $('ptAccMail').textContent = s.user.displayName && s.user.email ? s.user.email : '';
    }
  }
  async function loadVersion() {
    if (window.PageTraceVersion) { versionText = String(window.PageTraceVersion); return; }
    try {
      const response = await fetch('VERSION', { cache: 'no-store' });
      const text = response.ok ? (await response.text()).trim() : '';
      if (/^\d+(\.\d+)*$/.test(text)) versionText = text;
    } catch (_) { /* offline: show the name only */ }
  }
  let menuLayer = null;
  function openMenu() {
    if (menu.classList.contains('show')) return;
    renderMenu();
    menu.classList.add('show');
    menu.querySelector('.pt-menu-body').scrollTop = menuScrollTop;
    root.classList.add('pt-menu-open');
    menuLayer = () => closeMenu();
    touchUI.layers.push(menuLayer);
    loadVersion().then(() => { if (menu.classList.contains('show')) renderMenu(); });
  }
  function closeMenu() {
    if (menu.classList.contains('show')) menuScrollTop = menu.querySelector('.pt-menu-body')?.scrollTop || 0;
    menu.classList.remove('show');
    root.classList.remove('pt-menu-open');
    const i = touchUI.layers.indexOf(menuLayer);
    if (i >= 0) touchUI.layers.splice(i, 1);
    menuLayer = null;
  }
  function leaveSearch() {
    if (state().keyword.trim()) { ptSearch.value = ''; setSearch(''); }
  }
  function go(year, month) {
    leaveSearch();
    selectedYear = year;
    selectedMonth = month;
    closeMenu();
    navigateToSelection();
  }
  const closePop = () => menu.querySelectorAll('.pt-pop').forEach(el => el.remove());
  menu.addEventListener('click', event => {
    const pickBtn = event.target.closest('[data-action="pick"]');
    const pop = event.target.closest('.pt-pop');
    if (!pop) {
      const wasOpen = pickBtn && pickBtn.classList.contains('open');
      closePop();
      menu.querySelectorAll('.pt-select.open').forEach(el => el.classList.remove('open'));
      if (pickBtn && !wasOpen) {
        const kind = pickBtn.dataset.pick;
        const box = document.createElement('div');
        box.className = 'pt-pop ' + kind;
        box.setAttribute('role', 'listbox');
        box.innerHTML = pickData[kind].map(o => `<button type="button" role="option" class="pt-pop-item${o.on ? ' on' : ''}" data-action="pick-set" data-pick="${kind}" data-value="${o.value}"><span>${o.label}</span><span class="pt-row-count">${o.n === null || o.n === undefined ? '未加载' : o.n}</span></button>`).join('');
        pickBtn.classList.add('open');
        pickBtn.parentElement.append(box);
      }
      if (pickBtn) return;
    }

    const el = event.target.closest('[data-action]');
    if (!el || el.disabled) return;
    const action = el.dataset.action;
    const cur = now();
    if (action === 'close') closeMenu();
    else if (action === 'this-month') go(String(cur.getFullYear()), monthKey(cur.getMonth() + 1));
    else if (action === 'all-notes') go('all', 'all');
    else if (action === 'month') go(state().year === 'all' ? String(cur.getFullYear()) : state().year, el.dataset.month);
    else if (action === 'year') { leaveSearch(); selectedYear = el.dataset.year; navigateToSelection(); renderMenu(); }
    else if (action === 'trash') { showTrashModal(); }
    else if (action === 'doc') { if (typeof menuDocBtn !== 'undefined') menuDocBtn.click(); }
    else if (action === 'copy-all') { handleCopyFilteredNotes(); }
    else if (action === 'theme') { toggleTheme(); renderMenu(); }
    else if (action === 'login') { if (typeof loginBtn !== 'undefined') loginBtn.click(); }
    else if (action === 'pick-set') {
      const st = state(), c = now();
      const year = el.dataset.pick === 'year' ? el.dataset.value : (st.year === 'all' ? String(c.getFullYear()) : st.year);
      const month = el.dataset.pick === 'month' ? el.dataset.value : (st.year === 'all' ? 'all' : st.month);
      if (el.dataset.pick === 'year') { leaveSearch(); selectedYear = year; selectedMonth = month; navigateToSelection(); renderMenu(); }
      else go(year, month);
    }
    else if (action === 'logout') { dropdownLogout.click(); }
  });
  // ---- Multi-select ----
  const bar = document.createElement('div');
  bar.id = 'ptSelBar';
  bar.className = 'pt-selbar';
  bar.innerHTML = `<button type="button" data-sel="copy">${svg('copy')}<span>复制</span></button>` +
    `<button type="button" data-sel="delete">${svg('trash')}<span>删除</span></button>` +
    `<button type="button" data-sel="cancel">${svg('close')}<span>取消</span></button>` +
    `<button type="button" data-sel="more">${svg('more')}<span>更多</span></button>`;
  document.body.append(bar);

  function markRows() {
    if (!sel.on) return;
    document.querySelectorAll('.note-item-row[data-id]').forEach(row => row.classList.toggle('pt-selected', sel.ids.has(row.dataset.id)));
  }
  let selLayer = null;
  function enterSelect(id) {
    if (sel.on) return;
    const owner = state().user?.uid;
    if (!owner || !allIds().includes(id)) return;
    sel.on = true;
    sel.owner = owner;
    sel.context = selectionContext();
    sel.since = Date.now();
    sel.ids = new Set([id]);
    root.classList.add('pt-select-mode');
    ptMenuBtn.innerHTML = svg('check');
    ptMenuBtn.setAttribute('aria-label', '全选');
    selLayer = () => exitSelect();
    touchUI.layers.push(selLayer);
    markRows();
    refresh();
  }
  function exitSelect() {
    if (!sel.on) return;
    sel.on = false;
    sel.owner = null; sel.context = null;
    sel.ids = new Set();
    root.classList.remove('pt-select-mode');
    document.querySelectorAll('.note-item-row.pt-selected').forEach(row => row.classList.remove('pt-selected'));
    ptMenuBtn.innerHTML = svg('menu');
    ptMenuBtn.setAttribute('aria-label', '菜单');
    ptMenuBtn.classList.remove('all');
    const i = touchUI.layers.indexOf(selLayer);
    if (i >= 0) touchUI.layers.splice(i, 1);
    selLayer = null;
    refresh();
  }
  function allIds() { return (typeof getTargetNotes === 'function' ? getTargetNotes() : []).map(n => n.id); }
  function toggleRow(id) {
    if (sel.ids.has(id)) sel.ids.delete(id); else sel.ids.add(id);
    if (!sel.ids.size) { exitSelect(); return; }
    ptMenuBtn.classList.toggle('all', sel.ids.size >= allIds().length);
    markRows();
    refresh();
  }
  ptMenuBtn.addEventListener('click', () => {
    if (!sel.on) { openMenu(); return; }
    if (!validSelection()) return;
    const ids = allIds();
    sel.ids = sel.ids.size >= ids.length ? new Set([...sel.ids].slice(0, 1)) : new Set(ids);
    ptMenuBtn.classList.toggle('all', sel.ids.size >= ids.length);
    markRows();
    refresh();
  });
  document.addEventListener('click', event => {
    if (!sel.on) return;
    if (!validSelection()) return;
    const row = event.target.closest && event.target.closest('.note-item-row[data-id]');
    if (!row || event.target.closest('.pt-sheet-mask')) return;
    event.preventDefault();
    event.stopPropagation();
    if (Date.now() - sel.since > 700) toggleRow(row.dataset.id);
  }, true);

  const notesOf = () => [...sel.ids].map(id => (typeof findKnownNote === 'function' ? findKnownNote(id) : null)).filter(Boolean);
  async function trashMany(ids, uid) {
    if (!isOwner(uid)) return;
    if (ids.length === 1) { window.moveToTrash(ids[0]); return; }
    const items = ids.map(id => findKnownNote(id)).filter(Boolean);
    try {
      for (let i = 0; i < items.length; i += 400) {
        if (!isOwner(uid)) return;
        const batch = db.batch();
        for (const note of items.slice(i, i + 400)) {
          batch.update(db.collection('users').doc(uid).collection('notes').doc(note.id),
            { isDeleted: true, deletedAt: firebase.firestore.FieldValue.serverTimestamp() });
        }
        await batch.commit();
      }
      if (!isOwner(uid)) return;
      updateCachedNotes(items.map(note => ({ note: { ...note, isDeleted: true } })), uid);
      showUndoToast(`已移至回收站 ${items.length} 条`, async () => {
        for (const note of items) { if (!isOwner(uid)) return; await restoreFromTrash(note.id); }
      });
    } catch (error) {
      if (isOwner(uid)) showUndoToast('删除失败: ' + error.message, null, 4000, '⚠️');
    }
  }
  const noEvent = { stopPropagation() {}, currentTarget: null, target: null };
  bar.addEventListener('click', async event => {
    const button = event.target.closest('[data-sel]');
    if (!button || !sel.on) return;
    if (!validSelection()) return;
    const uid = sel.owner, context = sel.context;
    const owned = handler => (...args) => { if (isOwner(uid) && selectionContext() === context) return handler(...args); };
    const kind = button.dataset.sel;
    const ids = [...sel.ids];
    if (kind === 'cancel') { exitSelect(); return; }
    if (kind === 'copy') {
      const text = notesOf().map(formatNoteTextForCopy).filter(Boolean).join('\n\n');
      const ok = await copyTextToClipboard(text);
      if (!isOwner(uid) || selectionContext() !== context) return;
      showUndoToast(ok ? `已复制 ${ids.length} 条` : '复制失败', null, 1800, ok ? '✅' : '⚠️');
      if (ok) exitSelect();
    } else if (kind === 'delete') {
      exitSelect();
      trashMany(ids, uid);
    } else if (kind === 'more') {
      const single = ids.length === 1;
      const row = single ? document.querySelector(`.note-item-row[data-id="${CSS.escape(ids[0])}"]`) : null;
      const hit = row ? touchUI.rowItem(row) : null;
      const items = [];
      if (single && hit && hit.item) {
        items.push({ icon: 'edit', label: '编辑', handler: owned(() => { exitSelect(); window.handleMenuEdit(noEvent, ids[0]); }) });
        items.push({ icon: 'text', label: '选择文字', handler: owned(() => { exitSelect(); touchUI.selectText(hit); }) });
      }
      if (touchUI.canShare) {
        items.push({ icon: 'share', label: '分享', handler: owned(() => { touchUI.shareText(notesOf().map(formatNoteTextForCopy).filter(Boolean).join('\n\n')); exitSelect(); }) });
      }
      if (single && hit && hit.item) items.push({ icon: 'info', label: '笔记详情', handler: owned(() => touchUI.showDetails(hit)) });
      if (items.length) touchUI.openSheet(items, button);
    }
  });

  window.PageTraceMobile = { select: enterSelect, exitSelect, openMenu, closeMenu, refresh };

  // Keep title, status, counts and selection marks in step with the page.
  const watch = (el, options) => { if (el) new MutationObserver(refresh).observe(el, options); };
  watch($('notesList'), { childList: true, subtree: true });
  watch($('notesLoadStatus'), { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['style'] });
  watch($('searchCountBadge'), { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['style'] });
  watch($('yearCurrentLabel'), { childList: true, characterData: true, subtree: true });
  watch($('monthCurrentLabel'), { childList: true, characterData: true, subtree: true });
  watch($('monthDropdownMenu'), { childList: true, subtree: true });
  watch($('yearDropdownMenu'), { childList: true, subtree: true });
  watch($('mobileAccountContainer'), { childList: true, subtree: true });
  watch(root, { attributes: true, attributeFilter: ['data-theme'] });
  window.addEventListener('resize', refresh);
  document.fonts?.ready.then(refresh);
  refresh();
})();
