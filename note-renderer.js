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
    parser = new window.marked.Marked({ gfm: true, breaks: true }, {
      // Raw HTML is text, never an executable part of a note.
      renderer: { html: token => escape(token.text) },
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
  function repairSpacedTables(source) {
    if (!/\n[ \t]*\n[ \t]*\|/.test(source)) return source;
    const markdown = getParser();
    const tokens = markdown.lexer(source);
    const isRows = token => ['paragraph', 'table'].includes(token?.type) &&
      token.raw.trim().split('\n').every(line => /^\s*\|/.test(line));
    const parts = [];
    for (let i = 0; i < tokens.length; i++) {
      let raw = tokens[i].raw;
      if (isRows(tokens[i])) {
        while (isRows(tokens[i + 1]) ||
          (tokens[i + 1]?.type === 'space' && isRows(tokens[i + 2]))) {
          raw += tokens[++i].raw;
        }
        const joined = raw.replace(/\n(?:[ \t]*\n)+(?=[ \t]*\|)/g, '\n');
        if (joined !== raw) {
          const checked = markdown.lexer(joined);
          if (checked[0]?.type === 'table' && checked.every(token => ['table', 'space'].includes(token.type))) {
            raw = joined;
          }
        }
      }
      parts.push(raw);
    }
    return parts.join('');
  }
  function render(text) {
    const source = normalizeSource(text);
    if (!window.marked || !window.DOMPurify) return escape(source).replace(/\n/g, '<br>');
    try {
      const fragment = window.DOMPurify.sanitize(getParser().parse(repairSpacedTables(source)), {
        RETURN_DOM_FRAGMENT: true, ADD_TAGS: ['annotation'], ADD_ATTR: ['encoding']
      });
      fragment.querySelectorAll('a').forEach(link => {
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
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
