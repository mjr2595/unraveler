/**
 * Unraveler — popup controller.
 */

(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var BOOLEAN_FIELDS = [
    'enabled', 'autoRun', 'expandComments', 'expandHistory',
    'textFallback', 'preserveScroll', 'shiftClick', 'showScrollButton', 'debug'
  ];

  var activeTab = null;
  var pollTimer = null;

  // -------------------------------------------------------------------
  // Settings binding
  // -------------------------------------------------------------------

  function applySettings(cfg) {
    BOOLEAN_FIELDS.forEach(function (key) {
      var el = $(key);
      if (el) el.checked = !!cfg[key];
    });
    $('maxClicks').value = cfg.maxClicks;
    $('maxSeconds').value = Math.round(cfg.maxDurationMs / 1000);
    $('highlightMs').value = cfg.highlightDurationMs;
    $('buttonPosition').value = cfg.buttonPosition;
    $('extraSelectors').value = cfg.extraSelectors || '';
  }

  function save(patch) {
    chrome.storage.sync.set(patch);
  }

  function bindSettings() {
    BOOLEAN_FIELDS.forEach(function (key) {
      var el = $(key);
      if (!el) return;
      el.addEventListener('change', function () {
        var patch = {};
        patch[key] = el.checked;
        save(patch);
      });
    });

    $('maxClicks').addEventListener('change', function () {
      var n = parseInt(this.value, 10);
      if (!isFinite(n) || n < 1) { n = UNRAVELER_DEFAULTS.maxClicks; this.value = n; }
      save({ maxClicks: n });
    });

    $('maxSeconds').addEventListener('change', function () {
      var n = parseInt(this.value, 10);
      if (!isFinite(n) || n < 5) { n = Math.round(UNRAVELER_DEFAULTS.maxDurationMs / 1000); this.value = n; }
      save({ maxDurationMs: n * 1000 });
    });

    $('highlightMs').addEventListener('change', function () {
      var n = parseInt(this.value, 10);
      if (!isFinite(n) || n < 0) { n = UNRAVELER_DEFAULTS.highlightDurationMs; this.value = n; }
      save({ highlightDurationMs: n });
    });

    $('buttonPosition').addEventListener('change', function () {
      save({ buttonPosition: this.value });
    });

    $('extraSelectors').addEventListener('change', function () {
      save({ extraSelectors: this.value });
    });

    $('reset').addEventListener('click', function () {
      chrome.storage.sync.set(UNRAVELER_DEFAULTS, function () {
        applySettings(UNRAVELER_DEFAULTS);
      });
    });
  }

  // -------------------------------------------------------------------
  // Status
  // -------------------------------------------------------------------

  var REASON_TEXT = {
    'idle': 'Idle.',
    'running': 'Expanding…',
    'complete': 'Everything expanded.',
    'max-clicks': 'Stopped at the click limit — content may remain.',
    'timeout': 'Stopped at the time limit — content may remain.',
    'stuck-loading': 'A button stayed stuck loading. Jira may be slow.',
    'cancelled': 'Cancelled.',
    'error': 'Failed — check the page console.'
  };

  function setStatus(kind, line, sub) {
    $('statusDot').className = 'status-dot' + (kind ? ' ' + kind : '');
    $('statusLine').textContent = line;
    $('statusSub').textContent = sub || '';
  }

  function render(status) {
    if (!status) {
      setStatus('', 'Not a Jira page', 'Open a Jira issue to use Unraveler.');
      $('expand').disabled = true;
      $('stop').disabled = true;
      return;
    }

    if (!status.onIssue) {
      setStatus('', 'No issue detected', 'Open an issue, then try again.');
      $('expand').disabled = false;
      $('stop').disabled = true;
      return;
    }

    var key = status.issueKey && status.issueKey !== 'DOM' ? status.issueKey : 'this issue';

    if (status.running) {
      setStatus('running', 'Expanding ' + key + '…',
        status.clicks + ' click' + (status.clicks === 1 ? '' : 's') + ' so far');
      $('expand').disabled = true;
      $('stop').disabled = false;
      return;
    }

    $('expand').disabled = false;
    $('stop').disabled = true;

    var reason = status.reason || 'idle';
    var kind = 'done';
    if (reason === 'error') kind = 'error';
    else if (reason === 'max-clicks' || reason === 'timeout' || reason === 'stuck-loading') kind = 'warn';
    else if (reason === 'idle') kind = '';

    var sub = REASON_TEXT[reason] || reason;
    if (status.usedFallback) sub += ' Matched by text — testids may have changed.';
    if (status.blocked) sub += ' ' + status.blocked + ' unproductive button(s) skipped.';

    var line = reason === 'idle'
      ? 'Ready on ' + key
      : status.clicks + ' button' + (status.clicks === 1 ? '' : 's') + ' clicked';

    setStatus(kind, line, sub);
  }

  function pollStatus() {
    if (!activeTab) return;
    chrome.tabs.sendMessage(activeTab.id, { type: 'unraveler:status' }, function (status) {
      if (chrome.runtime.lastError) {
        // No content script here.
        render(null);
        maybeOfferGrant();
        return;
      }
      $('grantRow').hidden = true;
      render(status);
    });
  }

  // -------------------------------------------------------------------
  // Optional host grant
  // -------------------------------------------------------------------

  function originOf(url) {
    try {
      var u = new URL(url);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
      return u.origin + '/*';
    } catch (err) {
      return null;
    }
  }

  function maybeOfferGrant() {
    var origin = originOf(activeTab && activeTab.url);
    if (!origin) {
      // Not an http(s) page, or the URL is unreadable — nothing grantable, so
      // don't show a button that could only no-op.
      $('grantRow').hidden = true;
      return;
    }
    chrome.permissions.contains({ origins: [origin] }, function (has) {
      $('grantRow').hidden = !!has;
    });
  }

  function bindGrant() {
    $('grant').addEventListener('click', function () {
      var origin = originOf(activeTab && activeTab.url);
      if (!origin) {
        setStatus('error', 'Can\u2019t enable here',
          'Unraveler can only be enabled on an http(s) page.');
        $('grantRow').hidden = true;
        return;
      }

      // Must stay synchronous with the click: request() needs a user gesture.
      chrome.permissions.request({ origins: [origin] }, function (granted) {
        if (chrome.runtime.lastError) {
          setStatus('error', 'Permission request failed', chrome.runtime.lastError.message);
          return;
        }
        if (!granted) {
          setStatus('', 'Not enabled', 'Permission declined for ' + origin + '.');
          return;
        }
        // Chrome usually tears this popup down when the permission dialog
        // takes focus, so this callback may never run. The service worker
        // handles registration and injection off permissions.onAdded instead
        // — reaching here just means we can close early.
        window.close();
      });
    });
  }

  // -------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------

  function bindActions() {
    $('expand').addEventListener('click', function () {
      if (!activeTab) return;
      $('expand').disabled = true;
      setStatus('running', 'Expanding…', '');
      chrome.tabs.sendMessage(activeTab.id, { type: 'unraveler:expand' }, function (status) {
        if (chrome.runtime.lastError) { render(null); return; }
        render(status);
      });
    });

    $('stop').addEventListener('click', function () {
      if (!activeTab) return;
      chrome.tabs.sendMessage(activeTab.id, { type: 'unraveler:cancel' }, function (status) {
        if (chrome.runtime.lastError) return;
        render(status);
      });
    });
  }

  // -------------------------------------------------------------------
  // Boot
  // -------------------------------------------------------------------

  chrome.storage.sync.get(UNRAVELER_DEFAULTS, function (stored) {
    applySettings(Object.assign({}, UNRAVELER_DEFAULTS, stored));
    bindSettings();
    bindActions();
    bindGrant();

    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      activeTab = tabs && tabs[0];
      pollStatus();
      pollTimer = setInterval(pollStatus, 600);
    });
  });

  window.addEventListener('unload', function () {
    if (pollTimer) clearInterval(pollTimer);
  });
})();
