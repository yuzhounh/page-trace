const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const read = (name) => readFileSync(join(__dirname, '..', name), 'utf8');
const userscript = read('pagetrace.user.js');
const authHtml = read('auth.html');
const indexHtml = read('index.html');
const inlineScripts = (html) => [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)]
  .map((match) => match[1]).filter((code) => code.trim());
const authCode = inlineScripts(authHtml).at(-1);
const bridgeCode = userscript.slice(userscript.indexOf('const TRUSTED_APP_BASE_URLS'),
  userscript.indexOf('function createSvgIcon'));
const dashboardCode = indexHtml.slice(indexHtml.indexOf('let authBridgeNonce'),
  indexHtml.indexOf('// 登录 / 退出 / 头像浮窗'));
const firebaseConfig = { apiKey: 'AIzaSyA91weJPSAeO58tB0cYS38-q-XpXJTbjLc', projectId: 'page-trace-app' };
const makeUser = (uid = 'alice') => ({ uid, email: `${uid}@example.test`,
  refreshToken: `refresh-${uid}`, getIdToken: async () => `id-${uid}` });

// Execute the production bridge functions with browser/Firebase/GM adapters.
// Tokens and network responses are fixtures; no real account or cloud data is used.
function page(url = 'https://page-trace.pages.dev/auth.html', store = new Map()) {
  const listeners = [], queue = [], timers = new Map(), elements = new Map();
  let timerId = 0;
  const p = { store, sent: [], openerMessages: [], requests: [], subscriptions: [], closed: false };
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, { style: {}, textContent: '', className: '',
      handlers: {}, classList: { remove() {} },
      addEventListener(type, callback) { this.handlers[type] = callback; } });
    return elements.get(id);
  };
  p.window = { location: new URL(url),
    opener: { postMessage: (...args) => p.openerMessages.push(args) },
    addEventListener: (type, callback) => { if (type === 'message') listeners.push(callback); },
    postMessage(data, targetOrigin) {
      p.sent.push({ data, targetOrigin });
      if (targetOrigin === '*' || targetOrigin === p.window.location.origin) {
        p.emit(data);
      }
    },
    close: () => { p.closed = true; }
  };
  p.emit = (data, origin = p.window.location.origin, source = p.window) => queue.push({ data, origin, source });
  p.flush = async () => {
    for (let i = 0; i < 12; i++) {
      while (queue.length) {
        const event = queue.shift();
        for (const callback of listeners) callback(event);
      }
      await Promise.resolve();
    }
    assert.equal(queue.length, 0, 'message loop should settle');
  };
  const callbacks = [];
  p.auth = { currentUser: null,
    onAuthStateChanged: (callback) => callbacks.push(callback),
    onIdTokenChanged: (callback) => callbacks.push(callback),
    async signInWithPopup() { await p.setUser(p.loginUser); return { user: p.loginUser }; },
    async signOut() { await p.setUser(null); }
  };
  p.setUser = async (user) => {
    p.auth.currentUser = user;
    for (const callback of callbacks) await callback(user);
  };
  const firebaseAuth = () => p.auth;
  firebaseAuth.GoogleAuthProvider = function () {};
  const sandbox = { window: p.window, URL, crypto: webcrypto, console, Uint8Array,
    document: { getElementById: element },
    firebase: { apps: [{}], auth: firebaseAuth, initializeApp() {} },
    firebaseConfig, auth: p.auth, currentUser: null, notesData: [], unsubscribeNotes: null,
    bindFirestoreRealtime: (uid) => p.subscriptions.push(uid), renderList() {},
    GM_getValue: (key, fallback) => store.has(key) ? store.get(key) : fallback,
    GM_setValue: (key, value) => store.set(key, value),
    GM_deleteValue: (key) => store.delete(key),
    GM_xmlhttpRequest(options) {
      p.requests.push(options);
      options.onload({ status: 200, responseText: JSON.stringify(options.url.includes('securetoken')
        ? { id_token: 'renewed-id', refresh_token: 'renewed-refresh', user_id: 'alice', expires_in: '3600' }
        : { name: 'fixture-note' }) });
    },
    setInterval(callback) { const id = ++timerId; timers.set(id, { callback, repeat: true }); return id; },
    clearInterval: (id) => timers.delete(id),
    setTimeout(callback) { const id = ++timerId; timers.set(id, { callback, repeat: false }); return id; },
    clearTimeout: (id) => timers.delete(id)
  };
  for (const id of ['loginBtn', 'avatarBtn', 'avatarImg', 'avatarFallback', 'dropdownAvatar',
    'dropdownName', 'dropdownEmail', 'userDropdown']) sandbox[id] = element(id);
  p.context = vm.createContext(sandbox);
  p.loadUserscript = () => vm.runInContext(`${bridgeCode}\nsetupAuthBridgeListener();
    globalThis.api = { CONFIG, saveToFirestore };`, p.context);
  p.loadAuth = () => vm.runInContext(authCode, p.context);
  p.loadDashboard = () => vm.runInContext(dashboardCode, p.context);
  p.tick = async () => {
    for (const [id, timer] of [...timers]) {
      if (!timer.repeat) timers.delete(id);
      timer.callback();
    }
    await p.flush();
  };
  p.login = async (user) => { p.loginUser = user; await element('loginBtn').handlers.click(); await p.flush(); };
  p.nonce = () => p.sent.find(({ data }) => data.source === 'PAGETRACE_PING').data.nonce;
  p.success = (extra = {}) => ({ source: 'PAGETRACE_AUTH_SUCCESS', nonce: p.nonce(),
    payload: { ...firebaseConfig, idToken: 'id-alice', refreshToken: 'refresh-alice', uid: 'alice',
      expiresIn: 3600, ...extra } });
  return p;
}

test('all production JavaScript parses; credentials never go to opener', () => {
  new vm.Script(userscript);
  for (const code of [...inlineScripts(authHtml), ...inlineScripts(indexHtml)]) new vm.Script(code);
  assert.doesNotMatch(authHtml + userscript, /window\.opener\.postMessage/);
  assert.match(userscript, /@version\s+1\.10\.8/);
  assert.match(userscript, /@match\s+\*:\/\/\*\/\*/);
  assert.match(userscript, /window\.open\(CONFIG\.authAppUrl, '_blank', '[^']*noopener/);
});

test('ordinary pages cannot inject login/logout, including hostname and path lookalikes', async () => {
  for (const url of ['https://evil.example/auth.html', 'https://page-trace.pages.dev.evil.example/auth.html',
    'https://yuzhounh.github.io/other/auth.html', 'http://localhost:5837/auth.html',
    'http://127.0.0.1:3000/auth.html',
    'https://page-trace.pages.dev/other.html']) {
    const store = new Map([['pt_id_token', 'existing'], ['pt_uid', 'existing']]);
    const p = page(url, store);
    p.loadUserscript();
    p.emit({ source: 'PAGETRACE_AUTH_SUCCESS', payload: { idToken: 'evil', uid: 'evil' } });
    p.emit({ source: 'PAGETRACE_AUTH_LOGOUT' });
    await p.flush();
    assert.equal(store.get('pt_id_token'), 'existing');
    assert.equal(p.sent.length, 0);
    assert.equal(p.context.api.CONFIG.authAppUrl, 'https://page-trace.pages.dev/auth.html');
  }
});

test('trusted pages require exact origin, same window, session nonce, and valid fixed project', async () => {
  const p = page();
  p.loadUserscript();
  p.emit(p.success(), 'https://evil.example');
  p.emit(p.success(), undefined, {});
  p.emit({ ...p.success(), nonce: 'old-session' });
  for (const payload of [{ apiKey: 'evil' }, { projectId: 'evil' }, { refreshToken: '' },
    { expiresIn: NaN }, { expiresIn: -1 }, { uid: null }]) p.emit(p.success(payload));
  await p.flush();
  assert.equal(p.store.size, 0);
  p.emit(p.success());
  await p.flush();
  p.emit({ source: 'PAGETRACE_AUTH_LOGOUT', nonce: 'old-session' });
  p.emit({ source: 'PAGETRACE_AUTH_LOGOUT', nonce: p.nonce() }, 'https://evil.example');
  await p.flush();
  assert.equal(p.store.get('pt_uid'), 'alice');
  assert.equal(p.store.has('pt_api_key'), false);
  assert.equal(p.store.has('pt_project_id'), false);
});

test('existing login synchronizes after late userscript injection and closes only after storage confirmation', async () => {
  const p = page();
  p.loadAuth();
  await p.setUser(makeUser());
  assert.equal(p.sent.length, 0);
  assert.equal(p.closed, false);
  p.loadUserscript();
  await p.flush();
  assert.equal(p.store.get('pt_refresh_token'), 'refresh-alice');
  assert.equal(p.closed, false);
  await p.tick();
  assert.equal(p.closed, true);
  assert.equal(p.openerMessages.length, 0);
  assert.ok(p.sent.every(({ targetOrigin }) => targetOrigin === p.window.location.origin));
});

test('handshake retries cover a page listener loaded after the userscript', async () => {
  const p = page();
  p.loadUserscript();
  await p.flush(); // First ping arrives before the page listener exists.
  p.loadAuth();
  await p.setUser(makeUser());
  await p.tick();
  assert.equal(p.store.get('pt_uid'), 'alice');
});

test('manual Google login after handshake stores credentials and confirms completion', async () => {
  const p = page();
  p.loadAuth();
  p.loadUserscript();
  await p.flush();
  await p.login(makeUser());
  assert.equal(p.store.get('pt_id_token'), 'id-alice');
  assert.ok(p.sent.some(({ data }) => data.source === 'PAGETRACE_AUTH_CONFIRMED'));
});

test('no userscript or external ping/ack causes no token transfer or false completion', async () => {
  const p = page();
  p.loadAuth();
  await p.setUser(makeUser());
  const nonce = 'a'.repeat(32);
  p.emit({ source: 'PAGETRACE_PING', nonce }, 'https://evil.example');
  p.emit({ source: 'PAGETRACE_PING', nonce }, undefined, {});
  p.emit({ source: 'PAGETRACE_AUTH_CONFIRMED', nonce });
  await p.flush();
  await p.tick();
  assert.equal(p.sent.length, 0);
  assert.equal(p.closed, false);
});

test('login is shared with ordinary pages; direct save and expired-token renewal still work', async () => {
  const store = new Map();
  const authPage = page(undefined, store);
  authPage.loadAuth();
  authPage.loadUserscript();
  await authPage.flush();
  await authPage.login(makeUser());
  const ordinary = page('https://example.test/article', store);
  ordinary.loadUserscript();
  await ordinary.context.api.saveToFirestore({ title: 'Title', url: ordinary.window.location.href, note: 'Note' });
  assert.equal(ordinary.requests[0].headers.Authorization, 'Bearer id-alice');
  assert.equal(JSON.parse(ordinary.requests[0].data).fields.note.stringValue, 'Note');
  store.set('pt_token_expiry', 0);
  await ordinary.context.api.saveToFirestore({ title: 'Title', url: ordinary.window.location.href });
  assert.match(ordinary.requests[1].data, /refresh_token=refresh-alice/);
  assert.equal(ordinary.requests[2].headers.Authorization, 'Bearer renewed-id');
  assert.match(ordinary.requests[2].url, /projects\/page-trace-app\/.*users\/alice\/notes/);
  assert.equal(store.get('pt_refresh_token'), 'renewed-refresh');
});

test('dashboard synchronizes login, token updates, account switches, and logout without closing', async () => {
  const p = page('https://page-trace.pages.dev/');
  p.loadDashboard();
  p.loadUserscript();
  await p.flush();
  await p.setUser(makeUser());
  await p.flush();
  assert.equal(p.store.get('pt_uid'), 'alice');
  const bob = makeUser('bob');
  await p.setUser(bob);
  await p.flush();
  assert.equal(p.store.get('pt_refresh_token'), 'refresh-bob');
  bob.getIdToken = async () => 'updated-bob';
  await p.setUser(bob);
  await p.flush();
  assert.equal(p.store.get('pt_id_token'), 'updated-bob');
  assert.equal(p.closed, false);
  assert.deepEqual(p.subscriptions, ['alice', 'bob', 'bob']);
  await p.setUser(null);
  await p.flush();
  assert.equal(p.store.size, 0);
});

test('dashboard waits for initial Firebase state; a late handshake also receives logged-out state', async () => {
  const p = page('https://page-trace.pages.dev/', new Map([['pt_uid', 'existing']]));
  p.loadDashboard();
  p.loadUserscript();
  await p.flush();
  assert.equal(p.store.get('pt_uid'), 'existing');
  await p.setUser(null);
  await p.flush();
  assert.equal(p.store.size, 0);
  const late = page('https://page-trace.pages.dev/', new Map([['pt_uid', 'existing']]));
  late.loadDashboard();
  await late.setUser(null);
  late.loadUserscript();
  await late.flush();
  assert.equal(late.store.size, 0);
});

test('auth and dashboard discard credentials fetched before an account change', async () => {
  for (const dashboard of [false, true]) {
    const p = page(dashboard ? 'https://page-trace.pages.dev/' : undefined);
    if (dashboard) p.loadDashboard(); else p.loadAuth();
    p.loadUserscript();
    await p.flush();
    let resolveToken;
    const user = makeUser();
    user.getIdToken = () => new Promise((resolve) => { resolveToken = resolve; });
    const pending = p.setUser(user);
    await Promise.resolve();
    await p.setUser(null);
    resolveToken('stale-id');
    await pending;
    await p.flush();
    assert.equal(p.store.size, 0);
    assert.equal(p.sent.some(({ data }) => data.source === 'PAGETRACE_AUTH_SUCCESS'), false);
  }
});

test('dashboard rejects external handshake and forged script logout', async () => {
  const p = page('https://page-trace.pages.dev/');
  p.loadDashboard();
  await p.setUser(makeUser());
  const nonce = 'a'.repeat(32);
  p.emit({ source: 'PAGETRACE_PING', nonce }, 'https://evil.example');
  p.emit({ source: 'PAGETRACE_PING', nonce }, undefined, {});
  await p.flush();
  assert.equal(p.sent.length, 0);
  p.loadUserscript();
  await p.flush();
  p.emit({ source: 'PAGETRACE_SCRIPT_LOGOUT', nonce: p.nonce() }, 'https://evil.example');
  p.emit({ source: 'PAGETRACE_SCRIPT_LOGOUT', nonce: p.nonce() }, undefined, {});
  p.emit({ source: 'PAGETRACE_SCRIPT_LOGOUT', nonce: 'old-session' });
  await p.flush();
  assert.equal(p.auth.currentUser.uid, 'alice');
  p.emit({ source: 'PAGETRACE_SCRIPT_LOGOUT', nonce: p.nonce() });
  await p.flush();
  assert.equal(p.store.size, 0);
});

test('Cloudflare, GitHub subpath, legacy Firebase, and fixed localhost development URL are supported', async () => {
  for (const base of ['https://page-trace.pages.dev/', 'https://yuzhounh.github.io/page-trace/',
    'https://page-trace-app.web.app/', 'https://page-trace-app.firebaseapp.com/',
    'http://localhost:3000/']) {
    const p = page(`${base}auth.html`);
    p.loadAuth();
    p.loadUserscript();
    await p.flush();
    await p.setUser(makeUser());
    await p.flush();
    assert.equal(p.store.get('pt_uid'), 'alice', base);
    assert.equal(p.context.api.CONFIG.authAppUrl, `${base}auth.html`);
  }
});
