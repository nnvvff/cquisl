// State/event regression tests; Node's VM + a small DOM contract, no browser or dependencies.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../enhancements/site-boot.js", import.meta.url), "utf8");
const appURL = "https://example.test/cquisl/assets/index-source102.js?v=102";

class Events {
  listeners = new Map();
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback);
  }
  removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
  fire(type, detail = {}) {
    const event = {defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...detail};
    for (const callback of [...(this.listeners.get(type) || [])]) callback(event);
    return event;
  }
  count() { return [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0); }
}

class Element extends Events {
  constructor(tagName, attrs = {}) {
    super();
    this.tagName = tagName;
    this.attrs = {...attrs};
    this.children = [];
    this.textContent = "";
    this.hidden = false;
  }
  getAttribute(name) { return this.attrs[name] ?? null; }
  setAttribute(name, value) { this.attrs[name] = value; }
  hasAttribute(name) { return name in this.attrs; }
  remove() { this.removed = true; }
}

function harness({parsed = true, offline = false, mounted = false, entries = null} = {}) {
  const window = new Events();
  const document = new Events();
  const root = new Element("DIV");
  if (mounted) root.children.push(new Element("MAIN"));
  const shell = new Element("DIV", {"data-state": "loading"});
  const status = new Element("P");
  status.textContent = "正在加载…";
  const retry = new Element("A");
  retry.hidden = true;
  const style = new Element("STYLE");
  const nodes = new Map();
  function insertShell() {
    for (const [id, node] of Object.entries({root, "cquisl-loading": shell,
      "cquisl-loading-status": status, "cquisl-loading-retry": retry,
      "cquisl-loading-style": style})) nodes.set(id, node);
  }
  if (parsed) insertShell();
  const entry = new Element("SCRIPT", {type: "module"});
  entry.src = appURL;
  document.baseURI = "https://example.test/cquisl/database/?q=海洋#cases";
  document.documentElement = new Element("HTML");
  document.getElementById = id => nodes.get(id)?.removed ? null : nodes.get(id) || null;
  document.querySelectorAll = selector => {
    assert.equal(selector, 'script[type="module"][src]');
    return entries ?? [entry];
  };
  const timers = new Map();
  let nextTimer = 0;
  let observer;
  let reloads = 0;
  window.navigator = {onLine: !offline};
  window.location = {origin: "https://example.test", href: document.baseURI, reload() { reloads++; }};
  window.setTimeout = (callback, delay) => {
    assert.equal(delay, 8000);
    timers.set(++nextTimer, callback);
    return nextTimer;
  };
  window.clearTimeout = id => timers.delete(id);
  class MutationObserver {
    constructor(callback) { this.callback = callback; observer = this; }
    observe() { this.active = true; }
    disconnect() { this.active = false; }
  }
  const context = vm.createContext({window, document, MutationObserver, URL});
  function run() { vm.runInContext(source, context); }
  function mutate() { if (observer.active) observer.callback(); }
  function elapse() {
    for (const [id, callback] of [...timers]) { timers.delete(id); callback(); }
  }
  run();
  return {window, document, root, shell, status, retry, style, entry, timers,
    insertShell, mutate, elapse, run, nodes, observer, get reloads() { return reloads; }};
}

test("slow module cannot block status/retry behind DOMContentLoaded", () => {
  const h = harness();
  assert.equal(h.shell.attrs["data-state"], "loading");
  h.elapse();
  assert.equal(h.shell.attrs["data-state"], "slow");
  assert.match(h.status.textContent, /加载较慢/);
  assert.equal(h.retry.hidden, false);
  assert.equal(h.timers.size, 0);
  assert.equal(h.reloads, 0);
  const click = h.retry.fire("click", {button: 0});
  assert.equal(click.defaultPrevented, true);
  assert.equal(h.reloads, 1);
  assert.equal(h.window.location.href, h.document.baseURI);
});

test("captures the main module download failure, keeps native propagation", () => {
  const h = harness();
  const event = h.window.fire("error", {target: h.entry});
  assert.equal(h.shell.attrs["data-state"], "error");
  assert.match(h.status.textContent, /资源加载失败/);
  assert.equal(event.defaultPrevented, false);
  assert.equal(h.reloads, 0);
  h.elapse();
  assert.match(h.status.textContent, /资源加载失败/);
});

test("analytics, third party SDKs, image and stylesheet errors do not fail the app", () => {
  const h = harness();
  for (const [tag, url] of [["SCRIPT", "/analytics.js"], ["SCRIPT", "https://sdk.example/collect.js"],
    ["IMG", "/cquisl/assets/photo.jpg"], ["LINK", "/cquisl/assets/index.css"]]) {
    const target = new Element(tag);
    target.src = new URL(url, h.document.baseURI).href;
    h.window.fire("error", {target, filename: target.src});
  }
  h.window.fire("unhandledrejection", {reason: new Error("analytics unavailable")});
  assert.equal(h.shell.attrs["data-state"], "loading");
  assert.equal(h.retry.hidden, true);
});

test("runtime/chunk promise failures update status without taking over error handling", () => {
  for (const detail of [
    {type: "error", filename: appURL},
    {type: "unhandledrejection", reason: {stack: "Error: import failed\n at https://example.test/cquisl/assets/toolkit.js:20:4"}},
    {type: "unhandledrejection", reason: {message: "Failed to fetch dynamically imported module: " + appURL}},
  ]) {
    const h = harness();
    const event = h.window.fire(detail.type, detail);
    assert.equal(h.shell.attrs["data-state"], "error");
    assert.equal(event.defaultPrevented, false);
    assert.equal(h.root.children.length, 0);
    assert.equal(h.reloads, 0);
  }
});

test("offline/online transitions never reload automatically and preserve an actual failure", () => {
  const h = harness({offline: true});
  assert.equal(h.shell.attrs["data-state"], "offline");
  assert.equal(h.retry.hidden, false);
  h.window.navigator.onLine = true;
  h.window.fire("online");
  assert.equal(h.shell.attrs["data-state"], "loading");
  h.window.fire("error", {target: h.entry});
  h.window.navigator.onLine = false;
  h.window.fire("offline");
  assert.equal(h.shell.attrs["data-state"], "offline");
  h.window.navigator.onLine = true;
  h.window.fire("online");
  assert.equal(h.shell.attrs["data-state"], "error");
  assert.equal(h.reloads, 0);
});

test("React commit or existing error boundary removes only shell/style and cleans up", () => {
  for (const tag of ["MAIN", "DIV"]) {
    const h = harness();
    const overlay = new Element("DIV");
    h.nodes.set("existing-overlay", overlay);
    h.root.children.push(new Element(tag));
    h.mutate();
    assert.equal(h.shell.removed, true);
    assert.equal(h.style.removed, true);
    assert.equal(h.root.children.length, 1);
    assert.equal(overlay.removed, undefined);
    assert.equal(h.observer.active, false);
    assert.equal(h.window.count() + h.document.count() + h.retry.count(), 0);
    assert.equal(h.timers.size, 0);
    h.window.fire("error", {target: h.entry});
    h.window.fire("offline");
    assert.equal(h.reloads, 0);
  }
});

test("works before parser inserts root/shell and when React is already mounted", () => {
  const early = harness({parsed: false});
  early.window.fire("error", {target: early.entry});
  early.insertShell();
  early.mutate();
  assert.equal(early.shell.attrs["data-state"], "error");
  early.root.children.push(new Element("STYLE"));
  early.mutate();
  assert.equal(early.shell.removed, undefined);
  early.root.children = [new Element("MAIN")];
  early.mutate();
  assert.equal(early.shell.removed, true);
  const late = harness({mounted: true});
  assert.equal(late.shell.removed, true);
  assert.equal(late.window.count(), 0);
  assert.equal(late.timers.size, 0);
});

test("recognizes replacement of the entire root element", () => {
  const h = harness();
  const replacement = new Element("DIV");
  replacement.children = [new Element("MAIN")];
  h.nodes.set("root", replacement);
  h.mutate();
  assert.equal(h.shell.removed, true);
  assert.equal(h.document.getElementById("root"), replacement);
  assert.equal(h.root.children.length, 0);
  assert.equal(h.observer.active, false);
});

test("repeated boot is harmless and modified retry clicks remain native", () => {
  const h = harness();
  h.run();
  assert.equal(h.timers.size, 1);
  assert.equal(h.window.count(), 4);
  for (const detail of [{button: 1}, {button: 0, metaKey: true}, {button: 0, ctrlKey: true},
    {button: 0, shiftKey: true}, {button: 0, altKey: true}, {button: 0, defaultPrevented: true}]) {
    const event = h.retry.fire("click", detail);
    assert.equal(event.defaultPrevented, !!detail.defaultPrevented);
  }
  assert.equal(h.reloads, 0);
});

test("does not keep watching unrelated pages without a loading shell", () => {
  const h = harness({parsed: false});
  h.document.fire("DOMContentLoaded");
  assert.equal(h.observer.active, false);
  assert.equal(h.window.count() + h.document.count(), 0);
  assert.equal(h.timers.size, 0);
});
