const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const code = fs.readFileSync(path.join(__dirname, '../android-bridge.js'), 'utf8');
function setup(initialDraft, native = true) {
  const storage = new Map(initialDraft ? [['pagetrace_android_draft_v1', JSON.stringify(initialDraft)]] : []);
  const field = () => ({ value: '', addEventListener(name, fn) { this[name] = fn; } });
  const messages = [];
  const ctx = { window: {}, createTitle: field(), createUrl: field(), createNoteInput: field(),
    btnSubmitCreate: { disabled: false }, confirm: () => true, alert: message => { ctx.error = message; },
    document: { addEventListener() {} }, localStorage: {
      getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key)
    }, showCreateModal: () => { ctx.open = true; }, hideCreateModal: () => { ctx.open = false; },
    createModal: { classList: { contains: () => ctx.open } }, showUndoToast: () => { ctx.saved = true; },
    firebase: { auth: { GoogleAuthProvider: { credential: token => ({ token }) } } },
    auth: { signInWithCredential: async credential => { ctx.credential = credential; } }
  };
  if (native) ctx.window.PageTraceNative = { postMessage: message => messages.push(message) };
  vm.runInNewContext(code, ctx);
  return { ctx, app: ctx.window.PageTraceAndroid, storage, messages };
}
test('ordinary web pages do not activate native login', () => assert.equal(setup(null, false).app, undefined));
test('shared link, title and surrounding text open an editable draft; content is never executed', () => {
  const { ctx, app } = setup();
  assert.equal(app.receive({ text: '推荐 https://example.com/article?q=1\n稍后读 <script>alert(1)</script>', title: '文章' }), true);
  assert.equal(ctx.createUrl.value, 'https://example.com/article?q=1');
  assert.equal(ctx.createTitle.value, '文章');
  assert.match(ctx.createNoteInput.value, /<script>/);
  assert.equal(ctx.open, true);
});
test('cold launch restores edited draft; cancelling replacement preserves it', () => {
  const { ctx, app } = setup({ title: '草稿', url: 'https://old.example', note: '未保存备注' });
  ctx.confirm = () => false;
  app.receive({ text: 'https://new.example' });
  assert.equal(ctx.createNoteInput.value, '未保存备注');
  assert.equal(ctx.createUrl.value, 'https://old.example');
  assert.equal(app.back(), true);
  assert.equal(ctx.open, false);
});
test('new share waits during cloud write; saved confirmation clears draft', () => {
  const { ctx, app, storage, messages } = setup({ note: '正在保存' });
  ctx.btnSubmitCreate.disabled = true;
  assert.equal(app.receive({ text: 'https://new.example' }), false);
  assert.equal(ctx.createNoteInput.value, '正在保存');
  app.saved();
  assert.equal(storage.size, 0);
  assert.equal(ctx.saved, true);
  app.idle();
  assert.deepEqual(messages, ['ready', 'ready']);
});
test('native login exchanges Google credential with existing Firebase auth and retains draft', async () => {
  const { ctx, app, messages } = setup({ note: '我的备注' });
  app.signIn();
  assert.equal(messages.at(-1), 'signIn');
  await app.signedIn('fixture-token');
  assert.equal(ctx.credential.token, 'fixture-token');
  assert.equal(ctx.createNoteInput.value, '我的备注');
});

function savingFixture() {
  const { ctx } = setup();
  ctx.createTitle.value = '测试标题';
  ctx.createUrl.value = 'https://example.com';
  ctx.createNoteInput.value = '测试备注';
  ctx.currentUser = { uid: 'fixture-user' };
  ctx.navigator = { onLine: true };
  ctx.resolveNoteFields = async (title, url, note) => ({ title, url, note });
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../note-renderer.js'), 'utf8'), ctx);
  ctx.PageTraceNotes = ctx.window.PageTraceNotes;
  ctx.autoResizeTextarea = () => {};
  ctx.firebase.firestore = { FieldValue: { serverTimestamp: () => 'server-time' } };
  ctx.writes = [];
  ctx.db = { collection(name) {
    assert.equal(name, 'users');
    return { doc(uid) {
      assert.equal(uid, 'fixture-user');
      return { collection(name) {
        assert.equal(name, 'notes');
        return { add: async note => { ctx.writes.push(note); if (ctx.fail) throw Error('offline'); } };
      } };
    } };
  } };
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const start = html.indexOf('    async function handleCreateSubmit()');
  const end = html.indexOf("    btnSubmitCreate.addEventListener", start);
  vm.runInNewContext(html.slice(start, end), ctx);
  return ctx;
}
test('save writes once to the existing user notes collection and confirms only after success', async () => {
  const ctx = savingFixture();
  await Promise.all([ctx.handleCreateSubmit(), ctx.handleCreateSubmit()]);
  assert.equal(ctx.writes.length, 1);
  assert.equal(ctx.writes[0].source, 'android_share');
  assert.equal(ctx.writes[0].status, 'inbox');
  assert.equal(ctx.writes[0].note, '测试备注');
  assert.equal(ctx.createNoteInput.value, '');
  assert.equal(ctx.saved, true);
});
test('failed cloud write preserves editable draft and never shows saved confirmation', async () => {
  const ctx = savingFixture();
  ctx.fail = true;
  await ctx.handleCreateSubmit();
  assert.equal(ctx.createNoteInput.value, '测试备注');
  assert.equal(ctx.createNoteInput.readOnly, false);
  assert.equal(ctx.btnSubmitCreate.disabled, false);
  assert.equal(ctx.saved, undefined);
  assert.match(ctx.error, /保存失败/);
});
test('offline and account-switching saves do not write into the wrong account', async () => {
  const ctx = savingFixture();
  ctx.navigator.onLine = false;
  await ctx.handleCreateSubmit();
  assert.equal(ctx.writes.length, 0);
  ctx.navigator.onLine = true;
  ctx.resolveNoteFields = async () => { ctx.currentUser = { uid: 'different-user' }; return {}; };
  await ctx.handleCreateSubmit();
  assert.equal(ctx.writes.length, 0);
  assert.match(ctx.error, /账号已切换/);
});
