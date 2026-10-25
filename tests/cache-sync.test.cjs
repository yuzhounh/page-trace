const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { JSDOM } = require('jsdom');

const read = file => readFileSync(join(__dirname, '..', file), 'utf8');
const html = read('index.html');
const script = read('pagetrace.user.js');
const dashboardCode = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)]
  .map(match => match[1]).filter(code => code.trim()).at(-1);
const bridgeCode = script.slice(script.indexOf('const TRUSTED_APP_BASE_URLS'), script.indexOf('function createSvgIcon'));
const prefix = 'pagetrace_saved_v1_page-trace-app_alice_';
const makeNote = (id, title = id) => ({ id, title, url: 'https://example.test/article', note: '**Body**',
  source: 'userscript', status: 'inbox', createdAt: new Date().toISOString() });
const makeUser = (uid = 'alice') => ({ uid, email: `${uid}@example.test`, refreshToken: `refresh-${uid}`,
  getIdToken: async () => `token-${uid}` });
const sharedListeners = new WeakMap();

// Execute the complete production dashboard (including its real list renderer)
// with fixture Firebase/GM adapters. No real notes, credentials or network are used.
function page(t, { store = new Map(), cached = [], uid = 'alice', userscript = true,
  url = 'https://page-trace.pages.dev/', dashboard = true, serverNotes = [] } = {}) {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const w = dom.window, queue = [], timers = new Map(), subscriptions = [], frames = [], messages = [], gmReads = [];
  const metrics = { docReads: 0, storageWrites: [] };
  let hidden = false;
  Object.defineProperty(w.document, 'hidden', { configurable: true, get: () => hidden });
  const originalStore = w.Storage.prototype.setItem;
  w.Storage.prototype.setItem = function (key, value) {
    metrics.storageWrites.push(key);
    return originalStore.call(this, key, value);
  };
  let timerId = 0;
  w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  w.scrollTo = () => {};
  w.setTimeout = (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; };
  w.clearTimeout = id => timers.delete(id);
  w.setInterval = w.setTimeout;
  w.clearInterval = w.clearTimeout;
  w.postMessage = (data, origin) => {
    messages.push(data);
    if (origin === w.location.origin) queue.push({ data, origin, source: w });
  };
  const callbacks = [];
  const auth = { currentUser: null, onIdTokenChanged: callback => callbacks.push(callback),
    signOut: async () => { auth.currentUser = null; for (const callback of callbacks) await callback(null); } };
  const backend = new Map([[uid, new Map(serverNotes.map(note => [note.id, structuredClone(note)]))]]);
  const getCalls = [], writes = [], clipboard = [];
  const dataFor = account => { if (!backend.has(account)) backend.set(account, new Map()); return backend.get(account); };
  const docFor = note => ({ id: note.id, exists: true, data: () => {
    metrics.docReads++;
    const { id, serverCreateTime, serverUpdateTime, ...fields } = note;
    return { ...fields, createdAt: note.createdAt ? { toDate: () => new Date(note.createdAt) } : null };
  } });
  function query(account, criteria = [], ordering = null, maximum = null) {
    const select = notes => {
      let result = notes.filter(note => criteria.every(([field, op, value]) => {
        const actual = field === 'createdAt' ? Date.parse(note[field]) : note[field];
        const expected = value instanceof Date || typeof value?.getTime === 'function' ? value.getTime() : value;
        return op === '==' ? actual === expected : op === '>=' ? actual >= expected : actual < expected;
      }));
      if (ordering) result.sort((a, b) => (Date.parse(a[ordering[0]]) - Date.parse(b[ordering[0]])) * (ordering[1] === 'desc' ? -1 : 1));
      return maximum === null ? result : result.slice(0, maximum);
    };
    return {
      where: (field, op, value) => query(account, [...criteria, [field, op, value]], ordering, maximum),
      orderBy: (field, direction) => query(account, criteria, [field, direction], maximum),
      limit: maximum => query(account, criteria, ordering, maximum),
      async get() { getCalls.push({ uid: account, criteria, ordering, maximum }); return { docs: select([...dataFor(account).values()]).map(docFor) }; },
      async add(fields) {
        const id = 'web-note-' + dataFor(account).size;
        const note = { id, ...Object.fromEntries(Object.entries(fields).map(([key, value]) => [key,
          value?.fixtureTimestamp ? new Date().toISOString() : value])) };
        dataFor(account).set(id, note);
        notify(account);
        return this.doc(id);
      },
      onSnapshot(options, next, error) {
        const subscription = { uid: account, next, error, options, criteria, select, active: true };
        subscriptions.push(subscription);
        return () => { subscription.active = false; };
      },
      doc(id) {
        const ref = { uid: account, id,
          async get() { const note = dataFor(account).get(id); return note ? docFor(note) : { exists: false }; },
          async update(fields) {
            const note = dataFor(account).get(id);
            if (!note) throw Error('fixture missing document');
            for (const [key, value] of Object.entries(fields)) {
              if (value?.fixtureDelete) delete note[key];
              else note[key] = value?.fixtureTimestamp ? new Date().toISOString() : value;
            }
            writes.push({ uid: account, id, fields }); notify(account);
          },
          async delete() { dataFor(account).delete(id); writes.push({ uid: account, id, deleted: true }); notify(account); }
        };
        return ref;
      }
    };
  }
  function notify(account) {
    for (const subscription of subscriptions) if (subscription.active && subscription.uid === account) {
      const docs = subscription.select([...dataFor(account).values()]).map(docFor);
      subscription.next({ metadata: { fromCache: false, hasPendingWrites: false }, docs,
        docChanges: () => docs.map(doc => ({ type: 'modified', doc })) });
    }
  }
  const db = { collection: () => ({ doc: account => ({ collection: () => query(account) }) }),
    batch() {
      const refs = [];
      return { delete: ref => refs.push(ref), async commit() {
        for (const ref of refs) { dataFor(ref.uid).delete(ref.id); writes.push({ uid: ref.uid, id: ref.id, deleted: true }); }
        for (const account of new Set(refs.map(ref => ref.uid))) notify(account);
      } };
    } };
  const firebaseAuth = () => auth;
  firebaseAuth.GoogleAuthProvider = function () {};
  w.firebase = { initializeApp() {}, auth: firebaseAuth, firestore: () => db };
  w.firebase.firestore.FieldValue = { serverTimestamp: () => ({ fixtureTimestamp: true }), delete: () => ({ fixtureDelete: true }) };
  w.confirm = () => true;
  Object.defineProperty(w, 'isSecureContext', { value: true });
  Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: async text => clipboard.push(text) } });
  if (cached !== null) {
    w.localStorage.setItem('pagetrace_last_user', JSON.stringify({ uid, email: `${uid}@example.test` }));
    w.localStorage.setItem('pagetrace_notes_cache_' + uid, JSON.stringify(cached));
  }
  for (const file of ['vendor/marked/marked.umd.js', 'vendor/dompurify/purify.min.js',
    'vendor/katex/katex.min.js', 'note-renderer.js']) w.eval(read(file));
  const list = w.document.getElementById('notesList');
  const innerHTML = Object.getOwnPropertyDescriptor(w.Element.prototype, 'innerHTML');
  Object.defineProperty(list, 'innerHTML', {
    get: () => innerHTML.get.call(list),
    set(value) {
      innerHTML.set.call(list, value);
      frames.push([...list.querySelectorAll('[data-id]')].map(row => row.dataset.id));
    }
  });
  if (!sharedListeners.has(store)) sharedListeners.set(store, new Map());
  const listeners = sharedListeners.get(store);
  w.GM_getValue = (key, fallback) => { gmReads.push(key); return store.get(key) ?? fallback; };
  w.GM_setValue = (key, value) => {
    const previous = store.get(key);
    store.set(key, structuredClone(value));
    for (const listener of listeners.values()) if (listener.key === key) listener.callback(key, previous, value, true);
  };
  w.GM_deleteValue = key => store.delete(key);
  w.GM_listValues = () => [...store.keys()];
  w.GM_addValueChangeListener = (key, callback) => {
    const id = Symbol(); listeners.set(id, { key, callback }); return id;
  };
  w.GM_removeValueChangeListener = id => listeners.delete(id);
  const p = { dom, w, store, frames, subscriptions, messages, gmReads, getCalls, writes, clipboard, backend, metrics, fail: false };
  const serverTime = '2026-10-14T09:00:00.123456Z';
  w.GM_xmlhttpRequest = request => {
    if (p.fail) return request.ontimeout();
    request.onload({ status: 200, responseText: JSON.stringify({ ...JSON.parse(request.data),
      createTime: serverTime, updateTime: serverTime }) });
  };
  p.loadUserscript = () => w.eval(bridgeCode + '\nsetupAuthBridgeListener(); window.fixtureSave = saveToFirestore;');
  p.flush = async () => {
    for (let i = 0; i < 20; i++) {
      while (queue.length) w.dispatchEvent(new w.MessageEvent('message', queue.shift()));
      await Promise.resolve();
      w.fixtureUI?.flush();
    }
    assert.equal(queue.length, 0);
  };
  p.login = async (account = uid) => {
    const user = makeUser(account);
    auth.currentUser = user;
    for (const callback of callbacks) await callback(user);
    await p.flush();
  };
  p.timeout = async delay => {
    for (const [id, timer] of [...timers]) if (timer.delay === delay) {
      timers.delete(id); timer.callback();
    }
    await p.flush();
  };
  p.emit = (data, origin = w.location.origin, source = w) => queue.push({ data, origin, source });
  p.snapshot = async (notes, { fromCache = false, pending = false, changes = null, flush = true, subscription = subscriptions.at(-1) } = {}) => {
    if (!fromCache && !pending) for (const note of notes) dataFor(subscription.uid).set(note.id, structuredClone(note));
    const docs = subscription.select(notes).map(docFor);
    subscription.next({ metadata: { fromCache, hasPendingWrites: pending }, docs, size: docs.length,
      docChanges: () => typeof changes === 'function' ? changes(docs) : changes || docs.map(doc => ({ type: 'added', doc })) });
    if (flush) await p.flush();
  };
  p.setHidden = async value => { hidden = value; w.document.dispatchEvent(new w.Event('visibilitychange')); await p.flush(); };
  p.cached = () => ({ version: 2, complete: w.fixtureUI.state().complete,
    notes: JSON.parse(JSON.stringify(w.fixtureUI.state().notes)),
    settledIds: JSON.parse(w.localStorage.getItem(`pagetrace_shared_settled_v3_${uid}`) || '[]') });
  p.reply = async subscription => p.snapshot([...dataFor((subscription || subscriptions.at(-1)).uid).values()], { subscription: subscription || subscriptions.at(-1) });
  p.ids = () => [...list.querySelectorAll('[data-id]')].map(row => row.dataset.id);
  p.save = async (title = 'New note') => {
    const result = await w.fixtureSave({ title, url: 'https://example.test/article', note: '**Saved body**' });
    await p.flush();
    return result;
  };
  if (userscript) p.loadUserscript();
  if (dashboard) w.eval(dashboardCode + `\nwindow.fixtureUI = { selectMonth, selectYear, showTrashModal, hideTrashModal,
    handleCopyFilteredNotes, hideSearchBar, flush: flushPendingNotesWork, state: () => ({ scope: activeNotesScope, loading: notesScopeLoading,
      complete: hasCompleteNotesCache, notes: notesData, trashComplete, trashLoading, trash: trashNotesData }) };`);
  return p;
}

function signedStore() {
  return new Map([['pt_uid', 'alice'], ['pt_id_token', 'fixture-token'],
    ['pt_token_expiry', Date.now() + 3600000]]);
}

test('successful saves in separate pages retain both notes and exact server versions; failure stays pending', async t => {
  const store = signedStore();
  const first = page(t, { store, dashboard: false, url: 'https://example.test/first' });
  const second = page(t, { store, dashboard: false, url: 'https://example.test/second' });
  await Promise.all([first.save('One'), second.save('Two')]);
  const notes = [...store].filter(([key]) => key.startsWith(prefix)).map(([, note]) => note);
  assert.equal(notes.length, 2);
  assert.deepEqual(notes.map(note => note.title).sort(), ['One', 'Two']);
  assert.ok(notes.every(note => note.serverUpdateTime === '2026-10-14T09:00:00.123456Z'));
  second.fail = true;
  await assert.rejects(second.save('Failed'), /超时/);
  assert.equal([...store.keys()].filter(key => key.startsWith(prefix)).length, 2);
  assert.ok([...store.keys()].some(key => key.startsWith('pagetrace_pending_save_')));
});

test('first rendered list includes script saves; identical cloud data preserves actual DOM and server version', async t => {
  const old = makeNote('old'), fresh = makeNote('a'.repeat(32), 'Fresh');
  fresh.serverUpdateTime = '2026-10-14T09:00:00.123456Z';
  const store = signedStore(); store.set(prefix + fresh.id, fresh);
  const p = page(t, { store, cached: [old] });
  await p.flush();
  assert.deepEqual(new Set(p.frames.find(frame => frame.length)), new Set([old.id, fresh.id]));
  await p.login();
  const node = p.w.document.querySelector(`[data-id="${fresh.id}"]`);
  node.classList.add('fixture-open');
  const frameCount = p.frames.length;
  await p.snapshot([], { fromCache: true });
  await p.snapshot([fresh, old]);
  assert.equal(p.frames.length, frameCount);
  assert.equal(p.w.document.querySelector(`[data-id="${fresh.id}"]`), node);
  assert.ok(node.classList.contains('fixture-open'));
  assert.equal(p.cached().notes.find(note => note.id === fresh.id).serverUpdateTime, fresh.serverUpdateTime);
});

test('a save during initial synchronization survives an earlier cloud snapshot and does not duplicate', async t => {
  const old = makeNote('old');
  const p = page(t, { store: signedStore(), cached: [old] });
  await p.flush(); await p.login();
  await p.save();
  const fresh = [...p.store].find(([key]) => key.startsWith(prefix))[1];
  await p.snapshot([old]);
  assert.ok(p.ids().includes(fresh.id));
  const frameCount = p.frames.length;
  await p.snapshot([old, fresh]);
  assert.equal(p.frames.length, frameCount);
  assert.equal(p.ids().filter(id => id === fresh.id).length, 1);
});

test('cloud changes invalidate old version; deleted notes stay deleted after reopening', async t => {
  const fresh = makeNote('b'.repeat(32)); fresh.serverUpdateTime = '2026-10-14T09:00:00.123456Z';
  const store = signedStore(); store.set(prefix + fresh.id, fresh);
  const p = page(t, { store, cached: [] });
  await p.flush(); await p.login();
  await p.snapshot([{ ...fresh, note: 'Edited', updatedAt: new Date().toISOString() }]);
  assert.equal(p.cached().notes[0].serverUpdateTime, undefined);
  await p.snapshot([], { changes: [{ type: 'removed', doc: { id: fresh.id } }] });
  assert.deepEqual(p.ids(), []);
  const reopened = page(t, { store, cached: p.cached() });
  await reopened.flush();
  assert.deepEqual(reopened.ids(), []);
  assert.equal(reopened.w.document.querySelector('.skeleton-item-row'), null);
});

test('an empty complete cache remains an empty state after identical server confirmation', async t => {
  const p = page(t, { store: signedStore() });
  await p.flush(); await p.login();
  const frameCount = p.frames.length;
  await p.snapshot([]);
  assert.equal(p.frames.length, frameCount);
  assert.equal(p.w.document.querySelector('.skeleton-item-row'), null);
});

test('missing userscript waits at most 250ms then loads cloud without flashing the old cache', async t => {
  const old = makeNote('old'), fresh = makeNote('fresh');
  const p = page(t, { userscript: false, cached: [old] });
  await p.login();
  assert.equal(p.subscriptions.length, 0);
  assert.deepEqual(p.ids(), []);
  await p.timeout(250);
  assert.equal(p.subscriptions.length, 1);
  await p.snapshot([fresh]);
  assert.deepEqual(p.ids(), [fresh.id]);
  assert.ok(p.frames.every(frame => !frame.includes(old.id)));
});

test('cloud wait includes delayed login and only server confirmation hides the cache notice without redrawing', async t => {
  const old = makeNote('old');
  const p = page(t, { store: signedStore(), cached: [old] });
  await p.flush();
  const status = p.w.document.getElementById('notesLoadStatus');
  const node = p.w.document.querySelector('[data-id="old"]');
  assert.equal(status.textContent, '同步中…');
  assert.equal(p.subscriptions.length, 0);
  await p.timeout(15000);
  assert.equal(status.textContent, '云端连接暂不可用，当前显示本地缓存');
  assert.equal(p.w.fixtureUI.state().loading, true);
  assert.equal(p.w.document.getElementById('btnCopyAllNotes').disabled, true);
  await p.login();
  await p.snapshot([old], { fromCache: true });
  assert.equal(status.textContent, '云端连接暂不可用，当前显示本地缓存');
  assert.equal(p.w.document.querySelector('[data-id="old"]'), node);
  await p.snapshot([old]);
  assert.equal(status.textContent, '');
  assert.equal(status.style.display, 'none');
  assert.equal(p.w.fixtureUI.state().loading, false);
  assert.equal(p.w.document.getElementById('btnCopyAllNotes').disabled, false);
  assert.equal(p.w.document.querySelector('[data-id="old"]'), node);
  await p.timeout(15000);
  assert.equal(status.style.display, 'none');
});

test('a slow cloud connection falls back to the desktop cache then replaces it on recovery', async t => {
  const old = makeNote('old'), fresh = makeNote('fresh');
  const p = page(t, { userscript: false, cached: [old] });
  await p.login(); await p.timeout(250);
  assert.deepEqual(p.ids(), []);
  await p.timeout(15000);
  assert.deepEqual(p.ids(), [old.id]);
  assert.equal(p.w.document.getElementById('notesLoadStatus').textContent,
    '云端连接暂不可用，当前显示本地缓存');
  await p.snapshot([fresh]);
  assert.deepEqual(p.ids(), [fresh.id]);
  assert.equal(p.w.document.getElementById('notesLoadStatus').style.display, 'none');
});

test('no-cache timeouts are honest and pending writes keep syncing until fully confirmed', async t => {
  const p = page(t, { store: signedStore(), cached: null });
  await p.login();
  const status = p.w.document.getElementById('notesLoadStatus');
  await p.timeout(15000);
  assert.equal(status.textContent, '云端连接暂不可用，暂无本地缓存');
  await p.snapshot([makeNote('pending')], { pending: true });
  assert.equal(status.textContent, '同步中…');
  assert.equal(p.w.fixtureUI.state().loading, true);
  assert.equal(p.w.document.getElementById('btnCopyAllNotes').disabled, true);
  await p.snapshot([]);
  assert.equal(status.style.display, 'none');
  assert.match(p.w.document.querySelector('.notes-empty-message').textContent, /该月份暂无笔记/);
});

test('losing connectivity after sync shows a timed notice and global search stays incomplete until recovery', async t => {
  const old = makeNote('old');
  const p = page(t, { store: signedStore(), cached: [old], serverNotes: [old] });
  await p.flush(); await p.login(); await p.reply();
  const status = p.w.document.getElementById('notesLoadStatus');
  const node = p.w.document.querySelector('[data-id="old"]');
  assert.equal(status.style.display, 'none');
  await p.snapshot([old], { fromCache: true });
  await p.timeout(15000);
  assert.equal(status.textContent, '云端连接暂不可用，当前显示本地缓存');
  assert.equal(p.w.document.querySelector('[data-id="old"]'), node);
  await p.reply();
  assert.equal(status.style.display, 'none');
  keyword(p, 'old'); await p.flush(); await p.timeout(15000);
  assert.equal(status.textContent, '云端连接暂不可用，当前显示本地缓存');
  assert.match(p.w.document.getElementById('searchCountBadge').textContent, /检索中/);
  assert.equal(p.w.document.getElementById('btnCopyAllNotes').disabled, true);
  await p.reply();
  assert.equal(status.style.display, 'none');
  assert.equal(p.w.document.getElementById('searchCountBadge').textContent, '共 1 条');
});

test('month changes, account changes and logout cancel cloud wait notices from earlier scopes', async t => {
  const p = page(t, { store: signedStore(), cached: [makeNote('old')] });
  await p.flush(); await p.login();
  const oldSubscription = p.subscriptions.at(-1);
  const status = p.w.document.getElementById('notesLoadStatus');
  p.w.fixtureUI.selectMonth(p.w.fixtureUI.state().scope.key.endsWith('-01') ? '02' : '01');
  await p.flush(); await p.snapshot([]);
  await p.snapshot([makeNote('late')], { fromCache: true, subscription: oldSubscription });
  await p.timeout(15000);
  assert.equal(status.style.display, 'none');
  await p.login('bob'); await p.snapshot([]); await p.timeout(15000);
  assert.equal(status.style.display, 'none');
  await p.snapshot([], { fromCache: true });
  await p.w.firebase.auth().signOut(); await p.timeout(15000);
  assert.equal(status.style.display, 'none');
});

test('late userscript joins before cloud confirmation; foreign messages and old account callbacks are ignored', async t => {
  const store = signedStore(), fresh = makeNote('c'.repeat(32));
  store.set(prefix + fresh.id, fresh);
  const p = page(t, { userscript: false, store, cached: [] });
  await p.login();
  p.loadUserscript(); await p.flush();
  assert.deepEqual(p.ids(), [fresh.id]);
  const nonce = p.messages.find(message => message.source === 'PAGETRACE_CACHE_REQUEST').nonce;
  p.emit({ source: 'PAGETRACE_CACHE_RESULT', nonce, uid: 'alice', records: [makeNote('d'.repeat(32))] }, 'https://evil.test');
  await p.flush(); assert.deepEqual(p.ids(), [fresh.id]);
  const aliceSubscription = p.subscriptions.at(-1);
  await p.login('bob');
  await p.snapshot([fresh], { subscription: aliceSubscription });
  assert.ok(!p.ids().includes(fresh.id));
  assert.equal(aliceSubscription.active, false);
});

test('ordinary sites and auth pages cannot request the dashboard note cache', async t => {
  const store = signedStore(); store.set(prefix + 'e'.repeat(32), makeNote('e'.repeat(32)));
  for (const url of ['https://evil.test/', 'https://page-trace.pages.dev/other.html', 'https://page-trace.pages.dev/auth.html']) {
    const p = page(t, { store, url, dashboard: false });
    let replies = 0;
    p.w.addEventListener('message', event => { if (event.data.source === 'PAGETRACE_CACHE_RESULT') replies++; });
    p.emit({ source: 'PAGETRACE_CACHE_REQUEST', nonce: 'f'.repeat(32), uid: 'alice' });
    await p.flush();
    assert.equal(replies, 0, url);
  }
});

test('a local SDK deletion cannot be reintroduced by a later cache notification', async t => {
  const old = makeNote('old');
  const p = page(t, { store: signedStore(), cached: [old] });
  await p.flush(); await p.login(); await p.snapshot([old]);
  await p.save();
  const fresh = [...p.store].find(([key]) => key.startsWith(prefix))[1];
  await p.snapshot([old], { fromCache: true, pending: true,
    changes: [{ type: 'removed', doc: { id: fresh.id } }] });
  p.w.GM_setValue('pagetrace_saved_signal_v1_page-trace-app_alice', { id: fresh.id });
  await p.flush();
  assert.ok(!p.ids().includes(fresh.id));
});

test('a cache storage failure does not turn an acknowledged cloud save into a failed upload', async t => {
  const p = page(t, { store: signedStore(), dashboard: false, url: 'https://example.test/article' });
  const write = p.w.GM_setValue;
  p.w.GM_setValue = (key, value) => {
    if (key.startsWith(prefix)) throw Error('fixture storage quota');
    write(key, value);
  };
  await p.save();
  assert.ok(![...p.store.keys()].some(key => key.startsWith('pagetrace_pending_save_')));
});

function datedNote(id, year, month, title = id) {
  return { ...makeNote(id, title), createdAt: new Date(year, month - 1, 15, 12).toISOString() };
}
function keyword(p, value) {
  const input = p.w.document.getElementById('inlineSearchInput');
  if (!p.w.document.getElementById('searchBarContainer').classList.contains('show')) p.w.document.getElementById('openSearchBtn').click();
  input.value = value;
  input.dispatchEvent(new p.w.Event('input', { bubbles: true }));
}

test('12,000-note library starts with a month query and shared cache reads only indexed current-month bodies', async t => {
  const now = new Date(), year = now.getFullYear(), month = now.getMonth() + 1;
  const notes = Array.from({ length: 12000 }, (_, i) => datedNote(i.toString(16).padStart(32, '0'),
    i < 300 ? year : year - 1, i < 300 ? month : 1));
  const store = signedStore();
  for (const note of notes) {
    store.set(prefix + note.id, note);
    store.set(`pagetrace_saved_month_v2_page-trace-app_alice_${note.createdAt.slice(0, 7)}_${note.id}`, true);
  }
  const p = page(t, { store, cached: null, serverNotes: notes });
  await p.login();
  assert.equal(p.subscriptions.length, 1);
  const subscription = p.subscriptions[0];
  assert.deepEqual(subscription.criteria.map(([field, op]) => [field, op]), [['createdAt', '>='], ['createdAt', '<']]);
  assert.equal(p.getCalls.length, 0, 'no historical catalog fetched at startup');
  const cacheReply = p.messages.find(message => message.source === 'PAGETRACE_CACHE_RESULT' && Array.isArray(message.records));
  assert.equal(cacheReply.records.length, 300);
  const readIds = new Set(p.gmReads.filter(key => key.startsWith(prefix)).map(key => key.slice(prefix.length)));
  assert.equal(readIds.size, 300, 'historical note bodies are not read from shared storage');
  await p.reply();
  assert.equal(p.w.fixtureUI.state().notes.length, 300);
  assert.equal(p.ids().length, 50);
  keyword(p, notes.at(-1).title); await p.flush(); await p.reply();
  assert.equal(p.w.fixtureUI.state().notes.length, 12000);
  assert.deepEqual(p.ids(), [notes.at(-1).id]);
  assert.equal(p.w.document.getElementById('searchCountBadge').textContent, '共 1 条');
});

test('calendar leaves unloaded months unknown and can switch through empty months without losing navigation', async t => {
  const now = new Date(), year = now.getFullYear(), month = now.getMonth() + 1;
  const p = page(t, { store: signedStore(), cached: null, serverNotes: [datedNote('current', year, month)] });
  await p.login(); await p.reply();
  const target = new Date(year, month - 2, 1);
  const key = String(target.getMonth() + 1).padStart(2, '0');
  const unknown = p.w.document.querySelector(`#monthDropdownMenu [data-month="${key}"] .nav-count-badge`);
  assert.equal(unknown.textContent, '未加载');
  const old = p.subscriptions.at(-1);
  p.w.fixtureUI.selectYear(String(target.getFullYear()));
  p.w.fixtureUI.selectMonth(key);
  await p.flush();
  assert.equal(old.active, false);
  assert.ok(p.w.document.getElementById('monthNavBar').classList.contains('show'));
  await p.reply();
  assert.equal(p.w.document.querySelector(`#monthDropdownMenu [data-month="${key}"] .nav-count-badge`).textContent, '0 条');
  assert.match(p.w.document.getElementById('notesList').textContent, /该月份暂无笔记/);
  assert.ok(p.w.document.getElementById('monthNavBar').classList.contains('show'));
});

test('rapid month changes ignore late old-month callbacks and reuse a previously loaded month cache', async t => {
  const now = new Date(), y = now.getFullYear(), m = now.getMonth() + 1;
  const oldDate = new Date(y, m - 2, 1), olderDate = new Date(y, m - 3, 1);
  const old = datedNote('old-month', oldDate.getFullYear(), oldDate.getMonth() + 1);
  const older = datedNote('older-month', olderDate.getFullYear(), olderDate.getMonth() + 1);
  const p = page(t, { store: signedStore(), cached: null, serverNotes: [old, older] });
  await p.login(); await p.reply();
  const choose = date => { p.w.fixtureUI.selectYear(String(date.getFullYear())); p.w.fixtureUI.selectMonth(String(date.getMonth() + 1).padStart(2, '0')); };
  choose(oldDate); await p.flush(); const late = p.subscriptions.at(-1);
  choose(olderDate); await p.flush(); await p.reply();
  assert.deepEqual(p.ids(), [older.id]);
  await p.snapshot([old], { subscription: late });
  assert.deepEqual(p.ids(), [older.id]);
  choose(oldDate); await p.flush(); await p.reply();
  choose(olderDate); await p.flush();
  assert.deepEqual(p.ids(), [older.id], 'cached month appears before new server response');
});

test('global search loads history only after a nonempty keyword, reports incompleteness, and restores month', async t => {
  const now = new Date(), current = makeNote('current', 'Current'), historical = datedNote('history', now.getFullYear() - 8, 2, '历史唯一命中');
  const p = page(t, { store: signedStore(), cached: null, serverNotes: [current, historical] });
  await p.login(); await p.reply();
  p.w.document.getElementById('openSearchBtn').click(); await p.flush();
  assert.equal(p.subscriptions.length, 1, 'blank search does not load history');
  keyword(p, '历史唯一'); await p.flush();
  assert.equal(p.subscriptions.at(-1).criteria.length, 0);
  assert.match(p.w.document.getElementById('searchCountBadge').textContent, /检索中/);
  assert.doesNotMatch(p.w.document.getElementById('notesList').textContent, /未找到匹配/);
  assert.equal(p.w.document.getElementById('btnCopyAllNotes').disabled, true);
  const count = p.subscriptions.length;
  keyword(p, '唯一命中'); await p.flush();
  assert.equal(p.subscriptions.length, count, 'changing keywords reuses in-flight full history query');
  await p.reply();
  assert.deepEqual(p.ids(), [historical.id]);
  assert.equal(p.w.document.getElementById('searchCountBadge').textContent, '共 1 条');
  p.w.fixtureUI.hideSearchBar(); await p.flush();
  assert.equal(p.subscriptions.at(-1).criteria.length, 2);
  assert.deepEqual(p.ids(), [current.id]);
  const keys = Array.from({ length: p.w.localStorage.length }, (_, i) => p.w.localStorage.key(i));
  assert.ok(!keys.some(key => key === 'pagetrace_scope_v3_alice_all'), 'full search corpus is not persisted into startup storage');
});

test('copy waits for a complete scope and copies all 300 month notes rather than the 50 displayed', async t => {
  const notes = Array.from({ length: 300 }, (_, i) => makeNote(`id-${i}`, `完整复制 ${i}`));
  const p = page(t, { store: signedStore(), cached: null, serverNotes: notes });
  await p.login();
  await p.w.fixtureUI.handleCopyFilteredNotes();
  assert.equal(p.clipboard.length, 0);
  await p.reply();
  assert.equal(p.ids().length, 50);
  await p.w.fixtureUI.handleCopyFilteredNotes();
  assert.equal(p.clipboard.length, 1);
  for (const note of notes) assert.ok(p.clipboard[0].includes(note.title));
});

test('trash queries all deleted months; restoring an old note updates its cached month and clearing removes all trash', async t => {
  const now = new Date(), prior = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const historical = { ...datedNote('deleted-old', prior.getFullYear(), prior.getMonth() + 1), isDeleted: true, deletedAt: new Date().toISOString() };
  const other = { ...datedNote('deleted-older', now.getFullYear() - 4, 3), isDeleted: true, deletedAt: new Date().toISOString() };
  const p = page(t, { store: signedStore(), cached: null, serverNotes: [historical, other] });
  await p.login(); await p.reply();
  p.w.fixtureUI.selectYear(String(prior.getFullYear())); p.w.fixtureUI.selectMonth(String(prior.getMonth() + 1).padStart(2, '0'));
  await p.flush(); await p.reply();
  p.w.document.getElementById('btnToday').click(); await p.flush(); await p.reply();
  p.w.fixtureUI.showTrashModal(); await p.flush();
  const trash = p.subscriptions.at(-1);
  assert.deepEqual(trash.criteria, [['isDeleted', '==', true]]);
  assert.match(p.w.document.getElementById('trashCountBadge').textContent, /加载中/);
  assert.equal(p.w.document.getElementById('btnClearTrash').disabled, true);
  await p.reply(trash);
  assert.equal(p.w.fixtureUI.state().trash.length, 2);
  await p.w.restoreFromTrash(historical.id); await p.flush();
  p.w.fixtureUI.hideTrashModal();
  p.w.fixtureUI.selectYear(String(prior.getFullYear())); p.w.fixtureUI.selectMonth(String(prior.getMonth() + 1).padStart(2, '0'));
  await p.flush();
  assert.deepEqual(p.ids(), [historical.id], 'restored old note is in the cached month immediately');
  p.w.fixtureUI.showTrashModal(); await p.flush(); await p.reply();
  await p.w.clearAllTrash(); await p.flush();
  assert.ok(!p.backend.get('alice').has(other.id));
  assert.ok(p.backend.get('alice').has(historical.id));
  assert.ok(p.getCalls.some(call => JSON.stringify(call.criteria) === JSON.stringify([['isDeleted', '==', true]])));
});

test('month boundaries use local time and next-month start is exclusive', async t => {
  const start = new Date(2026, 9, 1).getTime(), end = new Date(2026, 10, 1).getTime();
  const notes = [start - 1, start, end - 1, end].map((time, i) => ({ ...makeNote('boundary-' + i), createdAt: new Date(time).toISOString() }));
  const p = page(t, { store: signedStore(), cached: null, serverNotes: notes });
  await p.login(); p.w.fixtureUI.selectYear('2026'); p.w.fixtureUI.selectMonth('10'); await p.flush();
  const subscription = p.subscriptions.at(-1);
  assert.equal(subscription.criteria[0][2].getTime(), start);
  assert.equal(subscription.criteria[1][2].getTime(), end);
  await p.reply();
  assert.deepEqual(new Set(p.ids()), new Set(['boundary-1', 'boundary-2']));
});

test('global load errors leave incomplete search results and copying disabled', async t => {
  const p = page(t, { store: signedStore(), cached: null, serverNotes: [makeNote('current')] });
  await p.login(); await p.reply(); keyword(p, 'current'); await p.flush();
  p.subscriptions.at(-1).error(Error('fixture connection failed')); await p.flush();
  await p.timeout(15000);
  assert.match(p.w.document.getElementById('notesLoadStatus').textContent, /加载失败/);
  assert.match(p.w.document.getElementById('searchCountBadge').textContent, /加载失败/);
  assert.equal(p.w.document.getElementById('btnCopyAllNotes').disabled, true);
  await p.w.fixtureUI.handleCopyFilteredNotes();
  assert.equal(p.clipboard.length, 0);
});

test('legacy full cache migrates into month partitions and an uncached month does not reread the corpus', async t => {
  const now = new Date(), current = makeNote('current'), historical = datedNote('legacy-old', now.getFullYear() - 5, 2);
  const p = page(t, { store: signedStore(), cached: [current, historical], serverNotes: [current, historical] });
  await p.flush(); await p.login(); await p.reply();
  assert.equal(p.w.localStorage.getItem('pagetrace_notes_cache_alice'), null);
  assert.equal(p.w.localStorage.getItem('pagetrace_scope_migrated_v3_alice'), 'true');
  p.w.fixtureUI.selectYear(String(now.getFullYear() - 5)); p.w.fixtureUI.selectMonth('02'); await p.flush();
  assert.deepEqual(p.ids(), [historical.id]);
  assert.ok(p.w.fixtureUI.state().complete);
});

test('an old userscript save without a month index still enters the active shared cache', async t => {
  const p = page(t, { store: signedStore(), cached: null });
  await p.login(); await p.reply();
  const legacy = makeNote('f'.repeat(32), 'Legacy capture');
  p.w.GM_setValue(prefix + legacy.id, legacy);
  p.w.GM_setValue('pagetrace_saved_signal_v1_page-trace-app_alice', { id: legacy.id });
  await p.flush();
  assert.deepEqual(p.ids(), [legacy.id]);
  assert.ok(p.store.has(`pagetrace_saved_month_v2_page-trace-app_alice_${legacy.createdAt.slice(0, 7)}_${legacy.id}`));
});

test('creating a web note while viewing history updates the cached current month before switching back', async t => {
  const p = page(t, { store: signedStore(), cached: null });
  await p.login(); await p.reply();
  p.w.document.getElementById('btnPrevMonth').click(); await p.flush(); await p.reply();
  p.w.document.getElementById('createTitle').value = 'New current month note';
  p.w.document.getElementById('createNoteInput').value = 'Saved in history view';
  p.w.document.getElementById('btnSubmitCreate').click(); await p.flush();
  assert.deepEqual(p.ids(), [], 'new current-month note does not leak into historical month');
  p.w.document.getElementById('btnToday').click(); await p.flush();
  assert.deepEqual(p.ids(), ['web-note-0']);
  const state = p.w.fixtureUI.state();
  const stored = JSON.parse(p.w.localStorage.getItem(`pagetrace_scope_v3_alice_${state.scope.key}`));
  assert.equal(typeof stored.notes[0].createdAt, 'string');
});

test('editing a historical search hit persists the correct month and deleting it cannot return from old shared records', async t => {
  const now = new Date(), prior = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const note = datedNote('a'.repeat(32), prior.getFullYear(), prior.getMonth() + 1, 'Editable history');
  note.serverUpdateTime = '2026-10-14T09:00:00.123456Z';
  const store = signedStore(); store.set(prefix + note.id, note);
  const p = page(t, { store, cached: null, serverNotes: [note] });
  await p.login(); await p.reply();
  p.w.fixtureUI.selectYear(String(prior.getFullYear())); p.w.fixtureUI.selectMonth(String(prior.getMonth() + 1).padStart(2, '0'));
  await p.flush(); await p.reply();
  keyword(p, 'Editable'); await p.flush(); await p.reply();
  p.w.openEditModal(note.id);
  p.w.document.getElementById('editTitle').value = 'Edited historical title';
  p.w.document.getElementById('btnSaveEdit').click(); await p.flush();
  p.w.fixtureUI.hideSearchBar(); await p.flush();
  assert.match(p.w.document.getElementById('notesList').textContent, /Edited historical title/);
  const current = p.w.fixtureUI.state();
  const stored = JSON.parse(p.w.localStorage.getItem(`pagetrace_scope_v3_alice_${current.scope.key}`));
  assert.equal(stored.notes[0].title, 'Edited historical title');
  assert.equal(typeof stored.notes[0].createdAt, 'string');
  await p.w.moveToTrash(note.id); await p.flush();
  assert.deepEqual(p.ids(), []);
  p.w.fixtureUI.showTrashModal(); await p.flush(); await p.reply();
  await p.w.restoreFromTrash(note.id); await p.flush();
  assert.deepEqual(p.ids(), [note.id]);
  assert.equal(p.cached().notes[0].serverUpdateTime ?? null, null);
});

test('clearing more than a batch of trash spans all months and preserves active notes', async t => {
  const now = new Date(), active = makeNote('active');
  const deleted = Array.from({ length: 405 }, (_, i) => ({ ...datedNote('trash-' + i, now.getFullYear() - i % 5, i % 12 + 1),
    isDeleted: true, deletedAt: new Date().toISOString() }));
  const p = page(t, { store: signedStore(), cached: null, serverNotes: [active, ...deleted] });
  await p.login(); await p.reply(); p.w.fixtureUI.showTrashModal(); await p.flush(); await p.reply();
  await p.w.clearAllTrash(); await p.flush();
  assert.equal(p.backend.get('alice').size, 1);
  assert.ok(p.backend.get('alice').has(active.id));
  assert.equal(p.writes.filter(write => write.deleted).length, 405);
  assert.equal(p.w.document.getElementById('btnClearTrash').disabled, true);
});

test('changing accounts while delete confirmation is open never deletes the previous or new account notes', async t => {
  const note = { ...makeNote('protected'), isDeleted: true };
  const p = page(t, { store: signedStore(), cached: null, serverNotes: [note] });
  await p.login(); await p.reply();
  let finish;
  p.w.PageTraceTouchUI = { confirm: () => new Promise(resolve => { finish = resolve; }) };
  const deleting = p.w.permanentDeleteNote(note.id);
  await p.login('bob'); finish(true); await deleting; await p.flush();
  assert.equal(p.writes.length, 0);
  assert.ok(p.backend.get('alice').has(note.id));
});

test('1000-note metadata snapshots do no body reads, cache writes or row rebuilds; one delta reads one document', async t => {
  const notes = Array.from({ length: 1000 }, (_, i) => ({ ...makeNote('perf-' + i, 'Note ' + i), note: 'body '.repeat(80) }));
  const p = page(t, { store: signedStore(), serverNotes: notes });
  await p.login(); await p.reply();
  const node = p.w.document.querySelector('.note-item-row[data-id]');
  const visibleId = node.dataset.id;
  const frames = p.frames.length;
  p.metrics.docReads = 0; p.metrics.storageWrites.length = 0;
  for (let i = 0; i < 20; i++) await p.snapshot(notes, { changes: [] });
  assert.equal(p.metrics.docReads, 0);
  assert.equal(p.metrics.storageWrites.filter(key => key.startsWith('pagetrace_scope_v3_')).length, 0);
  assert.equal(p.frames.length, frames);
  assert.equal(p.w.document.querySelector(`[data-id="${visibleId}"]`), node);
  const next = notes.map(note => note.id === visibleId ? { ...note, title: 'Changed once' } : note);
  await p.snapshot(next, { changes: docs => [{ type: 'modified', doc: docs.find(doc => doc.id === visibleId) }] });
  assert.equal(p.metrics.docReads, 1);
  assert.equal(p.metrics.storageWrites.filter(key => key.startsWith('pagetrace_scope_v3_')).length, 1);
  assert.equal(p.frames.length, frames + 1);
  assert.match(p.w.document.getElementById('notesList').textContent, /Changed once/);
});

test('bursts coalesce to one cache write and render; hidden pages persist but render latest data only on return', async t => {
  const first = makeNote('burst-a'), second = makeNote('burst-b');
  const p = page(t, { store: signedStore(), serverNotes: [first, second] });
  await p.login(); await p.reply();
  const frames = p.frames.length;
  p.metrics.storageWrites.length = 0;
  const a = { ...first, title: 'Latest A' }, b = { ...second, title: 'Latest B' };
  await p.snapshot([a, second], { flush: false, changes: docs => [{ type: 'modified', doc: docs.find(doc => doc.id === a.id) }] });
  await p.snapshot([a, b], { flush: false, changes: docs => [{ type: 'modified', doc: docs.find(doc => doc.id === b.id) }] });
  assert.equal(p.frames.length, frames);
  await p.timeout(60);
  assert.equal(p.frames.length, frames + 1);
  assert.equal(p.metrics.storageWrites.filter(key => key.startsWith('pagetrace_scope_v3_')).length, 1);
  await p.setHidden(true);
  const hiddenFrames = p.frames.length;
  const newest = { ...a, title: 'While hidden' };
  await p.snapshot([newest, b], { changes: docs => [{ type: 'modified', doc: docs.find(doc => doc.id === a.id) }] });
  assert.equal(p.frames.length, hiddenFrames);
  const state = p.w.fixtureUI.state();
  const cached = JSON.parse(p.w.localStorage.getItem(`pagetrace_scope_v3_alice_${state.scope.key}`));
  assert.equal(cached.notes.find(note => note.id === a.id).title, 'While hidden');
  await p.setHidden(false);
  assert.equal(p.frames.length, hiddenFrames + 1);
  assert.match(p.w.document.getElementById('notesList').textContent, /While hidden/);
});

test('cache-pending changes survive metadata-only acknowledgement and reconnect re-establishes authoritative content', async t => {
  const note = makeNote('pending-delta', 'Before');
  const p = page(t, { store: signedStore(), serverNotes: [note] });
  await p.login(); await p.reply();
  const updated = { ...note, title: 'Local pending edit' };
  await p.snapshot([updated], { fromCache: true, pending: true, changes: docs => [{ type: 'modified', doc: docs[0] }] });
  await p.snapshot([updated], { changes: [] });
  assert.equal(p.cached().notes[0].title, updated.title);
  const recovered = { ...updated, title: 'Recovered server content' };
  await p.snapshot([recovered], { fromCache: true, changes: [] });
  assert.equal(p.cached().notes[0].title, updated.title);
  await p.snapshot([recovered], { changes: [] });
  assert.equal(p.cached().notes[0].title, recovered.title);
});

test('a failed body-cache write retries on the next status snapshot and stops retrying after recovery', async t => {
  const note = makeNote('retry-cache');
  const p = page(t, { store: signedStore(), serverNotes: [note] });
  await p.login(); await p.reply();
  const original = p.w.Storage.prototype.setItem;
  let failing = true;
  p.w.Storage.prototype.setItem = function (key, value) {
    if (failing && key.startsWith('pagetrace_scope_v3_')) throw Error('quota fixture');
    return original.call(this, key, value);
  };
  const updated = { ...note, title: 'Needs durable cache' };
  await p.snapshot([updated], { changes: docs => [{ type: 'modified', doc: docs[0] }] });
  failing = false; p.metrics.storageWrites.length = 0;
  await p.snapshot([updated], { changes: [] });
  const key = `pagetrace_scope_v3_alice_${p.w.fixtureUI.state().scope.key}`;
  assert.equal(JSON.parse(p.w.localStorage.getItem(key)).notes[0].title, updated.title);
  assert.equal(p.metrics.storageWrites.filter(name => name === key).length, 1);
  p.metrics.storageWrites.length = 0;
  await p.snapshot([updated], { changes: [] });
  assert.equal(p.metrics.storageWrites.filter(name => name === key).length, 0);
});

test('revisiting a cached month refreshes its LRU metadata without rewriting the body', async t => {
  const now = new Date(), prior = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const current = makeNote('current-lru'), older = datedNote('older-lru', prior.getFullYear(), prior.getMonth() + 1);
  const p = page(t, { store: signedStore(), serverNotes: [current, older] });
  await p.login(); await p.reply();
  const currentScope = p.w.fixtureUI.state().scope.key;
  p.w.fixtureUI.selectYear(String(prior.getFullYear()));
  p.w.fixtureUI.selectMonth(String(prior.getMonth() + 1).padStart(2, '0'));
  await p.flush(); await p.reply();
  p.metrics.storageWrites.length = 0;
  p.w.fixtureUI.selectYear(String(now.getFullYear()));
  p.w.fixtureUI.selectMonth(String(now.getMonth() + 1).padStart(2, '0'));
  await p.flush();
  const index = JSON.parse(p.w.localStorage.getItem('pagetrace_scope_index_v3_alice'));
  assert.equal(index[0].key, `pagetrace_scope_v3_alice_${currentScope}`);
  assert.equal(p.metrics.storageWrites.filter(key => key.startsWith('pagetrace_scope_v3_')).length, 0);
});

test('userscript keeps only current and previous month copies and prunes after replying without reading old bodies', async t => {
  const now = new Date(), prior = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const recent = datedNote('1'.repeat(32), now.getFullYear(), now.getMonth() + 1, 'Recent capture');
  const previous = datedNote('2'.repeat(32), prior.getFullYear(), prior.getMonth() + 1, 'Previous month capture');
  const old = datedNote('3'.repeat(32), now.getFullYear() - 2, 3, 'Old capture');
  const index = note => `pagetrace_saved_month_v2_page-trace-app_alice_${note.createdAt.slice(0, 7)}_${note.id}`;
  const store = signedStore();
  for (const note of [recent, previous, old]) { store.set(prefix + note.id, note); store.set(index(note), true); }
  const p = page(t, { store, cached: null, serverNotes: [recent, previous, old] });
  await p.login(); await p.reply();
  assert.deepEqual(p.ids(), [recent.id]);
  for (const note of [recent, previous]) assert.ok(p.store.has(prefix + note.id) && p.store.has(index(note)));
  assert.equal(p.store.has(prefix + old.id), false);
  assert.equal(p.store.has(index(old)), false);
  assert.equal(p.gmReads.includes(prefix + old.id), false, 'old bodies are pruned by month index only');
  const later = datedNote('4'.repeat(32), now.getFullYear() - 2, 4, 'Late old capture');
  p.w.GM_setValue(prefix + later.id, later); p.w.GM_setValue(index(later), true);
  p.w.GM_setValue('pagetrace_saved_signal_v1_page-trace-app_alice', { id: recent.id });
  await p.flush();
  assert.equal(p.store.has(prefix + later.id), false, 'the next reply prunes copies that became old');
  assert.ok(p.store.has(prefix + recent.id));
});

test('a full-scope cache reply forgets settled IDs whose shared copies no longer exist', async t => {
  const now = new Date();
  const kept = datedNote('5'.repeat(32), now.getFullYear(), now.getMonth() + 1, 'Kept capture');
  const store = signedStore();
  store.set(prefix + kept.id, kept);
  store.set(`pagetrace_saved_month_v2_page-trace-app_alice_${kept.createdAt.slice(0, 7)}_${kept.id}`, true);
  const p = page(t, { store, cached: null, serverNotes: [kept] });
  p.w.localStorage.setItem('pagetrace_shared_settled_v3_alice', JSON.stringify(['6'.repeat(32), '7'.repeat(32)]));
  await p.login(); await p.reply();
  assert.deepEqual(p.cached().settledIds.sort(), ['5'.repeat(32), '6'.repeat(32), '7'.repeat(32)],
    'a month reply cannot tell whether other copies still exist');
  keyword(p, 'Kept'); await p.flush(); await p.reply();
  assert.deepEqual(p.cached().settledIds, [kept.id]);
  assert.deepEqual(p.ids(), [kept.id]);
});
