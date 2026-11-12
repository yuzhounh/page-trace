(function () {
  'use strict';
  const escape = text => text.replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
  const normalizeSource = text => (text || '').replace(/\r\n?/g, '\n').replace(/^(?:[ \t]*\n)+|\n[ \t]*$/g, '');
  function normalizeForSave(text) {
    if (!text) return '';
    let fence = null;
    return text.replace(/\r\n?/g, '\n').split('\n').filter(line => {
      const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
      if (marker) {
        if (!fence) fence = marker[1];
        else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
        return true;
      }
      return fence || !/^ {0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(line);
    }).map(line => line.trimEnd()).filter(line => line.trim() !== '').join('\n\n');
  }
  let parser;
  function getParser() {
    if (parser) return parser;
    const renderMath = token => {
      if (!window.katex) return escape(token.raw);
      try {
        return window.katex.renderToString(token.text, {
          displayMode: token.display, throwOnError: true, trust: false,
          maxExpand: 1000, maxSize: 20, strict: 'ignore'
        });
      } catch (_) {
        return `<code class="note-math-error">${escape(token.raw)}</code>`;
      }
    };
    let inTable = false;
    parser = new window.marked.Marked({ gfm: true, breaks: true }, {
      // Only bare line breaks in tables are HTML; attributes and other tags stay text.
      renderer: {
        html: token => inTable && /^<br\s*\/?>$/i.test(token.text) ? '<br>' : escape(token.text),
        table(token) {
          const previous = inTable;
          inTable = true;
          try { return window.marked.Renderer.prototype.table.call(this, token); }
          finally { inTable = previous; }
        }
      },
      extensions: [{
        name: 'blockMath', level: 'block',
        start: src => src.search(/\$\$|\\\[/),
        tokenizer(src) {
          const match = /^(?:\$\$[ \t]*\n([\s\S]+?)\n[ \t]*\$\$|\\\[[ \t]*\n([\s\S]+?)\n[ \t]*\\\])[ \t]*(?:\n|$)/.exec(src);
          if (match) return { type: 'blockMath', raw: match[0], text: match[1] || match[2], display: true };
        },
        renderer: renderMath
      }, {
        name: 'inlineMath', level: 'inline',
        start: src => src.search(/\$|\\[([]/),
        tokenizer(src) {
          const match = /^(?:\$\$((?:\\.|[^$\\`])+?)\$\$|\$(?!\$)((?:\\.|[^$\\`\n])+?)\$(?!\$)|\\\(([\s\S]+?)\\\)|\\\[([\s\S]+?)\\\])/.exec(src);
          if (!match) return;
          const text = match[1] || match[2] || match[3] || match[4];
          // Leave common currency such as "$5 and $10" as ordinary text.
          if (match[2] && (/^\s|\s$/.test(text) || /^\d/.test(src.slice(match[0].length)))) return;
          return { type: 'inlineMath', raw: match[0], text, display: !!(match[1] || match[4]) };
        },
        renderer: renderMath
      }]
    });
    return parser;
  }
  function repairTables(source) {
    if (!source.includes('|')) return source;
    const markdown = getParser();
    // Match GFM's escaped-pipe rules, including even/odd runs of backslashes.
    function pipes(row) {
      const positions = [];
      let slashes = 0;
      for (let i = 0; i < row.length; i++) {
        if (row[i] === '|' && slashes % 2 === 0) positions.push(i);
        slashes = row[i] === '\\' ? slashes + 1 : 0;
      }
      return positions;
    }
    function cells(row) {
      const positions = pipes(row.trim());
      return positions.length + 1 - (positions[0] === 0 ? 1 : 0) -
        (positions.at(-1) === row.trim().length - 1 ? 1 : 0);
    }
    const startsRow = line => /^ {0,3}\|/.test(line);
    const endsRow = line => pipes(line.trim()).at(-1) === line.trim().length - 1;
    const delimiter = line => /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/.test(line);
    function repairChunk(raw) {
      const lines = raw.split('\n');
      const result = [];
      const nextNonempty = start => {
        while (start < lines.length && !lines[start].trim()) start++;
        return start;
      };
      for (let i = 0; i < lines.length; i++) {
        const divider = nextNonempty(i + 1);
        if (!startsRow(lines[i]) || !delimiter(lines[divider] || '')) {
          result.push(lines[i]);
          continue;
        }
        const header = markdown.lexer(lines[i] + '\n' + lines[divider] + '\n')[0];
        if (header?.type !== 'table') {
          result.push(lines[i]);
          continue;
        }
        result.push(lines[i], lines[divider]);
        i = divider;
        const columns = header.header.length;
        while (true) {
          const start = nextNonempty(i + 1);
          if (!startsRow(lines[start] || '') || delimiter(lines[start])) break;
          // A second header starts a separate table, even with no blank line.
          if (delimiter(lines[nextNonempty(start + 1)] || '')) break;
          let row = lines[start];
          let end = start;
          if (cells(row) < columns || !endsRow(row)) {
            let candidate = row;
            for (let j = start + 1; j < lines.length; j++) {
              const line = lines[j];
              if (!line.trim()) continue;
              if (startsRow(line) || /^(?: {4}|\t)|^ {0,3}(?:#{1,6}\s|>|`{3,}|~{3,}|[-+*]\s|\d+[.)]\s)/.test(line)) break;
              const gap = /<br\s*\/?>\s*$/i.test(candidate) || /^\s*<br\s*\/?>/i.test(line) || endsRow(candidate) ? ' ' : '<br>';
              candidate += gap + line.trim();
              const count = cells(candidate);
              if (count > columns) break;
              if (count === columns && endsRow(candidate)) {
                row = candidate;
                end = j;
                break;
              }
            }
          }
          result.push(row);
          i = end;
        }
      }
      return result.join('\n');
    }
    // Leave code and nested blocks intact; their contents are not top-level rows.
    const parts = [];
    let cursor = 0;
    let tokenCursor = 0;
    for (const token of markdown.lexer(source)) {
      // Definitions live in lexer metadata, not tokens; retain source gaps verbatim.
      const start = source.indexOf(token.raw, tokenCursor);
      if (start < 0) return source;
      tokenCursor = start + token.raw.length;
      if (['code', 'list', 'blockquote', 'blockMath'].includes(token.type)) {
        parts.push(repairChunk(source.slice(cursor, start)), token.raw);
        cursor = tokenCursor;
      }
    }
    parts.push(repairChunk(source.slice(cursor)));
    return parts.join('');
  }
  function render(text) {
    const source = normalizeSource(text);
    if (!window.marked || !window.DOMPurify) return escape(source).replace(/\n/g, '<br>');
    try {
      const fragment = window.DOMPurify.sanitize(getParser().parse(repairTables(source)), {
        RETURN_DOM_FRAGMENT: true, ADD_TAGS: ['annotation'], ADD_ATTR: ['encoding']
      });
      fragment.querySelectorAll('a').forEach(link => {
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
      });
      fragment.querySelectorAll('table').forEach(table => {
        const scroll = document.createElement('div');
        scroll.className = 'note-table-scroll';
        table.replaceWith(scroll);
        scroll.append(table);
        // Soft-wrap long URLs/identifiers without lowering every word's minimum width.
        const walker = document.createTreeWalker(table, NodeFilter.SHOW_TEXT);
        const nodes = [];
        while (walker.nextNode()) {
          if (!walker.currentNode.parentElement.closest('.katex,pre')) nodes.push(walker.currentNode);
        }
        for (const node of nodes) {
          const matches = [...node.textContent.matchAll(/[^\s\u3000-\u9fff]{32,}/gu)];
          if (!matches.length) continue;
          const replacement = document.createDocumentFragment();
          let offset = 0;
          for (const match of matches) {
            replacement.append(node.textContent.slice(offset, match.index));
            const token = document.createElement('span');
            token.className = 'note-table-long-token';
            token.textContent = match[0];
            replacement.append(token);
            offset = match.index + match[0].length;
          }
          replacement.append(node.textContent.slice(offset));
          node.replaceWith(replacement);
        }
      });
      const container = document.createElement('div');
      container.append(fragment);
      return container.innerHTML;
    } catch (_) {
      return escape(source).replace(/\n/g, '<br>');
    }
  }
  const BLOCKS = 'p,li,h1,h2,h3,h4,h5,h6,blockquote,pre,tr,table,ul,ol,div,br,hr';
  function collapse(value) { return String(value).replace(/\s+/g, ' ').trim(); }
  function preview(text) {
    const source = normalizeSource(text);
    if (!window.marked || !window.DOMPurify) return collapse(source);
    try {
      const container = document.createElement('div');
      container.innerHTML = render(source);
      container.querySelectorAll('.katex').forEach(math => {
        const tex = math.querySelector('annotation[encoding="application/x-tex"]');
        math.replaceWith(document.createTextNode(tex ? tex.textContent : ''));
      });
      container.querySelectorAll(BLOCKS).forEach(el => el.append(document.createTextNode(' ')));
      return collapse(container.textContent);
    } catch (_) {
      return collapse(source);
    }
  }
  window.PageTraceNotes = { render, preview, normalizeSource, normalizeForSave };
})();
