const { test } = require('node:test');
const assert = require('node:assert/strict');
const Calendar = require('../calendar-counts.js');

function fixture() {
  const notes = [
    { id: 'old', createdAt: '2013-05-01T00:00:00Z' },
    { id: 'old-trash', createdAt: '2013-05-02T00:00:00Z', isDeleted: true },
    { id: 'boundary', createdAt: '2013-12-31T18:00:00Z' },
    { id: 'restore', createdAt: '2020-02-01T00:00:00Z', isDeleted: true },
    { id: 'current', createdAt: new Date().toISOString(), isDeleted: false }
  ];
  let user = { uid: 'alice', getIdToken: async () => 'fixture-token' }, remote = null, failAfter = Infinity;
  const store = new Map(), calls = [], writes = [], summaryReads = [];
  let summaryGate = null, releaseSummary = null;
  const encode = value => typeof value === 'number' ? { integerValue: String(value) } : typeof value === 'boolean' ? { booleanValue: value }
    : typeof value === 'string' ? { stringValue: value } : { mapValue: { fields: Object.fromEntries(Object.entries(value || {}).map(([k, v]) => [k, encode(v)])) } };
  const storage = { getItem: key => store.get(key) || null, setItem: (key, value) => store.set(key, value) };
  const makeRef = account => ({ account, async get() { return { exists: !!remote && remote.uid === account, data: () => structuredClone(remote) }; } });
  const db = { collection: collection => { assert.equal(collection, 'users'); return { doc: account => ({
    collection: collection => { assert.equal(collection, 'calendarCounts'); return { doc: () => makeRef(account) }; }
  }) }; }, async runTransaction(callback) {
    return callback({ get: doc => doc.get(), set(doc, value) { writes.push({ uid: doc.account, value: structuredClone(value) }); remote = structuredClone(value); } });
  } };
  const snapshotTime = '2026-10-28T08:30:00.000000Z';
  async function fetcher(url, options) {
    if (options.method === 'GET') {
      summaryReads.push(url);
      const account = user.uid;
      if (summaryGate) await summaryGate;
      const found = remote?.uid === account;
      return { ok: found, status: found ? 200 : 404, json: async () => found ? { fields: encode(remote).mapValue.fields } : {} };
    }
    const body = JSON.parse(options.body), query = body.structuredQuery || body.structuredAggregationQuery.structuredQuery;
    calls.push({ url, body });
    if (calls.length > failAfter) return { ok: false, status: 429, json: async () => ({ error: { message: 'Quota exceeded' } }) };
    assert.ok(url.includes(`/users/${user.uid}:`));
    let selected = [...notes];
    if (query.where?.fieldFilter) selected = selected.filter(n => n.isDeleted === true);
    if (query.where?.compositeFilter) {
      const [start, end] = query.where.compositeFilter.filters.map(f => Date.parse(f.fieldFilter.value.timestampValue));
      selected = selected.filter(n => Date.parse(n.createdAt) >= start && Date.parse(n.createdAt) < end);
    }
    if (query.orderBy) selected.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    if (query.orderBy?.[0].direction === 'DESCENDING') selected.reverse();
    if (query.limit) selected = selected.slice(0, query.limit);
    const rows = body.structuredAggregationQuery ? [{ readTime: snapshotTime, result: { aggregateFields: { n: { integerValue: String(selected.length) } } } }]
      : selected.length ? selected.map(n => ({ readTime: snapshotTime, document: { fields: { createdAt: { timestampValue: n.createdAt } } } })) : [{ readTime: snapshotTime }];
    return { ok: true, json: async () => rows };
  }
  const manager = Calendar.create({ projectId: 'fixture', storage, fetch: fetcher,
    getUser: () => user, getDb: () => db, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
  return { manager, notes, store, calls, writes, summaryReads, storage, db, fetcher,
    pauseSummary() { summaryGate = new Promise(resolve => { releaseSummary = resolve; }); },
    resumeSummary() { releaseSummary?.(); summaryGate = null; }, get user() { return user; },
    set user(value) { user = value; }, get remote() { return remote; }, set remote(value) { remote = value; },
    failAfter: value => { failAfter = value; } };
}

test('aggregation counts missing deletion flags, excludes trash, uses local month boundaries and saves complete totals', async () => {
  const f = fixture();
  await f.manager.connect(f.user);
  assert.equal(f.manager.state().error, undefined);
  assert.equal(f.manager.known('all', 'all'), 3);
  assert.equal(f.manager.known('2013', '05'), 1);
  const boundaryMonth = Calendar.monthOf(f.notes[2]);
  assert.equal(f.manager.known(boundaryMonth.slice(0, 4), boundaryMonth.slice(5)), 1);
  assert.equal(f.manager.known('2020', '02'), 0);
  assert.equal(f.remote.complete, true);
  assert.equal(Object.values(f.remote.years).reduce((a, b) => a + b, 0), f.remote.total);
  assert.ok(f.calls.filter(c => c.body.structuredQuery).every(c => c.body.structuredQuery.select.fields[0].fieldPath === 'createdAt'));
  assert.ok(f.calls.filter(c => c.body.readTime).every(c => c.body.readTime === '2026-10-28T08:30:00.000000Z'));
});

test('reload reuses historical summary and only refreshes current month', async () => {
  const f = fixture(); await f.manager.connect(f.user);
  const before = f.calls.length;
  f.manager.disconnect(); await f.manager.connect(f.user);
  assert.equal(f.calls.length - before, 3, 'one total, projected trash, one current-month count');
  assert.equal(f.manager.known('2013', '05'), 1);
});

test('trash, restore and additions refresh affected months; ordinary content edits do not invalidate', async () => {
  const f = fixture(); await f.manager.connect(f.user);
  const old = { ...f.notes[0] };
  f.notes[0].isDeleted = true;
  f.manager.changed(old, f.notes[0]);
  assert.equal(f.manager.known('2013', '05'), 1, 'retain last known count while its replacement is fetched');
  await f.manager.refresh(['2013-05']);
  assert.equal(f.manager.known('2013', '05'), 0);
  f.notes[0].isDeleted = false;
  await f.manager.refresh(['2013-05']);
  assert.equal(f.manager.known('2013', '05'), 1);
  f.manager.changed(f.notes[0], { ...f.notes[0], title: 'Edited' });
  assert.equal(f.manager.known('2013', '05'), 1);
  f.notes.push({ id: 'new', createdAt: '2013-05-03T00:00:00Z' });
  await f.manager.refresh(['2013-05']);
  assert.equal(f.manager.known('2013', '05'), 2);
  f.manager.disconnect();
});

test('quota stops without a retry loop and partial months stay unknown across reconnect', async () => {
  const f = fixture(); f.failAfter(7); await f.manager.connect(f.user);
  assert.match(f.manager.state().error, /Quota/);
  assert.equal(f.manager.known('all', 'all'), null);
  const before = f.calls.length;
  await f.manager.refresh();
  assert.equal(f.calls.length, before);
  f.manager.disconnect(); await f.manager.connect(f.user);
  assert.equal(f.calls.length, before, 'saved quota marker suppresses same-day queries');
});

test('account change rejects late responses and keeps cached summaries isolated', async () => {
  const f = fixture(); await f.manager.connect(f.user);
  f.user = { uid: 'bob' }; await f.manager.connect(f.user);
  assert.equal(f.manager.known('2013', '05'), null);
  f.user = { uid: 'alice' }; await f.manager.connect(f.user);
  assert.equal(f.manager.known('2013', '05'), 1);
  assert.ok([...f.store.keys()].some(k => k.includes('_alice_')));
  assert.ok(!f.writes.some(w => w.uid === 'bob'));
  const delayed = Calendar.create({ projectId: 'fixture', storage: f.storage, getUser: () => f.user,
    getDb: () => f.db, fetch: async () => { f.user = { uid: 'bob' }; return { ok: true, json: async () => [] }; } });
  f.user = { uid: 'alice', getIdToken: async () => 'fixture' };
  await delayed.connect(f.user);
  assert.equal(delayed.state()?.uid, 'alice');
  assert.ok(!f.writes.some(w => w.uid === 'bob'));
});

test('cold login preloads the whole summary before any body or aggregation query, while warm cache remains immediate', async () => {
  const f = fixture(); await f.manager.connect(f.user); f.manager.disconnect();
  const before = f.calls.length;
  const coldStore = new Map();
  const cold = Calendar.create({ projectId: 'fixture', storage: { getItem: k => coldStore.get(k), setItem: (k, v) => coldStore.set(k, v) },
    fetch: f.fetcher, getUser: () => f.user, getDb: () => f.db });
  f.pauseSummary();
  const connecting = cold.connect(f.user);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(f.summaryReads.length, 2);
  assert.equal(f.calls.length, before, 'aggregation waits until summary preload completes');
  assert.equal(cold.connect(f.user), connecting, 'token callbacks share one in-flight preload');
  f.resumeSummary(); await connecting;
  assert.equal(cold.known('2013', '05'), 1);
  assert.equal(f.calls.length - before, 3, 'historical counts are reused, only the current month is refreshed');
  cold.disconnect();
  f.pauseSummary();
  const warm = cold.connect(f.user);
  assert.equal(cold.known('2013', '05'), 1, 'local counts are available synchronously before the network');
  f.resumeSummary(); await warm; cold.disconnect();
});

test('a failed background refresh preserves saved counts and never changes unknown to zero', async () => {
  const f = fixture(); await f.manager.connect(f.user);
  const before = f.calls.length;
  f.failAfter(before);
  f.manager.invalidate(['2013-05']);
  assert.equal(f.manager.known('2013', 'all'), 1);
  await f.manager.refresh(['2013-05']);
  assert.equal(f.manager.known('2013', '05'), 1);
  assert.equal(f.manager.known('2099', '01'), null);
  f.manager.disconnect();
});
