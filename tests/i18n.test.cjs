const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { JSDOM } = require('jsdom');
const read = name => readFileSync(join(__dirname, '..', name), 'utf8');
const tick = w => new Promise(resolve => w.setTimeout(resolve, 0));

async function setup(html = read('index.html'), language = 'en', before) {
  const dom = new JSDOM(html, { url: 'http://localhost:3000/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  const close = w.close.bind(w);
  w.close = () => { w.dispatchEvent(new w.Event('pagehide')); close(); };
  await new Promise(resolve => {
    if (w.document.readyState !== 'loading') resolve();
    else w.document.addEventListener('DOMContentLoaded', resolve, { once: true });
  });
  if (before) before(w);
  w.localStorage.setItem('pagetrace_lang', language);
  w.eval(read('i18n.js'));
  return w;
}

test('all empty-page static UI, help and memo placeholders translate', async t => {
  const w = await setup(); t.after(() => w.close());
  const d = w.document;
  for (const id of ['createNoteInput', 'editNote']) {
    assert.match(d.getElementById(id).placeholder, /^Write a quick note/);
    assert.match(d.getElementById(id).placeholder, /\nSupports Markdown/);
  }
  const walker = d.createTreeWalker(d.body, w.NodeFilter.SHOW_TEXT);
  const missing = [];
  let node;
  while ((node = walker.nextNode())) {
    if (node.parentElement.closest('script, style, #menuLanguageLabel, #welcomeLangLabel, option')) continue;
    if (/\p{Script=Han}/u.test(node.nodeValue)) missing.push(node.nodeValue.trim());
  }
  assert.deepEqual(missing, []);
  for (const el of d.querySelectorAll('[title],[placeholder],[aria-label]')) {
    for (const attr of ['title', 'placeholder', 'aria-label']) assert.doesNotMatch(el.getAttribute(attr) || '', /\p{Script=Han}/u);
  }
  assert.equal(d.documentElement.lang, 'en');
  w.I18N.setLang('zh');
  assert.match(d.getElementById('createNoteInput').placeholder, /^输入随手笔记/);
  assert.equal(d.documentElement.lang, 'zh-CN');
});

test('new UI, edited text nodes, changed tooltips and open help round-trip without stale labels', async t => {
  const w = await setup('<!doctype html><div id="host"></div>'); t.after(() => w.close());
  const host = w.document.getElementById('host');
  host.innerHTML = '<h2>电脑网页版使用说明</h2><span id="count">共 13 条</span><button title="复制" aria-label="复制">收起</button>';
  await tick(w);
  const h = host.querySelector('h2'), count = host.querySelector('span'), button = host.querySelector('button');
  assert.equal(h.textContent, 'Desktop web help');
  assert.equal(count.textContent, '13 notes');
  assert.equal(button.title, 'Copy');
  assert.equal(button.getAttribute('aria-label'), 'Copy');
  assert.equal(button.textContent, 'Collapse');
  count.firstChild.nodeValue = '共 14 条';
  button.title = '已复制';
  await tick(w);
  assert.equal(count.textContent, '14 notes');
  assert.equal(button.title, 'Copied');
  w.I18N.setLang('zh');
  assert.equal(count.textContent, '共 14 条');
  assert.equal(button.title, '已复制');
  assert.equal(h.textContent, '电脑网页版使用说明');
  button.title = 'Copy'; // An earlier copy-feedback timer restores an English tooltip.
  await tick(w);
  assert.equal(button.title, '复制');
  w.I18N.setLang('en');
  assert.equal(button.title, 'Copy');
  assert.equal(count.textContent, '14 notes');
});

test('UI words inside notes, URLs, account names and inputs remain original across switches', async t => {
  const html = `<!doctype html><div class="note-title" title="复制">删除</div>
    <div class="note-body"><p>收起</p><a title="编辑">复制</a><code>共 13 条</code></div>
    <div class="trash-item-title">编辑</div><div class="trash-item-note">删除</div>
    <div class="trash-item-url" title="更多选项">https://example.com/复制</div>
    <div id="dropdownName">删除</div><div id="dropdownEmail">复制</div>
    <div class="pt-account-name">收起</div><div class="mobile-user-name" title="删除">删除</div>
    <div class="mobile-user-email">编辑</div><div data-i18n-ignore>复制</div>
    <input value="删除"><textarea>收起</textarea><button title="复制">删除</button>`;
  const w = await setup(html); t.after(() => w.close());
  const d = w.document;
  const selectors = ['.note-title', '.note-body', '.trash-item-title', '.trash-item-note', '.trash-item-url',
    '#dropdownName', '#dropdownEmail', '.pt-account-name', '.mobile-user-name', '.mobile-user-email', '[data-i18n-ignore]'];
  const original = selectors.map(s => d.querySelector(s).outerHTML);
  for (const lang of ['zh', 'en', 'zh', 'en']) {
    w.I18N.setLang(lang);
    assert.deepEqual(selectors.map(s => d.querySelector(s).outerHTML), original);
    assert.equal(d.querySelector('input').value, '删除');
    assert.equal(d.querySelector('textarea').value, '收起');
  }
  const child = d.createElement('p'); child.textContent = '删除'; d.querySelector('.note-body').append(child);
  await tick(w);
  assert.equal(child.textContent, '删除');
  assert.equal(d.querySelector('button').textContent, 'Delete');
  // The actual copy formatter reads original records, independently of rendered UI.
  const source = read('index.html').match(/    function formatNoteTextForCopy\(item\) \{[\s\S]*?\n    \}/)[0];
  w.getOptionalTitle = value => value || '';
  w.eval(source);
  const note = { title: '删除', url: 'https://example.com/复制', note: '**收起**\n\n共 13 条' };
  assert.equal(w.formatNoteTextForCopy(note), '删除\nhttps://example.com/复制\n**收起**\n\n共 13 条');
});

test('dates, counts, loading, errors and destructive confirmations use current language', async t => {
  const w = await setup('<!doctype html><div></div>'); t.after(() => w.close());
  const examples = [
    ['2026 年 11 月', 'November 2026'], ['2027年', '2027'], ['12 月', 'December'],
    ['共 1 条', '1 note'], ['0 条', '0 notes'], ['已选择 3 项', '3 selected'],
    ['加载中 · 2 条', 'Loading · 2 notes'], ['检索中 · 已找到 3 条', 'Searching · 3 notes found'],
    ['往下滚动加载更多 (已显示 50 / 共 99 条)', 'Scroll for more (50 of 99 notes shown)'],
    ['✓ 已加载全部 99 条笔记', '✓ All 99 notes loaded'],
    ['创建于 11-01 23:38', 'Created on 11-01 23:38'],
    ['复制当前筛选的 13 条笔记', 'Copy 13 filtered notes'],
    ['保存失败: 账号已切换，请重新保存', 'Save failed: The account changed. Save again.'],
    ['确定彻底清空回收站中的 13 条笔记吗？此操作无法撤销。', 'Permanently delete all 13 notes in trash? This cannot be undone.'],
  ];
  for (const [zh, en] of examples) assert.equal(w.I18N.tLabel(zh), en);
  w.I18N.setLang('zh');
  for (const [zh] of examples) assert.equal(w.I18N.tLabel(zh), zh);
  const ask = read('index.html').match(/    const askConfirm = message =>[\s\S]*?;\r?\n/)[0];
  let asked;
  w.confirm = message => { asked = message; return false; };
  w.eval(ask + '\nwindow.ask = askConfirm;');
  w.I18N.setLang('en');
  await w.ask('确定彻底删除该条笔记吗？此操作将永久抹除，无法找回。');
  assert.equal(asked, 'Permanently delete this note? This cannot be undone.');
});

test('fallback account/title labels translate while genuine names with the same wording do not', async t => {
  const w = await setup(`<!doctype html><div id="dropdownName" data-i18n-fallback>未设置昵称</div>
    <div class="trash-item-title" data-i18n-fallback>无标题页面</div>
    <div class="trash-item-title">无标题页面</div>`); t.after(() => w.close());
  assert.equal(w.document.getElementById('dropdownName').textContent, 'No display name');
  assert.deepEqual([...w.document.querySelectorAll('.trash-item-title')].map(el => el.textContent), ['Untitled page', '无标题页面']);
  w.I18N.setLang('zh');
  assert.equal(w.document.getElementById('dropdownName').textContent, '未设置昵称');
});

test('Android tooltips stripped of keyboard hints and touch confirmations translate', async t => {
  const w = await setup(read('index.html'), 'en', w => {
    w.PageTraceNative = { postMessage() {} };
    w.eval(read('touch-ui.js'));
  }); t.after(() => w.close());
  assert.equal(w.document.getElementById('btnSaveEdit').title, 'Save changes');
  const result = w.PageTraceTouchUI.confirm('确定彻底删除该条笔记吗？此操作将永久抹除，无法找回。');
  await tick(w);
  assert.match(w.document.querySelector('.pt-card p').textContent, /^Permanently delete this note/);
  assert.deepEqual([...w.document.querySelectorAll('.pt-card button')].map(el => el.textContent), ['Cancel', 'Confirm']);
  w.I18N.setLang('zh');
  assert.deepEqual([...w.document.querySelectorAll('.pt-card button')].map(el => el.textContent), ['取消', '确定']);
  w.document.querySelector('.pt-card button').click();
  assert.equal(await result, false);
});

test('mobile range, selection and open menus follow switches without translating note content', { timeout: 5000 }, async t => {
  const html = `<!doctype html><div id="notesLoadStatus" style="display:none"></div>
    <span id="searchCountBadge" style="display:none"></span><input id="inlineSearchInput">
    <span id="yearCurrentLabel"></span><span id="monthCurrentLabel"></span>
    <div id="notesList"><div class="month-date-count">共 13 条</div>
      <div class="note-item-row" data-id="n1"><div class="note-body" id="memo">删除</div></div></div>
    <div id="yearDropdownMenu"><div class="nav-dropdown-item" data-year="all"><span class="nav-count-badge">13 条</span></div>
      <div class="nav-dropdown-item" data-year="2026"><span class="nav-count-badge">13 条</span></div></div>
    <div id="monthDropdownMenu"><div class="nav-dropdown-item" data-month="11"><span class="nav-count-badge">13 条</span></div></div>`;
  const w = await setup(html, 'en', w => {
    w.PageTraceNative = { postMessage() {} };
    w.CSS = { escape: value => value };
    w.eval(`var currentUser = {uid:'u', displayName:'删除', email:'a@b.c'};
      var selectedYear = '2026', selectedMonth = '11', currentSearchKeyword = '';
      var notesData = [{id:'n1', note:'删除'}];`);
    w.getTargetNotes = () => w.eval('notesData');
    w.findKnownNote = id => w.eval('notesData').find(n => n.id === id);
    w.formatNoteTextForCopy = n => n.note;
    w.eval(read('touch-ui.js'));
    w.eval(read('mobile-ui.js'));
  }); t.after(() => w.close());
  const frame = async () => { await new Promise(resolve => w.requestAnimationFrame(resolve)); await tick(w); };
  await frame();
  assert.match(w.document.getElementById('ptTitle').textContent, /November 2026.*13 notes/);
  w.PageTraceMobile.openMenu(); await tick(w);
  assert.match(w.document.getElementById('ptMenu').textContent, /Notes & settings/);
  assert.equal(w.document.getElementById('ptAccName').textContent, '删除');
  w.document.querySelector('[data-action="language"]').click(); await frame();
  assert.match(w.document.getElementById('ptTitle').textContent, /2026 年 11 月.*共 13 条/);
  assert.match(w.document.getElementById('ptMenu').textContent, /笔记与设置/);
  w.I18N.setLang('en'); await frame();
  assert.match(w.document.getElementById('ptMenu').textContent, /Notes & settings/);
  w.PageTraceMobile.closeMenu();
  w.document.getElementById('memo').dispatchEvent(new w.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  await frame();
  assert.equal(w.document.getElementById('ptTitle').textContent, '1 selected');
  assert.equal(w.document.querySelector('[data-sel="delete"]').textContent, 'Delete');
  assert.equal(w.document.getElementById('memo').textContent, '删除');
});

test('unauthenticated UI hides header search and note buttons, and language toggle is in welcome card', async t => {
  // 1. When localStorage is empty and navigator.language is zh, defaults to zh
  const domZh = new JSDOM(read('index.html'), { url: 'http://localhost:3000/', runScripts: 'outside-only', pretendToBeVisual: true });
  const wZh = domZh.window;
  t.after(() => wZh.close());
  await new Promise(r => { if (wZh.document.readyState !== 'loading') r(); else wZh.document.addEventListener('DOMContentLoaded', r, { once: true }); });
  Object.defineProperty(wZh.navigator, 'language', { value: 'zh-CN', configurable: true });
  Object.defineProperty(wZh.navigator, 'languages', { value: ['zh-CN', 'zh'], configurable: true });
  wZh.eval(read('i18n.js'));
  assert.equal(wZh.I18N.getLang(), 'zh');
  // Header search and note buttons are hidden when not logged in
  assert.equal(wZh.document.getElementById('openSearchBtn').style.display, 'none');
  assert.equal(wZh.document.getElementById('openCreateBtn').style.display, 'none');
  // Header does not have unauth language button
  assert.equal(wZh.document.getElementById('unauthLangBtn'), null);

  // 2. When localStorage is empty and navigator.language is en, defaults to en
  const domEn = new JSDOM(read('index.html'), { url: 'http://localhost:3000/', runScripts: 'outside-only', pretendToBeVisual: true });
  const wEn = domEn.window;
  t.after(() => wEn.close());
  await new Promise(r => { if (wEn.document.readyState !== 'loading') r(); else wEn.document.addEventListener('DOMContentLoaded', r, { once: true }); });
  Object.defineProperty(wEn.navigator, 'language', { value: 'en-US', configurable: true });
  Object.defineProperty(wEn.navigator, 'languages', { value: ['en-US', 'en'], configurable: true });
  wEn.eval(read('i18n.js'));
  assert.equal(wEn.I18N.getLang(), 'en');
  assert.equal(wEn.document.getElementById('openSearchBtn').style.display, 'none');
  assert.equal(wEn.document.getElementById('openCreateBtn').style.display, 'none');

  // 3. Welcome card has the language button and switches language
  const welcomeHost = wEn.document.createElement('div');
  welcomeHost.innerHTML = `<button type="button" id="welcomeLangBtn"><span id="welcomeLangLabel">简体中文</span></button>`;
  wEn.document.body.appendChild(welcomeHost);
  const welcomeBtn = wEn.document.getElementById('welcomeLangBtn');
  welcomeBtn.addEventListener('click', () => wEn.I18N.toggleLang());
  assert.equal(wEn.document.getElementById('welcomeLangLabel').textContent, '简体中文');
  welcomeBtn.click();
  await tick(wEn);
  assert.equal(wEn.I18N.getLang(), 'zh');
  assert.equal(wEn.document.getElementById('welcomeLangLabel').textContent, 'English');

  // 4. Cross-tab storage event synchronization
  const storageEvent = new wEn.Event('storage');
  storageEvent.key = 'pagetrace_lang';
  storageEvent.newValue = 'en';
  wEn.dispatchEvent(storageEvent);
  await tick(wEn);
  assert.equal(wEn.I18N.getLang(), 'en');
  assert.equal(wEn.document.getElementById('welcomeLangLabel').textContent, '简体中文');
});
