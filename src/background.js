/**
 * Unraveler — service worker.
 *
 * Kept deliberately thin: badge painting, the keyboard command, and
 * registering the content script on extra Jira hosts the user opts into.
 * All real work lives in the content script.
 */

'use strict';

var DYNAMIC_SCRIPT_ID = 'unraveler-dynamic';

// Derived from the manifest so the file list and the statically matched hosts
// only ever need maintaining in one place.
var STATIC_ENTRY = (chrome.runtime.getManifest().content_scripts || [])[0] || {};
var CONTENT_FILES = STATIC_ENTRY.js || [];
var STATIC_MATCHES = STATIC_ENTRY.matches || [];

// Per-tab status cache. Service workers are evicted aggressively, so this is
// best-effort only — the popup always re-queries the tab directly.
var tabStatus = new Map();

// ---------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------

function paintBadge(tabId, status) {
  if (typeof tabId !== 'number') return;

  var text = '';
  var color = '#5E6C84';

  if (!status || !status.onIssue) {
    text = '';
  } else if (!status.enabled) {
    text = 'off';
    color = '#97A0AF';
  } else if (status.running) {
    text = String(status.clicks || 0);
    color = '#0C66E4';
  } else if (status.reason === 'error') {
    text = '!';
    color = '#C9372C';
  } else if (status.reason === 'max-clicks' || status.reason === 'timeout' || status.reason === 'stuck-loading') {
    // Stopped at a safety limit — there may still be unexpanded content.
    text = String(status.clicks || 0);
    color = '#E56910';
  } else if (status.clicks > 0) {
    text = String(status.clicks);
    color = '#22A06B';
  }

  chrome.action.setBadgeText({ tabId: tabId, text: text }).catch(function () {});
  chrome.action.setBadgeBackgroundColor({ tabId: tabId, color: color }).catch(function () {});
}

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || msg.type !== 'unraveler:report') return;
  var tabId = sender.tab && sender.tab.id;
  if (typeof tabId === 'number') {
    tabStatus.set(tabId, msg.status);
    paintBadge(tabId, msg.status);
  }
  sendResponse({ ok: true });
});

chrome.tabs.onRemoved.addListener(function (tabId) {
  tabStatus.delete(tabId);
});

// ---------------------------------------------------------------------
// Keyboard command
// ---------------------------------------------------------------------

chrome.commands.onCommand.addListener(function (command) {
  if (command !== 'expand-now') return;
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    var tab = tabs && tabs[0];
    if (!tab || typeof tab.id !== 'number') return;
    chrome.tabs.sendMessage(tab.id, { type: 'unraveler:expand' }, function () {
      // Tab has no content script (wrong host) — nothing to do.
      void chrome.runtime.lastError;
    });
  });
});

// ---------------------------------------------------------------------
// Optional hosts
// ---------------------------------------------------------------------
//
// Jira Cloud supports custom domains, so the static manifest match list can
// never be complete. The popup can request access to the current origin; when
// granted we register the same content script for it dynamically.

/** Pull the host out of a match pattern: "*://*.example.com/*" -> "example.com". */
function hostOfPattern(pattern) {
  var m = /^[^:]+:\/\/(?:\*\.)?([^/]+)/.exec(pattern);
  return m ? m[1] : null;
}

/**
 * True if the static content_scripts entry already covers this origin.
 *
 * Registering a dynamic script for an already-matched host would inject the
 * content script twice into the same page.
 */
function isCoveredStatically(origin) {
  if (STATIC_MATCHES.indexOf(origin) !== -1) return true;
  var host = hostOfPattern(origin);
  if (!host) return false;
  return STATIC_MATCHES.some(function (pattern) {
    var base = hostOfPattern(pattern);
    if (!base || base === '*') return false;
    return host === base || host.endsWith('.' + base);
  });
}

async function syncDynamicRegistration() {
  var granted = await chrome.permissions.getAll();
  var origins = (granted.origins || []).filter(function (o) {
    return !isCoveredStatically(o);
  });

  var existing = await chrome.scripting.getRegisteredContentScripts({ ids: [DYNAMIC_SCRIPT_ID] })
    .catch(function () { return []; });

  if (!origins.length) {
    if (existing.length) {
      await chrome.scripting.unregisterContentScripts({ ids: [DYNAMIC_SCRIPT_ID] }).catch(function () {});
    }
    return;
  }

  var definition = {
    id: DYNAMIC_SCRIPT_ID,
    matches: origins,
    js: CONTENT_FILES,
    runAt: 'document_idle',
    allFrames: false,
    persistAcrossSessions: true
  };

  if (existing.length) {
    await chrome.scripting.updateContentScripts([definition]).catch(function (e) {
      console.warn('[Unraveler] Could not update dynamic script:', e && e.message);
    });
  } else {
    await chrome.scripting.registerContentScripts([definition]).catch(function (e) {
      console.warn('[Unraveler] Could not register dynamic script:', e && e.message);
    });
  }
}

/**
 * True if a live content script is already answering in this tab.
 *
 * A second copy in the same isolated world would double up the navigation
 * poller and the message listener, so every injection is probed first.
 */
function hasContentScript(tabId) {
  return new Promise(function (resolve) {
    chrome.tabs.sendMessage(tabId, { type: 'unraveler:status' }, function () {
      resolve(!chrome.runtime.lastError);
    });
  });
}

/**
 * Inject into tabs already open on a freshly granted origin.
 *
 * registerContentScripts only affects future navigations, so without this the
 * tab the user was looking at when they clicked "Enable here" stays inert
 * until they reload it by hand. This lives here rather than in the popup
 * because requesting a permission closes the popup — its request() callback
 * is destroyed before it can run.
 */
async function injectIntoOpenTabs(origins) {
  var wanted = origins.filter(function (origin) {
    return !isCoveredStatically(origin);
  });
  if (!wanted.length) return;

  var tabs = await chrome.tabs.query({ url: wanted }).catch(function () { return []; });

  await Promise.all(tabs.map(async function (tab) {
    if (typeof tab.id !== 'number') return;
    if (await hasContentScript(tab.id)) return;
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: CONTENT_FILES
    }).catch(function (e) {
      console.warn('[Unraveler] Could not inject into tab', tab.id, e && e.message);
    });
  }));
}

chrome.permissions.onAdded.addListener(function (added) {
  syncDynamicRegistration()
    .then(function () { return injectIntoOpenTabs((added && added.origins) || []); })
    .catch(function (e) { console.warn('[Unraveler] Grant follow-up failed:', e && e.message); });
});

chrome.permissions.onRemoved.addListener(syncDynamicRegistration);
chrome.runtime.onInstalled.addListener(syncDynamicRegistration);
chrome.runtime.onStartup.addListener(syncDynamicRegistration);
