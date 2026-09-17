/**
 * Unraveler — content script entry point.
 *
 * Responsibilities:
 *   - load + live-update settings
 *   - detect which Jira issue (if any) is currently on screen
 *   - kick off an expansion run on navigation, and re-run on demand
 *   - report status to the service worker so it can paint the toolbar badge
 */

(function () {
  'use strict';

  var LOG_PREFIX = '[Unraveler]';

  var cfg = Object.assign({}, UNRAVELER_DEFAULTS);
  var currentKey = null;
  var pendingTimer = null;
  var lastHref = location.href;

  // -------------------------------------------------------------------
  // Settings
  // -------------------------------------------------------------------

  function loadConfig() {
    return new Promise(function (resolve) {
      chrome.storage.sync.get(UNRAVELER_DEFAULTS, function (stored) {
        if (chrome.runtime.lastError) {
          console.warn(LOG_PREFIX, 'Settings read failed, using defaults:', chrome.runtime.lastError.message);
          resolve(Object.assign({}, UNRAVELER_DEFAULTS));
          return;
        }
        resolve(Object.assign({}, UNRAVELER_DEFAULTS, stored));
      });
    });
  }

  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'sync') return;
    Object.keys(changes).forEach(function (key) {
      if (key in cfg) cfg[key] = changes[key].newValue;
    });
    if (cfg.debug) console.log(LOG_PREFIX, 'Settings updated:', cfg);
    updateFab();
  });

  // -------------------------------------------------------------------
  // Issue detection
  // -------------------------------------------------------------------

  var KEY_RE = '[A-Z][A-Z0-9_]*-\\d+';

  /**
   * Returns the issue key currently being viewed, or null.
   *
   * Jira Cloud surfaces issues at several URL shapes — the classic
   * /browse/KEY-1, the board/backlog detail pane via ?selectedIssue=, and the
   * newer project-scoped work item routes.
   */
  function currentIssueKey() {
    var url;
    try {
      url = new URL(location.href);
    } catch (err) {
      return null;
    }

    var browse = url.pathname.match(new RegExp('/browse/(' + KEY_RE + ')', 'i'));
    if (browse) return browse[1].toUpperCase();

    var selected = url.searchParams.get('selectedIssue');
    if (selected && new RegExp('^' + KEY_RE + '$', 'i').test(selected)) {
      return selected.toUpperCase();
    }

    var scoped = url.pathname.match(new RegExp('/(?:issues|work-items?)/(' + KEY_RE + ')', 'i'));
    if (scoped) return scoped[1].toUpperCase();

    // Last resort: a detail pane can be open without the URL reflecting it.
    if (document.querySelector('[data-testid^="issue.views.issue-details"], [data-testid^="issue.activity"]')) {
      return 'DOM';
    }

    return null;
  }

  // -------------------------------------------------------------------
  // Status reporting
  // -------------------------------------------------------------------

  function report(status) {
    var payload = Object.assign({ issueKey: currentKey, enabled: cfg.enabled }, status || {});
    try {
      chrome.runtime.sendMessage({ type: 'unraveler:report', status: payload }, function () {
        // Reading lastError suppresses "Unchecked runtime.lastError" noise
        // when the service worker is asleep or the popup is closed.
        void chrome.runtime.lastError;
      });
    } catch (err) {
      // Extension context can be invalidated by a reload; nothing to do.
    }
  }

  function buildStatus(extra) {
    var last = UnravelerEngine.getLastResult() || {};
    return Object.assign({
      running: UnravelerEngine.isRunning(),
      clicks: last.clicks || 0,
      blocked: last.blocked || 0,
      reason: last.reason || 'idle',
      usedFallback: !!last.usedFallback,
      issueKey: currentKey,
      enabled: cfg.enabled,
      onIssue: !!currentKey
    }, extra || {});
  }

  // -------------------------------------------------------------------
  // Run orchestration
  // -------------------------------------------------------------------

  function startRun(force) {
    if (!force && !cfg.enabled) {
      if (cfg.debug) console.log(LOG_PREFIX, 'Disabled, not running.');
      return Promise.resolve(buildStatus());
    }
    if (!currentKey) {
      if (cfg.debug) console.log(LOG_PREFIX, 'Not an issue view, not running.');
      return Promise.resolve(buildStatus());
    }
    if (UnravelerEngine.isRunning()) {
      return Promise.resolve(buildStatus());
    }
    return UnravelerEngine.run(cfg, function (status) {
      report(buildStatus(status));
    });
  }

  function scheduleRun(delay) {
    if (pendingTimer) clearTimeout(pendingTimer);
    pendingTimer = setTimeout(function () {
      pendingTimer = null;
      startRun(false);
    }, typeof delay === 'number' ? delay : cfg.startupDelayMs);
  }

  function onNavigated() {
    var key = currentIssueKey();
    if (key === currentKey) return;

    if (cfg.debug) console.log(LOG_PREFIX, 'Navigated:', currentKey, '->', key);
    currentKey = key;
    updateFab();

    // Abandon any in-flight run; it belongs to the previous issue.
    UnravelerEngine.cancel();
    report(buildStatus({ running: false, clicks: 0, reason: 'idle' }));

    if (key && cfg.autoRun) scheduleRun(cfg.startupDelayMs);
  }

  // -------------------------------------------------------------------
  // Navigation watching
  // -------------------------------------------------------------------
  //
  // History.pushState cannot be usefully patched from a content script: the
  // isolated world holds a separate JS wrapper, so patching it there never
  // sees the page's own navigations. Polling location.href is boring but
  // correct, and a string comparison every 700ms is free compared to the
  // repeated querySelectorAll the naive userscript does every second.

  function watchNavigation() {
    setInterval(function () {
      if (location.href === lastHref) return;
      lastHref = location.href;
      onNavigated();
    }, 700);

    window.addEventListener('popstate', onNavigated);
    window.addEventListener('hashchange', onNavigated);
  }

  // -------------------------------------------------------------------
  // Messaging
  // -------------------------------------------------------------------

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || typeof msg.type !== 'string') return;

    switch (msg.type) {
      case 'unraveler:status':
        sendResponse(buildStatus());
        return; // synchronous

      case 'unraveler:expand':
        startRun(true).then(function (status) {
          sendResponse(buildStatus(status));
        });
        return true; // async

      case 'unraveler:cancel':
        UnravelerEngine.cancel();
        sendResponse(buildStatus({ running: false, reason: 'cancelled' }));
        return;

      case 'unraveler:scroll-latest':
        sendResponse(UnravelerLatest.scrollToLatest(cfg));
        return; // synchronous

      default:
        return;
    }
  });

  // -------------------------------------------------------------------
  // Floating button
  // -------------------------------------------------------------------

  function mountFab() {
    UnravelerFab.mount(function () { UnravelerLatest.scrollToLatest(cfg); });
  }

  function updateFab() {
    UnravelerFab.setPosition(cfg.buttonPosition);
    UnravelerFab.setVisible(!!currentKey && cfg.enabled && cfg.showScrollButton);
  }

  // -------------------------------------------------------------------
  // Boot
  // -------------------------------------------------------------------

  loadConfig().then(function (loaded) {
    cfg = loaded;
    currentKey = currentIssueKey();
    if (cfg.debug) console.log(LOG_PREFIX, 'Ready on', location.href, 'issue:', currentKey, cfg);

    report(buildStatus());
    watchNavigation();
    mountFab();
    updateFab();

    if (currentKey && cfg.enabled && cfg.autoRun) scheduleRun(cfg.startupDelayMs);
  });
})();
