import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker, { handleRequest } from '../analytics-worker/src/index.js';

const schema = readFileSync(new URL('../analytics-worker/schema.sql', import.meta.url), 'utf8');
const origin = 'https://nnvvff.github.io';
const endpoint = 'https://collector.example';
let counter = 0;
const id = () => `event_${String(++counter).padStart(24, '0')}`;
const activity = (type, extras = {}) => ({ id: id(), type, path: '/cquisl/database', ...extras });
const batch = (events, extras = {}) => ({ site: 'cquisl', is_test: false, visit_id: 'anonymous_visit_123456789', events, ...extras });

function environment() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(schema);
  const queries = [];
  let batches = 0;
  function statement(sql, values = []) {
    return {
      bind(...params) { return statement(sql, params); },
      execute() {
        queries.push({ sql, values });
        const prepared = sqlite.prepare(sql);
        const before = sqlite.prepare('SELECT total_changes() AS n').get().n;
        const results = /^\s*SELECT\b/i.test(sql) || /\bRETURNING\b/i.test(sql) ? prepared.all(...values) : [];
        if (!/^\s*SELECT\b/i.test(sql) && !/\bRETURNING\b/i.test(sql)) prepared.run(...values);
        // D1 reports trigger writes in meta.changes; SQLite run().changes does not.
        const changes = Number(sqlite.prepare('SELECT total_changes() AS n').get().n - before);
        return { success: true, results, meta: { changes } };
      },
      async run() { return this.execute(); },
    };
  }
  const env = {
    ALLOWED_ORIGIN: origin,
    DB: {
      prepare: statement,
      async batch(statements) {
        batches += 1;
        sqlite.exec('BEGIN');
        try { const results = statements.map(s => s.execute()); sqlite.exec('COMMIT'); return results; }
        catch (error) { sqlite.exec('ROLLBACK'); throw error; }
      },
    },
    CLIENT_RATE: { async limit() { return { success: true }; } },
    GLOBAL_RATE: { async limit() { return { success: true }; } },
  };
  return { env, sqlite, queries, batches: () => batches };
}

function post(payload, overrides = {}) {
  return new Request(endpoint + '/collect', { method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.1', ...overrides.headers },
    body: typeof payload === 'string' ? payload : JSON.stringify(payload), ...overrides });
}
async function collect(h, payload) { return handleRequest(post(payload), h.env); }
async function stats(h, query = 'days=30') {
  const response = await handleRequest(new Request(endpoint + '/stats?' + query), h.env);
  assert.equal(response.status, 200);
  return response.json();
}

test('real SQLite: event retries and new visit event IDs cannot duplicate a visit', async t => {
  const h = environment(); t.after(() => h.sqlite.close());
  const events = ['visit', 'pageview', 'case_open', 'search', 'document_open'].map(type =>
    activity(type, ['case_open', 'document_open'].includes(type) ? { case_id: 'c-0001' } : {}));
  const payload = batch(events);
  const before = Date.now();
  assert.deepEqual(await (await collect(h, payload)).json(), { received: 5, inserted: 5 });
  assert.deepEqual(await (await collect(h, payload)).json(), { received: 5, inserted: 0 });
  assert.deepEqual(await (await collect(h, batch([activity('visit'), activity('pageview')]))).json(), { received: 2, inserted: 1 });
  const result = await stats(h);
  assert.deepEqual(result.totals, { pageview: 2, visit: 1, case_open: 1, search: 1, document_open: 1, custom_events: 3 });
  assert.deepEqual(result.all_time, result.totals);
  const rows = h.sqlite.prepare('SELECT * FROM events').all();
  assert.ok(rows.every(row => row.received_at >= before && row.received_at <= Date.now()));
  assert.ok(rows.every(row => /^[a-f0-9]{64}$/.test(row.visit_key)));
  assert.ok(!JSON.stringify(rows).includes(payload.visit_id));
  assert.ok(h.queries.filter(q => q.sql.includes('INSERT OR IGNORE')).every(q => !q.sql.includes(payload.visit_id)));
});

test('inserted counts returned event rows when D1 changes also counts aggregation trigger writes', async t => {
  const h = environment(); t.after(() => h.sqlite.close());
  const originalBatch = h.env.DB.batch;
  let writeResults;
  h.env.DB.batch = async statements => { writeResults = await originalBatch(statements); return writeResults; };
  const events = ['visit', 'pageview', 'case_open', 'search', 'document_open'].map(type =>
    activity(type, ['case_open', 'document_open'].includes(type) ? { case_id: 'c-0001' } : {}));
  const payload = batch(events, { is_test: true });
  const first = await collect(h, payload);
  assert.equal(writeResults.reduce((n, row) => n + row.meta.changes, 0), 10, 'five event + five daily trigger writes');
  assert.equal(writeResults.reduce((n, row) => n + row.results.length, 0), 5);
  assert.deepEqual(await first.json(), { received: 5, inserted: 5 });
  const retry = await collect(h, payload);
  assert.deepEqual(await retry.json(), { received: 5, inserted: 0 });
  assert.equal(writeResults.reduce((n, row) => n + row.results.length, 0), 0);
  assert.equal((await stats(h, 'days=7&is_test=1')).totals.custom_events, 3);
  assert.equal((await stats(h, 'days=7')).totals.custom_events, 0);
});

test('test and real partitions remain isolated even with identical IDs and visits', async t => {
  const h = environment(); t.after(() => h.sqlite.close());
  const payload = batch([activity('visit'), activity('pageview'), activity('search')]);
  await collect(h, { ...payload, is_test: true });
  let result = await stats(h);
  assert.equal(result.totals.pageview, 0); assert.equal(result.totals.custom_events, 0);
  assert.equal(result.first_day, null);
  const testResult = await stats(h, 'days=7&is_test=1');
  assert.equal(testResult.is_test, true); assert.equal(testResult.totals.search, 1);
  await collect(h, payload);
  result = await stats(h);
  assert.equal(result.is_test, false); assert.equal(result.totals.visit, 1); assert.equal(result.totals.pageview, 1);
  const text = JSON.stringify(result);
  for (const forbidden of [payload.visit_id, payload.events[0].id, 'visit_key', '192.0.2.1', 'user_agent', 'event_id']) {
    assert.ok(!text.includes(forbidden), forbidden);
  }
  assert.equal((await collect(h, { ...payload, is_test: 'false' })).status, 400);
  const missing = { ...payload }; delete missing.is_test;
  assert.equal((await collect(h, missing)).status, 400);
});

test('strict origins, methods and preflight reject before accessing D1', async t => {
  const h = environment(); t.after(() => h.sqlite.close());
  const payload = batch([activity('pageview')]);
  for (const bad of ['https://evil.example', 'https://nnvvff.github.io.evil.example', 'null', 'http://nnvvff.github.io']) {
    const request = post(payload); request.headers.set('Origin', bad);
    assert.equal((await handleRequest(request, h.env)).status, 403);
  }
  const missing = post(payload); missing.headers.delete('Origin');
  assert.equal((await handleRequest(missing, h.env)).status, 403);
  const preflight = new Request(endpoint + '/collect', { method: 'OPTIONS', headers: {
    Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type',
  } });
  const response = await handleRequest(preflight, h.env);
  assert.equal(response.status, 204); assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
  preflight.headers.set('Access-Control-Request-Headers', 'authorization');
  assert.equal((await handleRequest(preflight, h.env)).status, 403);
  assert.equal((await handleRequest(new Request(endpoint + '/collect', { headers: { Origin: origin } }), h.env)).status, 405);
  assert.equal((await handleRequest(new Request(endpoint + '/raw'), h.env)).status, 404);
  assert.equal(h.batches(), 0);
});

test('bounded input rejects private fields, arbitrary paths, IDs, timestamps and invalid cases', async t => {
  const h = environment(); t.after(() => h.sqlite.close());
  const invalid = [
    activity('search', { query: 'private search' }), activity('pageview', { timestamp: 1 }),
    activity('pageview', { path: '/cquisl/database?q=private' }), activity('pageview', { path: '/cquisl/analytics' }),
    activity('pageview', { path: '/other-site/' }), activity('case_open'),
    activity('case_open', { case_id: 'c-0307' }), activity('case_open', { case_id: 'c-0000' }),
    activity('pageview', { case_id: 'c-0001' }), activity('document_open', { url: 'https://private.example' }),
    activity('pageview', { id: 1234567890123456 }), activity('invented'),
    activity('search', { path: '/cquisl/about' }), activity('pageview', { path: '/cquisl/cases/c-0307' }),
  ];
  for (const event of invalid) assert.equal((await collect(h, batch([event]))).status, 400, JSON.stringify(event));
  for (const payload of [batch([]), batch(Array.from({ length: 11 }, () => activity('pageview'))),
    batch([activity('pageview')], { ip: '1.2.3.4' }), batch([activity('pageview')], { visit_id: 1234567890123456 })]) {
    assert.equal((await collect(h, payload)).status, 400);
  }
  assert.equal((await collect(h, 'x'.repeat(8193))).status, 413);
  assert.equal((await collect(h, '{')).status, 400);
  const contentType = post(batch([activity('pageview')])); contentType.headers.set('Content-Type', 'text/plain');
  assert.equal((await handleRequest(contentType, h.env)).status, 415);
  const declared = post(batch([activity('pageview')])); declared.headers.set('Content-Length', '9000');
  assert.equal((await handleRequest(declared, h.env)).status, 413);
  const streamed = new Request(endpoint + '/collect', { method: 'POST', duplex: 'half',
    headers: { Origin: origin, 'Content-Type': 'application/json' }, body: new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(5000)); controller.enqueue(new Uint8Array(4000)); controller.close(); },
    }) });
  assert.equal((await handleRequest(streamed, h.env)).status, 413);
  assert.equal(h.batches(), 0);
  assert.equal((await collect(h, batch([activity('pageview', { path: '/cquisl/cases/c-0001' })]))).status, 202);
});

test('strict transactional daily cap includes all test partitions and concurrent batches', async t => {
  const h = environment(); t.after(() => h.sqlite.close()); h.env.MAX_EVENTS_PER_DAY = '3';
  const response = await collect(h, batch(Array.from({ length: 5 }, () => activity('pageview'))));
  assert.deepEqual(await response.json(), { received: 5, inserted: 3 });
  const responses = await Promise.all(Array.from({ length: 4 }, () => collect(h, batch([activity('search')], { is_test: true }))));
  for (const result of responses) assert.equal((await result.json()).inserted, 0);
  assert.equal(h.sqlite.prepare('SELECT SUM(count) AS n FROM daily').get().n, 3);
  assert.equal((await stats(h)).totals.pageview, 3);
});

test('7/30/90 UTC periods include zero days; all-time survives raw cleanup', async t => {
  const h = environment(); t.after(() => h.sqlite.close());
  for (const days of [7, 30, 90]) {
    const result = await stats(h, `days=${days}`);
    assert.equal(result.trend.length, days); assert.equal(result.timezone, 'UTC');
    assert.ok(result.trend.every(row => row.pageview === 0 && row.visit === 0 && row.custom_events === 0));
    assert.equal(Date.parse(result.end) - Date.parse(result.start), (days - 1) * 86400000);
  }
  const old = Date.now() - 40 * 86400000;
  const day = new Date(old).toISOString().slice(0, 10);
  h.sqlite.prepare('INSERT INTO events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run('cquisl', 0, id(), 'old_hashed_visit', 'pageview', '/cquisl/', null, old, day);
  await worker.scheduled({}, h.env);
  assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS n FROM events').get().n, 0);
  const result = await stats(h);
  assert.equal(result.totals.pageview, 0); assert.equal(result.all_time.pageview, 1); assert.equal(result.first_day, day);
  const long = await stats(h, 'days=90'); assert.equal(long.totals.pageview, 1);
  assert.equal(h.sqlite.prepare('SELECT count FROM daily').get().count, 1);
});

test('stats parameters and explicit test filters cannot widen the API', async t => {
  const h = environment(); t.after(() => h.sqlite.close());
  for (const query of ['days=1', 'days=365', 'days=07', 'days=7&days=90', 'is_test=all', 'site=homepage',
    'include_raw=1', 'days=30&session=all', 'is_test=0%20OR%201=1']) {
    assert.equal((await handleRequest(new Request(endpoint + '/stats?' + query), h.env)).status, 400, query);
  }
  assert.equal((await handleRequest(new Request(endpoint + '/stats', { headers: { Origin: 'https://evil.example' } }), h.env)).status, 403);
  const direct = await handleRequest(new Request(endpoint + '/stats'), h.env);
  assert.equal(direct.headers.get('Access-Control-Allow-Origin'), origin);
});

test('rate limits and outages fail closed without exposing exceptions or personal input', async t => {
  const h = environment(); t.after(() => h.sqlite.close());
  const keys = [];
  h.env.CLIENT_RATE.limit = async options => { keys.push(options.key); return { success: false }; };
  const limited = await collect(h, batch([activity('pageview')]));
  assert.equal(limited.status, 429); assert.equal(limited.headers.get('Retry-After'), '60');
  assert.ok(!keys.join().includes('192.0.2.1')); assert.equal(h.batches(), 0);
  h.env.CLIENT_RATE.limit = async () => { throw new Error('limiter unavailable'); };
  assert.equal((await collect(h, batch([activity('pageview')]))).status, 503);
  h.env.CLIENT_RATE = { limit: async () => ({ success: true }) };
  h.env.DB.batch = async () => { throw new Error('private database name/token 123'); };
  const failed = await collect(h, batch([activity('pageview')]));
  assert.equal(failed.status, 503); assert.deepEqual(await failed.json(), { error: 'unavailable' });
});

test('UI-only DB binding has bounded burst throttling without requiring new account credentials', async t => {
  const h = environment(); t.after(() => h.sqlite.close()); delete h.env.CLIENT_RATE; delete h.env.GLOBAL_RATE;
  const payload = batch([activity('pageview')], { is_test: true });
  let allowed = 0; let denied = 0;
  for (let i = 0; i < 130; i++) {
    const request = post(payload); request.headers.set('CF-Connecting-IP', '192.0.2.77');
    const response = await handleRequest(request, h.env);
    if (response.status === 202) allowed++;
    else { assert.equal(response.status, 429); denied++; }
  }
  assert.equal(allowed, 120); assert.equal(denied, 10);
  assert.equal(h.sqlite.prepare('SELECT SUM(count) AS n FROM daily').get().n, 1, 'retries stayed deduplicated');
});

test('cache does not lose CORS or mix test and real aggregates', async t => {
  const h = environment(); t.after(() => h.sqlite.close());
  const previous = globalThis.caches; const entries = new Map(); const waits = [];
  globalThis.caches = { default: { async match(key) { return entries.get(key.url)?.clone(); },
    async put(key, value) { entries.set(key.url, value.clone()); } } };
  t.after(() => { if (previous === undefined) delete globalThis.caches; else globalThis.caches = previous; });
  await collect(h, batch([activity('search')], { is_test: true }));
  const ctx = { waitUntil(promise) { waits.push(promise); } };
  await handleRequest(new Request(endpoint + '/stats?days=7'), h.env, ctx); await Promise.all(waits);
  const cached = await handleRequest(new Request(endpoint + '/stats?days=7', { headers: { Origin: origin } }), h.env, ctx);
  assert.equal(cached.headers.get('Access-Control-Allow-Origin'), origin);
  assert.equal((await cached.json()).totals.search, 0);
  const separate = await handleRequest(new Request(endpoint + '/stats?days=7&is_test=1'), h.env, ctx);
  assert.equal((await separate.json()).totals.search, 1); await Promise.all(waits);
  assert.equal(entries.size, 2);
});
