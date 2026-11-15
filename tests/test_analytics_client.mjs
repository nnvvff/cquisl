import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const clientSource = readFileSync(new URL('../enhancements/analytics.js', import.meta.url), 'utf8');
const reportHtml = readFileSync(new URL('../enhancements/analytics-report.html', import.meta.url), 'utf8');
const reportSource = reportHtml.match(/<script id="analytics-report"[^>]*>([\s\S]*?)<\/script>/)[1];
const endpoint = 'https://cquisl-analytics.baohaomineee.workers.dev';
const excludeKey = 'haomin.analytics.exclude';
const firstCase = '科莫诉墨菲石油公司案';

class Element {
  constructor(tag, attrs = {}, text = '') {
    this.tagName = tag.toLowerCase(); this.attrs = { ...attrs }; this.children = [];
    this.parentElement = null; this.hidden = false; this.value = ''; this._text = text; this.listeners = new Map();
  }
  getAttribute(key) { return Object.hasOwn(this.attrs, key) ? String(this.attrs[key]) : null; }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  get target() { return this.getAttribute('target'); }
  get isConnected() { return Boolean(this.root || this.parentElement?.isConnected); }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this._text = String(value); this.replaceChildren(); }
  appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
  remove() { this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.parentElement = null; }
  replaceChildren(...children) { this.children.forEach(child => { child.parentElement = null; }); this.children = []; children.forEach(child => this.appendChild(child)); }
  getClientRects() { return this.hidden ? [] : [{}]; }
  matches(selectors) {
    return selectors.split(',').some(selector => {
      const match = selector.trim().match(/^([a-z0-9-]+)?(?:\[([a-z0-9-]+)(?:="([^"]*)")?\])?$/i);
      if (!match) throw new Error('Unsupported fixture selector: ' + selector);
      return (!match[1] || this.tagName === match[1]) && (!match[2] || (Object.hasOwn(this.attrs, match[2]) &&
        (match[3] === undefined || this.getAttribute(match[2]) === match[3])));
    });
  }
  closest(selector) { for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node; return null; }
  querySelectorAll(selector) {
    return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  addEventListener(type, listener) { const list = this.listeners.get(type) || []; list.push(listener); this.listeners.set(type, list); }
  emit(type, props = {}) { for (const listener of this.listeners.get(type) || []) listener({ type, target: this, isTrusted: true, button: 0, ...props }); }
}

function storage(initial = {}) {
  const values = new Map(Object.entries(initial)); let writes = 0;
  return { values, get writes() { return writes; }, getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { writes++; values.set(key, String(value)); }, removeItem(key) { values.delete(key); } };
}

function harness(options = {}) {
  let now = Date.parse('2026-11-15T12:00:00Z'); let timerId = 0;
  const timers = new Map(); const observers = []; const requests = [];
  const localStorage = options.storage || storage(options.excluded ? { [excludeKey]: '1' } : {});
  const document = new Element('document'); document.root = true;
  document.body = document.appendChild(new Element('body')); document.visibilityState = 'visible';
  document.currentScript = new Element('script', { 'data-endpoint': options.endpoint ?? endpoint,
    ...(options.testAttribute ? { 'data-analytics-test': '1' } : {}) });
  document.createElement = tag => new Element(tag);
  document.createElementNS = (_ns, tag) => new Element(tag);
  document.getElementById = id => {
    const walk = node => node.attrs.id === id ? node : node.children.map(walk).find(Boolean);
    return walk(document) || null;
  };
  const window = new Element('window'); window.localStorage = localStorage;
  window.location = new URL(options.url || 'https://nnvvff.github.io/cquisl/database');
  window.navigator = { webdriver: Boolean(options.webdriver) }; window.crypto = webcrypto;
  window.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (options.fetch) return options.fetch(String(url), init, requests.length);
    return { ok: true, status: 202 };
  };
  window.history = {};
  for (const name of ['pushState', 'replaceState']) window.history[name] = function (_state, _unused, url) {
    if (url) window.location = new URL(url, window.location.href); return `original-${name}`;
  };
  const originals = { ...window.history };
  class FakeDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const setTimeout = (fn, delay = 0) => { const id = ++timerId; timers.set(id, { at: now + delay, fn }); return id; };
  const clearTimeout = id => timers.delete(id);
  class MutationObserver {
    constructor(callback) { this.callback = callback; this.connected = false; observers.push(this); }
    observe() { this.connected = true; }
    disconnect() { this.connected = false; }
  }
  const context = vm.createContext({ window, document, Date: FakeDate, URL, URLSearchParams,
    Uint8Array, AbortController, MutationObserver, setTimeout, clearTimeout, Intl,
    fetch: window.fetch, console });
  const settle = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
  async function tick(ms = 0) {
    const target = now + ms; let steps = 0;
    while (true) {
      await settle();
      const next = [...timers.entries()].filter(([, value]) => value.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      assert.ok(++steps < 5000, 'No runaway timers'); now = next[1].at; timers.delete(next[0]); next[1].fn();
    }
    now = target; await settle();
  }
  return { window, document, requests, timers, observers, storage: localStorage, tick, settle, originals,
    run(source = clientSource) { vm.runInContext(source, context); },
    mutate() { for (const observer of observers) if (observer.connected) observer.callback([{ type: 'childList' }]); },
    add(tag, attrs = {}, text = '', parent = document.body) { return parent.appendChild(new Element(tag, attrs, text)); },
    events() { return requests.flatMap(request => request.init.body ? JSON.parse(request.init.body).events : []); },
  };
}

test('owner exclusion precedes test mode, queues, session writes, hooks and network', async () => {
  const h = harness({ excluded: true, testAttribute: true, webdriver: true, url: 'https://nnvvff.github.io/cquisl/database?analytics_test=1' });
  h.run(); await h.tick(600000);
  assert.equal(h.requests.length, 0); assert.equal(h.storage.writes, 0); assert.equal(h.timers.size, 0);
  assert.equal(h.observers.length, 0); assert.equal(h.window.history.pushState, h.originals.pushState);
  const unavailable = storage(); unavailable.getItem = () => { throw new Error('blocked'); };
  const blocked = harness({ storage: unavailable }); blocked.run(); await blocked.tick(5000);
  assert.equal(blocked.requests.length, 0); assert.equal(unavailable.writes, 0);
});

test('report routes, other hosts and missing/invalid endpoints do not track', async () => {
  for (const options of [{ url: 'https://nnvvff.github.io/cquisl/analytics/' }, { url: 'https://mirror.example/cquisl/database' },
    { endpoint: '' }, { endpoint: 'http://collector.example' }, { endpoint: endpoint + '?token=private' }]) {
    const h = harness(options); h.run(); await h.tick(10000);
    assert.equal(h.requests.length, 0); assert.equal(h.storage.writes, 0); assert.equal(h.timers.size, 0);
  }
});

test('data-endpoint batches initial PV and an idempotent visit without loading a CF beacon', async () => {
  const shared = storage(); const h = harness({ storage: shared }); h.run(); await h.tick(2000);
  assert.equal(h.requests.length, 1); const request = h.requests[0];
  assert.equal(request.url, endpoint + '/collect'); assert.equal(request.init.credentials, 'omit');
  assert.equal(request.init.referrerPolicy, 'no-referrer');
  const payload = JSON.parse(request.init.body);
  assert.equal(payload.is_test, false); assert.deepEqual(payload.events.map(event => event.type), ['visit', 'pageview']);
  assert.equal(h.document.querySelectorAll('script').length, 0);
  const reload = harness({ storage: shared }); reload.run(); await reload.tick(2000);
  assert.equal(JSON.parse(reload.requests[0].init.body).visit_id, payload.visit_id);
  h.run(); await h.tick(10000); assert.equal(h.requests.length, 1, 'second script inclusion is inert');
});

test('test URL, explicit attribute and webdriver mark tests and isolate visit storage', async () => {
  for (const options of [{ url: 'https://nnvvff.github.io/cquisl/database?analytics_test=1' }, { testAttribute: true }, { webdriver: true }]) {
    const h = harness(options); h.run(); await h.tick(2000);
    assert.equal(JSON.parse(h.requests[0].init.body).is_test, true);
    assert.ok(h.storage.values.has('cquisl.analytics.visit.v1.test'));
    assert.ok(!h.storage.values.has('cquisl.analytics.visit.v1'));
    h.window.history.pushState({}, '', '/cquisl/about'); await h.tick(2000);
    assert.ok(h.requests.every(request => JSON.parse(request.init.body).is_test === true));
  }
});

test('SPA path changes count once while filters, query text and report routes do not', async () => {
  const h = harness(); h.run(); await h.tick(2000);
  assert.equal(h.window.history.pushState({}, '', '/cquisl/database?keyword=private'), 'original-pushState');
  h.window.history.replaceState({}, '', '/cquisl/database?field=human'); await h.tick(2000);
  assert.equal(h.events().filter(event => event.type === 'pageview').length, 1);
  h.window.history.pushState({}, '', '/cquisl/about/'); await h.tick(2000);
  assert.deepEqual(h.events().filter(event => event.type === 'pageview').map(event => event.path), ['/cquisl/database', '/cquisl/about']);
  h.window.history.pushState({}, '', '/cquisl/analytics/'); await h.tick(2000);
  assert.equal(h.requests.length, 2); assert.ok(!JSON.stringify(h.requests).includes('private'));
});

test('only actual visible native case dialogs count; mutations and failed row clicks do not', async () => {
  const h = harness(); h.run();
  const row = h.add('tr'); h.document.emit('click', { target: row }); await h.tick(2100);
  assert.equal(h.events().filter(event => event.type === 'case_open').length, 0);
  const modal = h.add('div', { 'data-slot': 'dialog-content', 'data-state': 'open' });
  h.add('h2', { id: 'radix-case-title' }, firstCase, modal); h.mutate(); await h.tick(2100);
  assert.equal(h.events().filter(event => event.type === 'case_open').length, 1);
  assert.equal(h.events().find(event => event.type === 'case_open').case_id, 'c-0001');
  for (let i = 0; i < 4; i++) { h.mutate(); await h.tick(200); }
  await h.tick(2000); assert.equal(h.events().filter(event => event.type === 'case_open').length, 1);
  modal.setAttribute('data-state', 'closed'); h.mutate(); await h.tick(100);
  modal.setAttribute('data-state', 'open'); h.mutate(); await h.tick(2100);
  assert.equal(h.events().filter(event => event.type === 'case_open').length, 2);
  modal.hidden = true; h.mutate(); await h.tick(2100);
  const unrelated = h.add('div', { role: 'dialog' }); h.add('h2', {}, 'unrelated sensitive heading', unrelated);
  h.mutate(); await h.tick(2100); assert.equal(h.events().filter(event => event.type === 'case_open').length, 2);
});

test('search debounce/Enter/submit count one revision; clear, reset and filters do not count', async () => {
  const h = harness(); const form = h.add('form'); const input = h.add('input', { role: 'searchbox' }, '', form);
  h.run(); input.value = 'private search text'; h.document.emit('input', { target: input });
  await h.tick(400); input.value = 'private search text more'; h.document.emit('input', { target: input });
  await h.tick(800); h.document.emit('keydown', { target: input, key: 'Enter' }); h.document.emit('submit', { target: form });
  await h.tick(2000); assert.equal(h.events().filter(event => event.type === 'search').length, 1);
  input.value = ''; h.document.emit('input', { target: input }); await h.tick(2000);
  input.value = 'reset before debounce'; h.document.emit('input', { target: input });
  input.value = ''; await h.tick(2000); // React reset changes the value without a native input event.
  const filter = h.add('button', {}, '重置筛选'); h.document.emit('click', { target: filter });
  await h.tick(2000); assert.equal(h.events().filter(event => event.type === 'search').length, 1);
  input.value = 'second search'; h.document.emit('input', { target: input }); h.document.emit('keydown', { target: input, key: 'Enter' });
  h.document.emit('submit', { target: form }); await h.tick(2000);
  assert.equal(h.events().filter(event => event.type === 'search').length, 2);
  assert.ok(!JSON.stringify(h.requests).includes('private search')); assert.ok(!JSON.stringify([...h.storage.values]).includes('search'));
});

test('homepage search waits for actual submit', async () => {
  const h = harness({ url: 'https://nnvvff.github.io/cquisl/' });
  const form = h.add('form'); const input = h.add('input', { type: 'search' }, '', form); h.run();
  input.value = 'not submitted'; h.document.emit('input', { target: input }); await h.tick(2500);
  assert.equal(h.events().filter(event => event.type === 'search').length, 0);
  h.document.emit('submit', { target: form }); await h.tick(2000);
  assert.equal(h.events().filter(event => event.type === 'search').length, 1);
});

test('document links include Router-prefixed local PDFs and external resources without sending URLs', async () => {
  const h = harness(); const modal = h.add('div', { 'data-slot': 'dialog-content' });
  h.add('h2', {}, firstCase, modal);
  const local = h.add('a', { href: '/cquisl/pdfs/case_1.pdf?token=secret-document', target: '_blank' }, '', modal);
  const external = h.add('a', { href: 'https://official.example/case-detail?private=1', target: '_blank' }, '', modal);
  const icon = h.add('svg', {}, '', local);
  h.run(); await h.tick(2100);
  h.document.emit('click', { target: icon, button: 0 }); await h.tick(1000);
  h.document.emit('click', { target: local, button: 1 }); h.document.emit('auxclick', { target: local, button: 1 }); await h.tick(1000);
  h.document.emit('click', { target: external, button: 0 }); await h.tick(1000);
  const events = h.events().filter(event => event.type === 'document_open');
  assert.equal(events.length, 3); assert.ok(events.every(event => event.case_id === 'c-0001'));
  for (const forbidden of ['secret-document', 'official.example', 'case-detail', 'pdfs/', firstCase]) {
    assert.ok(!JSON.stringify(h.requests).includes(forbidden), forbidden);
  }
});

test('turning on owner exclusion cancels pending activity and prevents subsequent sends', async () => {
  const h = harness(); h.run(); h.storage.setItem(excludeKey, '1'); await h.tick(10000);
  assert.equal(h.requests.length, 0); assert.equal(h.timers.size, 0); assert.ok(h.observers.every(observer => !observer.connected));
  h.window.history.pushState({}, '', '/cquisl/about'); await h.tick(10000); assert.equal(h.requests.length, 0);
  const crossTab = harness(); crossTab.run(); crossTab.storage.setItem(excludeKey, '1');
  crossTab.window.emit('storage', { key: excludeKey }); await crossTab.tick(10000); assert.equal(crossTab.requests.length, 0);
});

test('collector outages stop after bounded retries; queues and event bursts stay capped', async () => {
  const h = harness({ fetch: async () => { throw new Error('offline'); } }); h.run();
  await h.tick(120000); assert.equal(h.requests.length, 3); assert.equal(h.timers.size, 0);
  const burst = harness(); const input = burst.add('input', { type: 'search' }); burst.run();
  for (let i = 0; i < 120; i++) {
    input.value = 'sensitive ' + i; burst.document.emit('input', { target: input }); burst.document.emit('keydown', { target: input, key: 'Enter' });
  }
  await burst.tick(10000);
  assert.ok(burst.events().filter(event => event.type !== 'visit').length <= 40);
  assert.ok(burst.requests.every(request => JSON.parse(request.init.body).events.length <= 10));
  assert.equal(burst.timers.size, 0);
});

function counts(values = {}) { return { pageview: 0, visit: 0, case_open: 0, search: 0, document_open: 0, custom_events: 0, ...values }; }
function responseData(days) {
  const end = '2026-11-15'; const endMs = Date.parse(end + 'T00:00:00Z');
  const trend = Array.from({ length: days }, (_, index) => ({
    day: new Date(endMs - (days - 1 - index) * 86400000).toISOString().slice(0, 10), ...counts(),
  }));
  return { schema_version: 1, source: 'cquisl-first-party-v1', site: 'cquisl', is_test: false, timezone: 'UTC',
    days, start: trend[0].day, end, generated_at: end + 'T12:00:00Z', first_day: null, totals: counts(), all_time: counts(), trend };
}
function report(options = {}) {
  const h = harness({ ...options, url: 'https://nnvvff.github.io/cquisl/analytics/', fetch: options.fetch || (async url => ({
    ok: true, headers: new Headers({ 'Content-Type': 'application/json' }),
    text: async () => JSON.stringify(responseData(Number(new URL(url).searchParams.get('days')))),
  })) });
  for (const name of ['status', 'error', 'chart', 'chart-empty', 'all-time', 'daily', 'refresh']) h.add(name === 'chart' ? 'svg' : 'div', { id: name });
  for (const name of Object.keys(counts())) h.add('dd', { 'data-count': name }, '—');
  for (const days of [7, 30, 90]) h.add('button', { 'data-days': String(days) });
  h.run(reportSource); return h;
}

test('standalone report reads aggregates only, switches all ranges, and shows honest empty zeros', async () => {
  const h = report(); await h.tick();
  assert.equal(h.requests.length, 1); assert.equal(h.requests[0].init.method, undefined);
  assert.ok(h.requests[0].url.startsWith(endpoint + '/stats?'));
  assert.equal(new URL(h.requests[0].url).searchParams.get('is_test'), '0');
  assert.equal(h.document.querySelectorAll('[data-count]')[0].textContent, '0');
  assert.equal(h.document.getElementById('chart-empty').textContent, '所选时段暂无记录');
  assert.equal(h.document.getElementById('daily').children.length, 30);
  assert.equal(h.document.getElementById('chart').hidden, true);
  for (const days of [7, 90]) {
    h.document.querySelectorAll('[data-days]').find(button => button.getAttribute('data-days') === String(days)).emit('click');
    await h.tick(); assert.equal(h.document.getElementById('daily').children.length, days);
  }
  assert.equal(h.storage.writes, 0); assert.equal(h.observers.length, 0);
});

test('report rejects failed or test/malformed data instead of displaying invented zero totals', async () => {
  for (const fetch of [async () => { throw new Error('offline'); }, async () => ({ ok: false }),
    async () => ({ ok: true, headers: new Headers({ 'Content-Type': 'application/json' }), text: async () => JSON.stringify({ ...responseData(30), is_test: true }) }),
    async () => ({ ok: true, headers: new Headers({ 'Content-Type': 'application/json' }), text: async () => JSON.stringify({ ...responseData(30), totals: counts({ pageview: 7 }) }) })]) {
    const h = report({ fetch }); await h.tick();
    assert.equal(h.document.getElementById('status').textContent, '暂无法读取');
    assert.ok(h.document.querySelectorAll('[data-count]').every(node => node.textContent === '—'));
  }
});
