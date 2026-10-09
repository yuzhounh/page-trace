const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { JSDOM } = require('jsdom');
const code = readFileSync(join(__dirname, '..', 'touch-ui.js'), 'utf8');
function setup() {
  const dom = new JSDOM(`<!doctype html><style>.a:hover,.b{color:red}.c:hover{color:blue}</style>
    <div class="note-item-row" data-id="n1"><div class="note-menu-meta"><div>字数统计 : 5</div><div>创建于 10-08 14:23</div></div><span id="t">正文</span></div>
    <button id="e" title="保存 (Shift+Enter / Ctrl+Enter)"></button>`, { runScripts: 'outside-only' });
  const w = dom.window;
  const sent = []; const calls = [];
  w.PageTraceNative = { postMessage: m => sent.push(m) };
  w.eval('var notesData = [{ id: "n1", note: "笔记内容", url: "https://e.com" }];');
  Object.assign(w, {
    handleMenuEdit: (e, id) => calls.push(['edit', id]), handleMenuDelete: (e, id) => calls.push(['delete', id]),
    copyTextToClipboard: async () => true, formatNoteTextForCopy: item => item.note, showUndoToast: m => calls.push(['toast', m])
  });
  w.eval(code);
  return { w, sent, calls };
}
const press = w => w.document.getElementById('t').dispatchEvent(new w.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
const labels = w => [...w.document.querySelectorAll('.pt-sheet > button')].map(b => b.textContent);
test('long press opens the sheet in the agreed order, vibrates, and marks the page as Android', () => {
  const { w, sent } = setup();
  assert.equal(press(w), false);
  assert.deepEqual(labels(w), ['编辑', '选择文字', '复制', '分享', '删除', '笔记详情']);
  assert.ok(sent.includes('haptic'));
  assert.ok(w.document.documentElement.classList.contains('is-android'));
});
test('sheet actions: edit, delete, share and details', () => {
  const { w, sent, calls } = setup();
  const click = label => [...w.document.querySelectorAll('.pt-sheet > button')].find(b => b.textContent === label).click();
  press(w); click('编辑'); press(w); click('删除'); press(w); click('分享');
  assert.deepEqual(calls, [['edit', 'n1'], ['delete', 'n1']]);
  assert.ok(sent.includes('share:笔记内容'));
  press(w); click('笔记详情');
  assert.match(w.document.querySelector('.pt-card').textContent, /字数统计 : 5[\s\S]*创建于 10-08 14:23[\s\S]*https:\/\/e\.com/);
});
test('back key closes the top layer; a confirm panel resolves false', async () => {
  const { w } = setup();
  const answer = w.PageTraceTouchUI.confirm('确定吗？');
  assert.equal(w.PageTraceTouchUI.back(), true);
  assert.equal(await answer, false);
  assert.equal(w.document.querySelector('.pt-sheet-mask'), null);
  press(w);
  assert.equal(w.PageTraceTouchUI.back(), true);
  assert.equal(w.document.querySelector('.pt-sheet-mask'), null);
});
test('hover-only rules are removed and shortcut hints dropped from tooltips', () => {
  const { w } = setup();
  const rules = [...w.document.styleSheets[0].cssRules].map(r => r.selectorText);
  assert.deepEqual(rules, ['.b']);
  assert.equal(w.document.getElementById('e').title, '保存');
});

function webSetup({ coarse = true, share = false } = {}) {
  const dom = new JSDOM(`<!doctype html><div id="notesList"></div>
    <div class="note-item-row" data-id="n1"><div class="note-menu-meta"><div>字数统计 : 5</div></div><span id="t">正文</span></div>`,
    { runScripts: 'outside-only', url: 'https://example.com/' });
  const w = dom.window;
  const calls = [];
  w.matchMedia = query => ({ matches: coarse && query.includes('pointer: coarse') });
  if (share) w.navigator.share = async data => { calls.push(['share', data.text]); };
  w.eval('var notesData = [{ id: "n1", note: "笔记内容", url: "https://e.com" }];');
  Object.assign(w, {
    handleMenuEdit: (e, id) => calls.push(['edit', id]), handleMenuDelete: () => {},
    copyTextToClipboard: async () => true, formatNoteTextForCopy: item => item.note, showUndoToast: (m, u, d, icon) => calls.push(['toast', m, icon])
  });
  w.eval(code);
  return { w, calls };
}
const touch = (w, type, x = 10, y = 10) => {
  const ev = new w.Event(type, { bubbles: true });
  ev.touches = type === 'touchend' ? [] : [{ clientX: x, clientY: y }];
  w.document.getElementById('t').dispatchEvent(ev);
};
const wait = ms => new Promise(r => setTimeout(r, ms));
test('web touch device: long press opens the sheet; a moving finger or a short tap does not', async () => {
  const { w } = webSetup();
  const root = w.document.documentElement;
  assert.ok(root.classList.contains('is-touch'));
  assert.ok(!root.classList.contains('is-android'));
  touch(w, 'touchstart'); touch(w, 'touchmove', 40, 40); await wait(600);
  assert.equal(w.document.querySelector('.pt-sheet'), null);
  touch(w, 'touchstart'); touch(w, 'touchend'); await wait(600);
  assert.equal(w.document.querySelector('.pt-sheet'), null);
  touch(w, 'touchstart'); await wait(600);
  assert.deepEqual(labels(w), ['编辑', '选择文字', '复制', '删除', '笔记详情']);
});
test('web touch device: share appears only when the browser can share; first-visit hint is shown once', async () => {
  const { w } = webSetup({ share: true });
  touch(w, 'touchstart'); await wait(600);
  assert.ok(labels(w).includes('分享'));
});
test('non-touch desktop browsers are left alone', () => {
  const { w } = webSetup({ coarse: false });
  assert.ok(!w.document.documentElement.classList.contains('is-touch'));
  assert.equal(press(w), true);
  assert.equal(w.document.querySelector('.pt-sheet'), null);
});
test('first visit on a touch phone hints at long press once', async () => {
  const { w, calls } = webSetup();
  w.document.getElementById('notesList').innerHTML = '<div class="note-item-row" data-id="x"></div>';
  await wait(50);
  assert.deepEqual(calls.find(c => c[0] === 'toast'), ['toast', '长按笔记可编辑、复制、删除', '👆']);
  assert.equal(w.localStorage.getItem('pagetrace_longpress_hint'), '1');
});
