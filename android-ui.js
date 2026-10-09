/* Android-only interaction layer: long-press note sheet, back-key overlay stack, theme and haptics bridge. */
(() => {
  if (!window.PageTraceNative) return;
  const root = document.documentElement;
  root.classList.add('is-android');
  const send = message => { try { window.PageTraceNative.postMessage(message); } catch (_) { /* native side unavailable */ } };
  const ICONS = {
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    text: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
    share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>'
  };
  const icon = name => `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
  const layers = [];
  function mount(content, anchor) {
    const mask = document.createElement('div');
    mask.className = 'pt-sheet-mask';
    const close = () => { mask.remove(); const i = layers.indexOf(close); if (i >= 0) layers.splice(i, 1); };
    mask.addEventListener('click', e => { if (e.target === mask) close(); });
    content.style.visibility = 'hidden';
    mask.append(content);
    document.body.append(mask);
    const rect = anchor ? anchor.getBoundingClientRect() : null;
    const center = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
    const top = Math.min(Math.max(12, center - content.offsetHeight / 2), window.innerHeight - content.offsetHeight - 12);
    content.style.top = `${top}px`;
    content.style.visibility = '';
    layers.push(close);
    return close;
  }
  function button(label, handler, cls) {
    const b = document.createElement('button');
    b.type = 'button';
    if (cls) b.className = cls;
    b.textContent = label;
    b.addEventListener('click', handler);
    return b;
  }
  function openSheet(items, anchor) {
    const sheet = document.createElement('div');
    sheet.className = 'pt-sheet';
    let close = () => {};
    for (const item of items) {
      const b = document.createElement('button');
      b.type = 'button';
      if (item.danger) b.className = 'danger';
      b.innerHTML = icon(item.icon);
      const span = document.createElement('span');
      span.textContent = item.label;
      b.append(span);
      b.addEventListener('click', () => { close(); item.handler(); });
      sheet.append(b);
    }
    close = mount(sheet, anchor);
  }
  function card(title, body, actions) {
    const el = document.createElement('div');
    el.className = 'pt-sheet pt-card';
    el.setAttribute('role', 'dialog');
    if (title) { const h = document.createElement('h3'); h.textContent = title; el.append(h); }
    el.append(body);
    const row = document.createElement('div');
    row.className = 'pt-actions';
    actions.forEach(a => row.append(a));
    el.append(row);
    return el;
  }
  function confirmPanel(message, okLabel = '确定') {
    return new Promise(resolve => {
      const text = document.createElement('p');
      text.textContent = message;
      let close = () => {};
      const done = value => () => { close(); resolve(value); };
      const el = card('', text, [button('取消', done(false)), button(okLabel, done(true), 'danger')]);
      close = mount(el);
      // The back key closes the top layer: treat that as "cancel".
      layers[layers.length - 1] = () => { close(); resolve(false); };
    });
  }
  function rowItem(target) {
    const row = target.closest && target.closest('.note-item-row[data-id]');
    return row ? { row, id: row.dataset.id, item: notesData.find(n => n.id === row.dataset.id) } : null;
  }
  const noEvent = { stopPropagation() {}, currentTarget: null, target: null };
  function showDetails({ row, item }) {
    const box = document.createElement('div');
    const lines = [...row.querySelectorAll('.note-menu-meta > div')].map(el => el.textContent.trim());
    if (item.url) lines.push(`链接 : ${item.url}`);
    for (const line of lines) {
      const d = document.createElement('div');
      d.className = 'pt-detail-row';
      d.textContent = line;
      box.append(d);
    }
    let close = () => {};
    close = mount(card('笔记详情', box, [button('完成', () => close(), 'primary')]));
  }
  // Select text in place: expand the note on the main screen and select its rendered text there.
  let stopSelecting = null;
  function selectText({ row }) {
    if (stopSelecting) stopSelecting();
    const body = row.querySelector('.note-body');
    if (!body) return;
    const toggle = body.nextElementSibling;
    if (body.classList.contains('is-collapsed') && toggle && toggle.classList.contains('note-expand-btn') && !toggle.hidden) toggle.click();
    const target = body.classList.contains('is-expanded') ? body.querySelector('.note-full') : body.querySelector('.note-preview');
    if (!target) return;
    row.classList.add('pt-selecting');
    // KaTeX keeps a hidden MathML copy of each formula; leave it out of what gets copied.
    const onCopy = event => {
      const selection = window.getSelection();
      if (!selection.rangeCount || !event.clipboardData) return;
      const holder = document.createElement('div');
      holder.append(selection.getRangeAt(0).cloneContents());
      holder.querySelectorAll('.katex-mathml').forEach(el => el.remove());
      holder.style.cssText = 'position:fixed;left:-9999px;white-space:pre-wrap';
      document.body.append(holder);
      const text = holder.innerText;
      holder.remove();
      event.clipboardData.setData('text/plain', text);
      event.preventDefault();
    };
    const onChange = () => { if (!String(window.getSelection()).length) stopSelecting(); };
    stopSelecting = () => {
      row.classList.remove('pt-selecting');
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('selectionchange', onChange);
      stopSelecting = null;
    };
    document.addEventListener('copy', onCopy);
    const range = document.createRange();
    range.selectNodeContents(target);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    setTimeout(() => document.addEventListener('selectionchange', onChange), 0);
  }
  async function copyNote({ item }) {
    const ok = await copyTextToClipboard(formatNoteTextForCopy(item));
    showUndoToast(ok ? '已复制' : '复制失败', null, 1800, ok ? '✅' : '⚠️');
  }
  function shareNote({ item }) {
    const text = formatNoteTextForCopy(item);
    if (text) send('share:' + text);
  }
  document.addEventListener('contextmenu', event => {
    const target = event.target;
    if (target.closest('input, textarea, .modal-overlay, .pt-sheet-mask')) return;
    const hit = rowItem(target);
    if (!hit || !hit.item) return;
    if (hit.row.classList.contains('pt-selecting')) return;
    event.preventDefault();
    send('haptic');
    openSheet([
      { icon: 'edit', label: '编辑', handler: () => window.handleMenuEdit(noEvent, hit.id) },
      { icon: 'text', label: '选择文字', handler: () => selectText(hit) },
      { icon: 'copy', label: '复制', handler: () => copyNote(hit) },
      { icon: 'share', label: '分享', handler: () => shareNote(hit) },
      { icon: 'trash', label: '删除', danger: true, handler: () => window.handleMenuDelete(noEvent, hit.id) },
      { icon: 'info', label: '笔记详情', handler: () => showDetails(hit) }
    ], hit.row);
  });

  const overlays = [
    () => editModal.classList.contains('show') && (closeEditModal.click(), true),
    () => createModal.classList.contains('show') && (hideCreateModal(), true),
    () => trashModal.classList.contains('show') && (hideTrashModal(), true),
    () => docModal.classList.contains('show') && (hideDocModal(), true),
    () => !drawerLayer.hidden && (closeMobileDrawer(), true),
    () => searchBarContainer.classList.contains('show') && (hideSearchBar(), true),
    () => [userDropdown, yearDropdownMenu, monthDropdownMenu].some(el => el.classList.contains('show')) &&
      ([userDropdown, yearDropdownMenu, monthDropdownMenu].forEach(el => el.classList.remove('show')), true)
  ];
  function back() {
    if (layers.length) { layers[layers.length - 1](); return true; }
    return overlays.some(close => { try { return close() === true; } catch (_) { return false; } });
  }

  // Touch has no hover: drop :hover rules so a tapped control never keeps its hover look.
  function splitSelectors(text) {
    const parts = []; let depth = 0; let start = 0;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '(' || c === '[') depth++;
      else if (c === ')' || c === ']') depth--;
      else if (c === ',' && depth === 0) { parts.push(text.slice(start, i)); start = i + 1; }
    }
    parts.push(text.slice(start));
    return parts;
  }
  function stripHover(rules) {
    for (let i = rules.length - 1; i >= 0; i--) {
      const rule = rules[i];
      if (rule.cssRules && !rule.selectorText) { stripHover(rule.cssRules); continue; }
      if (!rule.selectorText || !rule.selectorText.includes(':hover')) continue;
      const kept = splitSelectors(rule.selectorText).filter(s => !s.includes(':hover'));
      if (kept.length) rule.selectorText = kept.join(',');
      else (rule.parentRule || rule.parentStyleSheet).deleteRule(i);
    }
  }
  for (const sheet of document.styleSheets) {
    try { stripHover(sheet.cssRules); } catch (_) { /* cross-origin sheet */ }
  }
  document.querySelectorAll('[title*="Enter"]').forEach(el => {
    el.title = el.title.replace(/\s*[（(][^）)]*(Enter|Ctrl|Shift)[^）)]*[）)]/g, '');
  });

  const hex = color => {
    const m = String(color).match(/\d+(\.\d+)?/g);
    return m ? '#' + m.slice(0, 3).map(n => Number(n).toString(16).padStart(2, '0')).join('') : '#f8fafc';
  };
  const syncTheme = () => {
    const dark = !!document.querySelector('[data-theme="dark"]');
    send(`theme:${dark ? 'dark' : 'light'}:${hex(getComputedStyle(document.body).backgroundColor)}`);
  };
  new MutationObserver(syncTheme).observe(root, { attributes: true, subtree: true, attributeFilter: ['data-theme'] });
  syncTheme();

  window.PageTraceAndroidUI = { back, openSheet, confirm: confirmPanel, layers };
  if (window.PageTraceAndroid) window.PageTraceAndroid.confirm = confirmPanel;
})();
