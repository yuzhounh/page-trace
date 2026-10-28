/* Calendar summaries are independent of the body/scope cache. No note writes. */
(function (root) {
  'use strict';
  const version = 1;
  const zoneKey = zone => zone.replace(/\//g, '__');
  const monthKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  const timestamp = value => typeof value?.toDate === 'function' ? value.toDate().toISOString() : value;
  const monthOf = note => {
    const date = new Date(timestamp(note?.createdAt));
    return Number.isFinite(date.getTime()) ? monthKey(date) : null;
  };
  function totals(months) {
    const years = {};
    let total = 0, known = true;
    for (const [key, entry] of Object.entries(months)) {
      const year = key.slice(0, 4);
      if (years[year] === undefined) years[year] = 0;
      if (!Number.isSafeInteger(entry.count) || entry.count < 0) { years[year] = null; known = false; }
      else { total += entry.count; if (years[year] !== null) years[year] += entry.count; }
    }
    return { years, total: known ? total : null };
  }
  function create(options) {
    const zone = options.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const fetcher = options.fetch || root.fetch?.bind(root);
    let uid = '', generation = 0, data = null, unsubscribe = null, active = null, connected = false;
    let summaryPending = false, connectionTask = null;
    let pending = new Set(), queued = null, invalidated = new Map(), revision = 0;
    const key = () => `pagetrace_calendar_v1_${uid}_${zoneKey(zone)}`;
    const current = id => uid === id && options.getUser()?.uid === id;
    const quotaDay = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    function valid(raw, id) {
      return raw?.version === version && raw.uid === id && raw.timeZone === zone && raw.months &&
        typeof raw.months === 'object' && !Array.isArray(raw.months) &&
        Object.entries(raw.months).every(([m, e]) => /^\d{4}-(0[1-9]|1[0-2])$/.test(m) &&
          e && (e.count === null || Number.isSafeInteger(e.count) && e.count >= 0) && typeof e.readTime === 'string');
    }
    function publish() {
      if (!uid || !data) return;
      Object.assign(data, totals(data.months));
      try { options.storage.setItem(key(), JSON.stringify(data)); } catch (_) {}
      options.onChange?.(data);
    }
    const ref = id => options.getDb().collection('users').doc(id).collection('calendarCounts').doc(zoneKey(zone));
    function merge(base, other) {
      if (!base) return structuredClone(other);
      const result = { ...base, ...other, months: { ...base.months } };
      for (const [month, entry] of Object.entries(other.months)) {
        const old = result.months[month];
        if (!old || entry.readTime >= old.readTime) result.months[month] = entry;
      }
      result.dirtyMonths = { ...base.dirtyMonths, ...other.dirtyMonths };
      for (const [month, since] of Object.entries(result.dirtyMonths)) {
        if (result.months[month]?.readTime >= since && result.months[month]?.count !== null) delete result.dirtyMonths[month];
      }
      result.from = [base.from, other.from].filter(Boolean).sort()[0] || null;
      result.through = [base.through, other.through].filter(Boolean).sort().at(-1) || null;
      result.complete = !!(base.complete || other.complete) &&
        sequence(result.from, result.through).every(m => Number.isSafeInteger(result.months[m]?.count));
      return { ...result, ...totals(result.months) };
    }
    async function persist(id, patch) {
      if (!current(id)) return;
      const doc = ref(id);
      const saved = await options.getDb().runTransaction(async transaction => {
        const snapshot = await transaction.get(doc);
        const remote = snapshot.exists ? snapshot.data() : null;
        if (remote && !valid(remote, id)) throw Error('统计文档格式或账号不匹配');
        const next = merge(remote, patch);
        if (!current(id)) throw Error('统计账号已切换');
        transaction.set(doc, next);
        return next;
      });
      if (current(id)) { data = merge(data, saved); publish(); }
    }
    async function request(id, method, query, readTime) {
      const user = options.getUser();
      if (!current(id)) throw Error('统计账号已切换');
      const token = await user.getIdToken();
      if (!current(id)) throw Error('统计账号已切换');
      const body = method === 'runAggregationQuery'
        ? { structuredAggregationQuery: { structuredQuery: query, aggregations: [{ alias: 'n', count: {} }] } }
        : { structuredQuery: query };
      if (readTime) body.readTime = readTime;
      const response = await fetcher(`https://firestore.googleapis.com/v1/projects/${options.projectId}/databases/(default)/documents/users/${encodeURIComponent(id)}:${method}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body)
      });
      const result = await response.json();
      if (!response.ok) { const error = Error(result.error?.message || `统计请求失败 ${response.status}`); error.status = response.status; throw error; }
      if (!current(id)) throw Error('统计账号已切换');
      return result;
    }
    const baseQuery = () => ({ from: [{ collectionId: 'notes' }] });
    function decode(field) {
      if (field.mapValue) return Object.fromEntries(Object.entries(field.mapValue.fields || {}).map(([k, v]) => [k, decode(v)]));
      if (field.arrayValue) return (field.arrayValue.values || []).map(decode);
      if (field.integerValue !== undefined) return Number(field.integerValue);
      if (field.doubleValue !== undefined) return field.doubleValue;
      return field.stringValue ?? field.booleanValue ?? field.timestampValue ?? null;
    }
    async function preloadSummary(id) {
      const token = await options.getUser().getIdToken();
      if (!current(id)) throw Error('统计账号已切换');
      const response = await fetcher(`https://firestore.googleapis.com/v1/projects/${options.projectId}/databases/(default)/documents/users/${encodeURIComponent(id)}/calendarCounts/${encodeURIComponent(zoneKey(zone))}`, {
        method: 'GET', headers: { Authorization: `Bearer ${token}` }
      });
      if (response.status === 404) return null;
      const result = await response.json();
      if (!response.ok) throw Error(result.error?.message || '年月统计预加载失败');
      return decode({ mapValue: { fields: result.fields || {} } });
    }
    async function count(id, query, readTime) {
      const rows = await request(id, 'runAggregationQuery', query, readTime);
      const row = rows.find(row => row.result?.aggregateFields?.n);
      if (!row) throw Error('统计响应缺少数量');
      const n = Number(row.result.aggregateFields.n.integerValue);
      if (!Number.isSafeInteger(n) || n < 0) throw Error('统计响应数量无效');
      return { n, readTime: row.readTime };
    }
    async function bounds(id) {
      const first = await request(id, 'runQuery', { ...baseQuery(), select: { fields: [{ fieldPath: 'createdAt' }] },
        orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'ASCENDING' }], limit: 1 });
      const readTime = first.at(-1)?.readTime;
      if (!readTime) throw Error('统计响应缺少快照时间');
      const last = await request(id, 'runQuery', { ...baseQuery(), select: { fields: [{ fieldPath: 'createdAt' }] },
        orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' }], limit: 1 }, readTime);
      const dates = [new Date(), ...[first, last].flatMap(rows => rows.filter(r => r.document).map(r => {
        const field = r.document.fields?.createdAt;
        return new Date(field?.timestampValue || field?.stringValue);
      }))].filter(d => Number.isFinite(d.getTime()));
      return { from: `${Math.min(...dates.map(d => d.getFullYear()))}-01`,
        through: `${Math.max(...dates.map(d => d.getFullYear()))}-12`, readTime };
    }
    async function deleted(id, readTime) {
      const rows = await request(id, 'runQuery', { ...baseQuery(), select: { fields: [{ fieldPath: 'createdAt' }] },
        where: { fieldFilter: { field: { fieldPath: 'isDeleted' }, op: 'EQUAL', value: { booleanValue: true } } } }, readTime);
      const months = {};
      let total = 0;
      for (const row of rows) if (row.document) {
        total++;
        const field = row.document.fields?.createdAt;
        const m = monthOf({ createdAt: field?.timestampValue || field?.stringValue });
        if (m) months[m] = (months[m] || 0) + 1;
      }
      return { months, total };
    }
    function sequence(from, through) {
      const result = [];
      let [y, m] = from.split('-').map(Number);
      while (`${y}-${String(m).padStart(2, '0')}` <= through && result.length < 1200) {
        result.push(`${y}-${String(m).padStart(2, '0')}`); if (++m === 13) { m = 1; y++; }
      }
      return result;
    }
    async function refresh(months = null) {
      if (!uid || !fetcher || !options.getDb()?.runTransaction || !options.getUser()?.getIdToken) return;
      if (summaryPending) return;
      if (data?.blockedQuotaDay === quotaDay()) return;
      if (active) { if (months) months.forEach(m => pending.add(m)); return active; }
      const id = uid, run = generation;
      active = (async () => {
        try {
          const full = !data?.complete;
          const requested = [...new Set([...(months || [monthKey(new Date())]), ...pending])];
          pending.clear();
          let coverage = data?.from && data?.through ? { from: data.from, through: data.through } : await bounds(id);
          const nowMonth = monthKey(new Date());
          coverage.from = [coverage.from, nowMonth, ...requested].sort()[0].slice(0, 4) + '-01';
          coverage.through = [coverage.through, nowMonth, ...requested].sort().at(-1).slice(0, 4) + '-12';
          const all = await count(id, baseQuery());
          const snapshotTime = all.readTime;
          const trash = await deleted(id, snapshotTime);
          if (run !== generation) return;
          if (!data) data = { version, uid: id, timeZone: zone, months: {}, complete: false };
          Object.assign(data, coverage);
          const keys = [...new Set([...sequence(coverage.from, coverage.through).filter(m => data.months[m]?.count == null),
            ...Object.keys(data.dirtyMonths || {}), ...requested])];
          let unpersisted = {};
          for (const m of keys) {
            const beforeRevision = invalidated.get(m);
            const [year, month] = m.split('-').map(Number);
            const start = new Date(year, month - 1, 1).toISOString(), end = new Date(year, month, 1).toISOString();
            const result = await count(id, { ...baseQuery(), where: { compositeFilter: { op: 'AND', filters: [
              { fieldFilter: { field: { fieldPath: 'createdAt' }, op: 'GREATER_THAN_OR_EQUAL', value: { timestampValue: start } } },
              { fieldFilter: { field: { fieldPath: 'createdAt' }, op: 'LESS_THAN', value: { timestampValue: end } } }
            ] } } }, snapshotTime);
            if (run !== generation || !current(id)) return;
            if (invalidated.get(m) !== beforeRevision) { pending.add(m); continue; }
            const n = result.n - (trash.months[m] || 0);
            if (n < 0) throw Error('回收站数量超过当月总量');
            const entry = { count: n, readTime: snapshotTime };
            invalidated.delete(m);
            if (data.dirtyMonths) delete data.dirtyMonths[m];
            data.months[m] = entry; unpersisted[m] = entry; publish();
            if (Object.keys(unpersisted).length === 20) {
              await persist(id, { ...data, months: unpersisted }); unpersisted = {};
            }
          }
          if (run !== generation || !current(id)) return;
          const sum = totals(data.months).total;
          // All month entries must belong to this baseline before asserting its grand total.
          if (full && Object.values(data.months).every(e => e.readTime === snapshotTime) && sum !== all.n - trash.total)
            throw Error('年月合计与有效笔记总量不一致，请检查缺失或非法日期');
          data.complete = sequence(data.from, data.through).every(m => Number.isSafeInteger(data.months[m]?.count));
          data.updatedAt = snapshotTime;
          delete data.error; delete data.blockedQuotaDay;
          await persist(id, { ...data, months: { ...unpersisted } });
        } catch (error) {
          if (run === generation && current(id)) {
            data ||= { version, uid: id, timeZone: zone, months: {}, complete: false };
            data.error = error.message;
            if (error.status === 429) data.blockedQuotaDay = quotaDay();
            publish();
          }
        } finally {
          if (run === generation) {
            active = null;
            if (pending.size && !data?.error) { const next = [...pending]; pending.clear(); void refresh(next); }
          }
        }
      })();
      return active;
    }
    function invalidate(months) {
      if (!uid) return;
      for (const m of months.filter(Boolean)) {
        invalidated.set(m, ++revision);
        if (data) (data.dirtyMonths ||= {})[m] = new Date().toISOString();
        pending.add(m);
      }
      publish();
      if (queued) clearTimeout(queued);
      const id = uid;
      queued = setTimeout(() => { queued = null; if (current(id)) { const keys = [...pending]; pending.clear(); void refresh(keys); } }, 250);
    }
    function disconnect() {
      generation++; unsubscribe?.(); unsubscribe = null;
      if (queued) clearTimeout(queued); queued = null;
      uid = ''; data = null; pending.clear(); invalidated.clear(); active = null; connected = false;
      summaryPending = false; connectionTask = null;
    }
    function connect(user) {
      if (uid === user?.uid && connected) return connectionTask;
      disconnect();
      if (!user?.uid) return;
      const id = uid = user.uid, run = generation;
      try { const raw = JSON.parse(options.storage.getItem(key()) || 'null'); if (valid(raw, id)) data = raw; } catch (_) {}
      for (const m of Object.keys(data?.dirtyMonths || {})) invalidated.set(m, ++revision);
      publish();
      if (!fetcher || !options.getDb()?.runTransaction || !user.getIdToken) return;
      connected = true;
      summaryPending = true;
      connectionTask = (async () => {
      try {
        const doc = ref(id), remote = await preloadSummary(id);
        if (run !== generation || !current(id)) return;
        if (remote) {
          if (!valid(remote, id)) throw Error('云端统计格式或账号不匹配');
          data = merge(data, remote); publish();
        }
        if (doc.onSnapshot) unsubscribe = doc.onSnapshot(snapshot => {
          if (run !== generation || !current(id) || !snapshot.exists) return;
          const remote = snapshot.data(); if (valid(remote, id)) { data = merge(data, remote); publish(); }
        }, error => { if (run === generation && data) { data.error = error.message; publish(); } });
        summaryPending = false;
        await refresh();
      } catch (error) { if (run === generation && current(id)) { data ||= { version, uid: id, timeZone: zone, months: {}, complete: false }; data.error = error.message; publish(); } }
      finally { if (run === generation) summaryPending = false; }
      })();
      return connectionTask;
    }
    function known(year, month) {
      if (!data || data.uid !== uid || !current(uid)) return null;
      const keys = data.from && data.through ? sequence(data.from, data.through) : [];
      if (year !== 'all' && month !== 'all') return data.months[`${year}-${month}`]?.count ??
        (data.complete && `${year}-${month}` < data.from ? 0 : null);
      const selected = keys.filter(k => (year === 'all' || k.startsWith(year + '-')) && (month === 'all' || k.endsWith('-' + month)));
      if (!selected.length) return data.complete && year !== 'all' && year < data.from.slice(0, 4) ? 0 : null;
      if (year === 'all' && !data.complete) return null;
      if (year !== 'all' && month === 'all' && selected.length !== 12) return null;
      return selected.every(k => Number.isSafeInteger(data.months[k]?.count)) ? selected.reduce((n, k) => n + data.months[k].count, 0) : null;
    }
    return { connect, disconnect, refresh, invalidate, known, state: () => data,
      reconcile(scope, notes) {
        if (!data?.complete || !scope) return;
        const observed = {};
        for (const note of notes) if (!note.isDeleted) { const m = monthOf(note); if (m) observed[m] = (observed[m] || 0) + 1; }
        const changed = Object.keys(data.months).filter(m => {
          const [y, n] = m.split('-').map(Number);
          return (scope.start === null || scope.start <= new Date(y, n - 1, 1).getTime() && scope.end >= new Date(y, n, 1).getTime()) &&
            !invalidated.has(m) && data.months[m].count !== (observed[m] || 0);
        });
        if (changed.length) invalidate(changed);
      },
      changed(before, after) {
        const old = before && !before.isDeleted ? monthOf(before) : null;
        const next = after && !after.isDeleted ? monthOf(after) : null;
        if (old !== next) invalidate([...new Set([old, next].filter(Boolean))]);
      } };
  }
  const api = { create, totals, monthOf, monthKey, zoneKey };
  if (typeof module !== 'undefined') module.exports = api;
  else root.PageTraceCalendar = api;
})(typeof window !== 'undefined' ? window : globalThis);
