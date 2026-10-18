const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { JSDOM } = require('jsdom');
const script = readFileSync(join(__dirname, '..', 'pagetrace.user.js'), 'utf8');
const code = script.slice(script.indexOf('function processTitle('), script.indexOf('// 规范化笔记段落'));

test('X title rules use only the page title and leave notes and links alone', t => {
  const dom = new JSDOM('', { url: 'https://x.com/author/status/123', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const w = dom.window;
  w.eval(code + '\nwindow.capture = getPageCapture;');
  for (const [title, expected] of [
    ['Lonely on X: "🎉 牛逼！后续正文" / X', '🎉 牛逼！'],
    ['作者 on X: “正文包含"内部引号"。后续” / X', '正文包含"内部引号"。'],
    ['作者 on X: "' + '长'.repeat(90) + '" / X', '长'.repeat(60) + '…'],
    ['Home / X', 'Home / X']
  ]) {
    w.document.title = title;
    assert.deepEqual(JSON.parse(JSON.stringify(w.capture())), { title: expected, url: w.location.href });
  }
  dom.reconfigure({ url: 'https://example.com/article' });
  w.document.title = 'Lonely on X: "正文" / X';
  assert.equal(w.capture().title, w.document.title);
});
