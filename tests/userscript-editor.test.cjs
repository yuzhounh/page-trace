const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { JSDOM } = require('jsdom');
const script = readFileSync(join(__dirname, '..', 'pagetrace.user.js'), 'utf8');

function editor(t, url = 'https://example.test/article') {
  const dom = new JSDOM('<!doctype html><title>Fixture page</title><textarea id="site-editor"></textarea>',
    { url, runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const w = dom.window, roots = [], store = new Map([
    ['pt_uid', 'alice'], ['pt_id_token', 'fixture-token'], ['pt_token_expiry', Date.now() + 3600000]
  ]), timers = new Map(), requests = [], hostEvents = [];
  let timerId = 0;
  w.setTimeout = w.setInterval = (callback, delay) => {
    const id = ++timerId; timers.set(id, { callback, delay }); return id;
  };
  w.clearTimeout = w.clearInterval = id => timers.delete(id);
  w.matchMedia = () => ({ matches: false, addEventListener() {} });
  w.GM_getValue = (key, fallback) => store.get(key) ?? fallback;
  w.GM_setValue = (key, value) => store.set(key, value);
  w.GM_deleteValue = key => store.delete(key);
  w.GM_listValues = () => [...store.keys()];
  w.GM_addValueChangeListener = () => 1;
  w.GM_xmlhttpRequest = request => {
    requests.push(request);
    request.onload({ status: 200, responseText: JSON.stringify({ ...JSON.parse(request.data),
      createTime: '2026-10-15T00:00:00Z', updateTime: '2026-10-15T00:00:00Z' }) });
  };
  Object.defineProperty(w, 'isSecureContext', { value: true });
  Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: async () => {} } });
  const attach = w.Element.prototype.attachShadow;
  w.Element.prototype.attachShadow = function (options) {
    const root = attach.call(this, options); roots.push(root); return root;
  };
  // Model an existing site's capture handlers. Closed-shadow events reach the site
  // with target=DIV, so a site can mistake native paste for its own composer action.
  for (const type of ['keydown', 'keypress', 'keyup', 'paste', 'copy', 'cut', 'beforeinput', 'input',
    'compositionstart', 'compositionupdate', 'compositionend']) {
    w.document.addEventListener(type, event => {
      hostEvents.push({ type: event.type, tag: event.target.tagName });
      event.preventDefault();
    }, true);
  }
  w.eval(script);
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  const p = { w, store, requests, hostEvents, timers, roots };
  p.root = () => roots.at(-1);
  p.textarea = () => p.root().querySelector('textarea');
  p.open = () => {
    p.root().querySelector('.pt-pill-btn').dispatchEvent(new w.MouseEvent('contextmenu',
      { ctrlKey: true, bubbles: true, composed: true, cancelable: true }));
    p.textarea().focus();
  };
  p.key = (key, extra = {}) => p.textarea().dispatchEvent(new w.KeyboardEvent('keydown',
    { key, bubbles: true, composed: true, cancelable: true, ...extra }));
  p.event = (type, target = p.textarea()) => target.dispatchEvent(new w.Event(type,
    { bubbles: true, composed: true, cancelable: true }));
  p.paste = text => {
    const allowed = p.event('paste');
    // Synthetic clipboard events do not insert native clipboard data in JSDOM.
    // Model the browser's default insertion only when the event was not cancelled.
    if (allowed) {
      const input = p.textarea();
      input.setRangeText(text, input.selectionStart, input.selectionEnd, 'end');
      input.dispatchEvent(new w.InputEvent('input', { inputType: 'insertFromPaste', data: text,
        bubbles: true, composed: true }));
    }
    return allowed;
  };
  p.flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  p.open();
  return p;
}

test('X uses the ordinary input and saves only manually entered notes', async t => {
  for (const expected of ['', '我的备注', '自己复制的原文', '自己复制的原文\n\n我的备注']) {
    const p = editor(t, 'https://x.com/author/status/123');
    p.w.document.title = '作者 on X: "首句。后续正文" / X';
    p.open();
    assert.equal(p.root().querySelectorAll('.pt-input-actions button').length, 1);
    p.textarea().value = expected;
    assert.equal(p.textarea().value, expected);
    p.key('Enter', { ctrlKey: true }); await p.flush();
    const fields = JSON.parse(p.requests.at(-1).data).fields;
    assert.equal(fields.title.stringValue, '首句。后续正文');
    assert.equal(fields.note.stringValue, expected);
    assert.equal(fields.sourceText, undefined);
    assert.equal(fields.sourceAuthor, undefined);
    assert.equal(fields.captureKind, undefined);
  }
});

test('clipboard paste remains available with host capture handlers for keyboard and context-menu paths', async t => {
  for (const path of ['Ctrl+V', 'context menu']) await t.test(path, t => {
    const p = editor(t);
    if (path === 'Ctrl+V') assert.equal(p.key('v', { ctrlKey: true }), true);
    p.textarea().value = '前缀 后缀';
    p.textarea().setSelectionRange(3, 3);
    assert.equal(p.paste('粘贴文字\n第二行'), true);
    assert.equal(p.textarea().value, '前缀 粘贴文字\n第二行后缀');
    assert.ok([...p.store.entries()].some(([key, value]) => key.startsWith('pagetrace_draft_') && value === p.textarea().value));
    assert.deepEqual(p.hostEvents, []);
  });
});

test('copy, cut, selection, undo, redo, typing and IME retain default editing actions', t => {
  const p = editor(t);
  for (const key of ['a', 'c', 'x', 'v', 'z', 'y']) {
    assert.equal(p.key(key, { ctrlKey: true }), true, key);
    assert.equal(p.key(key, { metaKey: true }), true, 'Command+' + key);
  }
  assert.equal(p.key('Enter'), true);
  assert.equal(p.key('Backspace'), true);
  assert.equal(p.key('Enter', { ctrlKey: true, isComposing: true }), true);
  for (const type of ['copy', 'cut', 'beforeinput', 'keypress', 'keyup', 'compositionstart', 'compositionupdate', 'compositionend']) {
    assert.equal(p.event(type), true, type);
  }
  assert.equal(p.requests.length, 0);
  assert.deepEqual(p.hostEvents, []);
});

test('PageTrace submit and Escape still work while editor events stay out of the host page', async t => {
  const p = editor(t);
  p.paste('Fixture draft');
  assert.equal(p.key('Enter', { shiftKey: true }), false);
  await p.flush();
  assert.equal(p.requests.length, 1);
  assert.equal(JSON.parse(p.requests[0].data).fields.note.stringValue, 'Fixture draft');
  assert.equal(p.textarea().value, '');
  assert.equal(p.root().querySelector('.pt-card').classList.contains('active'), false);
  p.open(); p.paste('Preserved draft');
  assert.equal(p.key('Escape'), false);
  assert.equal(p.root().querySelector('.pt-card').classList.contains('active'), false);
  assert.equal(p.textarea().value, 'Preserved draft');
  assert.deepEqual(p.hostEvents, []);
});

test('ordinary page editors and remounted widgets keep their own event behavior', t => {
  const p = editor(t), site = p.w.document.getElementById('site-editor');
  site.focus();
  assert.equal(p.event('paste', site), false);
  assert.deepEqual(p.hostEvents, [{ type: 'paste', tag: 'TEXTAREA' }]);
  p.hostEvents.length = 0;
  p.w.document.getElementById('pagetrace-floating-widget').remove();
  [...p.timers.values()].find(timer => timer.delay === 2000).callback();
  p.open();
  assert.equal(p.paste('After remount'), true);
  assert.equal(p.textarea().value, 'After remount');
  assert.deepEqual(p.hostEvents, []);
});
