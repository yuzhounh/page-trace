const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const version = fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim();
const script = fs.readFileSync(path.join(root, 'pagetrace.user.js'), 'utf8');
const android = fs.readFileSync(path.join(root, 'android/app/build.gradle'), 'utf8');
if (!script.includes(`// @version      ${version}`) || !android.includes(`versionName '${version}'`)) {
  throw Error('Web, userscript and Android source versions must agree');
}
const output = path.join(root, 'dist', `web-${version}`);
fs.mkdirSync(output, { recursive: true });
for (const name of ['index.html', 'auth.html', 'VERSION', 'pagetrace.user.js', 'logo.svg',
  'android-bridge.js', 'touch-ui.js', 'touch-ui.css', 'android-ui.css', 'mobile-ui.js', 'mobile-ui.css',
  'note-renderer.js', 'note-renderer.css', 'calendar-counts.js', 'vendor', 'README.md']) {
  fs.cpSync(path.join(root, name), path.join(output, name), { recursive: true });
}
console.log(`Public assets copied normally to ${output}`);
