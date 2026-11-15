const TYPES = ['pageview', 'visit', 'case_open', 'search', 'document_open'];
const PATHS = new Set(['/cquisl/', '/cquisl/database', '/cquisl/research', '/cquisl/about']);
const ID = /^[A-Za-z0-9_-]{16,64}$/;
const CASE = /^c-\d{4}$/;
const MAX_BODY = 8192;
const DAY = 86400000;
// UI-only deployments can bind D1 without the Wrangler-only native limiters.
// This fallback is bounded per isolate, not a cross-location security boundary.
const localLimits = { minute: -1, clients: new Map(), global: new Map() };

function memoryLimit(key, kind) {
  const minute = Math.floor(Date.now() / 60000);
  if (localLimits.minute !== minute) {
    localLimits.minute = minute;
    localLimits.clients.clear();
    localLimits.global.clear();
  }
  const globalCount = localLimits.global.get(kind) || 0;
  const clientCount = localLimits.clients.get(key) || 0;
  if (globalCount >= 300 || clientCount >= 120 ||
      (!localLimits.clients.has(key) && localLimits.clients.size >= 1024)) return false;
  localLimits.global.set(kind, globalCount + 1);
  localLimits.clients.set(key, clientCount + 1);
  return true;
}

function validCase(value) {
  return typeof value === 'string' && CASE.test(value) && +value.slice(2) >= 1 && +value.slice(2) <= 306;
}

function validPath(path) {
  return typeof path === 'string' && (PATHS.has(path) ||
    (path.startsWith('/cquisl/cases/') && validCase(path.slice(14))));
}

function exactKeys(value, allowed) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).every(key => allowed.includes(key));
}

export function validateBatch(value) {
  if (!exactKeys(value, ['site', 'is_test', 'visit_id', 'events']) || value.site !== 'cquisl' ||
      typeof value.is_test !== 'boolean' || typeof value.visit_id !== 'string' || !ID.test(value.visit_id) ||
      !Array.isArray(value.events) || !value.events.length || value.events.length > 10) return null;
  for (const event of value.events) {
    if (!exactKeys(event, ['id', 'type', 'path', 'case_id']) || typeof event.id !== 'string' || !ID.test(event.id) ||
        !TYPES.includes(event.type) || !validPath(event.path)) return null;
    if (event.type === 'case_open' && !validCase(event.case_id)) return null;
    if (event.case_id !== undefined &&
        (!validCase(event.case_id) || !['case_open', 'document_open'].includes(event.type))) return null;
    if (event.type === 'search' && !['/cquisl/', '/cquisl/database'].includes(event.path)) return null;
  }
  return value;
}

function headers(origin, allowed) {
  const result = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Vary': 'Origin',
  };
  if (!origin || origin === allowed) result['Access-Control-Allow-Origin'] = allowed;
  return result;
}

function json(data, status, responseHeaders) {
  return new Response(JSON.stringify(data), { status, headers: responseHeaders });
}

async function digest(value) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function readBounded(request) {
  const declared = request.headers.get('Content-Length');
  if (declared && (!/^\d+$/.test(declared) || +declared > MAX_BODY)) throw new Error('body_size');
  if (!request.body) throw new Error('body_json');
  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY) { await reader.cancel(); throw new Error('body_size'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new Error('body_json'); }
}

async function throttle(request, env, kind) {
  // IP is used transiently to derive a rate-limit key, never saved to D1 or returned.
  const ipKey = await digest(request.headers.get('CF-Connecting-IP') || 'unknown');
  if (!env.CLIENT_RATE?.limit || !env.GLOBAL_RATE?.limit) return memoryLimit(`${kind}:${ipKey}`, kind);
  const local = await env.CLIENT_RATE.limit({ key: `${kind}:${ipKey}` });
  if (!local.success) return false;
  return (await env.GLOBAL_RATE.limit({ key: kind })).success;
}

async function collect(request, env, responseHeaders) {
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return json({ error: 'content_type' }, 415, responseHeaders);
  }
  const payload = validateBatch(await readBounded(request));
  if (!payload) return json({ error: 'invalid_event' }, 400, responseHeaders);
  const now = Date.now();
  const day = new Date(now).toISOString().slice(0, 10);
  const isTest = Number(payload.is_test);
  const visitKey = await digest(`cquisl:${isTest}:${payload.visit_id}`);
  const configured = Number(env.MAX_EVENTS_PER_DAY || 5000);
  const cap = Number.isFinite(configured) ? Math.max(1, Math.min(5000, Math.floor(configured))) : 5000;
  // D1 batch is transactional. The per-insert guard includes earlier statements in this batch,
  // and all sites/test partitions, so even concurrent batches cannot overrun the daily cap.
  const statements = payload.events.map(event => env.DB.prepare(`
    INSERT OR IGNORE INTO events
      (site, is_test, event_id, visit_key, type, path, case_id, received_at, day)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
    WHERE (SELECT COALESCE(SUM(count), 0) FROM daily WHERE site = ? AND day = ?) < ?
    RETURNING event_id
  `).bind('cquisl', isTest, event.id, visitKey, event.type, event.path,
    event.case_id ?? null, now, day, 'cquisl', day, cap));
  const results = await env.DB.batch(statements);
  if (results.some(result => result.success === false)) throw new Error('database');
  // D1 meta.changes includes writes made by aggregate_insert; RETURNING contains
  // only newly inserted event rows, including zero rows for ignored duplicates.
  return json({ received: payload.events.length, inserted: results.reduce((n, r) => n + (r.results?.length || 0), 0) },
    202, responseHeaders);
}

function emptyCounts() {
  return { pageview: 0, visit: 0, case_open: 0, search: 0, document_open: 0, custom_events: 0 };
}

function add(counts, type, count) {
  if (!TYPES.includes(type)) return;
  counts[type] += Number(count);
  if (['case_open', 'search', 'document_open'].includes(type)) counts.custom_events += Number(count);
}

async function stats(url, env, responseHeaders) {
  if ([...url.searchParams.keys()].some(key => !['site', 'days', 'is_test'].includes(key)) ||
      [...url.searchParams.keys()].some(key => url.searchParams.getAll(key).length !== 1)) {
    return json({ error: 'invalid_range' }, 400, responseHeaders);
  }
  const daysValue = url.searchParams.get('days') || '30';
  const testValue = url.searchParams.get('is_test') || '0';
  if (!['7', '30', '90'].includes(daysValue) || !['0', '1'].includes(testValue) ||
      (url.searchParams.get('site') || 'cquisl') !== 'cquisl') {
    return json({ error: 'invalid_range' }, 400, responseHeaders);
  }
  const days = +daysValue;
  const now = Date.now();
  const end = new Date(now).toISOString().slice(0, 10);
  const start = new Date(Date.parse(`${end}T00:00:00Z`) - (days - 1) * DAY).toISOString().slice(0, 10);
  const results = await env.DB.batch([
    env.DB.prepare('SELECT day, type, count FROM daily WHERE site = ? AND is_test = ? AND day >= ? AND day <= ? ORDER BY day')
      .bind('cquisl', +testValue, start, end),
    env.DB.prepare('SELECT type, SUM(count) AS count, MIN(day) AS first_day FROM daily WHERE site = ? AND is_test = ? GROUP BY type')
      .bind('cquisl', +testValue),
  ]);
  if (results.some(result => result.success === false)) throw new Error('database');
  const trend = Array.from({ length: days }, (_, index) => ({
    day: new Date(Date.parse(`${start}T00:00:00Z`) + index * DAY).toISOString().slice(0, 10), ...emptyCounts(),
  }));
  const byDay = new Map(trend.map(row => [row.day, row]));
  const totals = emptyCounts();
  const allTime = emptyCounts();
  let firstDay = null;
  for (const row of results[0].results || []) {
    if (byDay.has(row.day)) { add(byDay.get(row.day), row.type, row.count); add(totals, row.type, row.count); }
  }
  for (const row of results[1].results || []) {
    add(allTime, row.type, row.count);
    if (row.first_day && (!firstDay || row.first_day < firstDay)) firstDay = row.first_day;
  }
  return json({ schema_version: 1, source: 'cquisl-first-party-v1', site: 'cquisl', is_test: testValue === '1',
    timezone: 'UTC', days, start, end, generated_at: new Date(now).toISOString(), first_day: firstDay,
    totals, all_time: allTime, trend }, 200, responseHeaders);
}

export async function handleRequest(request, env, ctx = {}) {
  const url = new URL(request.url);
  const allowed = env.ALLOWED_ORIGIN || 'https://nnvvff.github.io';
  const origin = request.headers.get('Origin');
  const responseHeaders = headers(origin, allowed);
  const isCollect = url.pathname === '/collect';
  if (!isCollect && url.pathname !== '/stats') return json({ error: 'not_found' }, 404, responseHeaders);
  if ((origin && origin !== allowed) || (isCollect && origin !== allowed)) {
    return json({ error: 'origin' }, 403, responseHeaders);
  }
  if (request.method === 'OPTIONS') {
    if (origin !== allowed || request.headers.get('Access-Control-Request-Method') !== (isCollect ? 'POST' : 'GET') ||
        (request.headers.get('Access-Control-Request-Headers') || '').split(',')
          .some(header => header.trim() && header.trim().toLowerCase() !== 'content-type')) {
      return json({ error: 'preflight' }, 403, responseHeaders);
    }
    return new Response(null, { status: 204, headers: { ...responseHeaders,
      'Access-Control-Allow-Methods': isCollect ? 'POST' : 'GET',
      'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '3600' } });
  }
  if (request.method !== (isCollect ? 'POST' : 'GET')) {
    return json({ error: 'method' }, 405, { ...responseHeaders, Allow: isCollect ? 'POST' : 'GET' });
  }
  if (isCollect && url.search) return json({ error: 'invalid_url' }, 400, responseHeaders);
  try {
    if (!(await throttle(request, env, isCollect ? 'collect' : 'stats'))) {
      return json({ error: 'rate_limited' }, 429, { ...responseHeaders, 'Retry-After': '60' });
    }
    if (isCollect) return await collect(request, env, responseHeaders);
    // Cache only validated aggregate responses; keys keep ranges and test data separate.
    const cache = globalThis.caches?.default;
    const cacheKey = new Request(url.toString());
    const cached = cache && await cache.match(cacheKey);
    if (cached) return cached;
    const response = await stats(url, env, responseHeaders);
    if (response.ok && cache && ctx.waitUntil) {
      const cachedResponse = new Response(response.clone().body, { status: 200,
        headers: { ...responseHeaders, 'Cache-Control': 'public, max-age=60' } });
      ctx.waitUntil(cache.put(cacheKey, cachedResponse).catch(() => {}));
    }
    return response;
  } catch (error) {
    const message = error?.message;
    if (message === 'body_size') return json({ error: 'body_size' }, 413, responseHeaders);
    if (message === 'body_json') return json({ error: 'body_json' }, 400, responseHeaders);
    return json({ error: 'unavailable' }, 503, { ...responseHeaders, 'Retry-After': '60' });
  }
}

export default {
  fetch: handleRequest,
  async scheduled(_event, env) {
    // Bounded cleanup keeps IDs for much longer than the client's five-minute queue TTL.
    await env.DB.prepare(`DELETE FROM events WHERE (site, is_test, event_id) IN
      (SELECT site, is_test, event_id FROM events WHERE received_at < ? LIMIT 1000)`)
      .bind(Date.now() - 7 * DAY).run();
  },
};
