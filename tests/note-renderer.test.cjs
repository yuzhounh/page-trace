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
test('tables with blank lines between rows render with columns, inline formatting and safe links', () => {
  const { dom, render } = setup();
  const source = '| 维度 | Browser Use | WebMCP |\n\n| --- | --- | --- |\n\n| **交互对象** | DOM | 工具 |\n\n| 操作 | `<input>` | [接口](https://example.com) |';
  for (const text of [source, dom.window.PageTraceNotes.normalizeForSave(source)]) {
    const root = render(text);
    assert.equal(root.querySelectorAll('table').length, 1);
    assert.equal(root.querySelectorAll('th').length, 3);
    assert.equal(root.querySelectorAll('tbody tr').length, 2);
    assert.equal(root.querySelector('td strong').textContent, '交互对象');
    assert.equal(root.querySelector('td code').textContent, '<input>');
    assert.equal(root.querySelector('a').rel, 'noopener noreferrer');
  }
  assert.equal(render('| A | B |\n| --- | --- |\n\n| 1 | 2 |').querySelectorAll('td').length, 2);
});
test('table recovery preserves fenced code, surrounding prose and ordinary pipe-separated text', () => {
  const { render } = setup();
  const table = '| A | B |\n\n| --- | --- |\n\n| 1 | 2 |';
  const root = render('开头\n\n```text\n' + table + '\n```\n\n' + table + '\n\n结尾');
  assert.equal(root.querySelector('pre code').textContent, table + '\n');
  assert.equal(root.querySelectorAll('table').length, 1);
  assert.equal(root.querySelector('p').textContent, '开头');
  assert.equal(root.lastElementChild.textContent, '结尾');
  assert.equal(render('| 普通文字 |\n\n| 另一段 |').querySelector('table'), null);
});

test('only bare HTML breaks in table cells render, with code and other HTML kept literal', () => {
  const { render, dom } = setup();
  const source = '| 名称<br>说明 | 内容 |\n| --- | --- |\n' +
    '| 甲<br>乙<BR/>丙<br />丁 | `<br>` <br onmouseover="alert(1)"> <img src=x onerror=alert(1)> |\n\n' +
    '正文<br>保持文字';
  const root = render(source);
  assert.equal(root.querySelectorAll('th br').length, 1);
  assert.equal(root.querySelectorAll('td br').length, 3);
  assert.equal(root.querySelector('td code').textContent, '<br>');
  assert.equal(root.querySelector('img,[onmouseover],[onerror]'), null);
  assert.match(root.querySelectorAll('td')[1].textContent, /<br onmouseover=/);
  assert.equal(root.querySelector('p').textContent, '正文<br>保持文字');
  assert.match(dom.window.PageTraceNotes.preview(source), /甲 乙 丙 丁/);
});

test('six-column records split by breaks and blank lines recover before and after saving', () => {
  const { render, dom } = setup();
  const source = '开头\n\n| 模型 | 定位 | 状态 | 延迟 | 成本 | 场景 |\n\n| --- | --- | --- | --- | --- | --- |\n\n' +
    '| **Helix** | Flash-Lite<br>\n\n<br>端侧 | 未发布<br>\n\n<br>测试阶段 | 快 | $0.30 / $2.50 | 清洗 |\n\n' +
    '| **Hydrogen**<br>\n\n<br>氢 | Flash<br>\n\n<br>主力 | 灰度 | 300 tok/s<br>\n\n<br>高吞吐 | 低 | 日常 |\n\n' +
    '| Argon | Pro | 已发布 | 中速 | $2 / $10 | 长上下文\n理解 |\n\n' +
    '## 后续\n\n结尾';
  for (const text of [source, dom.window.PageTraceNotes.normalizeForSave(source)]) {
    const root = render(text);
    assert.equal(root.querySelectorAll('table').length, 1);
    assert.equal(root.querySelectorAll('th').length, 6);
    assert.equal(root.querySelectorAll('tbody tr').length, 3);
    const rows = [...root.querySelectorAll('tbody tr')];
    assert.equal(rows[0].children[1].innerHTML, 'Flash-Lite<br> <br>端侧');
    assert.match(rows[1].children[0].innerHTML, /<strong>Hydrogen<\/strong><br> <br>氢/);
    assert.equal(rows[2].children[5].innerHTML, '长上下文<br>理解');
    assert.equal(root.querySelector('h2').textContent, '后续');
    assert.equal(root.lastElementChild.textContent, '结尾');
  }
});

test('wrapped rows preserve escaped pipes, alignment, inline code, math and safe links', () => {
  const { render } = setup();
  const root = render('| A | B | C |\n| :--- | :---: | ---: |\n' +
    '| a\\|b<br>\n续行 | `c\\|d` | [链接](https://example.com)<br>\n$x^2$ |');
  assert.equal(root.querySelectorAll('td').length, 3);
  assert.match(root.querySelector('td').innerHTML, /a\|b<br> 续行/);
  assert.equal(root.querySelector('code').textContent, 'c|d');
  assert.equal(root.querySelector('a').rel, 'noopener noreferrer');
  assert.equal(root.querySelectorAll('.katex').length, 1);
  assert.equal(root.querySelectorAll('th')[2].getAttribute('align'), 'right');
});

test('table repair stops at new rows, headings and code, leaving incomplete records intact', () => {
  const { render } = setup();
  const wrapped = '| A | B | C |\n| --- | --- | --- |\n| 1 | x<br>\n\n<br>y | 3 |';
  const root = render('```text\n' + wrapped + '\n```\n\n' +
    '    | A | B |\n    | --- | --- |\n    | 1 | 2 |\n\n' +
    '| A | B | C |\n| --- | --- | --- |\n| incomplete |\n\n正文保持独立\n\n' +
    '## 标题\n\n' + wrapped + '\n\n| next | row | intact |\n\n结尾');
  assert.equal(root.querySelector('pre code').textContent, wrapped + '\n');
  assert.equal(root.querySelectorAll('pre').length, 2);
  assert.equal(root.querySelectorAll('table').length, 2);
  assert.ok([...root.querySelectorAll('p')].some(p => p.textContent === '正文保持独立'));
  assert.equal(root.querySelectorAll('table')[1].querySelectorAll('tbody tr').length, 2);
  assert.equal(root.lastElementChild.textContent, '结尾');
  assert.equal(render('| A | B |\n| --- | --- |\n| 1 | 2 |\n\n| X | Y |\n| --- | --- |\n| 3 | 4 |').querySelectorAll('table').length, 2);
});

test('table recovery retains reference definitions and nested blocks', () => {
  const { render } = setup();
  const root = render('[before]: https://example.com/before\n\n[前文][before]\n\n' +
    '```text\n| literal |\n```\n\n' +
    '[after]: https://example.com/after\n\n' +
    '| A | B |\n\n| --- | --- |\n\n| [后文][after]<br>\n\n续行 | 2 |\n\n' +
    '> 引用<br>\n> | 保持引用 |\n\n- 列表<br>\n  接续');
  assert.equal(root.querySelector('p a').href, 'https://example.com/before');
  assert.equal(root.querySelector('td a').href, 'https://example.com/after');
  assert.match(root.querySelector('blockquote').textContent, /引用<br>/);
  assert.match(root.querySelector('li').textContent, /列表<br>/);
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
test('save spacing matches the userscript without reformatting existing notes on display', () => {
  const { dom } = setup();
  const script = read('pagetrace.user.js');
  const start = script.indexOf('  function formatNoteWithBlankLines(');
  const end = script.indexOf('  function fallbackCopy(', start);
  dom.window.eval(script.slice(start, end));
  for (const source of ['', '\n \t\n', '\n第一行\n第二行\n\n\n第三行\n\n', '\r\n第一行\r\n \t\r\n第二行\r\n',
    '甲\n\n---\n\n乙\n***\n___\n- - -\n丙',
    '```text\n---\n***\n___\n```\n\n---\n\n正文',
    '~~~text\n---\n~~~\n\n---\n\n正文',
    '    ---\n    代码缩进', '| A | B |\n| --- | --- |\n| 1 | 2 |']) {
    const saved = dom.window.PageTraceNotes.normalizeForSave(source);
    assert.equal(saved, dom.window.formatNoteWithBlankLines(source));
    assert.equal(dom.window.PageTraceNotes.normalizeForSave(saved), saved);
  }
  assert.equal(dom.window.PageTraceNotes.normalizeForSave('\n甲\n\n\n乙\n丙\n'), '甲\n\n乙\n\n丙');
  assert.equal(dom.window.PageTraceNotes.normalizeSource('甲\n\n\n乙'), '甲\n\n\n乙');
  assert.equal(dom.window.PageTraceNotes.normalizeForSave('甲\n---\n***\n___\n- - -\n乙'), '甲\n\n乙');
  assert.equal(dom.window.PageTraceNotes.normalizeForSave('---\n\n***\n___'), '');
  assert.equal(dom.window.PageTraceNotes.normalizeForSave('正文中的 --- 保留'), '正文中的 --- 保留');
  assert.equal(dom.window.PageTraceNotes.normalizeForSave('```text\n---\n```\n---'), '```text\n\n---\n\n```');
  assert.equal(dom.window.PageTraceNotes.normalizeForSave('    ---'), '    ---');
  assert.equal(dom.window.PageTraceNotes.normalizeForSave('| A | B |\n| --- | --- |'), '| A | B |\n\n| --- | --- |');
});
test('page inline scripts compile', () => {
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
});
test('collapsed preview joins blocks with spaces and keeps formulas as TeX', () => {
  const { dom } = setup();
  const preview = source => dom.window.PageTraceNotes.preview(source);
  assert.equal(preview('第一段。\n\n第二段 **加粗**。\n\n- 甲\n- 乙'), '第一段。 第二段 加粗。 甲 乙');
  assert.equal(preview('公式 $x^2$ 结束'), '公式 x^2 结束');
  assert.equal(preview('<b>x</b>\n\n# 标题\n\n```\na\n  b\n```'), '<b>x</b> 标题 a b');
});
