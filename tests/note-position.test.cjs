const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { JSDOM } = require('jsdom');
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

function setup(touch = false) {
  const dom = new JSDOM('<!doctype html><div id="notesList"></div>', { runScripts: 'outside-only' });
  const w = dom.window;
  w.eval(`var notesData = [{id:'a'}, {id:'b'}, {id:'c'}], expandedNoteIds = new Set();
    var phoneLayout = {matches:${touch}}, finishNotePositionRestore = null;`);
  let y = 500, origin = 730, nextFrame = 0;
  const frames = new Map(), scrolls = [];
  Object.defineProperty(w, 'scrollY', { get: () => y });
  w.scrollTo = ({ top, behavior }) => { assert.equal(behavior, 'instant'); y = Math.max(0, top); scrolls.push(y); };
  w.requestAnimationFrame = fn => { frames.set(++nextFrame, fn); return nextFrame; };
  w.cancelAnimationFrame = id => frames.delete(id);
  const list = w.document.getElementById('notesList');
  const height = id => w.document.getElementById('noteBody-' + id).classList.contains('is-expanded') ? 7000 : 160;
  const top = id => origin + ['a', 'b', 'c'].slice(0, ['a', 'b', 'c'].indexOf(id)).reduce((sum, key) => sum + height(key) + 20, 0);
  for (const id of ['a', 'b', 'c']) {
    list.insertAdjacentHTML('beforeend', `<article class="note-item-row" data-id="${id}"><div id="noteBody-${id}" class="note-body is-collapsed"><div class="note-preview">摘要</div><div class="note-full"><a href="https://example.com">正文链接</a><p>长正文</p></div></div><button class="note-expand-btn"></button></article>`);
    list.lastElementChild.getBoundingClientRect = () => ({ top: top(id) - y, bottom: top(id) + height(id) - y, height: height(id) });
  }
  w.eval(html.slice(html.indexOf('    function collapseNoteKeepingBelow('), html.indexOf('    // 年份与月份下拉打开/切换')));
  const toggle = id => w.toggleNoteExpanded({ stopPropagation() {}, currentTarget: list.querySelector(`[data-id="${id}"] button`) }, id);
  const flush = () => { for (let i = 0; frames.size && i < 10; i++) { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn()); } };
  return { w, list, scrolls, toggle, flush, top, setY: value => { y = value; }, y: () => y, setOrigin: value => { origin = value; } };
}

for (const touch of [false, true]) test(`${touch ? 'touch' : 'desktop'} collapse preserves every following note with one pre-paint compensation`, () => {
  const p = setup(touch);
  p.toggle('a'); p.setY(7150);
  const before = ['b', 'c'].map(id => p.top(id) - p.y());
  p.toggle('a');
  assert.deepEqual(['b', 'c'].map(id => p.top(id) - p.y()), before);
  assert.equal(p.y(), 310); // Deliberately different from expansion's scrollY=500.
  assert.equal(p.scrolls.length, 1);
  p.flush(); assert.equal(p.scrolls.length, 1);
  assert.ok(!p.w.document.documentElement.classList.contains('note-position-restoring'));
  p.w.close();
});
test('fresh collapse geometry accounts for content inserted above while reading', () => {
  const p = setup();
  p.toggle('a'); p.setOrigin(970); p.setY(7150);
  const before = p.top('b') - p.y();
  p.toggle('a'); p.flush();
  assert.equal(p.top('b') - p.y(), before);
  p.w.close();
});
test('document-start clamping makes only unavoidable movement and never adds blank space', () => {
  const p = setup();
  p.setOrigin(80); p.toggle('a'); p.setY(6500);
  p.toggle('a'); p.flush();
  assert.equal(p.y(), 0);
  assert.equal(p.top('b'), 260);
  assert.equal(p.list.children.length, 3);
  assert.equal(p.list.querySelector('[style]'), null);
  p.w.close();
});
test('the final note preserves its bottom boundary without needing a next note', () => {
  const p = setup(); p.toggle('c'); p.setY(p.top('c') + 7000 - 600);
  p.toggle('c'); p.flush();
  assert.equal(p.top('c') + 160 - p.y(), 600);
  p.w.close();
});
test('touch collapse in the middle of a note shows its compact card below the current header', () => {
  const p = setup(true), events = [];
  p.w.document.documentElement.classList.add('is-touch', 'pt-collapsed');
  const bar = p.w.document.createElement('div'); bar.id = 'ptTop';
  bar.getBoundingClientRect = () => ({ bottom: 56 }); p.w.document.body.prepend(bar);
  p.w.PageTraceMobile = { settleReadingLayout: () => events.push('layout'), finishReadingPositionRestore() {} };
  p.toggle('a'); p.setY(3500); p.toggle('a');
  assert.equal(p.top('a') - p.y(), 64);
  assert.ok(p.w.document.documentElement.classList.contains('pt-collapsed'));
  assert.deepEqual(events, ['layout']);
  p.w.dispatchEvent(new p.w.Event('wheel')); p.setY(800); p.flush();
  assert.equal(p.y(), 800);
  assert.equal(p.scrolls.length, 1);
  p.w.close();
});
test('touch body uses the shared collapse; links and selected text do not collapse', () => {
  const p = setup(true);
  p.w.notesList = p.list; p.w.getSelection = () => '';
  const start = html.indexOf("    notesList.addEventListener('click', e => {", html.indexOf('    const phoneLayout ='));
  p.w.eval(html.slice(start, html.indexOf('    if (document.fonts)', start)));
  p.list.querySelectorAll('button').forEach(button => button.onclick = () => p.toggle(button.closest('article').dataset.id));
  p.list.querySelector('.note-preview').click();
  p.list.querySelector('a').addEventListener('click', event => event.preventDefault());
  p.list.querySelector('a').click();
  assert.ok(p.list.querySelector('#noteBody-a').classList.contains('is-expanded'));
  p.w.getSelection = () => 'selected'; p.list.querySelector('.note-full p').click();
  assert.ok(p.list.querySelector('#noteBody-a').classList.contains('is-expanded'));
  p.w.getSelection = () => ''; p.setY(7150); const before = p.top('b') - p.y();
  p.list.querySelector('.note-full p').click(); p.flush();
  assert.equal(p.top('b') - p.y(), before);
  p.w.close();
});
