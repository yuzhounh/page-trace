const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { JSDOM } = require('jsdom');
const read = name => readFileSync(join(__dirname, '..', name), 'utf8');
function setup() {
  const dom = new JSDOM(`<!doctype html><div id="notesLoadStatus" style="display:none"></div><span id="searchCountBadge" style="display:none"></span>
    <input id="inlineSearchInput"><span id="yearCurrentLabel"></span><span id="monthCurrentLabel"></span><div id="notesList">
    <div class="note-item-row" data-id="n1"><span id="t1">一</span></div><div class="note-item-row" data-id="n2"><span id="t2">二</span></div></div>
    <div id="yearDropdownMenu"><div class="nav-dropdown-item" data-year="all"><span class="nav-count-badge">5 条</span></div>
      <div class="nav-dropdown-item" data-year="2026"><span class="nav-count-badge">3 条</span></div></div>
    <div id="monthDropdownMenu"><div class="nav-dropdown-item" data-month="10"><span class="nav-count-badge">2 条</span></div></div>`,
    { runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  const calls = [];
  w.PageTraceNative = { postMessage() {} };
  w.CSS = { escape: s => s };
  w.eval(`var currentUser = { uid: 'u', email: 'a@b.c' }; var selectedYear = '2026'; var selectedMonth = '10'; var currentSearchKeyword = '';
    var notesData = [{ id: 'n1', note: '甲' }, { id: 'n2', note: '乙' }];`);
  Object.assign(w, {
    navigateToSelection: () => calls.push(['nav', w.eval('selectedYear'), w.eval('selectedMonth')]),
    getTargetNotes: () => w.eval('notesData'), findKnownNote: id => w.eval('notesData').find(n => n.id === id),
    formatNoteTextForCopy: n => n.note, copyTextToClipboard: async text => { calls.push(['copy', text]); return true; },
    showUndoToast: m => calls.push(['toast', m]), moveToTrash: id => calls.push(['trash', id]),
    handleMenuEdit() {}, handleMenuDelete() {}, showTrashModal: () => calls.push(['trashModal'])
  });
  w.eval(read('touch-ui.js'));
  w.eval(read('mobile-ui.js'));
  return { w, calls };
}
const frame = w => new Promise(r => w.requestAnimationFrame(() => r()));
test('title follows the selected range and search state', async () => {
  const { w } = setup();
  await frame(w);
  assert.equal(w.document.getElementById('ptTitle').textContent.replace(/\s/g, ''), '2026年10月');
  w.eval("selectedMonth = 'all'"); w.PageTraceMobile.refresh(); await frame(w);
  assert.equal(w.document.getElementById('ptTitle').textContent.replace(/\s/g, ''), '2026年');
  w.eval("currentSearchKeyword = 'x'"); w.PageTraceMobile.refresh(); await frame(w);
  assert.equal(w.document.getElementById('ptTitle').textContent, '搜索结果');
});
test('menu lists views with counts; choosing one navigates and closes the menu', () => {
  const { w, calls } = setup();
  w.PageTraceMobile.openMenu();
  const menu = w.document.getElementById('ptMenu');
  assert.ok(menu.classList.contains('show'));
  for (const label of ['笔记与设置', '本月2', '全部笔记5', '回收站', '10 月']) assert.ok(menu.textContent.includes(label));
  assert.ok(menu.querySelector('[data-action="pick"][data-pick="year"]'));
  assert.ok(menu.querySelector('[data-action="pick"][data-pick="month"]'));
  menu.querySelector('[data-action="all-notes"]').click();
  assert.deepEqual(calls.at(-1), ['nav', 'all', 'all']);
  assert.ok(!menu.classList.contains('show'));
  assert.equal(w.PageTraceTouchUI.layers.length, 0);
});

test('settings restores its scroll after closing and keeps non-navigation actions in place', () => {
  const { w, calls } = setup();
  w.PageTraceMobile.openMenu();
  const menu = w.document.getElementById('ptMenu');
  const body = menu.querySelector('.pt-menu-body');
  let offset = 140;
  Object.defineProperty(body, 'scrollTop', {
    get: () => menu.classList.contains('show') ? offset : 0,
    set: value => { offset = value; }
  });
  w.PageTraceMobile.closeMenu();
  w.PageTraceMobile.openMenu();
  assert.equal(menu.querySelector('.pt-menu-body').scrollTop, 140);
  const action = name => menu.querySelector(`[data-action="${name}"]`).click();
  w.handleCopyFilteredNotes = () => calls.push(['copyAll']);
  w.menuDocBtn = { click: () => calls.push(['doc']) };
  w.loginBtn = { click: () => calls.push(['login']) };
  w.dropdownLogout = { click: () => calls.push(['logout']) };
  for (const name of ['trash', 'doc', 'copy-all', 'logout']) {
    action(name);
    assert.ok(menu.classList.contains('show'), name);
    assert.equal(menu.querySelector('.pt-menu-body').scrollTop, 140);
  }
  w.eval('currentUser = null');
  w.PageTraceMobile.closeMenu();
  w.PageTraceMobile.openMenu();
  action('login');
  assert.ok(menu.classList.contains('show'));
  assert.ok(calls.some(call => call[0] === 'login'));
});

test('selection cannot delete a colliding ID after an account switch or survive a view change', async () => {
  const { w, calls } = setup();
  w.PageTraceMobile.select('n1');
  w.eval("currentUser = {uid:'other'}");
  w.document.querySelector('[data-sel="delete"]').click();
  assert.equal(calls.filter(call => call[0] === 'trash').length, 0);
  assert.ok(!w.document.documentElement.classList.contains('pt-select-mode'));
  w.PageTraceMobile.select('n1');
  w.eval("selectedMonth = 'all'");
  w.PageTraceMobile.refresh(); await frame(w);
  assert.ok(!w.document.documentElement.classList.contains('pt-select-mode'));
});

test('bulk undo is bound to its original account', async () => {
  const { w, calls } = setup();
  const refs=[];
  w.db={collection:()=>({doc:uid=>({collection:()=>({doc:id=>({uid,id})})})}),batch:()=>({update:ref=>refs.push(ref),commit:async()=>{}})};
  w.firebase={firestore:{FieldValue:{serverTimestamp:()=>({pending:true})}}};
  w.updateCachedNotes=()=>{};
  let undo;
  w.showUndoToast=(_message,handler)=>{undo=handler};
  w.restoreFromTrash=async id=>calls.push(['restore',id]);
  w.PageTraceMobile.select('n1');w.document.getElementById('ptMenuBtn').click();
  w.document.querySelector('[data-sel="delete"]').click();
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(refs.length,2);assert.ok(refs.every(ref=>ref.uid==='u'));
  assert.equal(typeof undo,'function');
  w.eval("currentUser = {uid:'other'}");
  await undo();
  assert.equal(calls.filter(call=>call[0]==='restore').length,0);
});
test('long press enters multi-select; taps toggle; back key leaves', async () => {
  const { w, calls } = setup();
  const t1 = w.document.getElementById('t1');
  t1.dispatchEvent(new w.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  const root = w.document.documentElement;
  assert.ok(root.classList.contains('pt-select-mode'));
  assert.equal(w.document.querySelector('.pt-sheet-mask'), null);
  await frame(w);
  assert.equal(w.document.getElementById('ptTitle').textContent, '已选择 1 项');
  assert.ok(w.document.querySelector('[data-id="n1"]').classList.contains('pt-selected'));
  w.PageTraceMobile.exitSelect();
  t1.dispatchEvent(new w.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  w.document.getElementById('ptMenuBtn').click(); // select all
  assert.equal(w.document.querySelectorAll('.pt-selected').length, 2);
  w.document.querySelector('[data-sel="copy"]').click();
  await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(calls.find(c => c[0] === 'copy'), ['copy', '甲\n\n乙']);
  t1.dispatchEvent(new w.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  assert.equal(w.PageTraceTouchUI.back(), true);
  assert.ok(!root.classList.contains('pt-select-mode'));
  t1.dispatchEvent(new w.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  w.document.querySelector('[data-sel="delete"]').click();
  assert.deepEqual(calls.at(-1), ['trash', 'n1']);
});
