const { copyFileSync, cpSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');
const root = join(__dirname, '..');
for (const [pkg, files] of Object.entries({
  marked: ['lib/marked.umd.js', 'LICENSE'],
  dompurify: ['dist/purify.min.js', 'LICENSE'],
  katex: ['dist/katex.min.js', 'dist/katex.min.css', 'LICENSE']
})) {
  const dest = join(root, 'vendor', pkg);
  mkdirSync(dest, { recursive: true });
  for (const file of files) copyFileSync(join(root, 'node_modules', pkg, file), join(dest, file.split('/').pop()));
}
cpSync(join(root, 'node_modules/katex/dist/fonts'), join(root, 'vendor/katex/fonts'), { recursive: true });
