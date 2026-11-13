const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { JSDOM } = require('jsdom');
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

function setup() {
  const dom = new JSDOM('<!doctype html><div id="notesList"></div>', { runScripts: 'outside-only' });
  const w = dom.window;
  w.eval(`var currentUser = { uid: 'u' }, selectedYear = '2026', selectedMonth = '11', currentSearchKeyword = '';
    var notesData = [{ id: 'a' }, { id: 'b' }], expandedNoteIds = new Set();
    var noteReadingPositions = new Map(), noteReadingContext = '', finishNotePositionRestore = null;`);
  let y = 500, nextFrame = 0;
  const frames = new Map(), scrolls = [];
  Object.defineProperty(w, 'scrollY', { get: () => y });
  w.scrollTo = ({ top, behavior }) => { assert.equal(behavior, 'instant'); y = Math.max(0, top); scrolls.push(y); };
  w.requestAnimationFrame = fn => { frames.set(++nextFrame, fn); return nextFrame; };
  w.cancelAnimationFrame = id => frames.delete(id);
  const positions = { a: 730, b: 1200 };
  const list = w.document.getElementById('notesList');
  for (const id of ['a', 'b']) {
    list.insertAdjacentHTML('beforeend', `<article class="note-item-row" data-id="${id}"><div id="noteBody-${id}" class="note-body is-collapsed"><div class="note-preview">摘要</div><div class="note-full"><a href="https://example.com">正文链接</a>长正文</div></div><button class="note-expand-btn"></button></article>`);
    const row = list.lastElementChild;
    row.getBoundingClientRect = () => ({ top: positions[id] - y, height: row.querySelector('.is-expanded') ? 7000 : 160 });
  }
  const start = html.indexOf('    function syncNoteReadingContext()');
  w.eval(html.slice(start, html.indexOf('    // 年份与月份下拉打开/切换', start)));
  const toggle = id => w.toggleNoteExpanded({ stopPropagation() {}, currentTarget: list.querySelector(`[data-id="${id}"] button`) }, id);
  const flush = () => { for (let i = 0; frames.size && i < 10; i++) { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn()); } };
  return { w, list, positions, scrolls, toggle, flush, setY: value => { y = value; }, y: () => y };
}

test('collapsing after reading a long note returns its title to the original viewport position', () => {
  const p = setup();
  p.toggle('a'); p.setY(6500); p.toggle('a'); p.flush();
  assert.equal(p.y(), 500);
  assert.ok(!p.w.document.documentElement.classList.contains('note-position-restoring'));
  assert.equal(p.list.querySelector('#noteBody-a').className, 'note-body is-collapsed');
  p.w.close();
});
test('restoration follows the note when new content appears above it, including replacement DOM', () => {
  const p = setup();
  p.toggle('a'); p.positions.a += 240; p.setY(6500); p.toggle('a');
  const row = p.list.firstElementChild;
  const replacement = row.cloneNode(true);
  replacement.getBoundingClientRect = () => ({ top: p.positions.a - p.y(), height: 160 });
  row.replaceWith(replacement);
  p.flush();
  assert.equal(p.y(), 740);
  p.w.close();
});
test('each expanded note keeps its own origin and a new expansion replaces the previous origin', () => {
  const p = setup();
  p.toggle('a'); p.setY(900); p.toggle('b'); p.setY(8000); p.toggle('b'); p.flush();
  assert.equal(p.y(), 900);
  p.toggle('a'); p.flush(); assert.equal(p.y(), 500);
  p.setY(600); p.toggle('a'); p.setY(6500); p.toggle('a'); p.flush();
  assert.equal(p.y(), 600);
  p.w.close();
});
test('account, month and search changes discard previous origins even when navigating back', () => {
  for (const change of ["currentUser = { uid: 'other' }", "selectedMonth = '10'", "currentSearchKeyword = 'query'"]) {
    const p = setup();
    p.toggle('a'); p.w.eval(change + '; syncNoteReadingContext()');
    p.w.eval("currentUser = { uid: 'u' }; selectedMonth = '11'; currentSearchKeyword = ''; syncNoteReadingContext()");
    p.setY(6500); p.toggle('a'); p.flush();
    assert.equal(p.y(), p.positions.a - 8, change);
    p.w.close();
  }
});
test('mobile header restoration supplies a safe inset and manual input cancels pending corrections', () => {
  const p = setup(), events = [];
  p.w.document.documentElement.classList.add('is-touch');
  const bar = p.w.document.createElement('div'); bar.id = 'ptTop';
  bar.getBoundingClientRect = () => ({ bottom: 118 }); p.w.document.body.prepend(bar);
  p.w.PageTraceMobile = {
    captureReadingPosition: () => ({ collapsed: false }),
    restoreReadingPosition: saved => events.push(['restore', saved.collapsed]),
    finishReadingPositionRestore: () => events.push(['finish'])
  };
  p.setY(700); p.toggle('a'); p.setY(6500); p.toggle('a');
  assert.equal(p.y(), 604); // Partly hidden title is placed below the restored header.
  p.w.dispatchEvent(new p.w.Event('wheel')); p.setY(800); p.flush();
  assert.equal(p.y(), 800);
  assert.deepEqual(events, [['restore', false], ['finish']]);
  p.w.close();
});
test('touch-body collapse uses the shared restoration while links and selected text stay interactive', () => {
  const p = setup();
  p.w.notesList = p.list;
  p.w.updateNoteExpandButtons = () => {};
  p.w.matchMedia = () => ({ matches: true });
  p.w.getSelection = () => '';
  const start = html.indexOf("    const phoneLayout =");
  p.w.eval(html.slice(start, html.indexOf('    if (document.fonts)', start)));
  p.list.querySelectorAll('button').forEach(button => button.onclick = () => p.toggle(button.closest('article').dataset.id));
  p.list.querySelector('.note-preview').click();
  assert.ok(p.list.querySelector('#noteBody-a').classList.contains('is-expanded'));
  p.list.querySelector('a').addEventListener('click', event => event.preventDefault());
  p.list.querySelector('a').click();
  assert.ok(p.list.querySelector('#noteBody-a').classList.contains('is-expanded'));
  p.w.getSelection = () => 'selected'; p.list.querySelector('.note-full').click();
  assert.ok(p.list.querySelector('#noteBody-a').classList.contains('is-expanded'));
  p.w.getSelection = () => ''; p.setY(6500); p.list.querySelector('.note-full').click(); p.flush();
  assert.equal(p.y(), 500);
  p.w.close();
});
