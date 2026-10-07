const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { JSDOM } = require('jsdom');
const vm = require('node:vm');
const read = file => readFileSync(join(__dirname, '..', file), 'utf8');
const html = read('index.html');
function setup() {
  const dom = new JSDOM('<!doctype html><div id="result"></div>', { runScripts: 'outside-only' });
  for (const file of ['vendor/marked/marked.umd.js', 'vendor/dompurify/purify.min.js', 'vendor/katex/katex.min.js', 'note-renderer.js']) dom.window.eval(read(file));
  const root = dom.window.document.getElementById('result');
  return { dom, root, render(source) { root.innerHTML = dom.window.PageTraceNotes.render(source); return root; } };
}
test('Markdown lists, tables, links, code and original indentation survive rendering', () => {
  const { render } = setup();
  const root = render('**重点**与*斜体*\n\n- 一\n- 二\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n[链接](https://example.com)\n\n```js\n  const x = "$x$";\n```');
  assert.equal(root.querySelector('strong').textContent, '重点');
  assert.equal(root.querySelectorAll('li').length, 2);
  assert.equal(root.querySelectorAll('td').length, 2);
  assert.equal(root.querySelector('a').rel, 'noopener noreferrer');
  assert.match(root.querySelector('pre').textContent, /^  const x/);
  assert.equal(root.querySelector('pre .katex'), null);
});
test('inline and display math preserve TeX before Markdown interprets underscores', () => {
  const { render } = setup();
  const root = render(String.raw`作者 $\rightarrow$ 论文；$x_i^2$；\(a_b\)` + '\n\n' + String.raw`$$
\begin{aligned}
a &= b \\
c &= d
\end{aligned}
$$`);
  assert.equal(root.querySelectorAll('.katex').length, 4);
  assert.equal(root.querySelectorAll('.katex-display').length, 1);
  assert.match(root.querySelector('annotation').textContent, /rightarrow/);
});
test('invalid formulas and unavailable libraries fall back to readable safe text', () => {
  const { dom, render } = setup();
  assert.match(render(String.raw`$\notARealCommand$`).textContent, /notARealCommand/);
  dom.window.marked = undefined;
  const root = render('<img src=x onerror=alert(1)>\n普通文本');
  assert.equal(root.querySelector('img'), null);
  assert.equal(root.querySelectorAll('br').length, 1);
});
test('HTML, unsafe links and trusted TeX commands cannot execute', () => {
  const { render } = setup();
  const root = render('<img src=x onerror=alert(1)>\n\n[危险](javascript:alert(1))\n\n' + String.raw`$\href{javascript:alert(1)}{x}$`);
  assert.equal(root.querySelector('img,script,iframe,[onerror],a[href^="javascript:"]'), null);
});
test('ordinary text, escaped dollars, currency and math inside code stay readable', () => {
  const { render } = setup();
  const root = render('第一行\n第二行\n\n\\$5 and $10; `$x$`');
  assert.equal(root.querySelectorAll('.katex').length, 0);
  assert.match(root.textContent, /\$5 and \$10/);
  assert.equal(root.querySelector('code').textContent, '$x$');
});
test('saving preserves Markdown links, blank lines and indented code', async () => {
  const { dom } = setup();
  const start = html.indexOf('    function isUrlLike(');
  const end = html.indexOf('    async function handleCreateSubmit');
  assert.ok(end > start);
  dom.window.eval(html.slice(start, end));
  const source = '    indented code\n\n[link](https://example.com)\n\n| A |\n| - |\n| 1 |';
  const result = await dom.window.resolveNoteFields('', '', source);
  assert.equal(result.note, source);
  assert.equal(result.url, '');
});
test('expand and collapse retain formatted DOM', () => {
  const { dom, root, render } = setup();
  const formatted = render('**重点** $x^2$').innerHTML;
  root.innerHTML = `<div class="note-item-row"><div class="note-body is-collapsed">${formatted}</div><button></button></div>`;
  dom.window.notesData = [{ id: 'test', note: '**重点** $x^2$' }];
  dom.window.expandedNoteIds = new Set();
  const code = html.slice(html.indexOf('    window.toggleNoteExpanded ='), html.indexOf('    // 年份与月份下拉打开/切换'));
  dom.window.eval(code);
  const event = { stopPropagation() {}, currentTarget: root.querySelector('button') };
  dom.window.toggleNoteExpanded(event, 'test');
  assert.equal(root.querySelector('.note-body').innerHTML, formatted);
  assert.equal(event.currentTarget.getAttribute('aria-expanded'), 'true');
  dom.window.toggleNoteExpanded(event, 'test');
  assert.equal(root.querySelector('.note-body').innerHTML, formatted);
  assert.equal(event.currentTarget.getAttribute('aria-expanded'), 'false');
});
test('page inline scripts compile', () => {
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
});
