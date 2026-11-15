/* Independent of the app module. Use a synchronous classic script immediately
 * after #root; see scripts/loading_shell.py. Never reload without a user click. */
(function () {
  "use strict";

  if (window.__CQUISL_LOADING_STARTED__) return;
  window.__CQUISL_LOADING_STARTED__ = true;

  var done = false;
  var slow = false;
  var failure = "";
  var shell;
  var retry;
  var observer;
  var slowTimer;

  // Identify only the local application's module graph, not analytics or SDKs.
  // The entry may optionally carry data-cquisl-app; the existing module entry
  // under /assets/ works unchanged, including content-hash query strings.
  function appDirectories() {
    var entries = document.querySelectorAll('script[type="module"][src]');
    var directories = [];
    for (var i = 0; i < entries.length; i++) {
      try {
        var url = new URL(entries[i].src, document.baseURI);
        if (url.origin !== window.location.origin) continue;
        if (!entries[i].hasAttribute("data-cquisl-app") &&
            url.pathname.indexOf("/assets/") === -1) continue;
        directories.push(url.origin + url.pathname.slice(0, url.pathname.lastIndexOf("/") + 1));
      } catch (_) { /* An invalid unrelated script URL is not an app failure. */ }
    }
    return directories;
  }

  function isAppURL(value) {
    if (!value) return false;
    try {
      var url = new URL(value, document.baseURI);
      if (url.origin !== window.location.origin || !/\.m?js$/.test(url.pathname)) return false;
      var directories = appDirectories();
      for (var i = 0; i < directories.length; i++) {
        if ((url.origin + url.pathname).indexOf(directories[i]) === 0) return true;
      }
    } catch (_) { /* Ignore malformed URLs from unrelated error events. */ }
    return false;
  }

  function stop() {
    done = true;
    if (observer) observer.disconnect();
    window.clearTimeout(slowTimer);
    window.removeEventListener("error", onError, true);
    window.removeEventListener("unhandledrejection", onRejection);
    window.removeEventListener("online", refresh);
    window.removeEventListener("offline", refresh);
    document.removeEventListener("DOMContentLoaded", onParsed);
    if (retry) retry.removeEventListener("click", onRetry);
  }

  function appReady() {
    var root = document.getElementById("root");
    if (!root) return false;
    // React's committed UI or its own error boundary both supersede the shell.
    // Text, comments, scripts and templates alone are not mounted UI.
    for (var i = 0; i < root.children.length; i++) {
      if (!/^(SCRIPT|STYLE|TEMPLATE|NOSCRIPT)$/.test(root.children[i].tagName)) return true;
    }
    return false;
  }

  function refresh() {
    if (done) return;
    shell = document.getElementById("cquisl-loading");
    if (appReady()) {
      stop();
      if (shell) shell.remove();
      var style = document.getElementById("cquisl-loading-style");
      if (style) style.remove();
      return;
    }
    if (!shell) return;
    var status = document.getElementById("cquisl-loading-status");
    var state = "loading";
    var message = "正在加载…";
    if (window.navigator.onLine === false) {
      state = "offline";
      message = "网络已断开，请联网后重试。";
    } else if (failure) {
      state = "error";
      message = failure === "resource" ? "页面资源加载失败，请重试。" : "页面加载出错，请重试。";
    } else if (slow) {
      state = "slow";
      message = "加载较慢，可继续等待或重试。";
    }
    // Avoid triggering the observer or live region again for unchanged state.
    if (shell.getAttribute("data-state") !== state) shell.setAttribute("data-state", state);
    if (status && status.textContent !== message) status.textContent = message;
    var button = document.getElementById("cquisl-loading-retry");
    if (button !== retry) {
      if (retry) retry.removeEventListener("click", onRetry);
      retry = button;
      if (retry) retry.addEventListener("click", onRetry);
    }
    if (retry) retry.hidden = state === "loading";
  }

  function onRetry(event) {
    // Preserve native open-in-new-tab behavior and the exact URL on reload.
    if (event.defaultPrevented || event.button !== 0 || event.metaKey ||
        event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    window.location.reload();
  }

  function onError(event) {
    if (done) return;
    var target = event.target;
    if (target && target.tagName === "SCRIPT" && isAppURL(target.src)) {
      failure = "resource";
    } else if (isAppURL(event.filename)) {
      failure = "runtime";
    } else {
      return;
    }
    refresh();
  }

  function onRejection(event) {
    if (done || !event.reason) return;
    // Dynamic-import failures may be promise rejections rather than error
    // events. Only attribute failures whose message/stack names an app asset.
    var detail = String(event.reason.stack || "") + " " + String(event.reason.message || event.reason);
    var urls = detail.match(/https?:\/\/[^\s\)\]"'<>]+/g) || [];
    for (var i = 0; i < urls.length; i++) {
      if (isAppURL(urls[i].replace(/:\d+(?::\d+)?$/, ""))) {
        failure = "runtime";
        refresh();
        return;
      }
    }
  }

  function onParsed() {
    refresh();
    // If included on a page without the shell, leave that page alone.
    if (!done && !document.getElementById("cquisl-loading")) stop();
  }

  // Do not wait for DOMContentLoaded: it waits for the very module download
  // whose failure/latency the shell is meant to cover. One timer, no polling.
  window.addEventListener("error", onError, true);
  window.addEventListener("unhandledrejection", onRejection);
  window.addEventListener("online", refresh);
  window.addEventListener("offline", refresh);
  document.addEventListener("DOMContentLoaded", onParsed);
  observer = new MutationObserver(refresh);
  observer.observe(document.documentElement, {childList: true, subtree: true});
  slowTimer = window.setTimeout(function () {
    slow = true;
    refresh();
  }, 8000);
  refresh();
}());
