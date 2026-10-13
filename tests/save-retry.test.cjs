const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const script = fs.readFileSync(require('node:path').join(__dirname, '../pagetrace.user.js'), 'utf8');
const saveCode = script.slice(script.indexOf('async function saveToFirestore('), script.indexOf('// 5. Auth 桥接'));
function client(storage, backend) {
  const context = vm.createContext({
    CONFIG: { uid: 'A', projectId: 'demo', apiKey: 'fixture' },
    refreshIdTokenIfNeeded: async () => 'fixture-token', crypto: webcrypto, Uint8Array,
    GM_getValue: (key, fallback) => storage.get(key) ?? fallback,
    GM_setValue: (key, value) => storage.set(key, structuredClone(value)),
    GM_deleteValue: key => storage.delete(key), GM_xmlhttpRequest: backend,
  });
  vm.runInContext(saveCode + '\nglobalThis.save = saveToFirestore;', context);
  return context;
}
const note = { title: 'Fixture', url: 'https://example.invalid/article', note: 'Draft' };
test('lost success acknowledgement, reload and retry create one note; a new capture creates another', async () => {
  const storage = new Map(), documents = new Map(), ids = [];
  let loseAcknowledgement = true;
  const backend = request => {
    const url = new URL(request.url), id = url.searchParams.get('documentId') || url.pathname.split('/').at(-1);
    if (request.method === 'GET') return request.onload({ status: 200, responseText: JSON.stringify(documents.get(id)) });
    ids.push(id);
    if (documents.has(id)) return request.onload({ status: 409, responseText: '{}' });
    const document = JSON.parse(request.data);
    documents.set(id, document);
    if (loseAcknowledgement) { loseAcknowledgement = false; return request.ontimeout(); }
    request.onload({ status: 200, responseText: JSON.stringify(document) });
  };
  await assert.rejects(client(storage, backend).save(note), /超时/);
  assert.equal(storage.size, 1);
  await client(storage, backend).save(note);
  assert.equal(documents.size, 1);
  assert.equal(ids[0], ids[1]);
  assert.equal(storage.size, 0);
  await client(storage, backend).save(note);
  assert.equal(documents.size, 2);
  assert.notEqual(ids[1], ids[2]);
});
test('a conflicting existing record is verified and never clears the pending draft', async () => {
  const storage = new Map();
  const context = client(storage, request => request.onload({
    status: request.method === 'POST' ? 409 : 200,
    responseText: JSON.stringify({ fields: { title: { stringValue: 'Different content' } } }),
  }));
  await assert.rejects(context.save(note), /已有记录与待提交内容不同/);
  assert.equal(storage.size, 1);
});
test('an account change while renewing identity stops the save before any request', async () => {
  let calls = 0;
  const context = client(new Map(), () => { calls++; });
  context.refreshIdTokenIfNeeded = async () => { context.CONFIG.uid = 'B'; return 'new-token'; };
  await assert.rejects(context.save(note), /登录账户已经改变/);
  assert.equal(calls, 0);
});
