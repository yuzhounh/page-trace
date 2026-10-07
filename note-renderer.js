(function () {
  'use strict';
  const escape = text => text.replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
  const normalizeSource = text => (text || '').replace(/\r\n?/g, '\n').replace(/^(?:[ \t]*\n)+|\n[ \t]*$/g, '');
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
  function render(text) {
    const source = normalizeSource(text);
    if (!window.marked || !window.DOMPurify) return escape(source).replace(/\n/g, '<br>');
    try {
      const fragment = window.DOMPurify.sanitize(getParser().parse(source), {
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
  window.PageTraceNotes = { render, normalizeSource };
})();
